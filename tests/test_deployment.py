import asyncio
import importlib
import json
import os
import runpy
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import uvicorn
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.admin import router as admin_router
from app.api.frontend import FrontendFiles, FrontendMount
from app.api.users import require_admin
from app.core import config
from app.services import model, tts
from app.tools import download_model


class ModelDownloadTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name) / "model"
        for item in (
            patch.object(model, "MODEL_PATH", self.root),
            patch.dict(model.download_model_status, {
                "downloading": False, "progress": None, "path": self.root, "error": None,
            }, clear=True),
        ):
            item.start()
            self.addCleanup(item.stop)
        self.download = Mock(side_effect=self.write_model)
        modules = patch.dict(sys.modules, {"modelscope": SimpleNamespace(snapshot_download=self.download)})
        modules.start()
        self.addCleanup(modules.stop)

    def write_model(self, *args, **kwargs):
        self.root.mkdir(exist_ok=True)
        for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "audiovae.pth", "model.safetensors"):
            (self.root / name).write_bytes(b"complete")

    def test_download_filters_files_and_reuses_complete_model(self):
        with patch.object(model, "MODEL_REVISION", "release-tag"):
            self.assertEqual(model.ensure_model(), str(self.root))
        self.download.assert_called_once_with(
            "OpenBMB/VoxCPM2", revision="release-tag", local_dir=str(self.root),
            allow_patterns=list(model.MODEL_FILES), enable_file_lock=True,
        )
        self.assertNotIn("README.md", self.download.call_args.kwargs["allow_patterns"])
        self.assertFalse((self.root / ".zvox-downloading").exists())
        self.assertEqual(model.ensure_model(), str(self.root))
        self.assertEqual(model.start_download(), {"status": "ready", "path": str(self.root)})
        self.download.assert_called_once()

    def test_concurrent_prepare_waits_and_downloads_once(self):
        started = threading.Event()
        release = threading.Event()
        waiting = threading.Event()
        original_wait = model._download_condition.wait

        def download(*args, **kwargs):
            self.write_model()
            started.set()
            if not release.wait(2):
                raise RuntimeError("Test download timed out")

        def wait(*args, **kwargs):
            waiting.set()
            return original_wait(*args, **kwargs)

        self.download.side_effect = download
        with patch.object(model._download_condition, "wait", side_effect=wait), ThreadPoolExecutor(2) as pool:
            first = pool.submit(model.ensure_model)
            try:
                self.assertTrue(started.wait(1))
                second = pool.submit(model.ensure_model, download=False)
                self.assertTrue(waiting.wait(1))
                self.assertFalse(model.check_model())
                self.assertTrue(model.get_download_status()["downloading"])
                self.assertEqual(model.start_download()["status"], "downloading")
                self.assertFalse(second.done())
            finally:
                release.set()
            self.assertEqual(first.result(2), str(self.root))
            self.assertEqual(second.result(2), str(self.root))
        self.download.assert_called_once()

    def test_failed_download_is_not_ready_and_can_be_retried(self):
        def fail(*args, **kwargs):
            self.write_model()
            raise OSError("network interrupted")

        self.download.side_effect = fail
        with self.assertRaisesRegex(OSError, "network interrupted"):
            model.ensure_model()
        self.assertFalse(model.check_model())
        self.assertFalse(model.get_download_status()["downloading"])
        self.assertEqual(model.get_download_status()["progress"], "failed")
        self.assertEqual(model.get_download_status()["error"], "network interrupted")
        with patch.dict(model.download_model_status, error=None, progress=None):
            self.assertFalse(model.check_model())
        self.download.side_effect = self.write_model
        model.ensure_model()
        self.assertEqual(model.get_download_status(), {"status": "ready", "path": str(self.root)})
        self.assertEqual(self.download.call_count, 2)

    def test_incomplete_snapshot_records_failure(self):
        self.download.side_effect = None
        with self.assertRaisesRegex(RuntimeError, "missing required files"):
            model.ensure_model()
        self.assertTrue((self.root / ".zvox-downloading").exists())
        self.assertFalse(model.get_download_status()["downloading"])
        self.assertEqual(model.get_download_status()["progress"], "failed")

    def test_offline_missing_model_does_not_contact_hub(self):
        with self.assertRaisesRegex(RuntimeError, "Model is not ready"):
            model.ensure_model(download=False)
        self.download.assert_not_called()
        self.write_model()
        self.assertEqual(model.ensure_model(download=False), str(self.root))

    def test_thread_start_failure_does_not_leave_download_running(self):
        with patch.object(model.threading, "Thread", side_effect=RuntimeError("cannot start thread")):
            with self.assertRaisesRegex(RuntimeError, "cannot start thread"):
                model.start_download()
        self.assertFalse(model.get_download_status()["downloading"])
        self.assertEqual(model.get_download_status()["error"], "cannot start thread")
        model.ensure_model()
        self.assertEqual(model.get_download_status()["status"], "ready")

    def test_status_returns_a_snapshot_without_downloading(self):
        status = model.get_download_status()
        status["downloading"] = True
        self.assertFalse(model.download_model_status["downloading"])
        self.download.assert_not_called()

    def test_cli_check_is_offline_and_reports_missing_and_ready(self):
        for ready in (False, True):
            if ready:
                self.write_model()
            output = StringIO()
            with patch.object(sys, "argv", ["download_model", "--check"]), redirect_stdout(output):
                self.assertEqual(download_model.main(), 0 if ready else 1)
            self.assertEqual(json.loads(output.getvalue()).get("status"), "ready" if ready else None)
        self.download.assert_not_called()

    def test_inference_prepares_model_and_loads_only_local_files(self):
        loaded = object()
        loader = Mock(return_value=loaded)
        with patch.dict(tts.model_state, model=None), patch.object(tts, "MODEL_AUTO_DOWNLOAD", False), patch.object(
            tts, "ensure_model", return_value=str(self.root)
        ) as prepare, patch.dict(sys.modules, {"voxcpm": SimpleNamespace(VoxCPM=SimpleNamespace(from_pretrained=loader))}):
            self.assertIs(tts._get_or_load_model(), loaded)
            self.assertIs(tts._get_or_load_model(), loaded)
        prepare.assert_called_once_with(download=False)
        loader.assert_called_once_with(str(self.root), load_denoiser=False, local_files_only=True)

    def test_admin_status_is_read_only_and_retry_returns_failure_clearly(self):
        app = FastAPI()
        app.include_router(admin_router)
        app.dependency_overrides[require_admin] = lambda: {"role": "admin"}
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/admin/model/status").status_code, 200)
            self.download.assert_not_called()
            with patch("app.api.admin.start_download", side_effect=RuntimeError("cannot start thread")), patch(
                "app.api.admin.logging.getLogger"
            ):
                self.assertEqual(client.get("/api/admin/model").status_code, 503)


