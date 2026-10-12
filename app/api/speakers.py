from fastapi import APIRouter, HTTPException

from app.models.schemas import Speaker
from app.services import speaker as speaker_service

router = APIRouter(prefix="/api", tags=["speakers", "Guest"])


@router.get("/speakers", response_model=list[Speaker])
async def list_speakers():
    """列出所有 speaker 及其信息"""
    return await speaker_service.list_speakers()


@router.get("/speakers/{speaker_id}", response_model=Speaker)
async def get_speaker(speaker_id: int):
    """获取单个 speaker 的详细信息"""
    speaker = await speaker_service.get_speaker(speaker_id)
    if not speaker:
        raise HTTPException(status_code=404, detail=f"Speaker '{speaker_id}' not found")
    return speaker
