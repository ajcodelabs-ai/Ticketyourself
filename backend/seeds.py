"""Idempotent seed of admin user, plans, demo organizers + tenants."""
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

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


async def _reset_demo_organizers() -> None:
    """
    Re-asserts the canonical state of the 3 demo organizers on every startup.
    Demo organizers are identified by their seeded email; real users are never touched.
    This protects against side-effects from tests/manual actions (e.g. a tester accidentally
    approving `prueba-eventos`).
    """
    plans_by_code = {
        p["code"]: p
        async for p in db.subscription_plans.find({}, {"_id": 0})
    }

    for od in DEMO_ORGANIZERS:
        user = await db.users.find_one({"email": od["user_email"].lower()}, {"_id": 0})
        if not user:
            continue
        organizer_id = user.get("organizer_id")
        if not organizer_id:
            continue

        plan = plans_by_code.get(od["plan_code"]) if od["plan_code"] else None
        plan_id = plan["id"] if plan else None
        approved = od["status"] == "approved"

        # Rebuild admin_comments deterministically
        admin_comments = []
        if od.get("approval_comment"):
            admin_comments.append(
                {
                    "id": str(uuid.uuid4()),
                    "admin_id": "system",
                    "admin_email": "system@ticketyourself.com",
                    "comment": od["approval_comment"],
                    "created_at": _now_iso(),
                }
            )
        if od.get("rejection_reason"):
            admin_comments.append(
                {
                    "id": str(uuid.uuid4()),
                    "admin_id": "system",
                    "admin_email": "system@ticketyourself.com",
                    "comment": od["rejection_reason"],
                    "created_at": _now_iso(),
                }
            )

        await db.organizers.update_one(
            {"id": organizer_id},
            {
                "$set": {
                    "company_name": od["company_name"],
                    "legal_id": od["legal_id"],
                    "org_type": od["org_type"],
                    "phone": od["phone"],
                    "country": od["country"],
                    "status": od["status"],
                    "rejection_reason": od.get("rejection_reason"),
                    "admin_comments": admin_comments,
                    "plan_id": plan_id,
                    "subscription_status": od["subscription_status"],
                    "approved_at": _now_iso() if approved else None,
                    "approved_by": "system" if approved else None,
                },
            },
        )

        # Also keep tenant status aligned
        await db.tenants.update_one(
            {"slug": od["slug"]},
            {"$set": {"status": "active" if approved else "inactive"}},
        )
        logger.info("Reset demo organizer %s → %s", od["slug"], od["status"])


# Prefixes used by ephemeral test organizers (created by pytest fixtures / testing agent).
# These accumulate over runs and pollute the DB. Cleaned up once per boot.
# Matched against BOTH slug and email — pytest tends to use the email prefix while
# the auto-slug rewrites the underscore to a dash (e.g. `new_xxx@…` → slug `newco-xxx`).
_EPHEMERAL_SLUG_PREFIXES = (
    "newco-",
    "actco-",
    "slugtest-",
    "new-",
    "acttest-",
    "eventos-quito-demo",
    "demo-welcome-test",
    "funnel-test",
    "test-bot",
    "bot-onboard",
    "prueba-test",
)
_EPHEMERAL_EMAIL_PREFIXES = (
    "new_",
    "newco_",
    "actco_",
    "acttest_",
    "slugtest_",
    "eventos.quito.demo",
    "test_",
    "funnel_",
    "funnel-test-",
    "testbot+",
    "testbot1",
)
# Test/disposable email domains. Seed users live under @ticketyourself.com and
# real users typically come from gmail/outlook/etc., so wiping any organizer
# whose email lives on these domains is safe and catches the long tail of
# pytest/playwright accounts that don't match a known prefix.
_EPHEMERAL_EMAIL_DOMAINS = (
    "@example.com",
    "@test.com",
)

# Buyer email patterns used by tests / playwright runs. Orders whose
# buyer.email matches ANY of these (case-insensitive, regex) get wiped at
# boot. Seed manual orders are protected by exact-email match (see SEED_*).
_EPHEMERAL_ORDER_EMAIL_PATTERNS = [
    r"@test\.com$",
    r"@example\.com$",
    r"^phase5b",
    r"^phase5bx",
    r"^funnel-test-",
    r"^test_e2e_",
    r"^new_",
    r"^acttest_",
    r"^slugtest_",
    r"^maria",
    r"^juan",
    r"^pw@",
    r"^ui_test@",
    r"^transfer@",
    r"^test\.buyer",
    r"^comprador\.test",
    r"^buyer\.manual",
]
SEED_MANUAL_BUYER_EMAILS = {
    "transfer-demo@example.com",
    "cash-demo@example.com",
}


