from fastapi import APIRouter, Request, Response

from app.models.schemas import ReadinessResponse
from app.services.health import get_readiness

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/live")
async def liveness():
    return {"status": "ok"}


@router.get("/ready", response_model=ReadinessResponse, responses={503: {"model": ReadinessResponse}})
async def readiness(request: Request, response: Response):
    result = await get_readiness(getattr(request.app.state, "worker_task", None))
    response.status_code = 200 if result["status"] == "ready" else 503
    response.headers["Cache-Control"] = "no-store"
    return result
