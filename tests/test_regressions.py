import asyncio
import json
import os
import tempfile
import threading
import unittest
import wave
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

from app.db import database
from app.main import app
from app.models.schemas import Job
from app.services import job as job_service
from app.services import model, speaker, sync, tts, user
from app.services.login_rate_limit import LoginRateLimiter


class DatabaseCase(unittest.TestCase):
    def setUp(self):
        test_url = os.getenv("TEST_DATABASE_URL")
        if not test_url:
            self.skipTest("TEST_DATABASE_URL is required for PostgreSQL integration tests")
        schema = "zvox_test_" + uuid.uuid4().hex
        with psycopg.connect(test_url, connect_timeout=10) as conn:
            conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))

        def drop_schema():
            with psycopg.connect(test_url, connect_timeout=10) as conn:
                conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))

        self.addCleanup(drop_schema)
        test_url = make_conninfo(test_url, options=f"-c search_path={schema}")
        db_patch = patch.object(database, "DATABASE_URL", test_url)
        db_patch.start()
        self.addCleanup(db_patch.stop)
        database.init_db()
        limiter_patch = patch.object(app.state, "login_limiter", LoginRateLimiter())
        limiter_patch.start()
        self.addCleanup(limiter_patch.stop)


class UserApiTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.admin = user.create_user("admin", "admin-password-123", "admin")
        self.alice = user.create_user("alice", "alice-password-123")
        self.bob = user.create_user("bob", "bob-password-123")
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(self._drain_queue)

    def _drain_queue(self):
        while not tts.job_queue.empty():
            tts.job_queue.get_nowait()
            tts.job_queue.task_done()

    def auth(self, username: str, password: str) -> dict:
        response = self.client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    def test_user_management_and_authentication(self):
        self.assertEqual(self.client.get("/api/jobs").status_code, 401)
        self.assertEqual(
            self.client.post("/api/auth/login", json={"username": "alice", "password": "wrong"}).status_code,
            401,
        )
        admin_auth = self.auth("admin", "admin-password-123")
        alice_auth = self.auth("alice", "alice-password-123")
        self.assertEqual(self.client.get("/api/admin/users", headers=alice_auth).status_code, 403)
        self.assertEqual(self.client.get("/api/admin/users", headers=admin_auth).status_code, 200)
        self.assertEqual(
            self.client.patch(f"/api/admin/users/{self.admin['id']}", headers=admin_auth, json={"is_active": False}).status_code,
            409,
        )
        response = self.client.post(
            "/api/admin/users",
            headers=admin_auth,
            json={"username": "charlie", "password": "12345678"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertNotIn("password_hash", response.json())
        response = self.client.post(
            f"/api/admin/users/{self.alice['id']}/password",
            headers=admin_auth,
            json={"password": "87654321"},
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.client.get("/api/users/me", headers=alice_auth).status_code, 401)
        new_auth = self.auth("alice", "87654321")
        self.assertEqual(
            self.client.post(
                "/api/users/me/password",
                headers=new_auth,
                json={"current_password": "87654321", "new_password": "abcdefgh"},
            ).status_code,
            204,
        )
        self.assertEqual(self.client.get("/api/users/me", headers=new_auth).status_code, 401)
        latest_auth = self.auth("alice", "abcdefgh")
        self.assertEqual(
            self.client.patch(
                f"/api/admin/users/{self.alice['id']}", headers=admin_auth, json={"is_active": False}
            ).status_code,
            200,
        )
        self.assertEqual(self.client.get("/api/users/me", headers=latest_auth).status_code, 401)
        bob_auth = self.auth("bob", "bob-password-123")
        self.assertEqual(self.client.post("/api/auth/logout", headers=bob_auth).status_code, 204)
        self.assertEqual(self.client.get("/api/users/me", headers=bob_auth).status_code, 401)
        with patch.object(user, "SESSION_TTL", timedelta(seconds=-1)):
            expired_auth = self.auth("bob", "bob-password-123")
        self.assertEqual(self.client.get("/api/users/me", headers=expired_auth).status_code, 401)

    def test_job_ownership_null_icon_and_capacity(self):
        conn = database.get_db()
        conn.execute("INSERT INTO speakers (id, name, icon_path) VALUES (1, 'Speaker', NULL)")
        conn.commit()
        conn.close()
        alice_auth = self.auth("alice", "alice-password-123")
        bob_auth = self.auth("bob", "bob-password-123")
        admin_auth = self.auth("admin", "admin-password-123")

        with patch("app.services.job.MAX_ACTIVE_JOBS_PER_USER", 1):
            response = self.client.post("/api/jobs", headers=alice_auth, json={"speaker_id": 1, "text": "hello"})
            self.assertEqual(response.status_code, 200, response.text)
            job_id = response.json()["job_id"]
            self.assertEqual(
                self.client.post("/api/jobs", headers=alice_auth, json={"speaker_id": 1, "text": "again"}).status_code,
                429,
            )

        detail = self.client.get(f"/api/jobs/{job_id}", headers=alice_auth)
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertIsNone(detail.json()["speaker_icon_url"])
        self.assertEqual(self.client.get(f"/api/jobs/{job_id}", headers=bob_auth).status_code, 404)
        self.assertEqual(self.client.get("/api/jobs", headers=bob_auth).json(), [])
        self.assertEqual(len(self.client.get("/api/jobs", headers=admin_auth).json()), 1)

    def test_hourly_limit_applies_after_job_completes(self):
        conn = database.get_db()
        conn.execute("INSERT INTO speakers (id, name) VALUES (1, 'Speaker')")
        conn.commit()
        conn.close()
        auth = self.auth("alice", "alice-password-123")
        with patch("app.services.job.MAX_JOBS_PER_HOUR", 1):
            response = self.client.post("/api/jobs", headers=auth, json={"speaker_id": 1, "text": "first"})
            self.assertEqual(response.status_code, 200)
            job = Job(**database.db_get_job(response.json()["job_id"]))
            job.status = "completed"
            database.db_update_job(job)
            self.assertEqual(
                self.client.post("/api/jobs", headers=auth, json={"speaker_id": 1, "text": "second"}).status_code,
                429,
            )

    def test_duplicate_username_returns_conflict(self):
        response = self.client.post(
            "/api/admin/users", headers=self.auth("admin", "admin-password-123"),
            json={"username": "ALICE", "password": "another-password-123"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Username already exists")


class PostgreSQLConcurrencyTests(DatabaseCase):
    def test_concurrent_job_submissions_respect_both_limits(self):
        for kind in ("active", "hourly"):
            with self.subTest(kind=kind):
                owner = user.create_user(f"owner-{kind}", "owner-password-123")
                barrier = threading.Barrier(5)

                def submit(index):
                    job = Job(
                        id=f"{kind}-{index}", speaker_id=1, text="test", created_at="now",
                        status="pending" if kind == "active" else "completed",
                    )
                    barrier.wait(timeout=10)
                    return database.db_insert_job(
                        job, owner["id"], 1 if kind == "active" else 10, 1 if kind == "hourly" else 10, ""
                    )

                with ThreadPoolExecutor(max_workers=5) as pool:
                    self.assertEqual(sum(pool.map(submit, range(5))), 1)
                self.assertEqual(len(database.db_list_jobs(10, None, owner["id"])), 1)

    def test_concurrent_admin_changes_preserve_last_active_admin(self):
        admins = [user.create_user(f"admin-{index}", "admin-password-123", "admin") for index in range(2)]
        barrier = threading.Barrier(2)

        def disable(admin):
            barrier.wait(timeout=10)
            try:
                database.db_update_user(admin["id"], None, False)
                return True
            except ValueError as exc:
                self.assertEqual(str(exc), "Cannot disable or demote the last active admin")
                return False

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sum(pool.map(disable, admins)), 1)
        self.assertEqual(sum(row["is_active"] for row in database.db_list_users()), 1)


class JobRecoveryTests(DatabaseCase):
    def test_job_timing_upgrade_persistence_and_recovery(self):
        owner = user.create_user("owner", "owner-password-123")
        job = Job(id="timed", speaker_id=1, text="test", created_at="now")
        self.assertTrue(database.db_insert_job(job, owner["id"], 10, 60, ""))
        with database.get_db() as conn:
            for column in ("started_at", "finished_at", "duration_seconds"):
                conn.execute(sql.SQL("ALTER TABLE jobs DROP COLUMN {}").format(sql.Identifier(column)))
        database.init_db()
        self.assertIsNone(database.db_get_job(job.id)["duration_seconds"])
        self.assertTrue(database.db_check_connection())
        job.started_at = "2026-10-07T01:00:00+00:00"
        job.finished_at = "2026-10-07T01:00:02+00:00"
        job.duration_seconds = 2.25
        job.status = "completed"
        database.db_update_job(job)
        self.assertEqual(database.db_get_job(job.id)["duration_seconds"], 2.25)
        item = asyncio.run(job_service.list_jobs(20, None, owner["id"]))[0]
        self.assertEqual(item.started_at, job.started_at)
        self.assertEqual(item.finished_at, job.finished_at)
        self.assertEqual(item.duration_seconds, 2.25)
        self.assertEqual(database.db_recover_jobs(), [])
        job.status = "running"
        database.db_update_job(job)
        self.assertEqual(database.db_recover_jobs(), [job.id])
        recovered = database.db_get_job(job.id)
        self.assertEqual(recovered["status"], "pending")
        for field in ("started_at", "finished_at", "duration_seconds"):
            self.assertIsNone(recovered[field])

    def test_init_db_is_idempotent_and_requires_database_url(self):
        owner = user.create_user("owner", "owner-password-123")
        database.init_db()
        self.assertEqual(database.db_get_user(owner["id"])["username"], "owner")
        with patch.object(database, "DATABASE_URL", ""), self.assertRaisesRegex(RuntimeError, "DATABASE_URL"):
            database.get_db()

    def test_enqueue_survives_debug_mode_and_request_cancellation(self):
        owner = user.create_user("owner", "owner-password-123")
        conn = database.get_db()
        conn.execute("INSERT INTO speakers (id, name) VALUES (1, 'Speaker')")
        conn.commit()
        conn.close()

        async def debug_scenario():
            asyncio.get_running_loop().set_debug(True)
            queue = asyncio.Queue()
            with patch.object(job_service, "job_queue", queue):
                job_id = await job_service.create_job(1, "hello", None, owner["id"])
                self.assertEqual(await asyncio.wait_for(queue.get(), timeout=1), job_id)
                queue.task_done()

        async def cancelled_scenario():
            queue = asyncio.Queue()
            started = threading.Event()
            resume = threading.Event()
            original_insert = job_service.db_insert_job

            def delayed_insert(*args):
                started.set()
                resume.wait(timeout=2)
                return original_insert(*args)

            with patch.object(job_service, "job_queue", queue), patch.object(
                job_service, "db_insert_job", side_effect=delayed_insert
            ):
                task = asyncio.create_task(job_service.create_job(1, "cancelled", None, owner["id"]))
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                resume.set()
                job_id = await asyncio.wait_for(queue.get(), timeout=1)
                self.assertEqual(database.db_get_job(job_id)["text"], "cancelled")
                queue.task_done()

        asyncio.run(debug_scenario())
        asyncio.run(cancelled_scenario())

    def test_existing_database_gets_user_column(self):
        conn = database.get_db()
        conn.execute("DROP TABLE jobs")
        conn.execute(
            "CREATE TABLE jobs (id TEXT PRIMARY KEY, speaker_id INTEGER NOT NULL, text TEXT NOT NULL, "
            "status TEXT NOT NULL, created_at TEXT NOT NULL, created_ip TEXT, result_key TEXT, error TEXT)"
        )
        conn.execute(
            "INSERT INTO jobs (id, speaker_id, text, status, created_at) VALUES ('legacy', 1, 'old', 'completed', 'now')"
        )
        conn.commit()
        conn.close()
        database.init_db()
        self.assertIsNone(database.db_get_job("legacy")["user_id"])

    def test_running_jobs_recover_and_list_uses_index(self):
        owner = user.create_user("owner", "owner-password-123")
        for job_id, status in (("old", "running"), ("new", "pending")):
            job = Job(id=job_id, speaker_id=1, text="test", status="pending", created_at=job_id)
            self.assertTrue(database.db_insert_job(job, owner["id"], 10, 10, ""))
            if status == "running":
                job.status = status
                database.db_update_job(job)
        self.assertEqual(database.db_recover_jobs(), ["new", "old"])
        self.assertEqual(database.db_get_job("old")["status"], "pending")
        with database.get_db() as conn:
            conn.execute("SET LOCAL enable_seqscan=off")
            plan = conn.execute("EXPLAIN SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20").fetchall()
        self.assertTrue(any("idx_jobs_created_at" in row["QUERY PLAN"] for row in plan))


class SpeakerUploadTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        user.create_user("admin", "admin-password-123", "admin")
        user.create_user("alice", "alice-password-123")
        token = user.login("admin", "admin-password-123")["access_token"]
        self.headers = {"Authorization": f"Bearer {token}"}
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.storage = Mock()
        storage_patch = patch.object(speaker, "s3", self.storage)
        storage_patch.start()
        self.addCleanup(storage_patch.stop)

    def audio(self, seconds=1, channels=1):
        output = BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(channels)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b"\x01\x00" * 16000 * seconds * channels)
        return output.getvalue()

    def upload(self, audio=None, **fields):
        return self.client.post(
            "/api/admin/speakers", headers=self.headers,
            data={"name": "  新音色  ", "prompt_text": "  你好世界  ", **fields},
            files={"audio": ("../../voice.wav", self.audio() if audio is None else audio, "audio/wav")},
        )

    def test_upload_is_immediately_available_and_survives_sync(self):
        response = self.upload(self.audio(channels=2), description="参考声音")
        self.assertEqual(response.status_code, 201, response.text)
        speaker_id = response.json()["id"]
        self.assertLess(speaker_id, 2**53)
        self.assertEqual(response.json()["name"], "新音色")
        self.assertEqual(self.client.get("/api/speakers").json(), [response.json()])
        audio, metadata = [call.kwargs for call in self.storage.put_object.call_args_list]
        self.assertEqual(audio["Key"], f"speaker/{speaker_id}/reference.wav")
        with wave.open(BytesIO(audio["Body"]), "rb") as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getnframes(), 16000)
        self.assertEqual(json.loads(metadata["Body"])["voices"], speaker.get_voices(speaker_id))
        self.assertEqual(speaker.get_voices(speaker_id)["prompt_text"], "你好世界")
        self.storage.get_paginator.return_value.paginate.return_value = [
            {"Contents": [{"Key": metadata["Key"]}]}
        ]
        self.storage.get_object.return_value = {"Body": BytesIO(metadata["Body"])}
        with patch.object(sync, "s3", self.storage):
            self.assertEqual(sync.sync_speakers_to_db(), (1, 0))
        self.assertIsNotNone(database.db_get_speaker(speaker_id))

    def test_upload_requires_admin(self):
        for headers, status in (
            ({}, 401),
            ({"Authorization": f"Bearer {user.login('alice', 'alice-password-123')['access_token']}"}, 403),
        ):
            with self.subTest(status=status):
                self.headers = headers
                self.assertEqual(self.upload().status_code, status)
        self.storage.put_object.assert_not_called()

    def test_supported_formats_preserve_float_audio_volume(self):
        for format, subtype in (("WAV", "FLOAT"), ("MP3", None), ("FLAC", None), ("OGG", "VORBIS")):
            with self.subTest(format=format):
                audio = BytesIO()
                speaker.sf.write(audio, [0.25] * 16000, 16000, format=format, subtype=subtype)
                self.storage.reset_mock()
                response = self.upload(audio.getvalue())
                self.assertEqual(response.status_code, 201, response.text)
                output = self.storage.put_object.call_args_list[0].kwargs["Body"]
                samples, rate = speaker.sf.read(BytesIO(output))
                self.assertEqual(rate, 16000)
                self.assertGreater(float(samples.mean()), 0.15)

    def test_rejects_invalid_audio_and_fields_without_writes(self):
        for audio, fields, status in (
            (b"", {}, 400),
            (b"not an audio file", {}, 400),
            (self.audio(seconds=31), {}, 400),
            (self.audio(channels=3), {}, 400),
            (self.audio()[:-100], {}, 400),
            (b"x" * (speaker.MAX_AUDIO_BYTES + 1), {}, 413),
            (self.audio(), {"name": "   "}, 400),
            (self.audio(), {"prompt_text": "   "}, 400),
            (self.audio(), {"name": "x" * 101}, 422),
        ):
            with self.subTest(size=len(audio), fields=fields):
                response = self.upload(audio, **fields)
                self.assertEqual(response.status_code, status, response.text)
        self.storage.put_object.assert_not_called()
        self.assertEqual(database.db_list_speakers(), [])

    def test_storage_failure_cleans_up_and_does_not_publish_speaker(self):
        self.storage.put_object.side_effect = [None, RuntimeError("storage unavailable")]
        with self.assertLogs("app.api.admin", level="ERROR"):
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(database.db_list_speakers(), [])
        deleted = [call.kwargs["Key"] for call in self.storage.delete_object.call_args_list]
        self.assertTrue(deleted[0].endswith("vox-data.json"))
        self.assertTrue(deleted[1].endswith("reference.wav"))

    def test_database_failure_removes_published_objects(self):
        with patch.object(speaker, "db_insert_speaker", side_effect=RuntimeError("database unavailable")), self.assertLogs(
            "app.api.admin", level="ERROR"
        ):
            self.assertEqual(self.upload().status_code, 503)
        self.assertEqual(self.storage.delete_object.call_count, 2)
        self.assertEqual(database.db_list_speakers(), [])


class SyncTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        conn = database.get_db()
        conn.execute("INSERT INTO speakers (id, name) VALUES (1, 'Existing')")
        conn.commit()
        conn.close()

    def metadata(self, speaker_id=2, **changes):
        data = {
            "id": speaker_id,
            "name": "Imported",
            "icon_path": "speaker/{id}/icon.png",
            "voices": {
                "prompt_text": "hello",
                "prompt_wav_path": "speaker/{id}/a.wav",
                "reference_wav_path": "speaker/{id}/a.wav",
            },
        }
        data.update(changes)
        return data

    def fake_s3(self, pages, objects):
        class Paginator:
            def paginate(self, **kwargs):
                for page in pages:
                    if isinstance(page, Exception):
                        raise page
                    yield {"Contents": [{"Key": key} for key in page]}

        def get_object(*, Bucket, Key):
            value = objects[Key]
            if isinstance(value, Exception):
                raise value
            return {"Body": BytesIO(value if isinstance(value, bytes) else json.dumps(value).encode())}

        return SimpleNamespace(get_paginator=lambda name: Paginator(), get_object=get_object)

    def test_paginated_import_updates_and_deletes_without_local_directory(self):
        key = "speaker/2/vox-data.json"
        fake = self.fake_s3([["speaker/2/a.wav"], [key]], {key: self.metadata()})
        with patch.object(sync, "s3", fake):
            sync.do_sync()
        self.assertEqual(sync.get_sync_status()["last_result"]["imported"], 1)
        self.assertEqual(sync.get_sync_status()["last_result"]["deleted"], 1)
        self.assertIsNone(database.db_get_speaker(1))
        self.assertEqual(database.db_get_speaker(2)["name"], "Imported")
        self.assertEqual(speaker.get_voices(2)["prompt_wav_path"], "speaker/2/a.wav")
        self.assertEqual(asyncio.run(speaker.get_speaker(2)).id, 2)

    def test_updated_metadata_and_partial_deletion(self):
        first = "speaker/1/vox-data.json"
        second = "speaker/2/vox-data.json"
        updated = self.metadata(speaker_id=1, name="Updated")
        with patch.object(sync, "s3", self.fake_s3([[first, second]], {
            first: updated, second: self.metadata()
        })):
            self.assertEqual(sync.sync_speakers_to_db(), (2, 0))
        self.assertEqual(database.db_get_speaker(1)["name"], "Updated")
        with patch.object(sync, "s3", self.fake_s3([[first]], {first: updated})):
            self.assertEqual(sync.sync_speakers_to_db(), (1, 1))
        self.assertIsNone(database.db_get_speaker(2))

    def test_invalid_or_incomplete_import_preserves_index(self):
        key = "speaker/2/vox-data.json"
        bad_cases = [
            ([[key]], {key: b"{broken"}),
            ([[key]], {key: self.metadata(speaker_id=3)}),
            ([[key], [key]], {key: self.metadata()}),
            ([[key]], {key: self.metadata(speaker_id=2.5)}),
            ([[key]], {key: self.metadata(voices={"prompt_text": "x", "prompt_wav_path": "/tmp/a.wav", "reference_wav_path": "speaker/2/a.wav"})}),
            ([[key]], {key: self.metadata(icon_path="speaker/2/../outside.png")}),
            ([[key]], {key: PermissionError("denied")}),
            ([[key], RuntimeError("network failed")], {key: self.metadata()}),
            ([[]], {}),
        ]
        for pages, objects in bad_cases:
            with self.subTest(pages=pages, objects=objects), patch.object(sync, "s3", self.fake_s3(pages, objects)):
                sync.do_sync()
                self.assertTrue(sync.get_sync_status()["last_result"]["errors"])
                self.assertEqual(database.db_get_speaker(1)["name"], "Existing")
                self.assertIsNone(database.db_get_speaker(2))

    def test_custom_prefix_and_key_validation(self):
        data = self.metadata()
        data["icon_path"] = "voices/{id}/icon.png"
        data["voices"]["prompt_wav_path"] = "voices/{id}/a.wav"
        data["voices"]["reference_wav_path"] = "voices/{id}/a.wav"
        key = "voices/2/vox-data.json"
        with patch.object(sync, "S3_SPEAKER_PREFIX", "voices/"), patch.object(
            speaker, "S3_SPEAKER_PREFIX", "voices/"
        ), patch.object(sync, "s3", self.fake_s3([[key]], {key: data})):
            self.assertEqual(sync.sync_speakers_to_db(), (1, 1))
            self.assertEqual(speaker.get_voices(2)["reference_wav_path"], "voices/2/a.wav")
            for bad in ("https://example.com/a.wav", "/tmp/a.wav", "voices/2/../a.wav", "voices/3/a.wav"):
                with self.assertRaises(ValueError):
                    speaker.resolve_speaker_key(bad, 2)


class ModelAndWorkerTests(unittest.TestCase):
    def test_idle_watcher_keeps_busy_model_loaded(self):
        async def check(busy):
            original_sleep = asyncio.sleep
            calls = 0

            async def tick(delay):
                nonlocal calls
                calls += 1
                if calls > 1:
                    raise asyncio.CancelledError()
                await original_sleep(0)

            with patch.dict(tts.model_state, {"model": object(), "last_used": 0, "busy": busy}, clear=True), patch.object(
                tts.asyncio, "sleep", tick
            ), patch.object(tts, "_unload_model") as unload, patch.object(tts, "job_queue", asyncio.Queue()):
                with self.assertRaises(asyncio.CancelledError):
                    await tts.model_idle_watcher()
                return unload.call_count

        self.assertEqual(asyncio.run(check(True)), 0)
        self.assertEqual(asyncio.run(check(False)), 1)

    def test_model_readiness_requires_main_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "audiovae.pth"):
                (root / name).write_bytes(b"x")
            with patch.object(model, "MODEL_PATH", root):
                self.assertFalse(model.check_model())
                (root / "model.safetensors").write_bytes(b"x")
                self.assertTrue(model.check_model())

    def test_job_downloads_distinct_keys_and_uploads_decodable_wav(self):
        row = {"id": "job", "speaker_id": 1, "text": "hello", "status": "pending", "created_at": "now"}
        download_paths = []
        uploaded = {}
        metadata = {}

        def download(bucket, key, path):
            Path(path).write_bytes(key.encode())
            download_paths.append(path)

        def generate(**kwargs):
            prompt = Path(kwargs["prompt_wav_path"])
            reference = Path(kwargs["reference_wav_path"])
            self.assertNotEqual(prompt, reference)
            self.assertEqual(prompt.read_bytes(), b"speaker/1/prompt/a.wav")
            self.assertEqual(reference.read_bytes(), b"speaker/1/reference/a.wav")
            return [0.0, 0.5, -0.5]

        def upload(fileobj, bucket, key):
            uploaded[key] = fileobj.read()

        fake_model = SimpleNamespace(generate=generate, tts_model=SimpleNamespace(sample_rate=24000))
        statuses = []
        with patch.object(tts, "db_get_job", return_value=row), patch.object(
            tts, "db_update_job", side_effect=lambda job: statuses.append(job.status)
        ), patch.object(tts, "get_voices", return_value={
            "prompt_text": "x",
            "prompt_wav_path": "speaker/1/prompt/a.wav",
            "reference_wav_path": "speaker/1/reference/a.wav",
        }), patch.object(
            tts, "_get_or_load_model", return_value=fake_model
        ), patch.object(tts, "s3", SimpleNamespace(
            download_file=download, upload_fileobj=upload, put_object=lambda **kwargs: metadata.update(kwargs)
        )):
            tts.run_job("job")
        self.assertEqual(statuses, ["running", "completed"])
        self.assertEqual(len(set(download_paths)), 2)
        self.assertTrue(all(not Path(path).exists() for path in download_paths))
        import soundfile as sf

        audio, rate = sf.read(BytesIO(uploaded["output/job/job.wav"]))
        self.assertEqual(rate, 24000)
        self.assertEqual(len(audio), 3)
        self.assertEqual(sf.info(BytesIO(uploaded["output/job/job.wav"])).subtype, "PCM_16")
        self.assertEqual(json.loads(metadata["Body"])["output_path"], "output/job/job.wav")

    def test_job_reuses_key_and_cleans_up_on_failures(self):
        row = {"id": "job", "speaker_id": 1, "text": "hello", "status": "pending", "created_at": "now"}
        key = "speaker/1/a.wav"
        for failure in ("download", "inference", "wav_upload", "metadata_upload"):
            with self.subTest(failure=failure):
                paths = []
                statuses = []
                deleted = []

                def download(bucket, object_key, path):
                    paths.append(path)
                    if failure == "download":
                        raise RuntimeError("missing input")
                    Path(path).write_bytes(b"audio")

                def generate(**kwargs):
                    self.assertEqual(kwargs["prompt_wav_path"], kwargs["reference_wav_path"])
                    self.assertTrue(Path(kwargs["prompt_wav_path"]).exists())
                    if failure == "inference":
                        raise RuntimeError("inference failed")
                    return [0.0]

                def upload(*args):
                    if failure == "wav_upload":
                        raise RuntimeError("upload failed")

                def put(**kwargs):
                    if failure == "metadata_upload":
                        raise RuntimeError("metadata failed")

                fake_s3 = SimpleNamespace(
                    download_file=download, upload_fileobj=upload, put_object=put,
                    delete_object=lambda **kwargs: deleted.append(kwargs["Key"]),
                )
                fake_model = SimpleNamespace(generate=generate, tts_model=SimpleNamespace(sample_rate=24000))
                with patch.object(tts, "db_get_job", return_value=row), patch.object(
                    tts, "db_update_job", side_effect=lambda job: statuses.append((job.status, job.error))
                ), patch.object(tts, "get_voices", return_value={
                    "prompt_text": "x", "prompt_wav_path": key, "reference_wav_path": key
                }), patch.object(tts, "_get_or_load_model", return_value=fake_model) as load, patch.object(
                    tts, "s3", fake_s3
                ):
                    tts.run_job("job")
                self.assertEqual([status for status, _ in statuses], ["running", "failed"])
                self.assertEqual(len(paths), 1)
                self.assertTrue(all(not Path(path).exists() for path in paths))
                if failure == "download":
                    load.assert_not_called()
                self.assertEqual(
                    deleted,
                    ["output/job/job.wav", "output/job/data.json"]
                    if failure in ("wav_upload", "metadata_upload") else [],
                )

    def test_worker_continues_after_exception(self):
        async def scenario():
            queue = asyncio.Queue()
            queue.put_nowait("first")
            queue.put_nowait("second")
            calls = []

            def run(job_id):
                calls.append(job_id)
                if job_id == "first":
                    raise RuntimeError("failed")

            with patch.object(tts, "job_queue", queue), patch.object(tts, "run_job", side_effect=run), patch.object(
                tts, "db_get_job", return_value=None
            ), patch.object(tts.logger, "exception"):
                worker = asyncio.create_task(tts.job_worker())
                await asyncio.wait_for(queue.join(), timeout=2)
                worker.cancel()
                await asyncio.gather(worker, return_exceptions=True)
            self.assertEqual(calls, ["first", "second"])
            self.assertFalse(tts.model_state["busy"])

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