async def _cleanup_ephemeral_orders() -> None:
    """
    Phase 5.5 — aggressive cleanup of test/ephemeral orders accumulated in
    preview. Matches any `buyer.email` against the patterns list, EXCLUDING
    the well-known seed manual orders.

    Side effects per matched order:
      - delete its tickets
      - delete its capacity reservations
      - if order was `paid`, decrement event.tickets_sold by quantity_total
      - delete the order
    Idempotent: empty match → no-op + no log.
    """
    pattern = "|".join(f"({p})" for p in _EPHEMERAL_ORDER_EMAIL_PATTERNS)
    query = {
        "buyer.email": {"$regex": pattern, "$options": "i"},
        # Belt + suspenders: never touch the well-known seed manual orders.
        "buyer.email": {"$nin": list(SEED_MANUAL_BUYER_EMAILS)},
    }
    # The 2nd $regex override in the dict above replaced the first; rebuild
    # with $and to keep both predicates.
    query = {
        "$and": [
            {"buyer.email": {"$regex": pattern, "$options": "i"}},
            {"buyer.email": {"$nin": list(SEED_MANUAL_BUYER_EMAILS)}},
        ]
    }

    cursor = db.ticket_orders.find(
        query,
        {
            "_id": 0,
            "id": 1,
            "event_id": 1,
            "status": 1,
            "quantity_total": 1,
            "order_number": 1,
            "buyer": 1,
        },
    )
    orders = [o async for o in cursor]
    if not orders:
        return

    order_ids = [o["id"] for o in orders]

    # Decrement event.tickets_sold for paid orders, grouped per event.
    paid_per_event: dict[str, int] = {}
    for o in orders:
        if o.get("status") == "paid":
            paid_per_event[o["event_id"]] = (
                paid_per_event.get(o["event_id"], 0) + o.get("quantity_total", 0)
            )
    for event_id, decrement in paid_per_event.items():
        await db.events.update_one(
            {"id": event_id}, {"$inc": {"tickets_sold": -decrement}}
        )

    tickets_deleted = (
        await db.tickets.delete_many({"order_id": {"$in": order_ids}})
    ).deleted_count
    reservations_deleted = (
        await db.event_capacity_reservations.delete_many({"order_id": {"$in": order_ids}})
    ).deleted_count
    orders_deleted = (
        await db.ticket_orders.delete_many({"id": {"$in": order_ids}})
    ).deleted_count
    logger.info(
        "Cleanup ephemeral orders: %d orders, %d tickets, %d reservations · "
        "decremented tickets_sold on %d event(s)",
        orders_deleted,
        tickets_deleted,
        reservations_deleted,
        len(paid_per_event),
    )


async def _cleanup_ephemeral_test_data() -> None:
    """
    Removes test-created organizers + their users + documents + tenants.
    Only matches the well-known ephemeral prefixes (no risk of touching real users).
    Idempotent: when there is nothing to clean it is a no-op.
    """
    seed_emails = {od["user_email"].lower() for od in DEMO_ORGANIZERS}
    seed_slugs = {od["slug"] for od in DEMO_ORGANIZERS}

    slug_or = "|".join(_EPHEMERAL_SLUG_PREFIXES)
    email_or = "|".join(_EPHEMERAL_EMAIL_PREFIXES)
    query = {
        "$or": [
            {"slug": {"$regex": f"^({slug_or})", "$options": "i"}},
            {"email": {"$regex": f"^({email_or})", "$options": "i"}},
        ]
    }

    org_cursor = db.organizers.find(
        query, {"_id": 0, "id": 1, "user_id": 1, "slug": 1, "email": 1}
    )
    orgs = [o async for o in org_cursor]
    orgs = [
        o for o in orgs
        if o.get("slug") not in seed_slugs and o.get("email", "").lower() not in seed_emails
    ]
    if not orgs:
        return

    org_ids = [o["id"] for o in orgs]
    user_ids = [o["user_id"] for o in orgs if o.get("user_id")]
    slugs = [o["slug"] for o in orgs]

    await db.organizer_documents.delete_many({"organizer_id": {"$in": org_ids}})
    await db.microsites.delete_many({"organizer_id": {"$in": org_ids}})
    await db.microsite_assets.delete_many({"organizer_id": {"$in": org_ids}})
    await db.activation_events.delete_many({"organizer_id": {"$in": org_ids}})
    await db.events.delete_many({"organizer_id": {"$in": org_ids}})
    await db.event_assets.delete_many({"organizer_id": {"$in": org_ids}})
    await db.organizers.delete_many({"id": {"$in": org_ids}})
    await db.users.delete_many({"id": {"$in": user_ids}})
    await db.tenants.delete_many({"slug": {"$in": slugs}})
    logger.info("Cleaned up %d ephemeral test organizer(s): %s", len(orgs), slugs)


