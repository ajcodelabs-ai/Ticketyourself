# Ticket Yourself (TYS) — PRD

## Resumen
Plataforma SaaS web de ticketing multi-tenant. Stack: FastAPI + React + MongoDB. UI español (Ecuador), USD. Multi-tenancy `<slug>.ajcodelabs.ai` (prod) / `?tenant=<slug>` / `/o/<slug>` (preview).

URL preview: `https://ticket-poc.preview.emergentagent.com`

## Roadmap

- **Fase 0** — POC integraciones ✅
- **Fase 1** — Landing + auth + organizers + admin + Stripe subscription ✅
- **Fase 2** — Microsite editor + activation funnel + welcome email ✅
- **Fase 3a** — Eventos básicos + demo shortcut ✅
- **Fase 4** — Compra Stripe + JWT QR + PDFs + dashboard ventas ✅
- **Fase 5** — Reestructura panel: sidebar 5 items + EventWizard 7 secciones + dashboard agregado + plan features + galería + Fixes A/B ✅
- **Fase 5b** — **Pago manual end-to-end (transferencia + efectivo)** ✅ (Feb 2026)
- **Fase 6** (P0) — Venue editor drag-and-drop + asientos numerados
- **Fase 3b** (P1) — Multi ticket types, multi-función, promo codes, descuentos avanzados
- **Fase 7** (P2) — Super-admin enriquecido (GMV, MRR, churn, eventos cross-tenant)

## Personas
- Visitante → registro
- Organizador → dashboard / microsite / eventos / ventas
- Super-admin → aprobaciones, planes, funnel
- Comprador final → microsite → evento → modal compra → ticket por email (o instrucciones de pago si manual)

## Fase 5b — Implementación (cerrada)

### Modelo
`ticket_orders` extendido:
- `status` admite nuevo valor `pending_manual_payment` (entre `pending` y `paid`)
- `payment_method`: `"stripe" | "transfer" | "cash"` (default `stripe`)
- `manual_payment_info`: `{method, reference, paid_at, confirmed_by, confirmed_at, organizer_notes}` — null para Stripe
- Reservas: TTL 15min para Stripe / **48h para manuales**

### Backend

**Públicos (sin auth)**
- `POST /api/public/orders` body `{..., payment_method}`:
  - `stripe` → Stripe Checkout Session (igual que antes)
  - `transfer`/`cash` → status `pending_manual_payment`, reserva 48h, devuelve `{order, payment_instructions, redirect_to}`. Valida que el método esté activo en el evento (400 si no).
- `GET /api/public/orders/{order_number}/instructions` — devuelve `{order, event, organizer, payment_method, payment_instructions, branding}`. Public, sin auth.

**Organizer (auth Bearer)**
- `POST /api/events/me/{event_id}/orders/{order_id}/confirm-payment` body `{notes?, reference?}` — RBAC, idempotente, emite tickets + email + audit log
- `POST /api/events/me/{event_id}/orders/{order_id}/reject-payment` body `{reason}` — RBAC, cancela orden + libera reserva + email + audit log

**Email service**
- `send_manual_payment_instructions` — al crear orden manual (deadline 48h + datos bancarios o ubicación)
- `send_manual_payment_rejected` — al rechazar (con razón visible para buyer)
- `send_purchase_confirmation` — reutilizada al confirmar manual (mismo email que paid Stripe)

### Frontend
- **`components/orders/PurchaseModal.jsx`** — selector radio de método (visible si ≥2 activos). Si Stripe → checkout. Si manual → redirect a `/o/:slug/orden/:order_number/instrucciones`.
- **`pages/orders/PaymentInstructions.jsx`** (nuevo) — datos bancarios o ubicación, deadline countdown, polling cada 10s (auto-redirige a éxito si el organizer confirma).
- **`components/events/EventSalesTabs.jsx`** — banner naranja con contador de pendientes, filtros por `payment_method` y `status`, badge "Esperando pago manual", `ManualPaymentDialog` con confirmar (con reference/notes) y rechazar (con reason).
- **`pages/events/EventPublic.jsx`** — chips informativos de métodos aceptados (`event-payment-chip-{m}`).
- **`App.js`** — ruta nueva `/o/:slug/orden/:order_number/instrucciones`.

### Fixes Fase 5 (incluidos)
- **Fix A**: galería responsive 4 col desktop / 2-3 mobile con lightbox modal (← →) en `EventPublic`, métodos de pago aceptados bloque previo al CTA.
- **Fix B**: `EventWizard` galería con `multiple={true}` en input + `uploadImages()` handler que itera files, respeta el límite de 10 (subida + advertencia si excede), agrupa el toast final.

### Seeds
- `concierto-acustico-demo` con **transfer + cash habilitados** (Banco Pichincha 2100123456, oficina Quito Lun-Sáb).
- 2 órdenes seed en `pending_manual_payment`: `Test Transferencia` y `Test Efectivo` sobre el concierto. Idempotentes — se borran y recrean en cada boot.

### Tests
- `tests/test_phase5b.py` — **9/9 PASS** (4.0s):
  - create transfer/cash → pending_manual
  - GET instructions
  - confirm full flow (status, paid_at, tickets, manual_info)
  - **idempotencia** (2 confirms → 1 ticket)
  - reject
  - **RBAC** (otro organizer → 403/404)
  - **QR validate** después de manual confirm (1ª OK, 2ª already_used)
  - método inválido → 4xx

### Trade-offs Fase 5b
1. **Cleanup auto de reservas 48h** — no hay job en background; las reservas expiradas se descuentan lazy al consultar `compute_availability`. Suficiente por ahora.
2. **Audit logs** — best-effort: si el módulo audit falla, no rompe el confirm/reject.
3. **Email mocks filesystem** — sigue activo mientras no haya Resend real.
4. **Polling cada 10s en PaymentInstructions** — simple. Podría ser SSE/websocket en una fase futura.

## Backlog priorizado

### P0 — Fase 6 (Venues)
- CRUD venues
- Editor drag-and-drop de butacas/zonas
- Asignar venue al evento + múltiples localidades

### P1 — Fase 3b
- Tipos de tickets múltiples (VIP / Platea / General)
- Multi-función (varias fechas)
- Promo codes
- Descuentos avanzados (NxM, por método, por cantidad)
- Lista verificada + código de acceso

### P1 — Onboarding
- Demo shortcut solo en preview
- Pre-llenado plan
- Validación RUC/cédula EC

### P2 — Fase 7 (Super-admin)
- GMV / MRR / churn
- Eventos cross-tenant
- Reportes contables SRI

## Credenciales
Ver `/app/memory/test_credentials.md`.
