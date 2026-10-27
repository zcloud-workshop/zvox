import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from app.api.users import require_admin
from app.models.schemas import ReviewSpeakerRequest, Speaker, WorkerStatus
from app.services import speaker as speaker_service
from app.services.model import get_download_status, start_download
from app.services.sync import claim_sync, do_sync, get_sync_status as sync_status_snapshot
from app.services.tts import get_worker_status

router = APIRouter(prefix="/api/admin", tags=["Admin"], dependencies=[Depends(require_admin)])


@router.get("/worker", response_model=WorkerStatus)
async def worker_status(request: Request):
    return get_worker_status(getattr(request.app.state, "worker_task", None))


@router.get("/speakers/reviews", response_model=list[Speaker])
async def list_speaker_reviews():
    """列出待审核的广场公开申请"""
    return await speaker_service.list_pending_speakers()


@router.post("/speakers/{speaker_id}/review", response_model=Speaker)
async def review_speaker(speaker_id: int, req: ReviewSpeakerRequest):
    """审核公开申请: 通过后音色进入广场, 驳回附审核意见"""
    try:
        return await speaker_service.review_speaker(speaker_id, req.decision, req.comment)
    except speaker_service.SpeakerNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except speaker_service.InvalidSpeakerState as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/speakers/sync")
def sync_speakers(background_tasks: BackgroundTasks):
    """触发从 S3 单向导入 Speaker 元数据."""
    if not claim_sync():
        return {"status": "already_running"}
    background_tasks.add_task(do_sync)
    return {"status": "submitted"}


@router.get("/speakers/sync/status")
async def get_sync_status():
    """查询当前导入任务的状态和上次导入结果."""
    return sync_status_snapshot()


@router.get("/model")
async def get_model_status():
    """检查模型是否存在，不存在则触发后台异步下载"""
    try:
        return await asyncio.to_thread(start_download)
    except Exception as exc:
        logging.getLogger(__name__).exception("Could not start model download")
        raise HTTPException(status_code=503, detail="Could not start model download") from exc


@router.get("/model/status")
async def get_model_download_status():
    """查询模型状态，已存在直接返回 ready"""
    return await asyncio.to_thread(get_download_status)