async def _seed_demo_microsites() -> None:
    """
    Per-organizer microsite seed:
      - demo-org → published, opinionated demo content.
      - prueba-eventos / evento-rechazado → unpublished default.
    Idempotent: only inserts when no microsite exists for that organizer.
    """
    from services.microsite_factory import default_microsite

    seeds = {
        "demo-org": {
            "published": True,
            "template": "estandar",
            "branding": {
                "primary_color": "#4f46e5",
                "secondary_color": "#eef2ff",
                "logo_url": None,
                "banner_url": None,
                "font_family": "Inter",
            },
            "content": {
                "hero_title": "Demo Organizer · Eventos en vivo",
                "hero_subtitle": "Conciertos, fiestas y experiencias únicas en Quito y Guayaquil.",
                "hero_cta_text": "Ver próximos eventos",
                "about_title": "Quiénes somos",
                "about_body": (
                    "Demo Organizer produce experiencias únicas desde 2018. "
                    "Trabajamos con artistas locales e internacionales y "
                    "garantizamos venues seguros y bien equipados."
                ),
                "contact_email": "hola@demo-org.test",
                "contact_phone": "+593 99 123 4567",
                "address": "Av. Amazonas N40-120, Quito, Ecuador",
            },
            "social_links": {
                "instagram": "https://instagram.com/demoorg",
                "facebook": "https://facebook.com/demoorg",
                "whatsapp": "+593991234567",
                "twitter": "",
                "tiktok": "",
                "youtube": "",
            },
        },
        "prueba-eventos": {"published": False},
        "evento-rechazado": {"published": False},
    }

    for slug, override in seeds.items():
        organizer = await db.organizers.find_one({"slug": slug}, {"_id": 0})
        if not organizer:
            continue
        existing = await db.microsites.find_one(
            {"organizer_id": organizer["id"]}, {"_id": 0, "id": 1}
        )
        doc = default_microsite(
            organizer_id=organizer["id"],
            tenant_slug=slug,
            company_name=organizer.get("company_name") or slug,
        )
        doc.update(override)
        if "branding" in override:
            doc["branding"] = {**doc["branding"], **override["branding"]}
        if "content" in override:
            doc["content"] = {**doc["content"], **override["content"]}
        if "social_links" in override:
            doc["social_links"] = {**doc["social_links"], **override["social_links"]}

        if existing:
            # For demo-org we re-assert the canonical microsite content (idempotent reset
            # — same pattern as _reset_demo_organizers). Other demos keep what the user
            # may have edited (no clobber).
            if slug == "demo-org":
                await db.microsites.update_one(
                    {"id": existing["id"]},
                    {
                        "$set": {
                            "template": doc["template"],
                            "branding": doc["branding"],
                            "content": doc["content"],
                            "social_links": doc["social_links"],
                            "sections_enabled": doc["sections_enabled"],
                            "published": doc["published"],
                            "updated_at": doc["updated_at"],
                        }
                    },
                )
                logger.info("Reset demo microsite for %s (published=%s)", slug, doc["published"])
            continue
        await db.microsites.insert_one(doc)
        logger.info("Seeded microsite for %s (published=%s)", slug, doc["published"])


