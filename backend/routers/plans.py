"""Plans router. Public: list/get active. Admin: full CRUD."""
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from audit import log_audit
from db import db
from models import PlanCreate, PlanOut, PlanUpdate
from security import require_role

router = APIRouter(prefix="/api/plans", tags=["plans"])
admin_router = APIRouter(
    prefix="/api/admin/plans",
    tags=["admin", "plans"],
    dependencies=[Depends(require_role("super_admin"))],
)


def _to_out(doc: dict) -> PlanOut:
    return PlanOut(**doc)


@router.get("", response_model=List[PlanOut])
async def list_active_plans():
    cursor = db.subscription_plans.find({"active": True}, {"_id": 0}).sort("price_cents", 1)
    docs = await cursor.to_list(length=100)
    return [_to_out(d) for d in docs]


@router.get("/{code}", response_model=PlanOut)
async def get_plan(code: str):
    doc = await db.subscription_plans.find_one({"code": code, "active": True}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Plan not found")
    return _to_out(doc)


# ────────────────────────────────────────────────────────────────────
# Admin CRUD
# ────────────────────────────────────────────────────────────────────
@admin_router.get("", response_model=List[PlanOut])
async def admin_list_plans():
    cursor = db.subscription_plans.find({}, {"_id": 0}).sort("price_cents", 1)
    docs = await cursor.to_list(length=200)
    return [_to_out(d) for d in docs]


@admin_router.post("", response_model=PlanOut, status_code=201)
async def admin_create_plan(payload: PlanCreate, admin=Depends(require_role("super_admin"))):
    existing = await db.subscription_plans.find_one({"code": payload.code})
    if existing:
        raise HTTPException(409, "Plan code already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "created_at": now,
        "updated_at": now,
    }
    await db.subscription_plans.insert_one(doc)
    await log_audit(admin["id"], "plan.created", "plan", doc["id"], {"code": doc["code"]})
    return _to_out(doc)


@admin_router.patch("/{code}", response_model=PlanOut)
async def admin_update_plan(code: str, payload: PlanUpdate, admin=Depends(require_role("super_admin"))):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.subscription_plans.find_one_and_update(
        {"code": code},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Plan not found")
    await log_audit(admin["id"], "plan.updated", "plan", result["id"], {"fields": list(updates.keys())})
    return _to_out(result)


@admin_router.delete("/{code}", status_code=204)
async def admin_delete_plan(code: str, admin=Depends(require_role("super_admin"))):
    plan = await db.subscription_plans.find_one({"code": code})
    if not plan:
        raise HTTPException(404, "Plan not found")
    subscribed = await db.organizers.count_documents({"plan_id": plan["id"]})
    if subscribed > 0:
        raise HTTPException(
            409,
            f"Cannot delete plan: {subscribed} organizer(s) are subscribed.",
        )
    await db.subscription_plans.delete_one({"code": code})
    await log_audit(admin["id"], "plan.deleted", "plan", plan["id"], {"code": code})
    return None