class FrontendDeploymentTests(unittest.TestCase):
    def test_spa_refresh_assets_and_api_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text("<html>ZVox</html>")
            (root / "assets").mkdir()
            (root / "assets/app.js").write_text("console.log('ZVox')")
            app = FastAPI()

            @app.get("/api/example")
            async def api_example():
                return {"ok": True}

            app.router.routes.append(FrontendMount("/", app=FrontendFiles(directory=root, html=True)))
            with TestClient(app) as client:
                for route in ("/", "/jobs/abc", "/admin/system"):
                    self.assertEqual(client.get(route).text, "<html>ZVox</html>")
                self.assertEqual(client.head("/jobs/abc").status_code, 200)
                self.assertEqual(client.get("/assets/app.js").status_code, 200)
                for route in ("/assets/missing.js", "/assets/missing", "/missing.css", "/api", "/api/missing"):
                    self.assertEqual(client.get(route).status_code, 404, route)
                self.assertEqual(client.get("/api/example").json(), {"ok": True})
                self.assertEqual(client.post("/api/example").status_code, 405)
                self.assertEqual(client.post("/api/missing").status_code, 404)
                self.assertEqual(client.get("/docs").status_code, 200)

    def test_startup_auto_download_can_be_disabled(self):
        main = importlib.import_module("app.main")

        async def idle():
            await asyncio.Future()

        async def scenario(enabled):
            application = FastAPI()
            with patch.object(main, "MODEL_AUTO_DOWNLOAD", enabled), patch.object(main, "init_db"), patch.object(
                main, "db_recover_jobs", return_value=[]
            ), patch.object(main, "job_worker", idle), patch.object(main, "model_idle_watcher", idle), patch.object(
                main, "start_download", return_value={"status": "download_started"}
            ) as download:
                async with main.lifespan(application):
                    self.assertEqual(download.call_count, int(enabled))

        asyncio.run(scenario(True))
        asyncio.run(scenario(False))


class StartupPortTests(unittest.TestCase):
    def start(self, *args):
        with patch.object(sys, "argv", ["main.py", *args]), patch.object(uvicorn, "run") as run:
            runpy.run_path(str(Path(__file__).resolve().parents[1] / "main.py"), run_name="__main__")
        return run.call_args.kwargs["port"]

    def test_port_defaults_to_7682_and_reads_environment(self):
        try:
            with patch("dotenv.load_dotenv"), patch.dict(os.environ):
                os.environ.pop("PORT", None)
                self.assertEqual(importlib.reload(config).PORT, 7682)
                os.environ["PORT"] = "9001"
                self.assertEqual(importlib.reload(config).PORT, 9001)
        finally:
            importlib.reload(config)

    def test_command_line_port_overrides_configured_port(self):
        with patch.object(config, "PORT", 9002):
            self.assertEqual(self.start(), 9002)
            self.assertEqual(self.start("--port", "9003"), 9003)


if __name__ == "__main__":
    unittest.main()
