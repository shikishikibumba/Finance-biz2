"""Firebase Storage helper.

Uploads base64 data-URLs (or raw bytes) to Cloud Storage and returns a
publicly-readable signed URL that the frontend can use directly in an
<img src>.

If Storage isn't enabled (bucket missing), we raise a clear HTTP 412 so the
caller can guide the user to enable it in Firebase Console.
"""
import os
import re
import uuid
import asyncio
import base64
import logging
from typing import Optional

import firebase_admin
from firebase_admin import storage
from google.cloud.exceptions import NotFound
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Match "data:image/png;base64,XXXX" → (mime, b64)
_DATA_URL_RE = re.compile(r"^data:([^;]+);base64,(.*)$", re.S)

_DEFAULT_BUCKET = f"{os.environ.get('FIREBASE_PROJECT_ID', 'commercial-trading1')}.appspot.com"

# Will be filled on first call
_bucket = None


def _get_bucket():
    global _bucket
    if _bucket is not None:
        return _bucket
    if not firebase_admin._apps:
        # database.py initialises this; safety net
        from firestore_db import _fs  # noqa: F401
    bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET", _DEFAULT_BUCKET)
    # Will be a NotFound on first .upload if the bucket isn't enabled — we
    # detect that lazily in upload_data_url.
    _bucket = storage.bucket(bucket_name)
    return _bucket


def parse_data_url(data_url: str) -> tuple[str, bytes]:
    """Return (mime, raw_bytes) from a base64 data URL. Raises on bad input."""
    m = _DATA_URL_RE.match(data_url or "")
    if not m:
        raise ValueError("image must be a base64 data URL")
    mime, b64 = m.group(1), m.group(2)
    return mime, base64.b64decode(b64)


def _ext_for(mime: str) -> str:
    return {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/heic": "heic",
        "image/gif": "gif",
        "application/pdf": "pdf",
    }.get(mime.lower(), "bin")


async def upload_data_url(data_url: str, folder: str = "uploads") -> str:
    """Upload a base64 data URL to Firebase Storage and return its public URL.

    Raises HTTPException(412) if Storage isn't enabled on the Firebase
    project — message tells the user exactly what to do.
    """
    mime, raw = parse_data_url(data_url)
    obj_name = f"{folder}/{uuid.uuid4().hex}.{_ext_for(mime)}"
    loop = asyncio.get_running_loop()

    def _do_upload():
        bucket = _get_bucket()
        blob = bucket.blob(obj_name)
        try:
            blob.upload_from_string(raw, content_type=mime)
        except NotFound:
            raise HTTPException(
                status_code=412,
                detail=(
                    "Firebase Storage is not enabled on this project. "
                    "Open https://console.firebase.google.com/project/"
                    f"{os.environ.get('FIREBASE_PROJECT_ID', 'commercial-trading1')}"
                    "/storage and click Get Started (region: asia-southeast1)."
                ),
            )
        # Make the object publicly readable. Easiest for embedding in <img>.
        blob.make_public()
        return blob.public_url

    return await loop.run_in_executor(None, _do_upload)


async def delete_url(public_url: Optional[str]) -> None:
    """Best-effort delete an uploaded object given its public URL."""
    if not public_url:
        return
    # public_url format: https://storage.googleapis.com/<bucket>/<object>
    try:
        prefix = "https://storage.googleapis.com/"
        if not public_url.startswith(prefix):
            return
        rest = public_url[len(prefix):]
        bucket_name, _, obj_name = rest.partition("/")
        loop = asyncio.get_running_loop()
        def _do():
            bucket = _get_bucket()
            if bucket.name != bucket_name:
                return
            bucket.blob(obj_name).delete()
        await loop.run_in_executor(None, _do)
    except Exception as e:
        logger.warning("Failed to delete storage object %s: %s", public_url, e)
