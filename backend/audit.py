"""Audit log helper — writes to PostgreSQL audit_log table."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional


async def log_audit(
    actor_user_id: Optional[str],
    action: str,
    target_type: str,
    target_id: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    from database import AsyncSessionLocal
    from orm_models import AuditLog

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        session.add(AuditLog(
            id=str(uuid.uuid4()),
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            metadata_=metadata or {},
            created_at=now,
        ))
        await session.commit()
