import asyncio
import json
import logging
import secrets
import threading
from io import BytesIO
from typing import BinaryIO

import soundfile as sf

from app.core.config import S3_BUCKET, S3_SPEAKER_PREFIX
from app.core.s3 import s3
from app.db.database import db_get_speaker, db_insert_speaker, db_list_speakers
from app.models.schemas import Speaker
from app.tools.url import build_icon_url

MAX_AUDIO_BYTES = 20 * 1024 * 1024
speaker_write_lock = threading.Lock()
logger = logging.getLogger(__name__)


class AudioTooLargeError(ValueError):
    pass


def create_speaker(name: str, description: str, prompt_text: str, audio: BinaryIO) -> Speaker:
    name, description, prompt_text = name.strip(), description.strip(), prompt_text.strip()
    if not name or not prompt_text:
        raise ValueError("音色名称和音频对应文本不能为空.")
    audio.seek(0, 2)
    size = audio.tell()
    if size > MAX_AUDIO_BYTES:
        raise AudioTooLargeError("音频文件不能超过 20 MB.")
    audio.seek(0)
    header = audio.read(12)
    if header[:4] == b"RIFF" and int.from_bytes(header[4:8], "little") + 8 > size:
        raise ValueError("音频文件不完整, 请重新选择.")
    audio.seek(0)
    try:
        with sf.SoundFile(audio) as source:
            if source.format not in {"WAV", "WAVEX", "MP3", "FLAC", "OGG"}:
                raise ValueError("请选择 WAV, MP3, FLAC 或 OGG 音频.")
            if not 0 < source.frames <= source.samplerate * 30:
                raise ValueError("音频时长需大于 0 且不超过 30 秒.")
            if source.channels not in (1, 2) or not 8000 <= source.samplerate <= 192000:
                raise ValueError("音频需为单声道或双声道, 采样率在 8-192 kHz 之间.")
            samples = source.read(dtype="float32", always_2d=True)
            if len(samples) != source.frames:
                raise ValueError("音频文件不完整, 请重新选择.")
            output = BytesIO()
            sf.write(output, samples.mean(axis=1), source.samplerate, format="WAV", subtype="PCM_16")
    except (sf.LibsndfileError, EOFError) as exc:
        raise ValueError("无法读取音频, 请检查文件是否完整且格式受支持.") from exc

    with speaker_write_lock:
        speaker_id = secrets.randbelow(2**53 - 1) + 1
        audio_key = f"{S3_SPEAKER_PREFIX.rstrip('/')}/{speaker_id}/reference.wav"
        metadata_key = f"{S3_SPEAKER_PREFIX.rstrip('/')}/{speaker_id}/vox-data.json"
        metadata = {
            "id": speaker_id,
            "name": name,
            "description": description,
            "voices": {
                "prompt_text": prompt_text,
                "prompt_wav_path": audio_key,
                "reference_wav_path": audio_key,
            },
        }
        # 先占用唯一对象 key, 避免覆盖已有音色资源.
        s3.put_object(
            Bucket=S3_BUCKET, Key=audio_key, Body=output.getvalue(),
            ContentType="audio/wav", IfNoneMatch="*",
        )
        try:
            s3.put_object(
                Bucket=S3_BUCKET, Key=metadata_key,
                Body=json.dumps(metadata, ensure_ascii=False).encode("utf-8"),
                ContentType="application/json",
            )
            db_insert_speaker(speaker_id, name, description, prompt_text, audio_key)
        except Exception:
            for key in (metadata_key, audio_key):
                try:
                    s3.delete_object(Bucket=S3_BUCKET, Key=key)
                except Exception:
                    logger.exception("Could not remove incomplete speaker object %s", key)
                    break
            raise
    return Speaker(id=speaker_id, name=name, description=description)


def resolve_speaker_key(value: str, speaker_id: int) -> str:
    """展开 Speaker 模板并限制对象 key 在对应 ID 的前缀内."""
    key = value.replace("{id}", str(speaker_id))
    root = f"{S3_SPEAKER_PREFIX.rstrip('/')}/{speaker_id}/"
    if not key.startswith(root):
        raise ValueError(f"Invalid Speaker object key: {value}")
    relative = key[len(root):]
    if not relative or any(part in ("", ".", "..") for part in relative.split("/")) or any(
        char in key for char in ("\\", "{", "}", "\x00")
    ):
        raise ValueError(f"Invalid Speaker object key: {value}")
    return key


async def list_speakers() -> list[Speaker]:
    """查询所有 speaker"""
    rows = await asyncio.to_thread(db_list_speakers)
    return [
        Speaker(
            id=r["id"],
            name=r["name"],
            description=r["description"],
            icon_url=build_icon_url(resolve_speaker_key(r["icon_path"], r["id"]) if r.get("icon_path") else None),
        )
        for r in rows
    ]


async def get_speaker(speaker_id: int) -> Speaker | None:
    """查询单个 speaker"""
    speaker = await asyncio.to_thread(db_get_speaker, speaker_id)
    if not speaker:
        return None
    icon_path = resolve_speaker_key(speaker["icon_path"], speaker_id) if speaker.get("icon_path") else None
    return Speaker(
        id=speaker_id,
        name=speaker["name"],
        description=speaker["description"],
        icon_url=build_icon_url(icon_path),
    )


def get_voices(speaker_id: int) -> dict | None:
    """从数据库读取指定 Speaker 的配置并展开 S3 对象 key."""
    speaker = db_get_speaker(speaker_id)
    if not speaker:
        return None
    return {
        "prompt_text": speaker.get("prompt_text", ""),
        "prompt_wav_path": resolve_speaker_key(speaker["prompt_wav_path"], speaker_id),
        "reference_wav_path": resolve_speaker_key(speaker["reference_wav_path"], speaker_id),
    }
