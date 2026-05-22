"""Admin router: organizer management + stats."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from audit import log_audit
from db import db
from models import (
    AdminStats,
    ApproveBody,
    CommentBody,
    OrganizerOut,
    OrganizersList,
    RejectBody,
    SuspendBody,
)
from security import require_role

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_role("super_admin"))],
)


async def _to_out(doc: dict) -> OrganizerOut:
    plan_code = None
    if doc.get("plan_id"):
        plan = await db.subscription_plans.find_one(
            {"id": doc["plan_id"]}, {"_id": 0, "code": 1}
        )
        if plan:
            plan_code = plan["code"]
    return OrganizerOut(plan_code=plan_code, **doc)


@router.get("/dashboard/stats", response_model=AdminStats)
async def admin_stats():
    organizers_total = await db.organizers.count_documents({})
    organizers_pending = await db.organizers.count_documents({"status": "pending"})
    organizers_approved = await db.organizers.count_documents({"status": "approved"})
    organizers_rejected = await db.organizers.count_documents({"status": "rejected"})
    organizers_suspended = await db.organizers.count_documents({"status": "suspended"})
    active_subs = await db.organizers.count_documents({"subscription_status": "active"})

    plans = await db.subscription_plans.find({}, {"_id": 0, "id": 1, "price_cents": 1, "billing_period": 1}).to_list(length=200)
    plan_price = {p["id"]: p for p in plans}

    revenue_cents = 0
    async for org in db.organizers.find(
        {"subscription_status": "active", "plan_id": {"$ne": None}},
        {"_id": 0, "plan_id": 1},
    ):
        plan = plan_price.get(org["plan_id"])
        if plan and plan["billing_period"] == "monthly":
            revenue_cents += plan["price_cents"]

    return AdminStats(
        organizers_total=organizers_total,
        organizers_pending=organizers_pending,
        organizers_approved=organizers_approved,
        organizers_rejected=organizers_rejected,
        organizers_suspended=organizers_suspended,
        active_subscriptions=active_subs,
        monthly_revenue_estimate_cents=revenue_cents,
    )


@router.get("/organizers", response_model=OrganizersList)
async def list_organizers(
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    query: dict = {}
    if status:
        query["status"] = status
    if search:
        regex = {"$regex": search.strip(), "$options": "i"}
        query["$or"] = [
            {"company_name": regex},
            {"email": regex},
            {"slug": regex},
        ]
    total = await db.organizers.count_documents(query)
    cursor = (
        db.organizers.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    items = [await _to_out(d) for d in docs]
    return OrganizersList(items=items, total=total, page=page, limit=limit)


@router.get("/organizers/{organizer_id}", response_model=OrganizerOut)
async def get_organizer(organizer_id: str):
    doc = await db.organizers.find_one({"id": organizer_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Organizer not found")
    return await _to_out(doc)


async def _add_comment(organizer_id: str, admin: dict, comment: str) -> dict:
    entry = {
        "id": str(uuid.uuid4()),
        "admin_id": admin["id"],
        "admin_email": admin.get("email"),
        "comment": comment,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.organizers.find_one_and_update(
        {"id": organizer_id},
        {"$push": {"admin_comments": entry}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Organizer not found")
    return entry


@router.post("/organizers/{organizer_id}/approve", response_model=OrganizerOut)
async def approve_organizer(
    organizer_id: str,
    payload: ApproveBody,
    admin=Depends(require_role("super_admin")),
):
    org = await db.organizers.find_one({"id": organizer_id}, {"_id": 0})
    if not org:
        raise HTTPException(404, "Organizer not found")
    if payload.comment:
        await _add_comment(organizer_id, admin, payload.comment)
    now = datetime.now(timezone.utc).isoformat()
    result = await db.organizers.find_one_and_update(
        {"id": organizer_id},
        {
            "$set": {
                "status": "approved",
                "rejection_reason": None,
                "approved_at": now,
                "approved_by": admin["id"],
            }
        },
        return_document=True,
        projection={"_id": 0},
    )
    await db.tenants.update_one({"slug": result["slug"]}, {"$set": {"status": "active"}})
    await log_audit(admin["id"], "organizer.approved", "organizer", organizer_id, {"comment": payload.comment or ""})
    return await _to_out(result)


@router.post("/organizers/{organizer_id}/reject", response_model=OrganizerOut)
async def reject_organizer(
    organizer_id: str,
    payload: RejectBody,
    admin=Depends(require_role("super_admin")),
):
    await _add_comment(organizer_id, admin, payload.comment)
    result = await db.organizers.find_one_and_update(
        {"id": organizer_id},
        {"$set": {"status": "rejected", "rejection_reason": payload.comment}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Organizer not found")
    await db.tenants.update_one({"slug": result["slug"]}, {"$set": {"status": "inactive"}})
    await log_audit(admin["id"], "organizer.rejected", "organizer", organizer_id, {"reason": payload.comment})
    return await _to_out(result)


@router.post("/organizers/{organizer_id}/suspend", response_model=OrganizerOut)
async def suspend_organizer(
    organizer_id: str,
    payload: SuspendBody,
    admin=Depends(require_role("super_admin")),
):
    await _add_comment(organizer_id, admin, payload.comment)
    result = await db.organizers.find_one_and_update(
        {"id": organizer_id},
        {"$set": {"status": "suspended"}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Organizer not found")
    await db.tenants.update_one({"slug": result["slug"]}, {"$set": {"status": "suspended"}})
    await log_audit(admin["id"], "organizer.suspended", "organizer", organizer_id, {"reason": payload.comment})
    return await _to_out(result)


@router.post("/organizers/{organizer_id}/comment", response_model=OrganizerOut)
async def add_comment(
    organizer_id: str,
    payload: CommentBody,
    admin=Depends(require_role("super_admin")),
):
    await _add_comment(organizer_id, admin, payload.comment)
    doc = await db.organizers.find_one({"id": organizer_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Organizer not found")
    await log_audit(admin["id"], "organizer.commented", "organizer", organizer_id, {})
    return await _to_out(doc)