async def _seed_demo_events() -> None:
    """
    Three demo events for demo-org. Reset on every boot so the public microsite
    showcases a realistic mix (paid + paid + free, varying dates).
    """
    organizer = await db.organizers.find_one({"slug": "demo-org"}, {"_id": 0, "id": 1})
    if not organizer:
        return

    now = datetime.now(timezone.utc)
    spec = [
        {
            "slug": "concierto-acustico-demo",
            "title": "Concierto Acústico Demo",
            "short_description": "Una noche íntima con artistas locales.",
            "description": (
                "Disfrutá una noche acústica con tres bandas locales en un ambiente íntimo. "
                "Sonido envolvente, luces tenues y bebida de cortesía con tu entrada."
            ),
            "category": "entertainment",
            "venue_name": "Teatro Bolívar",
            "venue_address": "Pasaje Royal 175 y Junín",
            "venue_city": "Quito",
            "starts_at": (now + timedelta(days=30)).replace(hour=21, minute=0).isoformat(),
            "ends_at": (now + timedelta(days=30)).replace(hour=23, minute=30).isoformat(),
            "pricing_type": "paid",
            "base_price_cents": 1500,
            "capacity": 100,
            "poster_url": "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800",
        },
        {
            "slug": "conferencia-marketing-digital",
            "title": "Conferencia de Marketing Digital",
            "short_description": "Estrategias 2026 para marcas en LATAM.",
            "description": (
                "Una jornada completa con speakers de Ecuador, Colombia y Argentina. "
                "Workshops prácticos por la tarde. Coffee break y networking incluidos."
            ),
            "category": "educational",
            "venue_name": "Hotel Quito",
            "venue_address": "González Suárez N27-142",
            "venue_city": "Quito",
            "starts_at": (now + timedelta(days=45)).replace(hour=9, minute=0).isoformat(),
            "ends_at": (now + timedelta(days=45)).replace(hour=18, minute=0).isoformat(),
            "pricing_type": "paid",
            "base_price_cents": 5000,
            "capacity": 50,
            "poster_url": "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800",
        },
        {
            "slug": "charla-liderazgo-femenino",
            "title": "Charla Gratuita: Liderazgo Femenino",
            "short_description": "Encuentro abierto con líderes de la región.",
            "description": (
                "Conversación abierta sobre desafíos y oportunidades del liderazgo "
                "femenino en empresas latinoamericanas. Cupos limitados — registrate gratis."
            ),
            "category": "corporate",
            "venue_name": "Centro Cultural Metropolitano",
            "venue_address": "García Moreno y Espejo",
            "venue_city": "Quito",
            "starts_at": (now + timedelta(days=15)).replace(hour=18, minute=30).isoformat(),
            "ends_at": (now + timedelta(days=15)).replace(hour=20, minute=30).isoformat(),
            "pricing_type": "free",
            "base_price_cents": 0,
            "capacity": None,
            "poster_url": "https://images.unsplash.com/photo-1591115765373-5207764f72e7?w=800",
        },
    ]

    for s in spec:
        existing = await db.events.find_one(
            {"organizer_id": organizer["id"], "slug": s["slug"]},
            {"_id": 0, "id": 1},
        )
        record = {
            "organizer_id": organizer["id"],
            "tenant_slug": "demo-org",
            "slug": s["slug"],
            "title": s["title"],
            "description": s["description"],
            "short_description": s["short_description"],
            "category": s["category"],
            "venue_name": s["venue_name"],
            "venue_address": s["venue_address"],
            "venue_city": s["venue_city"],
            "venue_country": "Ecuador",
            "starts_at": s["starts_at"],
            "ends_at": s["ends_at"],
            "timezone": "America/Guayaquil",
            "sales_start": None,
            "sales_end": None,
            "pricing_type": s["pricing_type"],
            "base_price_cents": s["base_price_cents"],
            "currency": "USD",
            "capacity": s["capacity"],
            "visibility": "public",
            "status": "published",
            "tickets_sold": 0,
            "poster_url": s["poster_url"],
            "banner_url": None,
            "gallery_urls": [],
            "payment_methods": (
                {
                    "stripe": {"enabled": True},
                    "transfer": {
                        "enabled": True,
                        "bank_name": "Banco Pichincha",
                        "account_number": "2100123456",
                        "account_holder": "Eventos Demo S.A.",
                        "instructions": "Envianos el comprobante al WhatsApp +593 98 765 4321 indicando el número de orden.",
                    },
                    "cash": {
                        "enabled": True,
                        "location": "Av. Amazonas N32-45, oficina 3, Quito",
                        "schedule": "Lun-Vie 9:00-18:00, Sáb 10:00-14:00",
                        "contact": "+593 98 765 4321",
                    },
                }
                if s["slug"] == "concierto-acustico-demo"
                else {
                    "stripe": {"enabled": True},
                    "transfer": {
                        "enabled": False,
                        "bank_name": "",
                        "account_number": "",
                        "account_holder": "",
                        "instructions": "",
                    },
                    "cash": {
                        "enabled": False,
                        "location": "",
                        "schedule": "",
                        "contact": "",
                    },
                }
            ),
            "discounts": {
                "disability_law": {"enabled": False, "percent": 50},
                "presale": {"enabled": False, "percent": 0, "ends_at": None},
            },
            "access_params": {
                "visibility": "public",
                "access_type": "open",
                "max_per_purchase": 10,
                "max_per_email": None,
                "refund_window_hours": 24,
                "show_buyer_name_on_ticket": True,
            },
            "updated_at": _now_iso(),
            "published_at": _now_iso(),
        }
        if existing:
            # Keep `id` and `created_at`; refresh everything else.
            await db.events.update_one(
                {"id": existing["id"]}, {"$set": record}
            )
        else:
            record["id"] = str(uuid.uuid4())
            record["created_at"] = _now_iso()
            await db.events.insert_one({**record})
        logger.info("Seeded demo event %s", s["slug"])


