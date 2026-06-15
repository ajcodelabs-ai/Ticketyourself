# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ticket Yourself (TYS)** — Multi-tenant SaaS ticketing platform. FastAPI + React + PostgreSQL. UI is in Spanish (Ecuador), currency is USD.

Multi-tenancy is resolved via subdomain (`<slug>.ajcodelabs.ai` in prod), `?tenant=<slug>` query param, or `/o/<slug>` route prefix.

Preview URL: `https://ticket-poc.preview.emergentagent.com`

## Repository Structure

```
backend/    FastAPI app (Python)
frontend/   React SPA (CRA + craco)
mobile/     Expo React Native app (QR scanner / door validation)
docs/       Project notes (PRD, STATUS, CLAUDE.md, auth_testing.md)
```

## Commands

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example.local backend/.env
alembic upgrade head
uvicorn server:app --reload --port 8000

# Docker (desde la raíz): make up | make migrate | make shell-db

# Tests — integration only; require a running backend + PostgreSQL
REACT_APP_BACKEND_URL=http://localhost:8000 pytest tests/ -v
pytest tests/test_phase4.py -v                                         # single file
pytest tests/test_phase5.py::TestEventWizard::test_create_event -v    # single test

# Stripe local webhook forwarding
stripe listen --forward-to http://localhost:8000/api/stripe/webhook
```

### Frontend
```bash
cd frontend
yarn install
yarn start      # dev server (port 3000) — alias for `yarn dev`
yarn build
yarn test       # Vitest (run once)
yarn test:watch # Vitest (watch mode)
```

### Mobile
```bash
cd mobile
yarn install
echo "EXPO_PUBLIC_BACKEND_URL=http://localhost:8000" > .env
yarn start      # Expo DevTools; press i/a/w for iOS/Android/web
yarn ios / yarn android
yarn lint
```

## Backend Architecture

**Entry point:** `server.py` — loads `.env` first, then wires all routers.

**Key modules:**
- `database.py` — SQLAlchemy 2 async engine + `AsyncSessionLocal` + `get_db` dependency; uses `DATABASE_URL`
- `orm_models.py` — SQLAlchemy ORM classes for all tables; JSONB for complex nested fields
- `alembic/` — schema migrations (`alembic upgrade head`)
- `db_helpers.py` — `row_to_dict(obj)` converts ORM rows to plain dicts for Pydantic parsing
- `security.py` — JWT (HS256, PyJWT), bcrypt, FastAPI `Depends` guards (`get_current_user`, `require_role`)
- `models.py` — all Pydantic v2 models; IDs are UUID strings
- `seeds.py` — idempotent seed on startup (super-admin, demo organizers, default plans)
- `slugs.py` — slug normalisation/validation helpers
- `audit.py` — `log_audit()` helper writing to `audit_log` table; used by admin actions
- `stripe_service.py` — Stripe SDK wrapper; `stripe.api_base` is overridden by `STRIPE_API_BASE` env var (Emergent proxy in preview)

**Router pattern:** each domain has a file in `routers/`. Multiple `APIRouter` instances per file (e.g., `router`, `public_router`, `admin_router`, `asset_router`) with distinct prefixes:
- Organizer routes: `/api/<resource>/me`
- Public routes: `/api/public/<resource>`
- Admin routes: `/api/admin/<resource>`

**Services layer** (`services/`): business logic extracted from routers:
- `order_service.py` — capacity reservation, ticket emission, Stripe checkout, manual payments
- `email_service.py` — Resend-based transactional emails
- `pdf_service.py` — ReportLab ticket PDF generation
- `ticket_jwt.py` — signed QR token issuance & validation
- `seats.py` — numbered seat reservation logic
- `plan_features.py` — per-plan feature flag checks

**Auth flow:** `POST /api/auth/login` returns `{user, organizer, access_token, refresh_token}` in the body AND sets HttpOnly cookies. Access tokens expire in 30 min, refresh tokens in 7 days. The web frontend stores tokens in `localStorage` (`tys_access_token` / `tys_refresh_token`) and sends them as `Authorization: Bearer <token>`. Reason: the Emergent preview platform's ingress rewrites CORS headers to `Access-Control-Allow-Origin: *`, which breaks `credentials: true` — so cookies can't be used cross-origin in preview. In local dev, the backend correctly sets specific allowed origins with `allow_credentials=True`. Cookies work for mobile/SSR/curl in all environments.

**RBAC:** Two roles — `super_admin` and `organizer`. Guards: `Depends(get_current_user)` for auth check, `Depends(require_role("super_admin"))` for role check.

## Frontend Architecture

**Bundler:** Vite 6 (`vite.config.ts`). Alias `@` → `src/`. Tests with Vitest (jsdom). All source files are TypeScript (`.ts`/`.tsx`) with a permissive `tsconfig.json` (`strict: false`, `noImplicitAny: false`) to allow gradual typing.

**Entry point:** `src/App.tsx` — wraps everything in `<AuthProvider>` → `<TenantProvider>` → `<BrowserRouter>` with three layout zones:
- `<Public>` — `PublicLayout`
- `<OrgArea>` — `ProtectedRoute role="organizer"` + `OrganizerLayout`
- `<AdminArea>` — `ProtectedRoute role="super_admin"` + `AdminLayout`

**API client:** `src/lib/api.ts` — Axios instance with `VITE_BACKEND_URL` base (`import.meta.env.VITE_BACKEND_URL`), Bearer token interceptor, global 401 → `tys:unauthorized` custom event.

**Key contexts:**
- `AuthContext` — user/organizer session, `checkSession()` on mount, listens for `tys:unauthorized`
- `TenantContext` — slug resolution: `?tenant=` param wins, then `localStorage`, then `"demo-org"` default

**UI stack:** shadcn/ui (Radix primitives + Tailwind), Sonner toasts, Recharts for dashboards.

**Venue editor** (`src/components/venues/`): Konva canvas-based seating editor. Supports stages, unnumbered zones, straight rows, curved rows, tables, individual seats. Components: `EditorCanvas`, `EditorToolbar`, `ElementShape`, `SeatPickerCanvas`, `PropertiesPanel`, `LocalitiesPanel`.

**Event wizard** (`src/components/events/EventWizard.tsx`): 7-step form for event creation (Info, Location, Tickets, Venue, Media, Discounts, Review).

## Mobile Architecture

Expo Router (file-based routing under `mobile/app/`). Currently minimal — primarily a QR scanner wrapper (`html5-qrcode`) for door validation, wrapping backend `/api/tickets/validate`.

## Database (PostgreSQL)

All application data lives in PostgreSQL. Schema is managed with Alembic.

```bash
cd backend && alembic upgrade head                    # apply migrations
alembic revision --autogenerate -m "description"    # new migration after orm_models.py changes
make migrate                                          # from repo root (Docker)
```

- `orm_models.py` — SQLAlchemy ORM for users, organizers, events, venues, orders, tickets, billing, audit, etc.
- IDs stored as `String(36)` to keep API contracts identical
- Order numbers: PostgreSQL sequence `ticket_order_seq`, formatted as `TYS-XXXXXX`
- **Router pattern:** inject `AsyncSession` via `session: AsyncSession = Depends(get_db)`; session auto-commits on success. Use `row_to_dict(orm_row)` before Pydantic parsing.

To reset demo data in Docker: `make clean && make up` (drops volumes and re-seeds).

## Demo Credentials (seeded automatically)

| Role | Email | Password | Status |
|------|-------|----------|--------|
| Super Admin | `admin@ticketyourself.com` | `Admin123!` | — |
| Organizer | `demo@ticketyourself.com` | `Organizer123!` | approved |
| Organizer | `prueba@ticketyourself.com` | `Organizer123!` | pending |
| Organizer | `rechazado@ticketyourself.com` | `Organizer123!` | rejected |

Super-admin credentials can be overridden with `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `backend/.env`. To reset demo data locally, drop and recreate the database (or `make clean && make up` with Docker).

