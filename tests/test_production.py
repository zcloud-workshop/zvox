import asyncio
import hashlib
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import DEFAULT, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.main as main
from app.api.admin import router as admin_router
from app.api.health import router as health_router
from app.api.users import router as users_router
from app.services import health, login_rate_limit, tts, user
from app.services.login_rate_limit import LoginRateLimitExceeded, LoginRateLimiter


class LoginRateLimitTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        clock_patch = patch.object(login_rate_limit, "time", SimpleNamespace(monotonic=lambda: self.now))
        clock_patch.start()
        self.addCleanup(clock_patch.stop)

    def test_ip_limit_cannot_be_bypassed_by_switching_usernames(self):
        limiter = LoginRateLimiter(max_per_ip=2, max_per_username=10)
        limiter.check("alice", "192.0.2.1")
        limiter.check("bob", "192.0.2.1")
        with self.assertRaises(LoginRateLimitExceeded):
            limiter.check("charlie", "192.0.2.1")
        limiter.check("charlie", "192.0.2.2")

    def test_account_limit_normalizes_username_across_ips(self):
        limiter = LoginRateLimiter(max_per_ip=10, max_per_username=1)
        limiter.check(" Alice ", "192.0.2.1")
        with self.assertRaises(LoginRateLimitExceeded):
            limiter.check("ALICE", "192.0.2.2")
        limiter.check("bob", "192.0.2.2")

    def test_retry_after_expires_without_extending_the_window(self):
        limiter = LoginRateLimiter(max_per_ip=1, max_per_username=1)
        limiter.check("alice", "192.0.2.1")
        self.now += 0.2
        with self.assertRaises(LoginRateLimitExceeded) as result:
            limiter.check("alice", "192.0.2.1")
        self.assertEqual(result.exception.retry_after, 60)
        self.now = 160.0
        limiter.check("alice", "192.0.2.1")
        self.now = 220.0
        limiter.check("alice", "192.0.2.1")

    def test_concurrent_attempts_do_not_exceed_limit(self):
        limiter = LoginRateLimiter(max_per_ip=3, max_per_username=3)
        barrier = threading.Barrier(8)

        def attempt(_):
            barrier.wait(timeout=2)
            try:
                limiter.check("alice", "192.0.2.1")
                return True
            except LoginRateLimitExceeded:
                return False

        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(attempt, range(8))), 3)

    def test_nonpositive_configuration_is_rejected(self):
        for config in ({"window_seconds": 0}, {"max_per_ip": -1}, {"max_per_username": 0}):
            with self.subTest(config=config), self.assertRaises(ValueError):
                LoginRateLimiter(**config)

    def test_login_returns_retry_after_and_skips_password_work(self):
        app = FastAPI()
        app.state.login_limiter = LoginRateLimiter(max_per_ip=1, max_per_username=10)
        app.include_router(users_router)
        with TestClient(app) as client, patch.object(user, "login", return_value=None) as authenticate:
            self.assertEqual(client.post("/api/auth/login", json={"username": "alice", "password": "bad"}).status_code, 401)
            response = client.post(
                "/api/auth/login", json={"username": "bob", "password": "bad"},
                headers={"X-Forwarded-For": "192.0.2.2"},
            )
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers["Retry-After"], "60")
            self.assertEqual(response.json()["detail"], "Too many login attempts")
            authenticate.assert_called_once_with("alice", "bad")

    def test_successful_login_also_counts_toward_limit(self):
        app = FastAPI()
        app.state.login_limiter = LoginRateLimiter(max_per_ip=1)
        app.include_router(users_router)
        result = {
            "access_token": "token", "token_type": "bearer", "expires_at": "2099-01-01T00:00:00Z",
            "user": {"id": 1, "username": "alice", "role": "user", "is_active": True, "created_at": "now"},
        }
        with TestClient(app) as client, patch.object(user, "login", return_value=result):
            payload = {"username": "alice", "password": "correct"}
            self.assertEqual(client.post("/api/auth/login", json=payload).json(), result)
            self.assertEqual(client.post("/api/auth/login", json=payload).status_code, 429)


