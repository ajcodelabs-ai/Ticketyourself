"""Idempotent seed of admin user, plans, demo organizers + tenants."""
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select, update as sa_update

from database import AsyncSessionLocal
from db_helpers import get_event_by_id, get_organizer_by_slug, row_to_dict
from orm_models import (
    ActivationEvent, Event, EventCapacityReservation, EventSeatAssignment,
    Microsite, MicrositeAsset, Organizer, OrganizerAdminComment, OrganizerDocument,
    SeatHold, SubscriptionPlan, Tenant, Ticket, TicketOrder, User,
)
from security import hash_password, verify_password
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

# Placeholder order id for numbered-event seat preview (no real TicketOrder row).
DEMO_SEAT_PREVIEW_ORDER_ID = "11111111-1111-4111-8111-111111111111"


async def _create_indexes() -> None:
    pass  # All indexes are managed by Alembic migrations


async def _seed_admin() -> None:
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ticketyourself.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin123!")
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == admin_email))
        existing = result.scalar_one_or_none()
        if existing is None:
            session.add(User(
                id=str(uuid.uuid4()),
                email=admin_email,
                password_hash=hash_password(admin_password),
                role="super_admin",
                organizer_id=None,
                created_at=datetime.now(timezone.utc),
                last_login=None,
            ))
            await session.commit()
            logger.info("Seeded super_admin %s", admin_email)
        else:
            if not verify_password(admin_password, existing.password_hash):
                existing.password_hash = hash_password(admin_password)
                await session.commit()
                logger.info("Updated super_admin password for %s", admin_email)


async def _seed_plans() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        for plan in PLANS:
            result = await session.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == plan["code"])
            )
            if result.scalar_one_or_none() is None:
                session.add(SubscriptionPlan(
                    id=str(uuid.uuid4()),
                    stripe_price_id=None,
                    created_at=now,
                    updated_at=now,
                    **plan,
                ))
        await session.commit()
    logger.info("Seeded %d plans", len(PLANS))


async def _seed_demo_organizers() -> None:
    """
    Inserts demo organizers + users + tenants idempotently.
    Skips if the user email already exists.
    All in PostgreSQL.
    """
    async with AsyncSessionLocal() as session:
        plans_result = await session.execute(select(SubscriptionPlan))
        plans_by_code = {row.code: row for row in plans_result.scalars().all()}

        now = datetime.now(timezone.utc)

        for od in DEMO_ORGANIZERS:
            user_check = await session.execute(
                select(User).where(User.email == od["user_email"].lower())
            )
            if user_check.scalar_one_or_none():
                continue

            user_id = str(uuid.uuid4())
            organizer_id = str(uuid.uuid4())
            slug = normalize_slug(od["slug"])
            plan = plans_by_code.get(od["plan_code"]) if od["plan_code"] else None
            plan_id = plan.id if plan else None
            tenant_status = "active" if od["status"] == "approved" else "inactive"

            # Tenant → PG (upsert)
            tenant_result = await session.execute(select(Tenant).where(Tenant.slug == slug))
            tenant_row = tenant_result.scalar_one_or_none()
            if tenant_row:
                tenant_row.name = od["company_name"]
                tenant_row.status = tenant_status
            else:
                session.add(Tenant(slug=slug, name=od["company_name"],
                                   status=tenant_status, created_at=now))

            # User → PG (flush before organizer: organizers.user_id → users.id)
            session.add(User(
                id=user_id,
                email=od["user_email"].lower(),
                password_hash=hash_password(od["user_password"]),
                role="organizer",
                organizer_id=organizer_id,
                created_at=now,
                last_login=None,
            ))
            await session.flush()

            # Organizer → PG
            org_row = Organizer(
                id=organizer_id,
                user_id=user_id,
                company_name=od["company_name"],
                legal_id=od["legal_id"],
                org_type=od["org_type"],
                email=od["user_email"].lower(),
                phone=od["phone"],
                country=od["country"],
                slug=slug,
                status=od["status"],
                rejection_reason=od.get("rejection_reason"),
                plan_id=plan_id,
                plan_code=od["plan_code"],
                subscription_status=od["subscription_status"],
                created_at=now,
                approved_at=now if od["status"] == "approved" else None,
                approved_by="system" if od["status"] == "approved" else None,
            )
            session.add(org_row)
            await session.flush()

            # Admin comments → PG
            if od.get("approval_comment"):
                session.add(OrganizerAdminComment(
                    id=str(uuid.uuid4()), organizer_id=organizer_id,
                    admin_id="system", admin_email="system@ticketyourself.com",
                    comment=od["approval_comment"], created_at=now,
                ))
            if od.get("rejection_reason"):
                session.add(OrganizerAdminComment(
                    id=str(uuid.uuid4()), organizer_id=organizer_id,
                    admin_id="system", admin_email="system@ticketyourself.com",
                    comment=od["rejection_reason"], created_at=now,
                ))

            # Documents (stub) → PG
            for doc in od.get("documents", []):
                session.add(OrganizerDocument(
                    id=str(uuid.uuid4()), organizer_id=organizer_id,
                    doc_type=doc["doc_type"], file_path=None,
                    original_filename=doc["original_filename"],
                    mime_type="application/pdf", size_bytes=12345,
                    uploaded_at=now, is_demo=True,
                ))

            logger.info("Seeded demo organizer %s (%s)", od["company_name"], od["status"])

        await session.commit()


