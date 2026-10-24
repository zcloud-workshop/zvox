import os

from dotenv import load_dotenv

load_dotenv()

# 服务监听端口, 启动参数 --port 优先
PORT = int(os.getenv("PORT", "7682"))

# PostgreSQL 连接地址
DATABASE_URL = os.getenv("DATABASE_URL", "")

# S3 存储配置
S3_PROVIDER = os.getenv("S3_PROVIDER", "rustfs")  # aws 或 rustfs
RUSTFS_ENDPOINT = os.getenv("RUSTFS_ENDPOINT", "http://localhost:9000")
RUSTFS_ACCESS_KEY = os.getenv("RUSTFS_ACCESS_KEY", "minioadmin")
RUSTFS_SECRET_KEY = os.getenv("RUSTFS_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "speaker")
S3_SPEAKER_PREFIX = os.getenv("S3_SPEAKER_PREFIX", "speaker/")
S3_OUTPUT_PREFIX = os.getenv("S3_OUTPUT_PREFIX", "output/")

# 预签名链接有效时间（秒）
PRESIGNED_EXPIRES_IN = int(os.getenv("PRESIGNED_EXPIRES_IN", "900"))
MAX_ACTIVE_JOBS_PER_USER = int(os.getenv("MAX_ACTIVE_JOBS_PER_USER", "10"))
MAX_JOBS_PER_HOUR = int(os.getenv("MAX_JOBS_PER_HOUR", "60"))
LOGIN_RATE_WINDOW_SECONDS = int(os.getenv("LOGIN_RATE_WINDOW_SECONDS", "60"))
LOGIN_MAX_ATTEMPTS_PER_IP = int(os.getenv("LOGIN_MAX_ATTEMPTS_PER_IP", "20"))
LOGIN_MAX_ATTEMPTS_PER_USERNAME = int(os.getenv("LOGIN_MAX_ATTEMPTS_PER_USERNAME", "10"))
CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()]

# VoxCPM 模型路径
MODEL_PATH = os.getenv("MODEL_PATH", "model/VoxCPM2")
MODEL_REVISION = os.getenv("MODEL_REVISION", "master")
MODEL_AUTO_DOWNLOAD = os.getenv("MODEL_AUTO_DOWNLOAD", "true").lower() in ("true", "1", "yes")