class ApiKeyAuthTests(unittest.TestCase):
    def test_prefixed_tokens_check_api_keys_before_sessions(self):
        key_user = {"id": 1, "role": "user", "api_key_id": 7}
        session_user = {"id": 1, "role": "user"}
        for token, key_result, expected in (
            ("zvox_key", key_user, key_user),
            ("zvox_session", None, session_user),  # 登录 Token 恰好带有相同前缀
            ("session", None, session_user),
        ):
            with self.subTest(token=token), patch.object(
                user, "db_get_api_key_user", return_value=key_result
            ) as by_key, patch.object(user, "db_get_session_user", return_value=session_user) as by_session:
                self.assertEqual(user.get_user_for_token(token), expected)
                self.assertEqual(by_key.called, token.startswith("zvox_"))
                self.assertEqual(by_session.called, expected is session_user)
                if by_key.called:
                    key_hash, now, touch_before = by_key.call_args.args
                    self.assertEqual(key_hash, hashlib.sha256(token.encode()).hexdigest())
                    self.assertEqual(
                        datetime.fromisoformat(now) - datetime.fromisoformat(touch_before), timedelta(minutes=1)
                    )

    def test_api_keys_cannot_manage_credentials_or_log_out(self):
        app = FastAPI()
        app.include_router(users_router)
        session_user = {"id": 1, "username": "alice", "role": "user", "is_active": 1, "created_at": "now"}
        headers = {"Authorization": "Bearer zvox_key"}
        with TestClient(app) as client, patch.multiple(
            user, list_api_keys=DEFAULT, create_api_key=DEFAULT, revoke_api_key=DEFAULT, change_password=DEFAULT,
            logout=DEFAULT,
        ) as services:
            services["list_api_keys"].return_value = []
            with patch.object(user, "get_user_for_token", return_value=session_user):
                self.assertEqual(client.get("/api/users/me/api-keys", headers=headers).json(), [])
            services["list_api_keys"].reset_mock()
            with patch.object(user, "get_user_for_token", return_value={**session_user, "api_key_id": 7}):
                response = client.get("/api/users/me", headers=headers)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("api_key_id", response.json())
                for method, path, body in (
                    ("GET", "/api/users/me/api-keys", None),
                    ("POST", "/api/users/me/api-keys", {"name": "derived"}),
                    ("DELETE", "/api/users/me/api-keys/1", None),
                    ("POST", "/api/users/me/password", {"current_password": "old-password", "new_password": "new-password"}),
                    ("POST", "/api/auth/logout", None),
                ):
                    with self.subTest(method=method, path=path):
                        response = client.request(method, path, headers=headers, json=body)
                        self.assertEqual(response.status_code, 403)
                        self.assertEqual(response.json()["detail"], "Login session required")
            for service in services.values():
                service.assert_not_called()


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.state.worker_task = Mock(done=Mock(return_value=False))
        self.app.include_router(health_router)
        self.app.include_router(admin_router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_live_does_not_require_dependencies_or_authentication(self):
        with patch.object(health, "db_check_connection", side_effect=RuntimeError) as database:
            response = self.client.get("/api/health/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
        database.assert_not_called()

    def test_readiness_returns_200_only_when_all_checks_pass(self):
        with patch.object(health, "db_check_connection", return_value=True), patch.object(health, "check_model", return_value=True):
            response = self.client.get("/api/health/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ready", "checks": {"database": True, "model": True, "worker": True}})
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_readiness_reports_each_dependency_failure_without_details(self):
        for failure in ("database", "model", "worker"):
            with self.subTest(failure=failure), patch.object(
                health, "db_check_connection", side_effect=RuntimeError("private connection string") if failure == "database" else None,
                return_value=True,
            ), patch.object(health, "check_model", return_value=failure != "model"), patch.object(health.logger, "warning"):
                self.app.state.worker_task.done.return_value = failure == "worker"
                response = self.client.get("/api/health/ready")
                self.assertEqual(response.status_code, 503)
                self.assertFalse(response.json()["checks"][failure])
                self.assertNotIn("private connection string", response.text)

    def test_missing_worker_is_not_ready(self):
        del self.app.state.worker_task
        with patch.object(health, "db_check_connection", return_value=True), patch.object(health, "check_model", return_value=True):
            self.assertEqual(self.client.get("/api/health/ready").status_code, 503)

    def test_worker_status_requires_admin_and_reports_running_job(self):
        self.assertEqual(self.client.get("/api/admin/worker").status_code, 401)
        headers = {"Authorization": "Bearer token"}
        with patch.object(user, "get_user_for_token", return_value={"role": "user"}):
            self.assertEqual(self.client.get("/api/admin/worker", headers=headers).status_code, 403)
        queue = asyncio.Queue()
        queue.put_nowait("next")
        with patch.object(user, "get_user_for_token", return_value={"role": "admin"}), patch.dict(
            tts.model_state, {"busy": True}
        ), patch.dict(tts.worker_state, {"current_job_id": "current"}), patch.object(tts, "job_queue", queue):
            response = self.client.get("/api/admin/worker", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"alive": True, "busy": True, "current_job_id": "current", "queue_size": 1})

    def test_lifespan_exposes_real_task_and_cancels_it_on_shutdown(self):
        async def idle():
            await asyncio.Event().wait()

        async def scenario():
            app = FastAPI()
            queue = asyncio.Queue()
            with patch.object(main, "init_db"), patch.object(main, "MODEL_AUTO_DOWNLOAD", False), patch.object(
                main, "db_recover_jobs", return_value=["pending"]
            ), patch.object(
                main, "job_queue", queue
            ), patch.object(main, "job_worker", idle), patch.object(main, "model_idle_watcher", idle):
                async with main.lifespan(app):
                    await asyncio.sleep(0)
                    task = app.state.worker_task
                    self.assertTrue(tts.get_worker_status(task)["alive"])
                    self.assertEqual(queue.get_nowait(), "pending")
                    queue.task_done()
                self.assertTrue(task.cancelled())
                self.assertFalse(tts.get_worker_status(task)["alive"])

        asyncio.run(scenario())

    def test_unexpected_worker_exit_is_logged(self):
        async def crash():
            raise RuntimeError("worker crashed")

        async def scenario():
            task = asyncio.create_task(crash())
            await asyncio.gather(task, return_exceptions=True)
            with patch.object(tts.logger, "error") as log:
                tts.log_worker_exit(task)
                log.assert_called_once()
            self.assertFalse(tts.get_worker_status(task)["alive"])

        asyncio.run(scenario())


