# Ticket Yourself (TYS) — PRD

## Resumen del proyecto
Plataforma SaaS web de ticketing multi-tenant. Stack: FastAPI + React + MongoDB. UI español (Ecuador), USD. Multi-tenancy por subdominio en prod (`<slug>.ticketyourself.com`); fallback `?tenant=<slug>` en preview.

## Roadmap

- **Fase 0 — POC integraciones riesgosas** ✅ COMPLETA (Feb 2026) — Stripe Checkout + multitenancy resolver. *Asterisco: con `sk_test_emergent` el webhook real no llega; mitigado en Fase 1 con simulador.*
- **Fase 1 — Landing pública + auth + organizers + super-admin + Stripe subscription real** ⏳ EN PROGRESO (Feb 2026)
- **Fase 2 — Microsite editor + branding por tenant**
- **Fase 3 — Eventos + tipos de ticket + tickets numerados**
- **Fase 4 — Compra pública + emisión QR + reportes**
- Fases 5-10 — Control de acceso en puerta, multi-moneda, custom domains, IA design, integraciones externas, mobile.

## Personas
- **Visitante**: llega a la landing, se interesa, se registra.
- **Organizador**: registra, sube docs, paga plan, gestiona su microsite/eventos (Fase 2+).
- **Super-admin** (`admin@ticketyourself.com`): aprueba/rechaza/suspende organizadores, gestiona planes.
- **Comprador final**: aparece en Fase 3 (compra invitado).

## Arquitectura Fase 1 — implementado

### Backend (`/app/backend/`)
Modular:
- `server.py` orquesta app, routers, lifespan, CORS.
- `db.py`, `models.py`, `security.py` (bcrypt + pyjwt HS256), `slugs.py`, `stripe_service.py` (raw SDK con `api_base=https://integrations.emergentagent.com/stripe`), `seeds.py`, `audit.py`.
- `poc_models.py` agrupa los modelos legacy del POC.
- `routers/`: `auth.py`, `tenants.py`, `plans.py`, `organizers.py`, `billing.py`, `stripe_webhook.py`, `admin.py`, `poc.py`.
- Uploads en `/app/backend/uploads/{organizer_id}/{uuid}_{filename}` (PDF/JPG/PNG, máx 10MB).

### Endpoints destacados
- **Auth**: `POST /api/auth/{register,login,logout,refresh,check-slug}` · `GET /api/auth/me`. JWT en httpOnly cookies (`tys_access` 30 min, `tys_refresh` 7 días) + soporte `Authorization: Bearer`.
- **Planes**: `GET /api/plans` (público), `/api/admin/plans` CRUD (super_admin).
- **Organizers**: `/api/organizers/me*` (organizer), `/api/organizers/{id}/documents*` (admin descarga/lista).
- **Billing**: `POST /api/billing/checkout-session` (subscription/payment), `/api/billing/portal-session`.
- **Stripe**: `POST /api/stripe/webhook` (firma real, requiere `STRIPE_WEBHOOK_SECRET`) y `POST /api/stripe/_simulate_webhook` (sólo si `ENV=development`).
- **Admin organizers**: list/get/approve/reject/suspend/comment + `/api/admin/dashboard/stats`. Todo registrado en `audit_log`.

### Modelos Mongo
`users`, `organizers`, `organizer_documents`, `tenants`, `subscription_plans`, `audit_log`, `billing_intents`, `poc_payments`. IDs como UUID strings, `_id` siempre excluido.

### Frontend (`/app/frontend/src/`)
- `contexts/AuthContext.jsx` (login/logout/refresh, escucha 401 globales).
- `lib/api.js` axios con `withCredentials: true` + interceptor 401.
- `components/{PublicLayout, OrganizerLayout, AdminLayout, ProtectedRoute}.jsx`.
- Pages organizer: `Landing, Login, Register, Onboarding, Dashboard, BillingSuccess, BillingCancel, Settings`.
- Pages admin: `AdminDashboard, AdminOrganizers, AdminOrganizerDetail, AdminPlans`.
- POC sigue accesible en `/poc/*`.

### Seed idempotente (al boot)
1. Super-admin `admin@ticketyourself.com / Admin123!`
2. 4 planes: `evento_unico` $50 one_time, `basico` $20/mes, `profesional` $50/mes, `enterprise` $200/mes.
3. 3 organizadores demo:
   - `demo-org` aprobado, plan `profesional`, suscripción activa.
   - `prueba-eventos` pending, 1 doc subido, sin plan.
   - `evento-rechazado` rechazado con motivo "Documento RUC ilegible".
   Todos con password `Organizer123!`.

### Trade-offs / decisiones
1. **Stripe SDK crudo** apunta a `integrations.emergentagent.com/stripe` (Emergent wrapper). Con `sk_test_emergent` los webhooks reales no llegan a `/api/stripe/webhook`; el simulador `POST /api/stripe/_simulate_webhook` cubre el flujo de testing. La página `/billing/success` lo invoca automáticamente.
2. **JWT en httpOnly cookies + Bearer fallback**: cookies para web (más seguras vs. XSS), Bearer para curl/testing.
3. **Slug auto-generado + editable**: validación on-the-fly contra `/auth/check-slug`. Inmutable post-registro.
4. **Suspended login OK pero dashboard bloqueado** — UX prevalece sobre cierre abrupto.
5. **`/billing/success` auto-redirige a `/dashboard` en 5s** (con botón "Ir ahora" para impacientes).

## Backlog

### P0 — Fase 2 (próxima)
- Editor del microsite del organizer (branding, descripción, hero).
- Sub-dominio activo en producción (DNS wildcard + cert).
- Customer Portal de Stripe testeable end-to-end con llaves propias.

### P1 — Fase 3
- Modelo `events` (con `ticket_types`, capacidad, precios server-side).
- Compra pública del ticket (sin auth, email + nombre).
- Emisión PDF + QR del ticket.

### P2
- Reportes de ventas por evento/tenant.
- Multi-moneda + payouts.
- IA design (Enterprise feature) + custom domains.

## Credenciales y test
Ver `/app/memory/test_credentials.md` y `/app/memory/auth_testing.md`.
