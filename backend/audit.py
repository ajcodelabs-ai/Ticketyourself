"""Audit log helper."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from db import db


async def log_audit(
    actor_user_id: Optional[str],
    action: str,
    target_type: str,
    target_id: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    doc = {
        "id": str(uuid.uuid4()),
        "actor_user_id": actor_user_id,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.audit_log.insert_one(doc)