async def _seed_demo_manual_orders() -> None:
    """
    Phase 5b — creates two demo orders in `pending_manual_payment` over the
    concierto-acustico-demo event so the organizer can see them in the
    Ventas tab without having to manually create them.

    Idempotent: deletes any prior demo manual orders before re-inserting.
    The buyer emails are well-known so they can be safely cleaned up.
    """
    # Locate the event + organizer for this seed.
    organizer = await db.organizers.find_one({"slug": "demo-org"}, {"_id": 0, "id": 1, "slug": 1})
    if not organizer:
        return
    event = await db.events.find_one(
        {"organizer_id": organizer["id"], "slug": "concierto-acustico-demo"},
        {"_id": 0},
    )
    if not event:
        return

    seed_emails = ("transfer-demo@example.com", "cash-demo@example.com")
    # Cleanup previous demo manual orders + their reservations.
    prior = db.ticket_orders.find(
        {"organizer_id": organizer["id"], "buyer.email": {"$in": list(seed_emails)}},
        {"_id": 0, "id": 1},
    )
    prior_ids = [d["id"] async for d in prior]
    if prior_ids:
        await db.event_capacity_reservations.delete_many({"order_id": {"$in": prior_ids}})
        await db.ticket_orders.delete_many({"id": {"$in": prior_ids}})

    seeds = [
        {
            "payment_method": "transfer",
            "buyer": {
                "name": "Test Transferencia",
                "email": seed_emails[0],
                "phone": "+593 99 111 1111",
                "document_id": "1700000001",
            },
            "quantity": 2,
        },
        {
            "payment_method": "cash",
            "buyer": {
                "name": "Test Efectivo",
                "email": seed_emails[1],
                "phone": "+593 99 222 2222",
                "document_id": "1700000002",
            },
            "quantity": 1,
        },
    ]

    from services import order_service

    for spec in seeds:
        totals = order_service.compute_totals(
            event=event, quantity=spec["quantity"], donation_amount_cents=0
        )
        try:
            order = await order_service.create_order_skeleton(
                event=event,
                organizer=organizer,
                quantity=spec["quantity"],
                buyer=spec["buyer"],
                totals=totals,
                payment_method=spec["payment_method"],
            )
            await order_service.reserve_capacity(
                event_id=event["id"],
                order_id=order["id"],
                quantity=spec["quantity"],
                ttl_minutes=order_service.MANUAL_RESERVATION_TTL_HOURS * 60,
            )
            logger.info(
                "Seeded demo manual order %s (%s)", order["order_number"], spec["payment_method"]
            )
        except Exception:  # noqa: BLE001
            logger.exception("Could not seed manual order for %s", spec["payment_method"])


