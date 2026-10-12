import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin import router as admin_router
from app.api.frontend import FrontendFiles, FrontendMount
from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.speakers import router as speakers_router
from app.api.users import router as users_router
from app.core.config import CORS_ORIGINS, MODEL_AUTO_DOWNLOAD
from app.db.database import db_recover_jobs, init_db
from app.services.model import start_download
from app.services.login_rate_limit import LoginRateLimiter
from app.services.tts import job_queue, job_worker, log_worker_exit, model_idle_watcher


@asynccontextmanager
async def lifespan(app):
    """应用生命周期：启动时初始化数据库和后台任务，关闭时取消协程"""
    await asyncio.to_thread(init_db)
    if MODEL_AUTO_DOWNLOAD:
        await asyncio.to_thread(start_download)
    for job_id in await asyncio.to_thread(db_recover_jobs):
        job_queue.put_nowait(job_id)
    worker_task = asyncio.create_task(job_worker())
    app.state.worker_task = worker_task
    worker_task.add_done_callback(log_worker_exit)
    watcher_task = asyncio.create_task(model_idle_watcher())
    try:
        yield
    finally:
        worker_task.cancel()
        watcher_task.cancel()
        await asyncio.gather(worker_task, watcher_task, return_exceptions=True)


app = FastAPI(title="ZVox Manager", lifespan=lifespan)
app.state.login_limiter = LoginRateLimiter()
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(speakers_router)
app.include_router(users_router)
app.include_router(admin_router)
app.include_router(jobs_router)
app.include_router(health_router)

frontend_dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if (frontend_dist / "index.html").is_file():
    app.router.routes.append(FrontendMount("/", app=FrontendFiles(directory=frontend_dist, html=True), name="frontend"))
