import asyncio
import json
import logging
import tempfile
import time
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from app.core.config import S3_BUCKET, MODEL_AUTO_DOWNLOAD, S3_OUTPUT_PREFIX
from app.core.s3 import s3
from app.db.database import db_get_job, db_update_job
from app.models.schemas import Job
from app.services.model import ensure_model
from app.services.speaker import get_voices

# 任务队列，按顺序依次执行
job_queue: asyncio.Queue[str] = asyncio.Queue()

# VoxCPM 模型状态：model 实例和上次使用时间
model_state: dict = {"model": None, "last_used": 0.0, "busy": False}
worker_state: dict = {"current_job_id": None}
logger = logging.getLogger(__name__)

# 模型空闲超时时间（秒），超时后自动释放显存
MODEL_IDLE_SECONDS = 180


def get_worker_status(worker_task: asyncio.Task | None) -> dict:
    return {
        "alive": worker_task is not None and not worker_task.done(),
        "busy": model_state["busy"],
        "current_job_id": worker_state["current_job_id"],
        "queue_size": job_queue.qsize(),
    }


def log_worker_exit(task: asyncio.Task):
    if task.cancelled():
        return
    error = task.exception()
    if error is None:
        logger.error("Job worker stopped unexpectedly")
    else:
        logger.error("Job worker stopped unexpectedly", exc_info=(type(error), error, error.__traceback__))


def _get_or_load_model():
    """获取或懒加载 VoxCPM 模型"""
    if model_state["model"] is None:
        model_path = ensure_model(download=MODEL_AUTO_DOWNLOAD)
        from voxcpm import VoxCPM

        model_state["model"] = VoxCPM.from_pretrained(model_path, load_denoiser=False, local_files_only=True)
    model_state["last_used"] = datetime.now(timezone.utc).timestamp()
    return model_state["model"]


def _unload_model():
    """释放 VoxCPM 模型并清理显存"""
    if model_state["model"] is not None:
        import gc

        import torch

        del model_state["model"]
        model_state["model"] = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def run_job(job_id: str):
    """执行单个 TTS 生成任务并上传结果到 S3."""
    row = db_get_job(job_id)
    if not row:
        return
    job = Job(**row)
    started = time.monotonic()
    job.started_at = datetime.now(timezone.utc).isoformat()
    job.finished_at = None
    job.duration_seconds = None
    job.status = "running"
    db_update_job(job)

    try:
        # 读取 speaker 的 voices 配置
        voices = get_voices(job.speaker_id)
        if not voices:
            raise RuntimeError(f"Speaker {job.speaker_id} not found or has no voices")

        with tempfile.TemporaryDirectory(prefix="zvox-job-") as directory:
            paths = {}
            for key in (voices["prompt_wav_path"], voices["reference_wav_path"]):
                if key not in paths:
                    path = Path(directory) / f"input-{len(paths)}.wav"
                    try:
                        s3.download_file(S3_BUCKET, key, str(path))
                    except Exception as e:
                        raise RuntimeError(f"Failed to download Speaker audio {key}: {e}") from e
                    paths[key] = str(path)

            model = _get_or_load_model()
            wav = model.generate(
                text=job.text,
                prompt_wav_path=paths[voices["prompt_wav_path"]],
                prompt_text=voices["prompt_text"],
                reference_wav_path=paths[voices["reference_wav_path"]],
            )

        import soundfile as sf

        output = BytesIO()
        sf.write(output, wav, model.tts_model.sample_rate, format="WAV")
        del wav
        output.seek(0)
        wav_key = f"{S3_OUTPUT_PREFIX}{job_id}/{job_id}.wav"
        data_key = f"{S3_OUTPUT_PREFIX}{job_id}/data.json"
        data_json = json.dumps(
            {
                "uuid": job_id,
                "speaker_id": job.speaker_id,
                "text": job.text,
                "created_at": job.created_at,
                "created_ip": job.created_ip,
                "output_path": wav_key,
            },
            ensure_ascii=False,
        )
        try:
            s3.upload_fileobj(output, S3_BUCKET, wav_key)
            s3.put_object(Bucket=S3_BUCKET, Key=data_key, Body=data_json.encode("utf-8"), ContentType="application/json")
        except Exception:
            for key in (wav_key, data_key):
                try:
                    s3.delete_object(Bucket=S3_BUCKET, Key=key)
                except Exception:
                    logger.exception("Could not remove incomplete output %s", key)
            raise

        # 存储 S3 对象 key，查询时再生成预签名链接
        job.result_key = wav_key
        job.status = "completed"
    except Exception as e:
        logger.exception("Job %s failed", job_id)
        job.status = "failed"
        job.error = str(e)
    job.finished_at = datetime.now(timezone.utc).isoformat()
    job.duration_seconds = time.monotonic() - started
    db_update_job(job)
    logger.info("Job finished: job_id=%s status=%s duration_seconds=%.3f", job_id, job.status, job.duration_seconds)


async def job_worker():
    """后台 worker 协程，从队列中依次取出任务并执行"""
    while True:
        job_id = await job_queue.get()
        model_state["busy"] = True
        worker_state["current_job_id"] = job_id
        started = time.monotonic()
        started_at = datetime.now(timezone.utc).isoformat()
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, run_job, job_id)
        except Exception:
            logger.exception("Job worker failed for %s", job_id)
            try:
                row = await asyncio.to_thread(db_get_job, job_id)
                if row:
                    job = Job(**row)
                    job.status = "failed"
                    job.error = "Job worker failed"
                    job.started_at = job.started_at or started_at
                    job.finished_at = datetime.now(timezone.utc).isoformat()
                    job.duration_seconds = time.monotonic() - started
                    await asyncio.to_thread(db_update_job, job)
                    logger.info("Job finished: job_id=%s status=failed duration_seconds=%.3f", job_id, job.duration_seconds)
            except Exception:
                logger.exception("Could not mark job %s as failed", job_id)
        finally:
            model_state["last_used"] = datetime.now(timezone.utc).timestamp()
            model_state["busy"] = False
            worker_state["current_job_id"] = None
            job_queue.task_done()


async def model_idle_watcher():
    """每 30 秒检查一次，模型空闲超过 MODEL_IDLE_SECONDS 则释放显存"""
    while True:
        await asyncio.sleep(30)
        if (
            model_state["model"] is not None
            and not model_state["busy"]
            and job_queue.empty()
            and datetime.now(timezone.utc).timestamp() - model_state["last_used"] >= MODEL_IDLE_SECONDS
        ):
            _unload_model()