async def _seed_demo_venues() -> None:
    """
    Phase 6a — seed 2 demo venues for demo-org so the editor lands on real data.
    Idempotent: deletes existing demo venues by well-known slug, recreates.
    """
    organizer = await db.organizers.find_one({"slug": "demo-org"}, {"_id": 0, "id": 1, "slug": 1})
    if not organizer:
        return
    demo_slugs = ("teatro-demo", "auditorio-pequeno")
    # Skip seed when an existing demo venue is referenced by events (avoid breaking those FKs).
    bound = await db.events.count_documents(
        {"venue_id": {"$exists": True, "$ne": None}}
    )
    if bound:
        # If any events bind to venues, leave as-is — admin/operator must clean up.
        existing = await db.venues.count_documents(
            {"organizer_id": organizer["id"], "slug": {"$in": list(demo_slugs)}}
        )
        if existing >= 2:
            return

    await db.venues.delete_many(
        {"organizer_id": organizer["id"], "slug": {"$in": list(demo_slugs)}}
    )

    now = _now_iso()
    # ── 1. Teatro Demo ────────────────────────────────────────────────────
    loc_platea = {"id": str(uuid.uuid4()), "name": "Platea", "color": "#3B82F6",
                  "description": "Filas frontales", "default_price_cents": 2500}
    loc_tribuna = {"id": str(uuid.uuid4()), "name": "Tribuna", "color": "#10B981",
                   "description": "Filas posteriores", "default_price_cents": 1500}
    loc_general = {"id": str(uuid.uuid4()), "name": "General", "color": "#6B7280",
                   "description": "Gradería", "default_price_cents": 1000}

    teatro_elements = [
        {
            "id": str(uuid.uuid4()), "kind": "stage",
            "x": 250, "y": 50, "rotation": 0, "label": "Escenario",
            "locality_id": None, "z_index": 0,
            "width": 700, "height": 80, "color": "#9CA3AF",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 300, "y": 180, "rotation": 0, "label": "Fila A",
            "locality_id": loc_platea["id"], "z_index": 1,
            "seats_count": 10, "seat_spacing": 30, "seat_radius": 11,
            "row_label": "A", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 270, "y": 240, "rotation": 0, "label": "Fila B",
            "locality_id": loc_platea["id"], "z_index": 1,
            "seats_count": 12, "seat_spacing": 30, "seat_radius": 11,
            "row_label": "B", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 270, "y": 300, "rotation": 0, "label": "Fila C",
            "locality_id": loc_tribuna["id"], "z_index": 1,
            "seats_count": 12, "seat_spacing": 30, "seat_radius": 11,
            "row_label": "C", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "unnumbered_zone",
            "x": 200, "y": 540, "rotation": 0, "label": "Gradería",
            "locality_id": loc_general["id"], "z_index": 1,
            "width": 800, "height": 150, "capacity": 50, "color": None,
        },
    ]
    teatro_cap = sum(
        (e.get("seats_count") or 0) if e["kind"] == "seat_row_straight" else (e.get("capacity") or 0)
        for e in teatro_elements
    )
    await db.venues.insert_one({
        "id": str(uuid.uuid4()),
        "organizer_id": organizer["id"],
        "tenant_slug": "demo-org",
        "name": "Teatro Demo",
        "slug": "teatro-demo",
        "description": "Sala chica con escenario frontal, ideal para shows íntimos.",
        "type": "theater",
        "canvas": {"width": 1200, "height": 800, "background_color": "#FAFAFA", "grid_size": 20},
        "elements": teatro_elements,
        "localities": [loc_platea, loc_tribuna, loc_general],
        "capacity_calculated": teatro_cap,
        "status": "published",
        "is_template": False,
        "created_at": now,
        "updated_at": now,
        "published_at": now,
    })

    # ── 2. Auditorio Pequeño (Phase 6b: showcases all new element kinds) ──
    loc_aud_gen = {"id": str(uuid.uuid4()), "name": "General", "color": "#6366F1",
                   "description": "Asientos numerados generales", "default_price_cents": 1500}
    loc_aud_vip = {"id": str(uuid.uuid4()), "name": "VIP", "color": "#F59E0B",
                   "description": "Asientos VIP frente al escenario", "default_price_cents": 5000}
    loc_aud_mesa = {"id": str(uuid.uuid4()), "name": "Mesa", "color": "#10B981",
                    "description": "Sillas en mesa", "default_price_cents": 3000}
    aud_elements = [
        {
            "id": str(uuid.uuid4()), "kind": "stage",
            "x": 240, "y": 40, "rotation": 0, "label": "Escenario",
            "locality_id": None, "z_index": 0,
            "width": 320, "height": 60, "color": "#9CA3AF",
        },
        # 2 filas rectas
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 240, "y": 160, "rotation": 0, "label": "Fila A",
            "locality_id": loc_aud_gen["id"], "z_index": 1,
            "seats_count": 10, "seat_spacing": 28, "seat_radius": 10,
            "row_label": "A", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 240, "y": 200, "rotation": 0, "label": "Fila B",
            "locality_id": loc_aud_gen["id"], "z_index": 1,
            "seats_count": 10, "seat_spacing": 28, "seat_radius": 10,
            "row_label": "B", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        # 1 fila curva
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_curved",
            "x": 400, "y": 360, "rotation": 0, "label": "Fila C (curva)",
            "locality_id": loc_aud_gen["id"], "z_index": 1,
            "seats_count": 10, "seat_spacing": 26, "seat_radius": 10,
            "curve_radius": 220, "curve_arc_degrees": 80,
            "row_label": "C", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        # 2 mesas redondas
        {
            "id": str(uuid.uuid4()), "kind": "table_round",
            "x": 180, "y": 460, "rotation": 0, "label": "Mesa 1",
            "locality_id": loc_aud_mesa["id"], "z_index": 1,
            "table_radius": 40, "chairs_count": 6,
            "chair_radius": 10, "chair_distance": 22,
        },
        {
            "id": str(uuid.uuid4()), "kind": "table_round",
            "x": 320, "y": 460, "rotation": 0, "label": "Mesa 2",
            "locality_id": loc_aud_mesa["id"], "z_index": 1,
            "table_radius": 40, "chairs_count": 6,
            "chair_radius": 10, "chair_distance": 22,
        },
        # 1 mesa rectangular
        {
            "id": str(uuid.uuid4()), "kind": "table_rect",
            "x": 480, "y": 440, "rotation": 0, "label": "Mesa larga",
            "locality_id": loc_aud_mesa["id"], "z_index": 1,
            "width": 160, "height": 60,
            "chairs_per_side": {"top": 2, "bottom": 2, "left": 0, "right": 0},
            "chair_radius": 10, "chair_distance": 20,
        },
        # 4 asientos individuales VIP cerca del escenario
        *[
            {
                "id": str(uuid.uuid4()), "kind": "seat_individual",
                "x": 240 + i * 60, "y": 115, "rotation": 0,
                "label": f"VIP-{i + 1}",
                "locality_id": loc_aud_vip["id"], "z_index": 2,
                "seat_radius": 12,
            }
            for i in range(4)
        ],
    ]
    aud_cap = 0
    for e in aud_elements:
        if e["kind"] in ("seat_row_straight", "seat_row_curved"):
            aud_cap += e.get("seats_count", 0)
        elif e["kind"] == "seat_individual":
            aud_cap += 1
        elif e["kind"] == "table_round":
            aud_cap += e.get("chairs_count", 0)
        elif e["kind"] == "table_rect":
            cps = e.get("chairs_per_side") or {}
            aud_cap += sum(int(cps.get(s) or 0) for s in ("top", "right", "bottom", "left"))
    await db.venues.insert_one({
        "id": str(uuid.uuid4()),
        "organizer_id": organizer["id"],
        "tenant_slug": "demo-org",
        "name": "Auditorio Pequeño",
        "slug": "auditorio-pequeno",
        "description": "Showcase de Fase 6b: filas rectas, fila curva, mesas redondas, mesa rectangular y asientos VIP individuales.",
        "type": "auditorium",
        "canvas": {"width": 800, "height": 600, "background_color": "#FAFAFA", "grid_size": 20},
        "elements": aud_elements,
        "localities": [loc_aud_gen, loc_aud_vip, loc_aud_mesa],
        "capacity_calculated": aud_cap,
        "status": "published",
        "is_template": False,
        "created_at": now,
        "updated_at": now,
        "published_at": now,
    })
    logger.info("Seeded 2 demo venues for demo-org (Teatro Demo + Auditorio Pequeño)")


