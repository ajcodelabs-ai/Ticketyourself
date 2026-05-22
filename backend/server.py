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

from db import close_db_client  # noqa: E402
from seeds import run_seeds  # noqa: E402
from routers import admin as admin_router  # noqa: E402
from routers import auth as auth_router  # noqa: E402
from routers import billing as billing_router  # noqa: E402
from routers import organizers as organizers_router  # noqa: E402
from routers import plans as plans_router  # noqa: E402
from routers import poc as poc_router  # noqa: E402
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
app.include_router(poc_router.router)


# CORS — explicit origin (credentials required for cookies)
frontend_url = os.environ.get("FRONTEND_URL", "")
allowed = [o for o in (frontend_url, "http://localhost:3000") if o]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed or ["*"],
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
    await close_db_client()
