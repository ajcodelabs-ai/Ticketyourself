"""
Ticket Yourself (TYS) — Backend
Fase 1: landing pública + auth + organizer onboarding + super-admin panel.
"""
from dotenv import load_dotenv
from pathlib import Path

# IMPORTANT: load env BEFORE importing anything that reads env at module scope.
load_dotenv(Path(__file__).parent / ".env")

import logging  # noqa: E402
import os  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from database import close_db  # noqa: E402
from seeds import run_seeds  # noqa: E402
from routers import activation as activation_router  # noqa: E402
from routers import admin as admin_router  # noqa: E402
from routers import auth as auth_router  # noqa: E402
from routers import billing as billing_router  # noqa: E402
from routers import dev as dev_router  # noqa: E402
from routers import microsite as microsite_router  # noqa: E402
from routers import organizers as organizers_router  # noqa: E402
from routers import plans as plans_router  # noqa: E402
from routers import stripe_webhook as stripe_webhook_router  # noqa: E402
from routers import tenants as tenants_router  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("tys")


app = FastAPI(
    title="Ticket Yourself API",
    version="1.0.0",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)


# Routers
@app.get("/api/health")
async def health():
    return {"status": "ok"}


app.include_router(tenants_router.router)
app.include_router(auth_router.router)
app.include_router(plans_router.router)
app.include_router(plans_router.admin_router)
app.include_router(organizers_router.router)
app.include_router(organizers_router.admin_router)
app.include_router(billing_router.router)
app.include_router(stripe_webhook_router.router)
app.include_router(admin_router.router)
app.include_router(microsite_router.router)
app.include_router(microsite_router.public_router)
app.include_router(microsite_router.asset_router)
app.include_router(activation_router.router)
app.include_router(activation_router.admin_router)
app.include_router(dev_router.router)
from routers import events as events_router  # noqa: E402
from routers import functions as functions_router  # noqa: E402
from routers import orders as orders_router  # noqa: E402
from routers import tickets as tickets_router  # noqa: E402
from routers import dashboard as dashboard_router  # noqa: E402
from routers import admin_dashboard as admin_dashboard_router  # noqa: E402
from routers import admin_exports as admin_exports_router  # noqa: E402
from routers import venues as venues_router  # noqa: E402
from routers import admin_venue_templates as admin_venue_templates_router  # noqa: E402

app.include_router(events_router.router)
# functions_router.public_router must be registered BEFORE events_router's
# public_router: routes are matched in registration order, and events.py's
# `/{tenant_slug}/{event_slug}` (2 dynamic segments) would otherwise shadow
# these literal-suffixed 2-segment paths (`/{event_id}/functions`,
# `/{event_id}/ticket-types`), making them always 404.
app.include_router(functions_router.public_router)
app.include_router(events_router.public_router)
app.include_router(events_router.admin_router)
app.include_router(events_router.asset_router)
app.include_router(orders_router.router)
app.include_router(tickets_router.router)
app.include_router(dashboard_router.router)
app.include_router(admin_dashboard_router.router)
app.include_router(admin_exports_router.router)
app.include_router(venues_router.router)
app.include_router(venues_router.public_router)
app.include_router(admin_venue_templates_router.router)
from routers import staff as staff_router  # noqa: E402
from routers import guest_lists as guest_lists_router  # noqa: E402
app.include_router(staff_router.auth_router)
app.include_router(staff_router.router)
app.include_router(functions_router.router)
app.include_router(guest_lists_router.router)
app.include_router(guest_lists_router.public_router)


# CORS — must NOT use "*" with allow_credentials=True per browser spec.
# We accept any *.preview.emergentagent.com host (current + future previews)
# plus localhost:3000 (dev). Specific FRONTEND_URL is also added as a literal allow.
frontend_url = os.environ.get("FRONTEND_URL", "")
explicit_allowed = [o for o in (frontend_url, "http://localhost:3000") if o]
app.add_middleware(
    CORSMiddleware,
    allow_origins=explicit_allowed,
    allow_origin_regex=r"^https://[a-zA-Z0-9-]+\.preview\.emergentagent\.com$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await run_seeds()
    logger.info("TYS backend started")


@app.on_event("shutdown")
async def on_shutdown():
    await close_db()