## Environment Variables

Required in `backend/.env`:
```
DATABASE_URL=postgresql+asyncpg://tys:tys_dev@localhost:5432/tys_dev
JWT_SECRET=<secret>
ENV=development_local          # controls cookie samesite/secure flags; use "production" in prod
STRIPE_API_KEY=sk_test_...
STRIPE_API_BASE=https://api.stripe.com   # override for Emergent proxy in preview
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@ticketyourself.com
TYS_FEE_PERCENT=5             # platform fee (default 5%)
ADMIN_EMAIL=admin@ticketyourself.com     # optional; seeds super-admin
ADMIN_PASSWORD=Admin123!                 # optional
FRONTEND_URL=http://localhost:3000       # added to CORS allowed origins
```

Required in `frontend/.env`:
```
VITE_BACKEND_URL=http://localhost:8000
```

Required in `mobile/.env`:
```
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000   # use LAN IP for physical devices
```

## Key Patterns

- All Pydantic models use `ConfigDict(extra="ignore")` via `TimestampedModel`.
- Venue editor is locked for structural changes once an event with sales exists (`lock_on_sales`).
- `organizer.status` can be `pending|approved|rejected|suspended`. Login is never blocked — the frontend shows a blocked dashboard with the reason.
- Plan feature gating via `services/plan_features.py` — check plan code before exposing premium features. Enforcement is currently OFF; the file is the single source of truth for limits and feature flags.
- Static file uploads are served directly by FastAPI from `backend/event_assets/` and `backend/microsite_assets/`.
- `routers/dev.py` — development-only endpoints (seeding/reset helpers); should not be exposed in production.
- `poc_models.py` and `routers/poc.py` — legacy Phase 0 POC code; kept for reference but not part of the active product.
- Order numbers use the PostgreSQL `ticket_order_seq` sequence, formatted as `TYS-XXXXXX`.
- **PG router pattern:** inject `AsyncSession` via `session: AsyncSession = Depends(get_db)`; the session auto-commits on success and rolls back on exception. Use `row_to_dict(orm_row)` to convert to dict before passing to Pydantic.

## Roadmap Status

15 of 17 phases complete. Pending: **Phase 8** (multi ticket types, multi-function events, advanced promo codes) and **Phase 10** (historical MRR/churn/cohort snapshots). All other features including numbered seating, Stripe checkout, manual payments, QR validation, and super-admin panel are fully implemented.
