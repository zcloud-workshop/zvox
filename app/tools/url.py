from app.core.config import PRESIGNED_EXPIRES_IN, S3_BUCKET
from app.core.s3 import s3


def build_presigned_url(key: str | None) -> str | None:
    if not key:
        return None
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=PRESIGNED_EXPIRES_IN,
    )


def build_icon_url(icon_path: str | None) -> str | None:
    return build_presigned_url(icon_path)
