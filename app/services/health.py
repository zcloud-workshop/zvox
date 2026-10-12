import asyncio
import logging

from app.db.database import db_check_connection
from app.services.model import check_model
from app.services.tts import get_worker_status

logger = logging.getLogger(__name__)


async def get_readiness(worker_task: asyncio.Task | None) -> dict:
    database, model = await asyncio.gather(
        asyncio.to_thread(db_check_connection), asyncio.to_thread(check_model), return_exceptions=True
    )
    checks = {"database": database is True, "model": model is True, "worker": get_worker_status(worker_task)["alive"]}
    for name, result in (("database", database), ("model", model)):
        if isinstance(result, Exception):
            logger.warning("Readiness check failed: %s", name)
    return {"status": "ready" if all(checks.values()) else "not_ready", "checks": checks}