async def _reset_demo_organizers() -> None:
    """
    Re-asserts the canonical state of the 3 demo organizers on every startup.
    All in PostgreSQL.
    """
    from sqlalchemy.orm import selectinload

    async with AsyncSessionLocal() as session:
        plans_result = await session.execute(select(SubscriptionPlan))
        plans_by_code = {row.code: row for row in plans_result.scalars().all()}

        now = datetime.now(timezone.utc)

        for od in DEMO_ORGANIZERS:
            user_result = await session.execute(
                select(User).where(User.email == od["user_email"].lower())
            )
            user_row = user_result.scalar_one_or_none()
            if not user_row or not user_row.organizer_id:
                continue
            organizer_id = user_row.organizer_id

            org_result = await session.execute(
                select(Organizer)
                .where(Organizer.id == organizer_id)
                .options(selectinload(Organizer.admin_comments))
            )
            org_row = org_result.scalar_one_or_none()
            if not org_row:
                continue

            plan = plans_by_code.get(od["plan_code"]) if od["plan_code"] else None
            plan_id = plan.id if plan else None
            approved = od["status"] == "approved"

            org_row.company_name = od["company_name"]
            org_row.legal_id = od["legal_id"]
            org_row.org_type = od["org_type"]
            org_row.phone = od["phone"]
            org_row.country = od["country"]
            org_row.status = od["status"]
            org_row.rejection_reason = od.get("rejection_reason")
            org_row.plan_id = plan_id
            org_row.subscription_status = od["subscription_status"]
            org_row.approved_at = now if approved else None
            org_row.approved_by = "system" if approved else None

            # Reset admin comments: delete existing, re-insert canonical ones
            for c in list(org_row.admin_comments):
                await session.delete(c)
            await session.flush()
            if od.get("approval_comment"):
                session.add(OrganizerAdminComment(
                    id=str(uuid.uuid4()), organizer_id=organizer_id,
                    admin_id="system", admin_email="system@ticketyourself.com",
                    comment=od["approval_comment"], created_at=now,
                ))
            if od.get("rejection_reason"):
                session.add(OrganizerAdminComment(
                    id=str(uuid.uuid4()), organizer_id=organizer_id,
                    admin_id="system", admin_email="system@ticketyourself.com",
                    comment=od["rejection_reason"], created_at=now,
                ))

            tenant_result = await session.execute(
                select(Tenant).where(Tenant.slug == od["slug"])
            )
            tenant_row = tenant_result.scalar_one_or_none()
            if tenant_row:
                tenant_row.status = "active" if approved else "inactive"

            logger.info("Reset demo organizer %s → %s", od["slug"], od["status"])

        await session.commit()


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
    preview. Matches any `buyer_email` against the patterns list, EXCLUDING
    the well-known seed manual orders.

    Side effects per matched order:
      - delete its tickets (also cascade-deleted by FK, but explicit is safer)
      - delete its capacity reservations
      - if order was `paid`, decrement event.tickets_sold by quantity_total
      - delete the order
    Idempotent: empty match → no-op + no log.
    """
    # Build a single case-insensitive OR regex for PostgreSQL ~* operator
    pg_pattern = "|".join(f"({p})" for p in _EPHEMERAL_ORDER_EMAIL_PATTERNS)
    seed_emails = list(SEED_MANUAL_BUYER_EMAILS)

    async with AsyncSessionLocal() as _pg:
        orders_result = await _pg.execute(
            select(
                TicketOrder.id,
                TicketOrder.event_id,
                TicketOrder.status,
                TicketOrder.quantity_total,
            ).where(
                TicketOrder.buyer_email.op("~*")(pg_pattern),
                TicketOrder.buyer_email.notin_(seed_emails),
            )
        )
        orders = [
            {"id": r.id, "event_id": r.event_id, "status": r.status, "quantity_total": r.quantity_total}
            for r in orders_result.all()
        ]
        if not orders:
            return

        order_ids = [o["id"] for o in orders]

        paid_per_event: dict[str, int] = {}
        for o in orders:
            if o.get("status") == "paid":
                paid_per_event[o["event_id"]] = (
                    paid_per_event.get(o["event_id"], 0) + o.get("quantity_total", 0)
                )
        for event_id, decrement in paid_per_event.items():
            await _pg.execute(
                sa_update(Event)
                .where(Event.id == event_id)
                .values(tickets_sold=Event.tickets_sold - decrement)
            )

        res_result = await _pg.execute(
            delete(EventCapacityReservation).where(EventCapacityReservation.order_id.in_(order_ids))
        )
        tix_result = await _pg.execute(
            delete(Ticket).where(Ticket.order_id.in_(order_ids))
        )
        ord_result = await _pg.execute(
            delete(TicketOrder).where(TicketOrder.id.in_(order_ids))
        )
        await _pg.commit()

    logger.info(
        "Cleanup ephemeral orders: %d orders, %d tickets, %d reservations · "
        "decremented tickets_sold on %d event(s)",
        ord_result.rowcount,
        tix_result.rowcount,
        res_result.rowcount,
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

    async with AsyncSessionLocal() as session:
        slug_conditions = [Organizer.slug.ilike(f"{p}%") for p in _EPHEMERAL_SLUG_PREFIXES]
        email_conditions = [Organizer.email.ilike(f"{p}%") for p in _EPHEMERAL_EMAIL_PREFIXES]
        stmt = select(Organizer.id, Organizer.user_id, Organizer.slug, Organizer.email).where(
            or_(*slug_conditions, *email_conditions)
        )
        result = await session.execute(stmt)
        orgs = [
            {"id": r.id, "user_id": r.user_id, "slug": r.slug, "email": r.email}
            for r in result.all()
            if r.slug not in seed_slugs and (r.email or "").lower() not in seed_emails
        ]
        if not orgs:
            return

        org_ids = [o["id"] for o in orgs]
        user_ids = [o["user_id"] for o in orgs if o.get("user_id")]
        slugs = [o["slug"] for o in orgs]

        # Phase-6 collections now in PG
        await session.execute(delete(Microsite).where(Microsite.organizer_id.in_(org_ids)))
        await session.execute(delete(MicrositeAsset).where(MicrositeAsset.organizer_id.in_(org_ids)))
        await session.execute(delete(ActivationEvent).where(ActivationEvent.organizer_id.in_(org_ids)))

        # PG deletes — Venue/Event before Organizer (FK constraints)
        from orm_models import Venue as _CleanupVenue
        await session.execute(delete(_CleanupVenue).where(_CleanupVenue.organizer_id.in_(org_ids)))
        await session.execute(delete(Event).where(Event.organizer_id.in_(org_ids)))
        await session.execute(delete(Organizer).where(Organizer.id.in_(org_ids)))
        await session.execute(delete(User).where(User.id.in_(user_ids)))
        await session.execute(delete(Tenant).where(Tenant.slug.in_(slugs)))
        await session.commit()

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

    from sqlalchemy.orm.attributes import flag_modified as _flag_modified

    for slug, override in seeds.items():
        organizer = await get_organizer_by_slug(slug)
        if not organizer:
            continue
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

        now_dt = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as _ms_pg:
            existing_row = await _ms_pg.scalar(
                select(Microsite).where(Microsite.organizer_id == organizer["id"])
            )
            if existing_row:
                if slug == "demo-org":
                    existing_row.template = doc["template"]
                    existing_row.branding = doc["branding"]
                    existing_row.content = doc["content"]
                    existing_row.social_links = doc["social_links"]
                    existing_row.sections_enabled = doc["sections_enabled"]
                    existing_row.published = doc.get("published", False)
                    existing_row.updated_at = now_dt
                    _flag_modified(existing_row, "branding")
                    _flag_modified(existing_row, "content")
                    _flag_modified(existing_row, "social_links")
                    _flag_modified(existing_row, "sections_enabled")
                    await _ms_pg.commit()
                    logger.info("Reset demo microsite for %s (published=%s)", slug, existing_row.published)
                continue
            _ms_pg.add(Microsite(
                id=doc["id"],
                organizer_id=organizer["id"],
                slug=slug,
                template=doc.get("template"),
                branding=doc.get("branding", {}),
                content=doc.get("content", {}),
                social_links=doc.get("social_links", {}),
                sections_enabled=doc.get("sections_enabled", {}),
                published=doc.get("published", False),
                created_at=now_dt,
                updated_at=now_dt,
            ))
            await _ms_pg.commit()
        logger.info("Seeded microsite for %s (published=%s)", slug, doc.get("published", False))


async def _seed_demo_events() -> None:
    """
    Three demo events for demo-org. Reset on every boot so the public microsite
    showcases a realistic mix (paid + paid + free, varying dates).
    """
    organizer = await get_organizer_by_slug("demo-org")
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
            "starts_at": (now + timedelta(days=30)).replace(hour=21, minute=0),
            "ends_at": (now + timedelta(days=30)).replace(hour=23, minute=30),
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
            "starts_at": (now + timedelta(days=45)).replace(hour=9, minute=0),
            "ends_at": (now + timedelta(days=45)).replace(hour=18, minute=0),
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
            "starts_at": (now + timedelta(days=15)).replace(hour=18, minute=30),
            "ends_at": (now + timedelta(days=15)).replace(hour=20, minute=30),
            "pricing_type": "free",
            "base_price_cents": 0,
            "capacity": None,
            "poster_url": "https://images.unsplash.com/photo-1591115765373-5207764f72e7?w=800",
        },
    ]

    from sqlalchemy.orm.attributes import flag_modified as _flag_modified

    _demo_payment_methods_full = {
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
    _demo_payment_methods_stripe = {
        "stripe": {"enabled": True},
        "transfer": {"enabled": False, "bank_name": "", "account_number": "", "account_holder": "", "instructions": ""},
        "cash": {"enabled": False, "location": "", "schedule": "", "contact": ""},
    }
    _demo_discounts = {
        "disability_law": {"enabled": False, "percent": 50},
        "presale": {"enabled": False, "percent": 0, "ends_at": None},
    }
    _demo_access_params = {
        "visibility": "public", "access_type": "open",
        "max_per_purchase": 10, "max_per_email": None,
        "refund_window_hours": 24, "show_buyer_name_on_ticket": True,
    }

    for s in spec:
        _pm = _demo_payment_methods_full if s["slug"] == "concierto-acustico-demo" else _demo_payment_methods_stripe
        now_dt = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as session:
            row = await session.scalar(
                select(Event).where(
                    Event.organizer_id == organizer["id"],
                    Event.slug == s["slug"],
                )
            )
            if row:
                row.title = s["title"]
                row.description = s["description"]
                row.short_description = s["short_description"]
                row.category = s["category"]
                row.venue_name = s["venue_name"]
                row.venue_address = s["venue_address"]
                row.venue_city = s["venue_city"]
                row.venue_country = "Ecuador"
                row.starts_at = s["starts_at"]
                row.ends_at = s["ends_at"]
                row.timezone = "America/Guayaquil"
                row.pricing_type = s["pricing_type"]
                row.base_price_cents = s["base_price_cents"]
                row.currency = "USD"
                row.capacity = s["capacity"]
                row.visibility = "public"
                row.status = "published"
                row.poster_url = s["poster_url"]
                row.payment_methods = _pm
                row.discounts = _demo_discounts
                row.access_params = _demo_access_params
                row.updated_at = now_dt
                row.published_at = now_dt
                _flag_modified(row, "payment_methods")
                _flag_modified(row, "discounts")
                _flag_modified(row, "access_params")
            else:
                session.add(Event(
                    id=str(uuid.uuid4()),
                    organizer_id=organizer["id"],
                    tenant_slug="demo-org",
                    slug=s["slug"],
                    title=s["title"],
                    description=s["description"],
                    short_description=s["short_description"],
                    category=s["category"],
                    venue_name=s["venue_name"],
                    venue_address=s["venue_address"],
                    venue_city=s["venue_city"],
                    venue_country="Ecuador",
                    starts_at=s["starts_at"],
                    ends_at=s["ends_at"],
                    timezone="America/Guayaquil",
                    sales_start=None,
                    sales_end=None,
                    pricing_type=s["pricing_type"],
                    base_price_cents=s["base_price_cents"],
                    currency="USD",
                    capacity=s["capacity"],
                    visibility="public",
                    status="published",
                    tickets_sold=0,
                    poster_url=s["poster_url"],
                    banner_url=None,
                    gallery_urls=[],
                    locality_pricing=[],
                    payment_methods=_pm,
                    discounts=_demo_discounts,
                    access_params=_demo_access_params,
                    created_at=now_dt,
                    updated_at=now_dt,
                    published_at=now_dt,
                ))
            await session.commit()
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
    organizer = await get_organizer_by_slug("demo-org")
    if not organizer:
        return
    async with AsyncSessionLocal() as _pg:
        _ev_row = await _pg.scalar(
            select(Event).where(
                Event.organizer_id == organizer["id"],
                Event.slug == "concierto-acustico-demo",
            )
        )
    event = row_to_dict(_ev_row) if _ev_row else None
    if not event:
        return

    seed_emails = ("transfer-demo@example.com", "cash-demo@example.com")
    # Cleanup previous demo manual orders + their reservations.
    async with AsyncSessionLocal() as _pg_cleanup:
        _prior_result = await _pg_cleanup.execute(
            select(TicketOrder.id).where(
                TicketOrder.organizer_id == organizer["id"],
                TicketOrder.buyer_email.in_(list(seed_emails)),
            )
        )
        prior_ids = [r.id for r in _prior_result.all()]
        if prior_ids:
            await _pg_cleanup.execute(
                delete(EventCapacityReservation).where(
                    EventCapacityReservation.order_id.in_(prior_ids)
                )
            )
            await _pg_cleanup.execute(
                delete(TicketOrder).where(TicketOrder.id.in_(prior_ids))
            )
            await _pg_cleanup.commit()

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
    from sqlalchemy import delete as sa_delete, func as sa_func
    from orm_models import Venue

    organizer = await get_organizer_by_slug("demo-org")
    if not organizer:
        return
    demo_slugs = ("teatro-demo", "auditorio-pequeno")

    async with AsyncSessionLocal() as session:
        # Skip seed when an existing demo venue is referenced by events (avoid breaking those FKs).
        bound = await session.scalar(
            select(func.count(Event.id)).where(Event.venue_id.isnot(None))
        ) or 0
        if bound:
            existing_count = await session.scalar(
                select(sa_func.count(Venue.id)).where(
                    Venue.organizer_id == organizer["id"],
                    Venue.slug.in_(list(demo_slugs)),
                )
            )
            if (existing_count or 0) >= 2:
                return

        await session.execute(
            sa_delete(Venue).where(
                Venue.organizer_id == organizer["id"],
                Venue.slug.in_(list(demo_slugs)),
            )
        )
        await session.flush()

    now = datetime.now(timezone.utc)
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
    async with AsyncSessionLocal() as session:
        session.add(Venue(
            id=str(uuid.uuid4()),
            organizer_id=organizer["id"],
            tenant_slug="demo-org",
            name="Teatro Demo",
            slug="teatro-demo",
            description="Sala chica con escenario frontal, ideal para shows íntimos.",
            type="theater",
            canvas={"width": 1200, "height": 800, "background_color": "#FAFAFA", "grid_size": 20},
            elements=teatro_elements,
            localities=[loc_platea, loc_tribuna, loc_general],
            capacity_calculated=teatro_cap,
            status="published",
            is_template=False,
            created_at=now,
            updated_at=now,
            published_at=now,
        ))
        await session.commit()

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
    async with AsyncSessionLocal() as session:
        session.add(Venue(
            id=str(uuid.uuid4()),
            organizer_id=organizer["id"],
            tenant_slug="demo-org",
            name="Auditorio Pequeño",
            slug="auditorio-pequeno",
            description="Showcase de Fase 6b: filas rectas, fila curva, mesas redondas, mesa rectangular y asientos VIP individuales.",
            type="auditorium",
            canvas={"width": 800, "height": 600, "background_color": "#FAFAFA", "grid_size": 20},
            elements=aud_elements,
            localities=[loc_aud_gen, loc_aud_vip, loc_aud_mesa],
            capacity_calculated=aud_cap,
            status="published",
            is_template=False,
            created_at=now,
            updated_at=now,
            published_at=now,
        ))
        await session.commit()
    logger.info("Seeded 2 demo venues for demo-org (Teatro Demo + Auditorio Pequeño)")


async def _seed_venue_templates() -> None:
    """
    Platform venue templates (is_template=True) for organizers to clone.
    Idempotent: skips slugs that already exist as templates.
    """
    from orm_models import Venue

    organizer = await get_organizer_by_slug("demo-org")
    if not organizer:
        return

    template_specs = [
        {
            "slug": "plantilla-teatro-clasico",
            "name": "Teatro clásico",
            "description": "Escenario frontal, platea numerada y gradería general. Ideal para obras y conciertos íntimos.",
            "type": "theater",
            "canvas": {"width": 1200, "height": 800, "background_color": "#FAFAFA", "grid_size": 20},
            "build": "_build_template_teatro_clasico",
        },
        {
            "slug": "plantilla-auditorio-conferencias",
            "name": "Auditorio para conferencias",
            "description": "Escenario, filas numeradas y zona VIP al frente. Pensado para charlas y presentaciones.",
            "type": "auditorium",
            "canvas": {"width": 1000, "height": 700, "background_color": "#FAFAFA", "grid_size": 20},
            "build": "_build_template_auditorio",
        },
    ]

    existing_slugs: set[str] = set()
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Venue.slug).where(
                Venue.organizer_id == organizer["id"],
                Venue.is_template.is_(True),
                Venue.slug.in_([s["slug"] for s in template_specs]),
            )
        )
        existing_slugs = {row[0] for row in result.all()}

    to_create = [s for s in template_specs if s["slug"] not in existing_slugs]
    if not to_create:
        return

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        for spec in to_create:
            localities, elements, capacity = _build_venue_template_layout(spec["build"])
            session.add(Venue(
                id=str(uuid.uuid4()),
                organizer_id=organizer["id"],
                tenant_slug=organizer["slug"],
                name=spec["name"],
                slug=spec["slug"],
                description=spec["description"],
                type=spec["type"],
                canvas=spec["canvas"],
                elements=elements,
                localities=localities,
                capacity_calculated=capacity,
                status="draft",
                is_template=True,
                created_at=now,
                updated_at=now,
                published_at=None,
            ))
        await session.commit()
    logger.info("Seeded %d venue template(s): %s", len(to_create), ", ".join(s["name"] for s in to_create))


def _build_venue_template_layout(build_key: str):
    """Return (localities, elements, capacity) for a named template layout."""
    if build_key == "_build_template_teatro_clasico":
        return _build_template_teatro_clasico()
    if build_key == "_build_template_auditorio":
        return _build_template_auditorio()
    raise ValueError(f"Unknown template layout: {build_key}")


def _build_template_teatro_clasico():
    loc_platea = {
        "id": str(uuid.uuid4()), "name": "Platea", "color": "#3B82F6",
        "description": "Filas centrales", "default_price_cents": 2500,
    }
    loc_tribuna = {
        "id": str(uuid.uuid4()), "name": "Tribuna", "color": "#10B981",
        "description": "Filas posteriores", "default_price_cents": 1500,
    }
    loc_general = {
        "id": str(uuid.uuid4()), "name": "General", "color": "#6B7280",
        "description": "Gradería", "default_price_cents": 1000,
    }
    elements = [
        {
            "id": str(uuid.uuid4()), "kind": "stage",
            "x": 280, "y": 60, "rotation": 0, "label": "Escenario",
            "locality_id": None, "z_index": 0,
            "width": 640, "height": 80, "color": "#9CA3AF",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 320, "y": 200, "rotation": 0, "label": "Fila A",
            "locality_id": loc_platea["id"], "z_index": 1,
            "seats_count": 12, "seat_spacing": 28, "seat_radius": 11,
            "row_label": "A", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 300, "y": 260, "rotation": 0, "label": "Fila B",
            "locality_id": loc_platea["id"], "z_index": 1,
            "seats_count": 14, "seat_spacing": 28, "seat_radius": 11,
            "row_label": "B", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 280, "y": 320, "rotation": 0, "label": "Fila C",
            "locality_id": loc_tribuna["id"], "z_index": 1,
            "seats_count": 16, "seat_spacing": 28, "seat_radius": 11,
            "row_label": "C", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "unnumbered_zone",
            "x": 220, "y": 520, "rotation": 0, "label": "Gradería",
            "locality_id": loc_general["id"], "z_index": 1,
            "width": 760, "height": 140, "capacity": 80, "color": None,
        },
    ]
    capacity = sum(
        (e.get("seats_count") or 0) if e["kind"] == "seat_row_straight" else (e.get("capacity") or 0)
        for e in elements
    )
    return [loc_platea, loc_tribuna, loc_general], elements, capacity


def _build_template_auditorio():
    loc_general = {
        "id": str(uuid.uuid4()), "name": "General", "color": "#6366F1",
        "description": "Asientos numerados", "default_price_cents": 1500,
    }
    loc_vip = {
        "id": str(uuid.uuid4()), "name": "VIP", "color": "#F59E0B",
        "description": "Primera fila premium", "default_price_cents": 4500,
    }
    elements = [
        {
            "id": str(uuid.uuid4()), "kind": "stage",
            "x": 200, "y": 40, "rotation": 0, "label": "Escenario",
            "locality_id": None, "z_index": 0,
            "width": 600, "height": 70, "color": "#9CA3AF",
        },
        *[
            {
                "id": str(uuid.uuid4()), "kind": "seat_individual",
                "x": 220 + i * 55, "y": 130, "rotation": 0,
                "label": f"VIP-{i + 1}",
                "locality_id": loc_vip["id"], "z_index": 2,
                "seat_radius": 12,
            }
            for i in range(8)
        ],
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 180, "y": 220, "rotation": 0, "label": "Fila A",
            "locality_id": loc_general["id"], "z_index": 1,
            "seats_count": 14, "seat_spacing": 26, "seat_radius": 10,
            "row_label": "A", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 180, "y": 280, "rotation": 0, "label": "Fila B",
            "locality_id": loc_general["id"], "z_index": 1,
            "seats_count": 14, "seat_spacing": 26, "seat_radius": 10,
            "row_label": "B", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_straight",
            "x": 180, "y": 340, "rotation": 0, "label": "Fila C",
            "locality_id": loc_general["id"], "z_index": 1,
            "seats_count": 14, "seat_spacing": 26, "seat_radius": 10,
            "row_label": "C", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
        {
            "id": str(uuid.uuid4()), "kind": "seat_row_curved",
            "x": 500, "y": 460, "rotation": 0, "label": "Fila D (curva)",
            "locality_id": loc_general["id"], "z_index": 1,
            "seats_count": 12, "seat_spacing": 24, "seat_radius": 10,
            "curve_radius": 200, "curve_arc_degrees": 70,
            "row_label": "D", "numbering_start": 1,
            "numbering_direction": "ltr", "numbering_style": "numeric",
        },
    ]
    capacity = 0
    for e in elements:
        k = e["kind"]
        if k in ("seat_row_straight", "seat_row_curved"):
            capacity += e.get("seats_count", 0)
        elif k == "seat_individual":
            capacity += 1
    return [loc_general, loc_vip], elements, capacity


async def _seed_demo_numbered_event() -> None:
    """
    Phase 7 — Creates "Función Especial — Demo Numerado" linked to Teatro Demo,
    with pricing per locality + a couple of pre-sold seats + a held seat so the
    public seat-picker shows all 3 visual states out of the box.
    Idempotent: matches by slug.
    """
    organizer = await get_organizer_by_slug("demo-org")
    if not organizer:
        return
    async with AsyncSessionLocal() as pg:
        from orm_models import Venue as _Venue
        venue_result = await pg.execute(
            select(_Venue).where(
                _Venue.organizer_id == organizer["id"],
                _Venue.slug == "teatro-demo",
            )
        )
        _venue_row = venue_result.scalar_one_or_none()
    if not _venue_row:
        return
    from db_helpers import row_to_dict as _rtd
    venue = _rtd(_venue_row)

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

    from sqlalchemy.orm.attributes import flag_modified as _flag_modified

    now = datetime.now(timezone.utc)
    slug = "funcion-especial-demo-numerado"
    _pm_num = {
        "stripe": {"enabled": True},
        "transfer": {
            "enabled": True, "bank_name": "Banco Pichincha",
            "account_number": "2100123456",
            "account_holder": "Eventos Demo S.A.",
            "instructions": "Envianos el comprobante al WhatsApp +593 98 765 4321.",
        },
        "cash": {"enabled": False, "location": "", "schedule": "", "contact": ""},
    }
    _disc_num = {
        "disability_law": {"enabled": False, "percent": 50},
        "presale": {"enabled": False, "percent": 0, "ends_at": None},
    }
    _ap_num = {
        "visibility": "public", "access_type": "open",
        "max_per_purchase": 10, "max_per_email": None,
        "refund_window_hours": 24, "show_buyer_name_on_ticket": True,
    }

    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(
                Event.organizer_id == organizer["id"],
                Event.slug == slug,
            )
        )
        if row:
            event_id = row.id
            row.title = "Función Especial — Demo Numerado"
            row.description = (
                "Función con asientos numerados. Elegí tus butacas directamente sobre "
                "el mapa del Teatro Demo. Tres localidades disponibles: Platea, Tribuna y Gradería General."
            )
            row.short_description = "Función con asientos numerados — mapa interactivo."
            row.category = "entertainment"
            row.venue_name = "Teatro Demo"
            row.venue_address = "Pasaje Royal 175 y Junín"
            row.venue_city = "Quito"
            row.venue_country = "Ecuador"
            row.starts_at = (now + timedelta(days=20)).replace(hour=20, minute=0)
            row.ends_at = (now + timedelta(days=20)).replace(hour=22, minute=30)
            row.timezone = "America/Guayaquil"
            row.pricing_type = "paid"
            row.base_price_cents = 1000
            row.currency = "USD"
            row.capacity = venue.get("capacity_calculated") or 0
            row.visibility = "public"
            row.status = "published"
            row.poster_url = "https://images.unsplash.com/photo-1503095396549-807759245b35?w=800"
            row.venue_id = venue["id"]
            row.venue_slug = venue["slug"]
            row.locality_pricing = pricing
            row.seat_holds_window_minutes = 10
            row.payment_methods = _pm_num
            row.discounts = _disc_num
            row.access_params = _ap_num
            row.updated_at = now
            row.published_at = now
            _flag_modified(row, "locality_pricing")
            _flag_modified(row, "payment_methods")
            _flag_modified(row, "discounts")
            _flag_modified(row, "access_params")
        else:
            event_id = str(uuid.uuid4())
            session.add(Event(
                id=event_id,
                organizer_id=organizer["id"],
                tenant_slug="demo-org",
                slug=slug,
                title="Función Especial — Demo Numerado",
                description=(
                    "Función con asientos numerados. Elegí tus butacas directamente sobre "
                    "el mapa del Teatro Demo. Tres localidades disponibles: Platea, Tribuna y Gradería General."
                ),
                short_description="Función con asientos numerados — mapa interactivo.",
                category="entertainment",
                venue_name="Teatro Demo",
                venue_address="Pasaje Royal 175 y Junín",
                venue_city="Quito",
                venue_country="Ecuador",
                starts_at=(now + timedelta(days=20)).replace(hour=20, minute=0),
                ends_at=(now + timedelta(days=20)).replace(hour=22, minute=30),
                timezone="America/Guayaquil",
                sales_start=None,
                sales_end=None,
                pricing_type="paid",
                base_price_cents=1000,
                currency="USD",
                capacity=venue.get("capacity_calculated") or 0,
                visibility="public",
                status="published",
                tickets_sold=0,
                poster_url="https://images.unsplash.com/photo-1503095396549-807759245b35?w=800",
                banner_url=None,
                gallery_urls=[],
                venue_id=venue["id"],
                venue_slug=venue["slug"],
                locality_pricing=pricing,
                seat_holds_window_minutes=10,
                payment_methods=_pm_num,
                discounts=_disc_num,
                access_params=_ap_num,
                created_at=now,
                updated_at=now,
                published_at=now,
            ))
        await session.commit()
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
    async with AsyncSessionLocal() as _pg_clear:
        await _pg_clear.execute(
            delete(EventSeatAssignment).where(EventSeatAssignment.event_id == event_id)
        )
        await _pg_clear.execute(
            delete(SeatHold).where(SeatHold.event_id == event_id)
        )
        await _pg_clear.commit()

    pre_sold_seats = []
    if fila_a:
        pre_sold_seats.append((fila_a["id"], 0, "A-1", fila_a.get("locality_id")))
        pre_sold_seats.append((fila_a["id"], 1, "A-2", fila_a.get("locality_id")))
    if fila_c:
        pre_sold_seats.append((fila_c["id"], 4, "C-5", fila_c.get("locality_id")))

    sold_qty = 0
    if pre_sold_seats:
        async with AsyncSessionLocal() as _pg_assign:
            for el_id, idx, label, loc_id in pre_sold_seats:
                sid = f"{el_id}::s::{idx}"
                _pg_assign.add(EventSeatAssignment(
                    id=str(uuid.uuid4()),
                    event_id=event_id,
                    venue_id=venue["id"],
                    seat_id=sid,
                    ticket_id=str(uuid.uuid4()),
                    order_id=DEMO_SEAT_PREVIEW_ORDER_ID,
                    holder_email="demo-buyer@example.com",
                    locality_id=loc_id,
                    assigned_at=now,
                ))
                sold_qty += 1
            await _pg_assign.execute(
                sa_update(Event).where(Event.id == event_id).values(tickets_sold=sold_qty)
            )
            await _pg_assign.commit()

    # Pre-held: one seat held for 1 hour (visible to public as "held" by another)
    if fila_a:
        sid_held = f"{fila_a['id']}::s::2"
        async with AsyncSessionLocal() as _pg_hold:
            _pg_hold.add(SeatHold(
                id=str(uuid.uuid4()),
                event_id=event_id,
                venue_id=venue["id"],
                seat_id=sid_held,
                session_token="seed-held-session-fixed",
                status="held",
                held_at=now,
                expires_at=now + timedelta(hours=1),
                order_id=None,
            ))
            await _pg_hold.commit()


async def _backfill_discount_rule_ids() -> None:
    """One-shot migration: any event.discounts.rules[*] persisted without an `id`
    gets a fresh UUID. Idempotent — only events that need patching get a write."""
    from sqlalchemy.orm.attributes import flag_modified as _flag_modified
    from sqlalchemy import text

    async with AsyncSessionLocal() as session:
        # Only load events that have at least one discount rule
        result = await session.execute(
            select(Event).where(
                text("jsonb_array_length(COALESCE(events.discounts->'rules', '[]'::jsonb)) > 0")
            )
        )
        rows = result.scalars().all()
        fixed = 0
        for row in rows:
            discounts = row.discounts or {}
            rules = discounts.get("rules") or []
            if not any(r.get("id") in (None, "") for r in rules):
                continue
            for r in rules:
                if not r.get("id"):
                    r["id"] = str(uuid.uuid4())
            row.discounts = discounts
            _flag_modified(row, "discounts")
            fixed += 1
        if fixed:
            await session.commit()
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
    await _seed_venue_templates()
    await _seed_demo_numbered_event()
    await _backfill_discount_rule_ids()
