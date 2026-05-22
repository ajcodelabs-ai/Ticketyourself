# Ticket Yourself (TYS) — PRD

## Resumen del proyecto
Plataforma SaaS web de ticketing multi-tenant. Stack: FastAPI + React + MongoDB. UI español (Ecuador), USD. Multi-tenancy por subdominio en prod (`<slug>.ticketyourself.com`); fallback `?tenant=<slug>` y `/o/<slug>` en preview.

## Roadmap

- **Fase 0** — POC integraciones riesgosas ✅ COMPLETA (Feb 2026).
- **Fase 1** — Landing pública + auth + organizers + super-admin + Stripe subscription real ✅ COMPLETA.
- **Fase 2** — Microsite editor + público + activation funnel + welcome email ✅ COMPLETA.
- **Fase 3a** — Eventos básicos + demo shortcut ✅ COMPLETA.
- **Fase 4** — **Compra pública de tickets + Stripe payment + JWT QR + PDFs + Dashboard de ventas** ✅ COMPLETA (Feb 2026).
- **Fase 5** (P1) — App de validación en puerta (lector QR, offline-friendly, sync de revocaciones).
- **Fase 3b** (P2) — Eventos avanzados (tickets numerados, multi-función, suscripciones, promo codes).

## Personas
- **Visitante**: llega a la landing, se interesa, se registra.
- **Organizador**: registra, sube docs, paga plan, gestiona su microsite/eventos/ventas.
- **Super-admin**: aprueba/rechaza/suspende organizadores, gestiona planes.
- **Comprador final**: visita la página pública del evento, completa Stripe checkout (o reserva gratis), recibe ticket por email con QR.

## Fase 4 — Implementación

### Backend
**Modelos Mongo nuevos:**
- `ticket_orders`: `{id, order_number (TYS-NNNNNN), event_id, organizer_id, tenant_slug, buyer{name,email,phone,document_id}, items[], quantity_total, subtotal_cents, fees_cents (5%), total_cents, currency, donation_amount_cents, status (pending|paid|refunded|cancelled), stripe_session_id, stripe_payment_intent_id, paid_at, refunded_at, expires_at}`
- `tickets`: `{id, order_id, event_id, organizer_id, holder, qr_token (JWT), status (issued|used|revoked), issued_at, used_at, used_by}`
- `event_capacity_reservations`: `{id, event_id, order_id, quantity, expires_at}` (TTL 15min para Stripe checkout)
- `counters`: `{_id, seq}` para autoincrement de order_number

**Servicios:**
- `services/ticket_jwt.py` — HS256 JWT con propósito `ticket_admission`, exp = ends_at + 1 año
- `services/pdf_service.py` — reportlab A4 con branding del organizador + QR
- `services/order_service.py` — totals, validate_buyer, reserve_capacity, finalize_paid_order (idempotente), refund_order

**Endpoints públicos (sin auth):**
- `POST /api/public/orders` — crea orden. Free → instant paid. Paid/donation → Stripe checkout
- `GET /api/public/orders/{order_number}` — polling status (refresca contra Stripe si pending)
- `GET /api/public/orders/{order_number}/tickets/{ticket_id}/pdf` — PDF descargable

**Endpoints organizer (auth):**
- `GET /api/events/me/{id}/orders` — lista órdenes con filtros
- `GET /api/events/me/{id}/tickets[.csv]` — lista o exporta tickets
- `GET /api/events/me/{id}/stats` — ingresos, conversión, ocupación
- `POST /api/events/me/{id}/orders/{order_id}/refund` — reembolso (revoca tickets)
- `POST /api/events/me/{id}/orders/{order_id}/resend-email`
- `POST /api/tickets/validate` — Fase 5 ya implementado (decode QR + mark used)

**Webhooks Stripe:**
- `POST /api/stripe/webhook` — extendido para reconocer `metadata.tys_purpose=ticket_purchase`
- `POST /api/stripe/_simulate_webhook` — acepta `order_number` para finalizar ticket orders (dev)
- `POST /api/_dev/simulate-purchase-paid` — shortcut sin Stripe, devuelve tickets emitidos (dev)

### Frontend
- `pages/orders/OrderSuccess.jsx` — `/o/:slug/orden/:order_number` con polling cada 2s, QR + PDF download, simulate button (dev)
- `pages/orders/OrderCancel.jsx` — `/o/:slug/orden/:order_number/cancelado` con retry + simulate
- `components/orders/PurchaseModal.jsx` — modal en EventPublic con qty / buyer / donation
- `components/events/EventSalesTabs.jsx` — tabs Estadísticas/Ventas/Tickets en `/eventos/:id`
- `lib/orders.js` — helpers de formato y URLs

### Trade-offs Fase 4
1. **5% fee fijo** hardcoded para POC; configurable vía env `TYS_FEE_PERCENT`.
2. **Quantity cap = 10** por orden — buyer.document_id queda opcional, no se pre-cobra por asistente.
3. **Reservation TTL = 15min** alineado con Stripe Checkout session.
4. **Single ticket type** ("general") — diversidad de tipos llega en Fase 3b.
5. **Donation = 1 ticket** independiente del monto, sin tarifa de servicio.
6. **PDF en backend** vía reportlab (no client-side) — preserva branding consistente.
7. **JWT en QR** (no DB lookup directo) — permite validación offline en la app de puerta (Fase 5).
8. **Webhook firmado opcional** — sin `STRIPE_WEBHOOK_SECRET` real, el simulator + GET-with-session_id refresh cubren el flujo.

## Backlog

### P0 — Fase 5 (próxima)
- App/feature de validación en puerta (lector QR, idempotente, multi-usuario, offline-first).
- Dashboard de ventas a nivel organizer (agregado de todos sus eventos).
- Métricas de comparación: este mes vs mes anterior.

### P1 — Fase 3b
- Múltiples ticket types por evento (VIP, General, Estudiante).
- Tickets numerados con seat map.
- Multi-función (varias fechas por evento).
- Promo codes + descuentos por grupo.

### P2
- Multi-moneda + payouts a la cuenta del organizador.
- Custom domains.
- IA design (Enterprise).
- Reportes contables (TXT/PDF para SRI).

## Credenciales y test
Ver `/app/memory/test_credentials.md`.
