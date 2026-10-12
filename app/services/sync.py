import json
import threading

from app.core.config import S3_BUCKET, S3_SPEAKER_PREFIX
from app.core.s3 import s3
from app.db.database import get_db
from app.services.speaker import resolve_speaker_key, speaker_write_lock

sync_status = {"running": False, "last_result": None}
_sync_lock = threading.Lock()


def claim_sync() -> bool:
    with _sync_lock:
        if sync_status["running"]:
            return False
        sync_status["running"] = True
        return True


def get_sync_status() -> dict:
    with _sync_lock:
        return sync_status.copy()


def do_sync():
    """从 S3 导入 Speaker 元数据, 完整校验后更新数据库."""
    imported = 0
    deleted = 0
    errors = []
    try:
        imported, deleted = sync_speakers_to_db()
    except Exception as e:
        errors.append({"key": None, "error": str(e)})
    finally:
        with _sync_lock:
            sync_status["last_result"] = {
                "downloaded": 0,
                "uploaded": 0,
                "skipped": 0,
                "imported": imported,
                "deleted": deleted,
                "errors": errors,
            }
            sync_status["running"] = False


def sync_speakers_to_db() -> tuple[int, int]:
    """读取 S3 中全部 vox-data.json, 在单个事务中更新 Speaker 索引."""
    with speaker_write_lock:
        return _sync_speakers_to_db()


def _sync_speakers_to_db() -> tuple[int, int]:
    prefix = S3_SPEAKER_PREFIX.rstrip("/") + "/"
    metadata_keys = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            relative = key[len(prefix):]
            parts = relative.split("/")
            if len(parts) == 2 and parts[1] == "vox-data.json":
                metadata_keys.append(key)

    if not metadata_keys:
        raise ValueError(f"No Speaker metadata found under {prefix}; existing index preserved")

    speakers = []
    seen_ids: set[int] = set()
    for key in sorted(metadata_keys):
        try:
            response = s3.get_object(Bucket=S3_BUCKET, Key=key)
            data = json.loads(response["Body"].read().decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
            raw_id = data["id"]
            if isinstance(raw_id, bool) or not isinstance(raw_id, (int, str)) or not str(raw_id).isdigit():
                raise ValueError("Invalid speaker id")
            speaker_id = int(raw_id)
            if speaker_id <= 0 or speaker_id in seen_ids:
                raise ValueError("Invalid or duplicate speaker id")
            if key != f"{prefix}{speaker_id}/vox-data.json":
                raise ValueError("Speaker id does not match object key")
            name = data["name"]
            voices = data["voices"]
            if not isinstance(name, str) or not name.strip() or not isinstance(voices, dict):
                raise ValueError("Invalid speaker name or voices")
            if any(
                data.get(field) is not None and not isinstance(data[field], str)
                for field in ("description", "icon_path")
            ):
                raise ValueError("Invalid speaker metadata")
            voice_values = [voices[field] for field in ("prompt_text", "prompt_wav_path", "reference_wav_path")]
            if any(not isinstance(value, str) or not value.strip() for value in voice_values):
                raise ValueError("Missing voice configuration")
            for value in voice_values[1:]:
                resolve_speaker_key(value, speaker_id)
            if data.get("icon_path"):
                resolve_speaker_key(data["icon_path"], speaker_id)
        except Exception as e:
            raise ValueError(f"{key}: {e}") from e
        seen_ids.add(speaker_id)
        speakers.append((speaker_id, name, data.get("description"), data.get("icon_path"), *voice_values))

    conn = get_db()
    try:
        for speaker in speakers:
            conn.execute(
                """INSERT INTO speakers
                   (id, name, description, icon_path, prompt_text, prompt_wav_path, reference_wav_path)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT(id) DO UPDATE SET
                       name=excluded.name, description=excluded.description,
                       icon_path=excluded.icon_path, prompt_text=excluded.prompt_text,
                       prompt_wav_path=excluded.prompt_wav_path, reference_wav_path=excluded.reference_wav_path""",
                speaker,
            )
        cursor = conn.execute(
            "DELETE FROM speakers WHERE NOT (id = ANY(%s))", (sorted(seen_ids),)
        )
        conn.commit()
        return len(speakers), cursor.rowcount
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
