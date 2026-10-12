import boto3
from botocore.client import Config

from app.core.config import (
    RUSTFS_ACCESS_KEY,
    RUSTFS_ENDPOINT,
    RUSTFS_SECRET_KEY,
    S3_PROVIDER,
)

if S3_PROVIDER == "aws":
    s3 = boto3.client("s3")
elif S3_PROVIDER == "rustfs":
    s3 = boto3.client(
        "s3",
        endpoint_url=RUSTFS_ENDPOINT,
        aws_access_key_id=RUSTFS_ACCESS_KEY,
        aws_secret_access_key=RUSTFS_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )
else:
    raise ValueError(f"不支持的 S3_PROVIDER: {S3_PROVIDER}，可选值: aws, rustfs")
