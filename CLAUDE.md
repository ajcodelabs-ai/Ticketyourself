# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Ticket Yourself (TYS)** — Multi-tenant SaaS ticketing platform. FastAPI + React + PostgreSQL. UI is in Spanish (Ecuador), currency is USD.

Multi-tenancy resolves via subdomain (`<slug>.ajcodelabs.ai` in prod), `?tenant=<slug>` query param, or `/o/<slug>` route prefix. Default tenant in preview/local: `demo-org`.

Full architecture detail: [docs/CLAUDE.md](docs/CLAUDE.md).

## Commands

### Docker (recommended)

```bash
make up          # start PostgreSQL + backend + frontend with hot-reload
make down        # stop
make clean       # stop + delete volumes (full DB reset)
make logs        # follow all logs
make migrate     # run Alembic migrations in backend container
make shell-db    # psql into PostgreSQL
make test-backend   # pytest in container (requires make up)
make test-frontend  # vitest in container
```

### Backend (without Docker)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp backend/.env.example.local backend/.env
alembic upgrade head
uvicorn server:app --reload --port 8000
```

Run tests (requires running backend + PostgreSQL):
```bash
REACT_APP_BACKEND_URL=http://localhost:8000 pytest tests/ -v
pytest tests/test_phase4.py -v                                         # single file
pytest tests/test_phase5.py::TestEventWizard::test_create_event -v    # single test
```

### Frontend (without Docker)

```bash
cd frontend && yarn install
echo "VITE_BACKEND_URL=http://localhost:8000" > .env
yarn start      # dev server on port 3000
yarn test       # Vitest (run once)
yarn test:watch
```

### Mobile (optional)

```bash
cd mobile && yarn install
echo "EXPO_PUBLIC_BACKEND_URL=http://localhost:8000" > .env
yarn start      # Expo DevTools; press i/a/w for iOS/Android/web
```

### Stripe webhooks (local)

```bash
stripe listen --forward-to http://localhost:8000/api/stripe/webhook
```

## Backend Architecture

**Entry point:** `backend/server.py` — loads `.env`, wires all routers.

**Key modules:**
- `orm_models.py` — SQLAlchemy 2 async ORM for all tables; JSONB for complex nested fields; IDs are `String(36)` UUIDs
- `database.py` — async engine + `AsyncSessionLocal` + `get_db` dependency
- `security.py` — JWT HS256 (PyJWT), bcrypt, `get_current_user` / `require_role` Depends guards
- `models.py` — all Pydantic v2 request/response models; use `ConfigDict(extra="ignore")` via `TimestampedModel`
- `db_helpers.py` — `row_to_dict(orm_row)` converts ORM rows to plain dicts before Pydantic parsing
- `seeds.py` — idempotent seed on startup (super-admin, demo organizers, plans)
- `audit.py` — `log_audit()` writing to `audit_log` table; used by admin actions

**Router pattern:** files in `routers/` expose multiple `APIRouter` instances with distinct prefixes:
- Organizer: `/api/<resource>/me`
- Public: `/api/public/<resource>`
- Admin: `/api/admin/<resource>`

Inject DB session with `session: AsyncSession = Depends(get_db)`. Call `row_to_dict(row)` before passing to Pydantic.

**Services layer** (`services/`): business logic extracted from routers:
- `order_service.py` — capacity reservation, ticket emission, Stripe checkout, manual payments
- `email_service.py` — Resend transactional emails
- `pdf_service.py` — ReportLab ticket PDFs
- `ticket_jwt.py` — signed QR token issuance & validation
- `seats.py` — numbered seat reservation
- `plan_features.py` — per-plan feature flag checks (currently unenforced; single source of truth)

**Auth:** `POST /api/auth/login` returns `{user, organizer, access_token, refresh_token}` in body AND sets HttpOnly cookies. Frontend stores tokens in `localStorage` (`tys_access_token` / `tys_refresh_token`) as `Authorization: Bearer` — cookies can't be used cross-origin because the preview platform forces `Access-Control-Allow-Origin: *`.

**RBAC:** roles `super_admin` and `organizer`. Login is never blocked — blocked organizers see a dashboard with reason.

**Migrations:**
```bash
alembic revision --autogenerate -m "description"   # after changing orm_models.py
alembic upgrade head
```

## Frontend Architecture

**Bundler:** Vite 6. Alias `@` → `src/`. TypeScript (`strict: false`, `noImplicitAny: false` for gradual typing). Tests: Vitest + jsdom.

**Entry point:** `src/App.tsx` — wraps in `<AuthProvider>` → `<TenantProvider>` → `<BrowserRouter>` with three layout zones:
- Public routes → `PublicLayout`
- `/app/*` → `ProtectedRoute role="organizer"` + `OrganizerLayout`
- `/admin/*` → `ProtectedRoute role="super_admin"` + `AdminLayout`

**API client:** `src/lib/api.ts` — Axios with `VITE_BACKEND_URL` base, Bearer token interceptor, global 401 → `tys:unauthorized` custom event.

**Key contexts:**
- `AuthContext` — session management, `checkSession()` on mount
- `TenantContext` — slug resolution via query param, then localStorage, then `"demo-org"`

**UI stack:** shadcn/ui (Radix + Tailwind), Sonner toasts, Recharts dashboards.

**Notable components:**
- `src/components/venues/` — Konva canvas seating editor (stages, zones, rows, tables, seats)
- `src/components/events/EventWizard.tsx` — 7-step event creation wizard (Info → Location → Tickets → Venue → Media → Discounts → Review)

## Database

Order numbers use PostgreSQL sequence `ticket_order_seq`, formatted as `TYS-XXXXXX`. Schema managed entirely by Alembic — never edit the DB directly; always go through `orm_models.py` + a new migration.

## Environment Variables

**`backend/.env`** (copy from `backend/.env.example.local`):
```
DATABASE_URL=postgresql+asyncpg://tys:tys_dev@localhost:5432/tys_dev
JWT_SECRET=<secret>
ENV=development_local
STRIPE_API_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_API_BASE=https://api.stripe.com
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@ticketyourself.com
FRONTEND_URL=http://localhost:3000
TYS_FEE_PERCENT=5
```

**`frontend/.env`**: `VITE_BACKEND_URL=http://localhost:8000`

**`mobile/.env`**: `EXPO_PUBLIC_BACKEND_URL=http://localhost:8000` (use LAN IP for physical devices)

## Demo Credentials (seeded automatically)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | `admin@ticketyourself.com` | `Admin123!` |
| Organizer (approved) | `demo@ticketyourself.com` | `Organizer123!` |
| Organizer (pending) | `prueba@ticketyourself.com` | `Organizer123!` |
| Organizer (rejected) | `rechazado@ticketyourself.com` | `Organizer123!` |

## Key Patterns & Gotchas

- Venue editor is structurally locked once an event with sales exists (`lock_on_sales`).
- `routers/dev.py` — dev-only seed/reset endpoints; must not be exposed in production.
- `poc_models.py` / `routers/poc.py` — legacy Phase 0 POC; not part of active product.
- Static uploads served by FastAPI from `backend/event_assets/` and `backend/microsite_assets/`.
- `STRIPE_API_BASE` env var overrides the Stripe SDK base URL (used in Emergent preview proxy).
