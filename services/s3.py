"""
S3 access for package assets (currently: per-package watermark logos).

Uses the same private bucket as the photographer/ingestion services. Objects
are stored under WATERMARK_LOGO_PREFIX and referenced by their plain
https://{bucket}.s3.{region}.amazonaws.com/{key} URL — the same URL shape the
ingestion worker writes for photos. The bucket is private, so anything shown
in a browser goes through a short-lived presigned URL.
"""
import os
import uuid
from typing import Optional
from urllib.parse import urlparse, unquote

import boto3
from botocore.config import Config

WATERMARK_LOGO_PREFIX = "packages/watermarks/"
MAX_WATERMARK_LOGO_BYTES = 2 * 1024 * 1024

# Detected from the file's magic bytes, not the client-supplied content type.
_IMAGE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
)


def detect_image_type(data: bytes) -> Optional[tuple[str, str]]:
    """(extension, content_type) for PNG / JPEG / WEBP bytes, else None."""
    for signature, ext, content_type in _IMAGE_SIGNATURES:
        if data.startswith(signature):
            return ext, content_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


class S3Service:
    def __init__(self):
        self.region = os.getenv("AWS_REGION", "ap-south-1")
        self.bucket = os.getenv("S3_BUCKET_NAME") or os.getenv("AWS_S3_BUCKET_NAME") or ""
        self._client = None

    @property
    def configured(self) -> bool:
        return bool(self.bucket and os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"))

    @property
    def client(self):
        # Created lazily so the service still boots without AWS settings —
        # only the upload endpoints need them.
        if self._client is None:
            self._client = boto3.client(
                "s3",
                aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
                region_name=self.region,
                endpoint_url=f"https://s3.{self.region}.amazonaws.com",
                config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
            )
        return self._client

    def object_url(self, key: str) -> str:
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{key}"

    def watermark_logo_key(self, url: str) -> Optional[str]:
        """The object key if `url` is a watermark logo in our bucket, else None."""
        parsed = urlparse(url or "")
        if parsed.scheme != "https" or not parsed.hostname:
            return None
        if not parsed.hostname.startswith(f"{self.bucket}.s3.") or not self.bucket:
            return None
        key = unquote(parsed.path.lstrip("/"))
        return key if key.startswith(WATERMARK_LOGO_PREFIX) else None

    def upload_watermark_logo(self, data: bytes, ext: str, content_type: str) -> str:
        key = f"{WATERMARK_LOGO_PREFIX}{uuid.uuid4().hex}.{ext}"
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        return self.object_url(key)

    def presign(self, key: str, expiration: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expiration
        )


s3_service = S3Service()
