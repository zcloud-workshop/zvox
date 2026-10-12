from app.core.config import PRESIGNED_EXPIRES_IN, S3_BUCKET
from app.core.s3 import s3


def build_icon_url(icon_path: str | None) -> str | None:
    if not icon_path:
        return None
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": icon_path},
        ExpiresIn=PRESIGNED_EXPIRES_IN,
    )