async def _seed_demo_numbered_event() -> None:
    """
    Phase 7 — Creates "Función Especial — Demo Numerado" linked to Teatro Demo,
    with pricing per locality + a couple of pre-sold seats + a held seat so the
    public seat-picker shows all 3 visual states out of the box.
    Idempotent: matches by slug.
    """
    organizer = await db.organizers.find_one({"slug": "demo-org"}, {"_id": 0, "id": 1})
    if not organizer:
        return
    venue = await db.venues.find_one(
        {"organizer_id": organizer["id"], "slug": "teatro-demo"}, {"_id": 0},
    )
    if not venue:
        return

    # Resolve locality ids by name
    loc_by_name = {loc["name"]: loc["id"] for loc in venue.get("localities", [])}
    pricing = []
    if "Platea" in loc_by_name:
        pricing.append({"locality_id": loc_by_name["Platea"], "price_cents": 2500,
                        "max_tickets_per_purchase": None})
    if "Tribuna" in loc_by_name:
        pricing.append({"locality_id": loc_by_name["Tribuna"], "price_cents": 1500,
                        "max_tickets_per_purchase": None})
    if "General" in loc_by_name:
        pricing.append({"locality_id": loc_by_name["General"], "price_cents": 1000,
                        "max_tickets_per_purchase": None})

    now = datetime.now(timezone.utc)
    slug = "funcion-especial-demo-numerado"
    record = {
        "organizer_id": organizer["id"],
        "tenant_slug": "demo-org",
        "slug": slug,
        "title": "Función Especial — Demo Numerado",
        "description": (
            "Función con asientos numerados. Elegí tus butacas directamente sobre "
            "el mapa del Teatro Demo. Tres localidades disponibles: Platea, Tribuna y Gradería General."
        ),
        "short_description": "Función con asientos numerados — mapa interactivo.",
        "category": "entertainment",
        "venue_name": "Teatro Demo",
        "venue_address": "Pasaje Royal 175 y Junín",
        "venue_city": "Quito",
        "venue_country": "Ecuador",
        "starts_at": (now + timedelta(days=20)).replace(hour=20, minute=0).isoformat(),
        "ends_at": (now + timedelta(days=20)).replace(hour=22, minute=30).isoformat(),
        "timezone": "America/Guayaquil",
        "sales_start": None, "sales_end": None,
        "pricing_type": "paid",
        "base_price_cents": 1000,  # ignored when venue_id is set
        "currency": "USD",
        "capacity": venue.get("capacity_calculated") or 0,
        "visibility": "public",
        "status": "published",
        "tickets_sold": 0,
        "poster_url": "https://images.unsplash.com/photo-1503095396549-807759245b35?w=800",
        "banner_url": None,
        "gallery_urls": [],
        "payment_methods": {
            "stripe": {"enabled": True},
            "transfer": {
                "enabled": True, "bank_name": "Banco Pichincha",
                "account_number": "2100123456",
                "account_holder": "Eventos Demo S.A.",
                "instructions": "Envianos el comprobante al WhatsApp +593 98 765 4321.",
            },
            "cash": {
                "enabled": False, "location": "", "schedule": "", "contact": "",
            },
        },
        "discounts": {
            "disability_law": {"enabled": False, "percent": 50},
            "presale": {"enabled": False, "percent": 0, "ends_at": None},
        },
        "access_params": {
            "visibility": "public", "access_type": "open",
            "max_per_purchase": 10, "max_per_email": None,
            "refund_window_hours": 24, "show_buyer_name_on_ticket": True,
        },
        # Phase 7 fields
        "venue_id": venue["id"],
        "venue_slug": venue["slug"],
        "locality_pricing": pricing,
        "seat_holds_window_minutes": 10,
        "updated_at": _now_iso(),
        "published_at": _now_iso(),
    }
    existing = await db.events.find_one(
        {"organizer_id": organizer["id"], "slug": slug}, {"_id": 0, "id": 1},
    )
    if existing:
        event_id = existing["id"]
        await db.events.update_one({"id": event_id}, {"$set": record})
    else:
        event_id = str(uuid.uuid4())
        record["id"] = event_id
        record["created_at"] = _now_iso()
        await db.events.insert_one({**record})
    logger.info("Seeded numbered event %s linked to %s", slug, venue["slug"])

    # ── Pre-sold + pre-held seats for visual demo ─────────────────────────
    # Find the first seat-row element ("Fila A") and pre-sell seats A-1 / A-2,
    # then put A-3 on hold. Find Fila C (Tribuna) and pre-sell C-5.
    fila_a = next(
        (e for e in venue["elements"]
         if e.get("kind") == "seat_row_straight" and (e.get("row_label") or "").upper() == "A"),
        None,
    )
    fila_c = next(
        (e for e in venue["elements"]
         if e.get("kind") == "seat_row_straight" and (e.get("row_label") or "").upper() == "C"),
        None,
    )
    # Clear any prior demo holds/assignments for this event so it's idempotent
    await db.event_seat_assignments.delete_many({"event_id": event_id})
    await db.seat_holds.delete_many({"event_id": event_id})

    pre_sold_seats = []
    if fila_a:
        pre_sold_seats.append((fila_a["id"], 0, "A-1", fila_a.get("locality_id")))
        pre_sold_seats.append((fila_a["id"], 1, "A-2", fila_a.get("locality_id")))
    if fila_c:
        pre_sold_seats.append((fila_c["id"], 4, "C-5", fila_c.get("locality_id")))

    assignments = []
    sold_qty = 0
    for el_id, idx, label, loc_id in pre_sold_seats:
        sid = f"{el_id}::s::{idx}"
        assignments.append({
            "id": str(uuid.uuid4()),
            "event_id": event_id, "venue_id": venue["id"],
            "seat_id": sid, "ticket_id": f"seed-demo-{sid}",
            "order_id": "seed-demo",
            "holder_email": "demo-buyer@example.com",
            "locality_id": loc_id,
            "assigned_at": _now_iso(),
        })
        sold_qty += 1
    if assignments:
        await db.event_seat_assignments.insert_many(assignments)
        await db.events.update_one(
            {"id": event_id}, {"$set": {"tickets_sold": sold_qty}},
        )

    # Pre-held: one seat held for 1 hour (visible to public as "held" by another)
    if fila_a:
        expires = (now + timedelta(hours=1)).isoformat()
        sid_held = f"{fila_a['id']}::s::2"
        await db.seat_holds.insert_one({
            "id": str(uuid.uuid4()),
            "event_id": event_id, "venue_id": venue["id"],
            "seat_id": sid_held,
            "holder": {"session_token": "seed-held-session-fixed", "buyer_email": None},
            "status": "held",
            "held_at": _now_iso(),
            "expires_at": expires,
            "order_id": None,
        })


