# Ticket Yourself (TYS) — PRD

## Resumen del proyecto

Plataforma SaaS web de ticketing multi-tenant. Cada organizador (tenant) tiene su microsite y puede vender entradas para sus eventos. Stack: **FastAPI + React + MongoDB**. UI en español (Ecuador), USD.

Multi-tenancy en producción será por subdominio (`<slug>.ticketyourself.com`). En preview Emergent — sin DNS wildcard — se usa fallback `?tenant=<slug>` en la URL.

## Roadmap (alto nivel)

- **Fase 0 — POC integraciones riesgosas** ⏳ EN PROGRESO
  - Stripe Checkout end-to-end (sesión + retorno + webhook + polling)
  - Resolución de tenant (subdominio en prod, `?tenant=` en preview)
- **Fase 1 — Auth + Organizers + Microsite básico**
- **Fase 2 — Eventos + Tickets**
- **Fase 3 — Compras públicas + emisión de tickets**
- Fases 4-10 — Reportería, suscripciones recurrentes reales, branding por tenant, etc.

## User personas (Fase 0)

- **Desarrollador / fundador (vos)**: necesita validar que Stripe y la multitenancy funcionan antes de seguir.
- *(En Fase 1+ aparecen "Organizador" y "Comprador final".)*

## Fase 0 — Alcance implementado (Feb 2026)

### Backend (`/app/backend/server.py`)
- `GET  /api/health` — healthcheck.
- `GET  /api/tenants/resolve` — resuelve por Host header (subdominio) o por `?tenant=<slug>`. Devuelve `{tenant: null}` si no hay match (HTTP 200).
- `POST /api/poc/stripe/create-subscription-session` — crea sesión Stripe para plan `basic` ($20) o `pro` ($50). **POC**: pago único, NO subscription real. Real subscription queda para Fase 1+.
- `POST /api/poc/stripe/create-ticket-session` — crea sesión Stripe para un ticket de monto variable.
- `POST /api/stripe/webhook` — verifica firma y marca `poc_payments` → `paid` (idempotente).
- `GET  /api/poc/stripe/status/{session_id}` — polling de respaldo (Emergent's `sk_test_emergent` puede no entregar webhooks). Actualiza DB igualmente.
- `GET  /api/poc/payments?tenant_slug=...` — lista pagos POC del tenant.
- Seed idempotente al arrancar: `demo-org`, `prueba-eventos`.
- Índices: `tenants.slug` unique, `poc_payments.stripe_session_id` unique.

### Frontend (`/app/frontend/src`)
- `/` Landing con CTAs a subscribe / ticket.
- `/poc/subscribe` Selector plan Básico/Pro → redirección a Stripe.
- `/poc/ticket` Form evento + monto → redirección a Stripe.
- `/poc/success` Polling cada 2s (10 intentos) sobre `status/{session_id}`.
- `/poc/cancel` Retorno de cancelación.
- `/poc/payments` Tabla de pagos del tenant con estado en vivo.
- `TenantContext` con persistencia en `localStorage` y sync con `?tenant=`.
- shadcn/ui + Tailwind, fuente Inter, paleta índigo `--primary: 245 70% 55%`.

### Modelos Mongo
- `tenants { _id, id, slug (unique), name, status, created_at }`
- `poc_payments { _id, id, tenant_slug, stripe_session_id (unique), type ('subscription'|'ticket'), status ('pending'|'paid'|'failed'), amount_cents, currency, description, plan_name?, event_name?, created_at, paid_at? }`

### Decisiones / trade-offs

1. **Subscription = one-time payment en Fase 0**. `emergentintegrations.checkout` no expone `mode='subscription'`. Validamos el flujo con un cargo único equivalente al primer mes; el SetupIntent / Subscription real va en Fase 1+ cuando creemos Stripe Products.
2. **Polling complementa el webhook**. Con `STRIPE_API_KEY=sk_test_emergent` los webhooks pueden no llegar al endpoint custom (el playbook de Emergent lo advierte). El frontend hace polling vía `/api/poc/stripe/status/{session_id}` que también actualiza el DB. Ambos caminos son idempotentes.
3. **`amount_cents` en ticket llega del frontend**: aceptable en Fase 0 porque no hay eventos persistidos todavía. En Fase 2 los precios vivirán en `events`/`ticket_types` server-side.
4. **Sin auth en Fase 0**. Se agrega en Fase 1.

## Backlog priorizado

### P0 (próxima fase, Fase 1)
- Auth: JWT-based custom auth (organizer login). Llamar `integration_playbook_expert_v2` antes de codear.
- Modelo `Organizer` (1:1 con Tenant) + onboarding.
- Subscription Stripe **real** (mode=subscription, Products+Prices, Customer Portal).
- Microsite público del tenant en `/o/{slug}` o subdominio.

### P1
- Eventos y tipos de ticket (con precios server-side).
- Compras públicas (sin auth de comprador, solo email).
- Emisión de tickets con QR.

### P2
- Reportería por evento / tenant.
- Branding por tenant (logo, colores).
- Multi-moneda real, payouts.

## Test credentials

Ver `/app/memory/test_credentials.md` (tenants seed, tarjeta test Stripe, URLs de prueba).

## Auth status

Ver `/app/memory/auth_testing.md` — **no hay auth en Fase 0**.
