"""Idempotent seed of admin user, plans, demo organizers + tenants."""
import logging
import os
import uuid
from datetime import datetime, timezone

from db import db
from security import hash_password
from slugs import normalize_slug

logger = logging.getLogger("tys.seed")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


PLANS = [
    {
        "code": "evento_unico",
        "name": "Evento único",
        "description": "Cobro único para un solo evento. Ideal para probar la plataforma sin compromiso.",
        "price_cents": 50_00,
        "currency": "usd",
        "billing_period": "one_time",
        "features": [
            "1 evento",
            "Hasta 200 tickets",
            "Microsite del evento",
            "Soporte por email",
        ],
        "max_events": 1,
        "max_tickets_per_event": 200,
        "includes_numbered": False,
        "includes_ai_design": False,
        "includes_custom_domain": False,
        "active": True,
    },
    {
        "code": "basico",
        "name": "Básico",
        "description": "Plan mensual para organizadores que arrancan.",
        "price_cents": 20_00,
        "currency": "usd",
        "billing_period": "monthly",
        "features": [
            "Hasta 5 eventos activos",
            "Hasta 500 tickets por evento",
            "Microsite del organizador",
            "Reportes básicos",
        ],
        "max_events": 5,
        "max_tickets_per_event": 500,
        "includes_numbered": False,
        "includes_ai_design": False,
        "includes_custom_domain": False,
        "active": True,
    },
    {
        "code": "profesional",
        "name": "Profesional",
        "description": "Para productoras y organizadores recurrentes.",
        "price_cents": 50_00,
        "currency": "usd",
        "billing_period": "monthly",
        "features": [
            "Eventos ilimitados",
            "Tickets ilimitados por evento",
            "Tickets numerados",
            "Reportes avanzados",
            "Soporte prioritario",
        ],
        "max_events": -1,
        "max_tickets_per_event": -1,
        "includes_numbered": True,
        "includes_ai_design": False,
        "includes_custom_domain": False,
        "active": True,
    },
    {
        "code": "enterprise",
        "name": "Enterprise",
        "description": "Para empresas grandes con branding completo.",
        "price_cents": 200_00,
        "currency": "usd",
        "billing_period": "monthly",
        "features": [
            "Todo lo del plan Profesional",
            "Diseño asistido por IA",
            "Dominio personalizado",
            "Soporte dedicado",
            "SLA",
        ],
        "max_events": -1,
        "max_tickets_per_event": -1,
        "includes_numbered": True,
        "includes_ai_design": True,
        "includes_custom_domain": True,
        "active": True,
    },
]


DEMO_ORGANIZERS = [
    {
        "slug": "demo-org",
        "company_name": "Demo Organizer",
        "user_email": "demo@ticketyourself.com",
        "user_password": "Organizer123!",
        "legal_id": "1790012345001",
        "org_type": "company",
        "phone": "+593987654321",
        "country": "Ecuador",
        "status": "approved",
        "plan_code": "profesional",
        "subscription_status": "active",
        "approval_comment": "Cuenta de demo aprobada automáticamente.",
        "documents": [
            {"doc_type": "ruc", "original_filename": "ruc_demo.pdf"},
            {"doc_type": "id_card", "original_filename": "id_demo.pdf"},
        ],
    },
    {
        "slug": "prueba-eventos",
        "company_name": "Prueba Eventos",
        "user_email": "prueba@ticketyourself.com",
        "user_password": "Organizer123!",
        "legal_id": "0912345678",
        "org_type": "individual",
        "phone": "+593987111222",
        "country": "Ecuador",
        "status": "pending",
        "plan_code": None,
        "subscription_status": "none",
        "approval_comment": None,
        "documents": [
            {"doc_type": "ruc", "original_filename": "ruc_prueba.pdf"},
        ],
    },
    {
        "slug": "evento-rechazado",
        "company_name": "Eventos Rechazados S.A.",
        "user_email": "rechazado@ticketyourself.com",
        "user_password": "Organizer123!",
        "legal_id": "1799999999001",
        "org_type": "company",
        "phone": "+593987333444",
        "country": "Ecuador",
        "status": "rejected",
        "plan_code": None,
        "subscription_status": "none",
        "rejection_reason": "Documento RUC ilegible, por favor reenvíalo.",
        "approval_comment": None,
        "documents": [],
    },
]


async def _create_indexes() -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.organizers.create_index("slug", unique=True)
    await db.organizers.create_index("user_id", unique=True)
    await db.organizers.create_index("id", unique=True)
    await db.tenants.create_index("slug", unique=True)
    await db.subscription_plans.create_index("code", unique=True)
    await db.organizer_documents.create_index("organizer_id")
    await db.audit_log.create_index("created_at")
    await db.poc_payments.create_index("stripe_session_id", unique=True)
    await db.poc_payments.create_index("tenant_slug")