class JobTimingTests(unittest.TestCase):
    def test_success_and_failure_record_execution_duration(self):
        row = {"id": "job", "speaker_id": 1, "text": "hello", "created_at": "now"}
        voices = {"prompt_text": "hello", "prompt_wav_path": "speaker/1/a.wav", "reference_wav_path": "speaker/1/a.wav"}
        for status in ("completed", "failed"):
            with self.subTest(status=status):
                updates = []
                generate = Mock(return_value=[0.0], side_effect=RuntimeError("failed") if status == "failed" else None)
                model = SimpleNamespace(generate=generate, tts_model=SimpleNamespace(sample_rate=24000))
                with patch.object(tts, "db_get_job", return_value=row), patch.object(
                    tts, "db_update_job", side_effect=lambda job: updates.append(job.model_dump())
                ), patch.object(tts, "get_voices", return_value=voices), patch.object(
                    tts, "_get_or_load_model", return_value=model
                ), patch.object(tts, "s3"), patch.object(
                    tts, "time", SimpleNamespace(monotonic=Mock(side_effect=[100.0, 102.25]))
                ), patch.object(tts.logger, "exception"), patch.object(tts.logger, "info") as log:
                    tts.run_job("job")
                self.assertEqual(updates[0]["status"], "running")
                self.assertIsNone(updates[0]["finished_at"])
                self.assertIsNone(updates[0]["duration_seconds"])
                final = updates[-1]
                self.assertEqual(final["status"], status)
                self.assertEqual(final["duration_seconds"], 2.25)
                self.assertLessEqual(datetime.fromisoformat(final["started_at"]), datetime.fromisoformat(final["finished_at"]))
                log.assert_called_once()

    def test_worker_records_duration_after_unexpected_job_failure_and_continues(self):
        async def scenario():
            queue = asyncio.Queue()
            queue.put_nowait("failed")
            queue.put_nowait("next")
            row = {"id": "failed", "speaker_id": 1, "text": "hello", "created_at": "now"}
            with patch.object(tts, "job_queue", queue), patch.object(
                tts, "run_job", side_effect=[RuntimeError("database write failed"), None]
            ) as run, patch.object(tts, "db_get_job", return_value=row), patch.object(
                tts, "db_update_job"
            ) as update, patch.object(
                tts, "time", SimpleNamespace(monotonic=Mock(side_effect=[100.0, 102.25, 103.0]))
            ), patch.object(tts.logger, "exception"):
                worker = asyncio.create_task(tts.job_worker())
                try:
                    await asyncio.wait_for(queue.join(), timeout=2)
                    job = update.call_args.args[0]
                    self.assertEqual(job.status, "failed")
                    self.assertEqual(job.duration_seconds, 2.25)
                    self.assertIsNotNone(job.started_at)
                    self.assertIsNotNone(job.finished_at)
                    self.assertEqual(run.call_count, 2)
                    self.assertIsNone(tts.get_worker_status(worker)["current_job_id"])
                    self.assertFalse(tts.get_worker_status(worker)["busy"])
                finally:
                    worker.cancel()
                    await asyncio.gather(worker, return_exceptions=True)

        asyncio.run(scenario())
