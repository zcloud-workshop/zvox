import logging
import threading
from pathlib import Path

from app.core.config import MODEL_PATH, MODEL_REVISION

# 模型下载状态
download_model_status = {
    "downloading": False,
    "progress": None,
    "path": Path(MODEL_PATH),
    "error": None,
}

_download_condition = threading.Condition()
logger = logging.getLogger(__name__)

MODEL_FILES = (
    "config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
    "audiovae.safetensors", "audiovae.pth", "model.safetensors", "pytorch_model.bin",
)


def _model_files_present() -> bool:
    """检查 VoxCPM2 加载所需的配置和权重是否存在"""
    model_dir = Path(MODEL_PATH)
    if not model_dir.is_dir():
        return False
    required = ("config.json", "tokenizer.json", "tokenizer_config.json")
    audio_weights = ("audiovae.safetensors", "audiovae.pth")
    model_weights = ("model.safetensors", "pytorch_model.bin")

    def nonempty(name: str) -> bool:
        path = model_dir / name
        return path.is_file() and path.stat().st_size > 0

    return all(nonempty(name) for name in required) and any(nonempty(name) for name in audio_weights) and any(
        nonempty(name) for name in model_weights
    )


def check_model() -> bool:
    return not (Path(MODEL_PATH) / ".zvox-downloading").exists() and _model_files_present()


def _download_model() -> str:
    try:
        from modelscope import snapshot_download

        model_dir = Path(MODEL_PATH)
        model_dir.mkdir(parents=True, exist_ok=True)
        marker = model_dir / ".zvox-downloading"
        marker.touch()
        snapshot_download(
            "OpenBMB/VoxCPM2",
            revision=MODEL_REVISION,
            local_dir=str(MODEL_PATH),
            allow_patterns=list(MODEL_FILES),
            enable_file_lock=True,
        )
        if not _model_files_present():
            raise RuntimeError("Downloaded model is missing required files")
        marker.unlink()
        with _download_condition:
            download_model_status["progress"] = "done"
        return str(MODEL_PATH)
    except Exception as exc:
        with _download_condition:
            download_model_status["error"] = str(exc)
            download_model_status["progress"] = "failed"
        raise
    finally:
        with _download_condition:
            download_model_status["downloading"] = False
            _download_condition.notify_all()


def _claim_download():
    download_model_status.update(downloading=True, progress="downloading", error=None)


def ensure_model(*, download: bool = True) -> str:
    """复用本地模型或等待正在进行的下载, 缺失时按需下载."""
    with _download_condition:
        waited = False
        while download_model_status["downloading"]:
            waited = True
            _download_condition.wait()
        if waited and download_model_status["error"]:
            raise RuntimeError(f"Model download failed: {download_model_status['error']}")
        if check_model() and not download_model_status["error"]:
            return str(MODEL_PATH)
        if not download:
            raise RuntimeError("Model is not ready; run python -m app.tools.download_model or use the admin download API")
        _claim_download()
    return _download_model()


def get_download_status() -> dict:
    with _download_condition:
        path = str(MODEL_PATH)
        if not download_model_status["downloading"] and not download_model_status["error"] and check_model():
            return {"status": "ready", "path": path}
        return {**download_model_status, "path": path}


def _do_download():
    try:
        _download_model()
    except Exception:
        logger.exception("Model download failed")


def start_download() -> dict:
    """启动后台模型下载（非阻塞）"""
    with _download_condition:
        if download_model_status["downloading"]:
            return {"status": "downloading", "progress": download_model_status["progress"]}
        if check_model() and not download_model_status["error"]:
            return {"status": "ready", "path": str(MODEL_PATH)}
        _claim_download()
        try:
            threading.Thread(target=_do_download, daemon=True).start()
        except Exception as exc:
            download_model_status.update(downloading=False, progress="failed", error=str(exc))
            _download_condition.notify_all()
            raise
    return {"status": "download_started"}