async def _seed_admin() -> None:
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ticketyourself.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin123!")
    existing = await db.users.find_one({"email": admin_email})
    now = _now_iso()
    if existing is None:
        await db.users.insert_one(
            {
                "id": str(uuid.uuid4()),
                "email": admin_email,
                "password_hash": hash_password(admin_password),
                "role": "super_admin",
                "organizer_id": None,
                "created_at": now,
                "last_login": None,
            }
        )
        logger.info("Seeded super_admin %s", admin_email)
    else:
        # Re-hash if password env changed (helps local dev/testing)
        from security import verify_password
        if not verify_password(admin_password, existing["password_hash"]):
            await db.users.update_one(
                {"email": admin_email},
                {"$set": {"password_hash": hash_password(admin_password)}},
            )
            logger.info("Updated super_admin password for %s", admin_email)


async def _seed_plans() -> None:
    now = _now_iso()
    for plan in PLANS:
        await db.subscription_plans.update_one(
            {"code": plan["code"]},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    **plan,
                    "stripe_price_id": None,
                    "created_at": now,
                    "updated_at": now,
                },
            },
            upsert=True,
        )
    logger.info("Seeded %d plans", len(PLANS))


async def _seed_demo_organizers() -> None:
    """
    Inserts demo organizers + users + tenants idempotently.
    Skips if the user email already exists.
    """
    plans_by_code = {
        p["code"]: p
        async for p in db.subscription_plans.find({}, {"_id": 0})
    }
    now = _now_iso()

    for od in DEMO_ORGANIZERS:
        if await db.users.find_one({"email": od["user_email"]}):
            continue

        user_id = str(uuid.uuid4())
        organizer_id = str(uuid.uuid4())
        slug = normalize_slug(od["slug"])
        plan = plans_by_code.get(od["plan_code"]) if od["plan_code"] else None
        plan_id = plan["id"] if plan else None
        tenant_status = "active" if od["status"] == "approved" else "inactive"

        # User
        await db.users.insert_one(
            {
                "id": user_id,
                "email": od["user_email"].lower(),
                "password_hash": hash_password(od["user_password"]),
                "role": "organizer",
                "organizer_id": organizer_id,
                "created_at": now,
                "last_login": None,
            }
        )

        # Admin comments
        admin_comments = []
        if od.get("approval_comment"):
            admin_comments.append(
                {
                    "id": str(uuid.uuid4()),
                    "admin_id": "system",
                    "admin_email": "system@ticketyourself.com",
                    "comment": od["approval_comment"],
                    "created_at": now,
                }
            )
        if od.get("rejection_reason"):
            admin_comments.append(
                {
                    "id": str(uuid.uuid4()),
                    "admin_id": "system",
                    "admin_email": "system@ticketyourself.com",
                    "comment": od["rejection_reason"],
                    "created_at": now,
                }
            )

        # Organizer
        await db.organizers.insert_one(
            {
                "id": organizer_id,
                "user_id": user_id,
                "company_name": od["company_name"],
                "legal_id": od["legal_id"],
                "org_type": od["org_type"],
                "email": od["user_email"].lower(),
                "phone": od["phone"],
                "country": od["country"],
                "slug": slug,
                "status": od["status"],
                "rejection_reason": od.get("rejection_reason"),
                "admin_comments": admin_comments,
                "plan_id": plan_id,
                "subscription_status": od["subscription_status"],
                "stripe_customer_id": None,
                "stripe_subscription_id": None,
                "current_period_end": None,
                "created_at": now,
                "approved_at": now if od["status"] == "approved" else None,
                "approved_by": "system" if od["status"] == "approved" else None,
            }
        )

        # Tenant (1:1)
        await db.tenants.update_one(
            {"slug": slug},
            {
                "$set": {
                    "name": od["company_name"],
                    "status": tenant_status,
                },
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "slug": slug,
                    "created_at": now,
                },
            },
            upsert=True,
        )

        # Documents (fake stub files)
        for doc in od.get("documents", []):
            await db.organizer_documents.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "organizer_id": organizer_id,
                    "doc_type": doc["doc_type"],
                    "file_path": None,  # demo files don't exist on disk
                    "original_filename": doc["original_filename"],
                    "mime_type": "application/pdf",
                    "size_bytes": 12345,
                    "uploaded_at": now,
                    "is_demo": True,
                }
            )

        logger.info("Seeded demo organizer %s (%s)", od["company_name"], od["status"])


async def run_seeds() -> None:
    await _create_indexes()
    await _seed_admin()
    await _seed_plans()
    await _seed_demo_organizers()
