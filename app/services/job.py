import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from app.db.database import db_get_job, db_get_speaker, db_insert_job, db_list_jobs
from app.core.config import MAX_ACTIVE_JOBS_PER_USER, MAX_JOBS_PER_HOUR, PRESIGNED_EXPIRES_IN, S3_BUCKET
from app.core.s3 import s3
from app.models.schemas import Job, JobListItem
from app.services.speaker import resolve_speaker_key
from app.services.tts import job_queue
from app.tools.url import build_icon_url


class JobLimitExceeded(Exception):
    pass


def _insert_job(
    speaker_id: int, text: str, client_ip: str | None, user_id: int, loop: asyncio.AbstractEventLoop
) -> str:
    """校验 speaker, 创建任务, 返回 job_id"""
    speaker = db_get_speaker(speaker_id)
    if not speaker:
        raise ValueError(f"Speaker '{speaker_id}' not found")

    now = datetime.now(timezone.utc)
    job_id = uuid.uuid4().hex
    job = Job(
        id=job_id,
        speaker_id=speaker_id,
        text=text,
        created_at=now.isoformat(),
        created_ip=client_ip,
    )
    if not db_insert_job(
        job, user_id, MAX_ACTIVE_JOBS_PER_USER, MAX_JOBS_PER_HOUR, (now - timedelta(hours=1)).isoformat()
    ):
        raise JobLimitExceeded("Job limit exceeded")
    loop.call_soon_threadsafe(job_queue.put_nowait, job_id)
    return job_id


async def create_job(speaker_id: int, text: str, client_ip: str | None, user_id: int) -> str:
    return await asyncio.to_thread(_insert_job, speaker_id, text, client_ip, user_id, asyncio.get_running_loop())


async def list_jobs(limit: int, before: str | None, user_id: int | None) -> list[JobListItem]:
    """查询任务列表, 附带 speaker 信息"""
    rows = await asyncio.to_thread(db_list_jobs, limit, before, user_id)
    result = []
    for r in rows:
        icon_path = r["speaker_icon_path"]
        if icon_path:
            icon_path = resolve_speaker_key(icon_path, r["speaker_id"])
        result.append(
            JobListItem(
                id=r["id"],
                created_at=r["created_at"],
                status=r["status"],
                text=r["text"],
                speaker_id=r["speaker_id"],
                speaker_name=r["speaker_name"],
                speaker_icon_url=build_icon_url(icon_path),
                started_at=r["started_at"],
                finished_at=r["finished_at"],
                duration_seconds=r["duration_seconds"],
            )
        )
    return result


async def get_job(job_id: str, user_id: int | None) -> dict | None:
    """查询单个任务详情, 拼接 presigned URL 和 speaker 信息"""
    row = await asyncio.to_thread(db_get_job, job_id, user_id)
    if not row:
        return None

    if row.get("result_key"):
        row["result_url"] = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": row["result_key"]},
            ExpiresIn=PRESIGNED_EXPIRES_IN,
        )
    else:
        row["result_url"] = None

    speaker = await asyncio.to_thread(db_get_speaker, row["speaker_id"])
    icon_path = speaker.get("icon_path") if speaker else None
    if icon_path:
        icon_path = resolve_speaker_key(icon_path, row["speaker_id"])

    if speaker:
        row["speaker_name"] = speaker["name"]
        row["speaker_description"] = speaker["description"]
        row["speaker_icon_url"] = build_icon_url(icon_path)
    else:
        row["speaker_name"] = None
        row["speaker_description"] = None
        row["speaker_icon_url"] = None
    return row
