import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.api.users import get_current_user
from app.models.schemas import Speaker
from app.services import speaker as speaker_service

router = APIRouter(prefix="/api", tags=["speakers"], dependencies=[Depends(get_current_user)])


@router.get("/speakers", response_model=list[Speaker])
async def list_speakers(user: dict = Depends(get_current_user)):
    """列出当前用户可用的音色: 系统音色、自己的音色与广场公开音色"""
    return await speaker_service.list_speakers(user)


@router.get("/speakers/plaza", response_model=list[Speaker])
async def list_plaza_speakers():
    """音色广场: 浏览系统音色与审核通过的公开音色"""
    return await speaker_service.list_plaza_speakers()


@router.get("/speakers/mine", response_model=list[Speaker])
async def list_my_speakers(user: dict = Depends(get_current_user)):
    """列出我创建的音色及审核状态"""
    return await speaker_service.list_my_speakers(user)


@router.post("/speakers", response_model=Speaker, status_code=201)
async def create_speaker(
    name: str = Form(..., min_length=1, max_length=100),
    prompt_text: str = Form(..., min_length=1, max_length=4096),
    description: str = Form("", max_length=500),
    publish: bool = Form(False),
    audio: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """创建属于当前用户的音色, publish 为 true 时直接提交广场审核"""
    try:
        return await asyncio.to_thread(
            speaker_service.create_speaker, name, description, prompt_text, audio.file, user["id"], publish
        )
    except speaker_service.SpeakerLimitReached as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except speaker_service.AudioTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logging.getLogger(__name__).exception("Could not create speaker")
        raise HTTPException(status_code=503, detail="Could not save speaker") from exc


@router.post("/speakers/{speaker_id}/submit", status_code=204)
async def submit_speaker(speaker_id: int, user: dict = Depends(get_current_user)):
    """提交公开申请, 由管理员审核"""
    return await _speaker_action(speaker_service.submit_speaker, speaker_id, user)


@router.post("/speakers/{speaker_id}/withdraw", status_code=204)
async def withdraw_speaker(speaker_id: int, user: dict = Depends(get_current_user)):
    """撤回公开申请或从广场下架"""
    return await _speaker_action(speaker_service.withdraw_speaker, speaker_id, user)


async def _speaker_action(action, speaker_id: int, user: dict):
    try:
        await action(speaker_id, user)
    except speaker_service.SpeakerNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except speaker_service.InvalidSpeakerState as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/speakers/{speaker_id}", response_model=Speaker)
async def get_speaker(speaker_id: int, user: dict = Depends(get_current_user)):
    """获取单个 speaker 的详细信息"""
    speaker = await speaker_service.get_speaker(speaker_id, user)
    if not speaker:
        raise HTTPException(status_code=404, detail=f"Speaker '{speaker_id}' not found")
    return speaker
