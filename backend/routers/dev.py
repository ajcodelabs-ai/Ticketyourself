"""DEV-only endpoints (email log viewer). Enabled when ENV=development."""
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

router = APIRouter(prefix="/api/_dev", tags=["dev"])

EMAIL_LOG_DIR = Path(__file__).resolve().parent.parent / "email_log"


def _dev_only():
    if os.environ.get("ENV", "development") != "development":
        raise HTTPException(status_code=404, detail="Not found")


@router.get("/email-log")
async def list_email_log():
    _dev_only()
    EMAIL_LOG_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(EMAIL_LOG_DIR.glob("*.html"), reverse=True)
    return [
        {
            "name": f.name,
            "size_bytes": f.stat().st_size,
            "viewer_url": f"/api/_dev/email-log/{f.name}",
        }
        for f in files
    ]


@router.get("/email-log/{name}", response_class=HTMLResponse)
async def get_email_log(name: str):
    _dev_only()
    # Reject path traversal.
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid name")
    path = EMAIL_LOG_DIR / name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="text/html")
