from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.users import get_current_user
from app.models.schemas import CreateJobRequest, JobListItem
from app.services import job as job_service

router = APIRouter(prefix="/api", tags=["jobs"])


@router.post("/jobs")
async def create_job(req: CreateJobRequest, request: Request, user: dict = Depends(get_current_user)):
    """创建 TTS 语音生成任务, 校验 speaker 存在后入队"""
    try:
        job_id = await job_service.create_job(
            req.speaker_id,
            req.text,
            request.client.host if request.client else None,
            user,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except job_service.JobLimitExceeded as e:
        raise HTTPException(status_code=429, detail=str(e))
    return {"job_id": job_id}


@router.get("/jobs", response_model=list[JobListItem])
async def list_jobs(
    limit: int = Query(default=20, ge=1, le=100),
    before: str | None = Query(default=None),
    user: dict = Depends(get_current_user),
):
    """按时间倒序分页查询任务列表, 附带 speaker 名称和头像"""
    return await job_service.list_jobs(limit, before, None if user["role"] == "admin" else user["id"])


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user: dict = Depends(get_current_user)):
    """查询单个任务的详细信息和状态"""
    row = await job_service.get_job(job_id, None if user["role"] == "admin" else user["id"])
    if not row:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return row
