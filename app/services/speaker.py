import asyncio
import json
import logging
import secrets
import threading
from datetime import datetime, timezone
from io import BytesIO
from typing import BinaryIO

import soundfile as sf

from app.core.config import MAX_SPEAKERS_PER_USER, S3_BUCKET, S3_SPEAKER_PREFIX
from app.core.s3 import s3
from app.db.database import (
    db_count_speakers_by_owner,
    db_get_speaker,
    db_insert_speaker,
    db_list_pending_speakers,
    db_list_plaza_speakers,
    db_list_speakers,
    db_list_user_speakers,
    db_update_speaker_status,
)
from app.models.schemas import Speaker
from app.tools.url import build_icon_url, build_presigned_url

MAX_AUDIO_BYTES = 20 * 1024 * 1024
speaker_write_lock = threading.Lock()
logger = logging.getLogger(__name__)


class AudioTooLargeError(ValueError):
    pass


class SpeakerLimitReached(Exception):
    pass


class SpeakerNotFound(ValueError):
    pass


class InvalidSpeakerState(ValueError):
    pass


def can_use(speaker: dict, user: dict) -> bool:
    """判断用户能否使用该音色: 管理员全量, 系统音色与已公开音色所有人可用, 其余仅创建者."""
    if user["role"] == "admin":
        return True
    owner_id = speaker.get("owner_user_id")
    return owner_id is None or owner_id == user["id"] or speaker.get("status") == "approved"


def create_speaker(
    name: str, description: str, prompt_text: str, audio: BinaryIO,
    owner_user_id: int | None = None, publish: bool = False,
) -> Speaker:
    name, description, prompt_text = name.strip(), description.strip(), prompt_text.strip()
    if not name or not prompt_text:
        raise ValueError("音色名称和音频对应文本不能为空.")
    if owner_user_id is not None and db_count_speakers_by_owner(owner_user_id) >= MAX_SPEAKERS_PER_USER:
        raise SpeakerLimitReached(f"每个用户最多创建 {MAX_SPEAKERS_PER_USER} 个音色.")
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
            db_insert_speaker(
                speaker_id, name, description, prompt_text, audio_key,
                owner_user_id=owner_user_id,
                status="pending" if publish and owner_user_id is not None else (
                    "private" if owner_user_id is not None else None
                ),
                created_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception:
            for key in (metadata_key, audio_key):
                try:
                    s3.delete_object(Bucket=S3_BUCKET, Key=key)
                except Exception:
                    logger.exception("Could not remove incomplete speaker object %s", key)
                    break
            raise
    return Speaker(id=speaker_id, name=name, description=description, owner_id=owner_user_id,
                   status="pending" if publish and owner_user_id is not None else (
                       "private" if owner_user_id is not None else None
                   ))


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


def _speaker_from_row(row: dict, *, with_audio: bool = False, with_comment: bool = False) -> Speaker:
    icon_path = resolve_speaker_key(row["icon_path"], row["id"]) if row.get("icon_path") else None
    audio_url = None
    if with_audio and row.get("reference_wav_path"):
        audio_url = build_presigned_url(resolve_speaker_key(row["reference_wav_path"], row["id"]))
    return Speaker(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        icon_url=build_icon_url(icon_path),
        owner_id=row.get("owner_user_id"),
        owner_username=row.get("owner_username"),
        status=row.get("status"),
        review_comment=row.get("review_comment") if with_comment else None,
        audio_url=audio_url,
    )


async def list_speakers(user: dict) -> list[Speaker]:
    """查询当前用户可用的音色: 系统音色、自己的音色与广场公开音色"""
    rows = await asyncio.to_thread(db_list_speakers, user)
    return [_speaker_from_row(r) for r in rows]


async def list_plaza_speakers() -> list[Speaker]:
    """查询音色广场的公开音色"""
    rows = await asyncio.to_thread(db_list_plaza_speakers)
    return [_speaker_from_row(r, with_audio=True) for r in rows]


async def list_my_speakers(user: dict) -> list[Speaker]:
    """查询当前用户创建的音色及审核状态"""
    rows = await asyncio.to_thread(db_list_user_speakers, user["id"])
    return [_speaker_from_row(r, with_audio=True, with_comment=True) for r in rows]


async def list_pending_speakers() -> list[Speaker]:
    """查询待管理员审核的公开申请"""
    rows = await asyncio.to_thread(db_list_pending_speakers)
    return [_speaker_from_row(r, with_audio=True) for r in rows]


async def get_speaker(speaker_id: int, user: dict) -> Speaker | None:
    """查询单个 speaker, 用户无权使用时按不存在处理"""
    speaker = await asyncio.to_thread(db_get_speaker, speaker_id)
    if not speaker or not can_use(speaker, user):
        return None
    return _speaker_from_row(speaker, with_audio=True)


def _owned_speaker(speaker_id: int, user: dict) -> dict:
    """校验音色存在且由当前用户创建, 不满足时按不存在处理以避免枚举他人音色."""
    speaker = db_get_speaker(speaker_id)
    if not speaker or speaker["owner_user_id"] != user["id"]:
        raise SpeakerNotFound(f"Speaker '{speaker_id}' not found")
    return speaker


async def submit_speaker(speaker_id: int, user: dict) -> Speaker:
    """创建者提交公开申请, 进入待审核状态"""
    return await asyncio.to_thread(_transition_owned, speaker_id, user, "pending", ("private", "rejected"))


async def withdraw_speaker(speaker_id: int, user: dict) -> Speaker:
    """创建者撤回公开申请或从广场下架, 回到私有状态"""
    return await asyncio.to_thread(_transition_owned, speaker_id, user, "private", ("pending", "approved"))


def _transition_owned(speaker_id: int, user: dict, status: str, allowed_from: tuple[str, ...]) -> Speaker:
    _owned_speaker(speaker_id, user)
    row = db_update_speaker_status(speaker_id, status, allowed_from, None)
    if row is None:
        raise InvalidSpeakerState("当前状态不允许该操作")
    return _speaker_from_row(row, with_comment=True)


async def review_speaker(speaker_id: int, decision: str, comment: str | None) -> Speaker:
    """管理员审核公开申请: 通过进入广场, 驳回附审核意见"""
    status = "approved" if decision == "approve" else "rejected"
    return await asyncio.to_thread(_review_speaker, speaker_id, status, comment)


def _review_speaker(speaker_id: int, status: str, comment: str | None) -> Speaker:
    row = db_update_speaker_status(speaker_id, status, ("pending",), comment)
    if row is None:
        if db_get_speaker(speaker_id) is None:
            raise SpeakerNotFound(f"Speaker '{speaker_id}' not found")
        raise InvalidSpeakerState("只有待审核的音色才能执行审核")
    return _speaker_from_row(row, with_comment=True)


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