async def _backfill_discount_rule_ids() -> None:
    """One-shot migration: any `event.discounts.rules[*]` persisted before the
    Phase 9.5 model change may have `id == null`. Two such rules would compare
    equal in `evaluate_discounts` and break stacking. Idempotent — only events
    that actually need patching get a write."""
    cursor = db.events.find(
        {"discounts.rules.id": None},
        {"_id": 0, "id": 1, "discounts": 1},
    )
    fixed = 0
    async for ev in cursor:
        rules = (ev.get("discounts") or {}).get("rules") or []
        if not any(r.get("id") in (None, "") for r in rules):
            continue
        for r in rules:
            if not r.get("id"):
                r["id"] = str(uuid.uuid4())
        await db.events.update_one(
            {"id": ev["id"]},
            {"$set": {"discounts.rules": rules}},
        )
        fixed += 1
    if fixed:
        logger.info("backfilled discount-rule UUIDs on %d event(s)", fixed)


async def run_seeds() -> None:
    await _create_indexes()
    await _cleanup_ephemeral_test_data()
    await _cleanup_ephemeral_orders()
    await _seed_admin()
    await _seed_plans()
    await _seed_demo_organizers()
    await _reset_demo_organizers()
    await _seed_demo_microsites()
    await _seed_demo_events()
    await _seed_demo_manual_orders()
    await _seed_demo_venues()
    await _seed_demo_numbered_event()
    await _backfill_discount_rule_ids()
