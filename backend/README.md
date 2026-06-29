# TYS Backend

API REST construida con FastAPI + PostgreSQL (SQLAlchemy async + Alembic). Maneja autenticación, multi-tenancy, eventos, venues, órdenes, tickets QR y billing con Stripe.

## Requisitos

- Python 3.11+
- PostgreSQL 14+ corriendo localmente

## Instalación y arranque

```bash
# Desde la raíz del repo
cd backend

# Entorno virtual
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Dependencias
pip install -r requirements.txt

# Variables de entorno
cp .env.example.local backend/.env
# o desde la raíz:
make env-backend-local

# Crear esquema (primera vez o tras pull con nuevas migraciones)
alembic upgrade head

# Servidor de desarrollo con hot-reload
uvicorn server:app --reload --port 8000
```

El backend corre en `http://localhost:8000`.  
Al arrancar ejecuta seeds idempotentes: crea el super-admin, planes y organizadores de demo si no existen.

Con Docker Compose desde la raíz: `make up` (PostgreSQL + migraciones + backend).

## Variables de entorno (`backend/.env`)

```env
# Base de datos (PostgreSQL)
DATABASE_URL=postgresql+asyncpg://tys:tys_dev@localhost:5432/tys_dev

# JWT
JWT_SECRET=cambia-esto-en-produccion

# Entorno (controla flags de cookies: development_local | production)
ENV=development_local

# Stripe
STRIPE_API_KEY=sk_test_...
STRIPE_API_BASE=https://api.stripe.com
STRIPE_WEBHOOK_SECRET=whsec_...

# Plataforma
TYS_FEE_PERCENT=5          # porcentaje de comisión (default: 5)
FRONTEND_URL=http://localhost:3000

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@ticketyourself.com

# Super admin (opcional — defaults a admin@ticketyourself.com / Admin123!)
ADMIN_EMAIL=admin@ticketyourself.com
ADMIN_PASSWORD=Admin123!
```

## Migraciones (Alembic)

```bash
cd backend

# Aplicar todas las migraciones pendientes
alembic upgrade head

# Generar migración tras cambiar orm_models.py
alembic revision --autogenerate -m "descripcion del cambio"

# Ver historial
alembic history
```

Desde Docker: `make migrate` (requiere `make up`).

## Endpoints principales

| Prefijo | Descripción |
|---------|-------------|
| `GET /api/health` | Health check |
| `GET /api/docs` | Swagger UI interactivo |
| `/api/auth/*` | Registro, login, logout, refresh, me, check-slug |
| `/api/tenants/resolve` | Resolución de tenant por subdominio o query param |
| `/api/events/me/*` | CRUD de eventos del organizador autenticado |
| `/api/public/events/*` | Eventos públicos sin autenticación |
| `/api/venues/me/*` | Editor de venues del organizador |
| `/api/public/venues/*` | Preview público de venues |
| `/api/orders/*` | Creación de órdenes y flujo de pago |
| `/api/tickets/*` | Emisión y validación de tickets QR |
| `/api/admin/*` | Panel super-admin (requiere rol `super_admin`) |
| `/api/billing/*` | Suscripciones Stripe del organizador |

## Tests

Los tests son de integración — requieren un backend corriendo y PostgreSQL accesible.

```bash
# Correr todos los tests
REACT_APP_BACKEND_URL=http://localhost:8000 \
DATABASE_URL=postgresql+asyncpg://tys:tys_dev@localhost:5432/tys_dev \
pytest tests/ -v

# Correr un archivo específico
pytest tests/test_phase4.py -v

# Correr un test específico
pytest tests/test_phase5.py::TestEventWizard::test_create_event -v
```

## Autenticación

JWT HS256 (bcrypt para passwords). Los tokens se retornan en el **body** del login (`access_token` / `refresh_token`) y también se setean como cookies HttpOnly como fallback.

- **Access token:** válido 30 minutos
- **Refresh token:** válido 7 días
- **Uso en requests:** `Authorization: Bearer <access_token>`

Los guards de FastAPI se aplican con `Depends(get_current_user)` y `Depends(require_role("organizer"))` / `require_role("super_admin")`.

## Estructura de archivos

```
server.py          punto de entrada, registra todos los routers
database.py        engine SQLAlchemy async + get_db()
orm_models.py      modelos ORM (PostgreSQL)
alembic/           migraciones de esquema
security.py        JWT, bcrypt, cookies, Depends guards
models.py          modelos Pydantic (todos los dominios)
seeds.py           seed idempotente al arrancar
slugs.py           normalización y validación de slugs
audit.py           registro de auditoría para super-admin
stripe_service.py  helpers Stripe

routers/           un archivo por dominio (auth, events, orders, venues…)
services/          lógica de negocio extraída de los routers
  order_service.py     reserva de capacidad, emisión de tickets
  email_service.py     emails transaccionales (Resend)
  pdf_service.py       generación de PDFs de tickets (ReportLab)
  ticket_jwt.py        tokens QR firmados
  seats.py             reserva de asientos numerados
  plan_features.py     feature flags por plan

tests/             tests de integración por fase del roadmap
event_assets/      imágenes de eventos (servidas por FastAPI)
microsite_assets/  assets de microsites de organizadores
```

## Webhook Stripe

```bash
# Desarrollo local con Stripe CLI
stripe listen --forward-to http://localhost:8000/api/stripe/webhook
```

El endpoint `/api/stripe/webhook` verifica la firma y delega a `order_service.finalize_paid_order` para marcar órdenes pagadas y emitir tickets.
