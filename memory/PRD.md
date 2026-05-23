# Ticket Yourself (TYS) — PRD

## Resumen
Plataforma SaaS web de ticketing multi-tenant. FastAPI + React + MongoDB. UI español (Ecuador), USD.
Multi-tenancy `<slug>.ajcodelabs.ai` (prod) / `?tenant=<slug>` / `/o/<slug>` (preview).

URL preview: `https://ticket-poc.preview.emergentagent.com`

## Roadmap

- **Fase 0** — POC integraciones ✅
- **Fase 1** — Landing + auth + organizers + admin + Stripe subscription ✅
- **Fase 2** — Microsite editor + activation funnel + welcome email ✅
- **Fase 3a** — Eventos básicos + demo shortcut ✅
- **Fase 4** — Compra Stripe + JWT QR + PDFs + dashboard ventas ✅
- **Fase 5** — Sidebar 5 items + EventWizard 7 secciones + galería + plan features ✅
- **Fase 5b** — Pago manual end-to-end (transferencia + efectivo) ✅
- **Fase 5.5** — **Super-Admin enriquecido: dashboard global + audit + exports + lista cross-tenant** ✅ (Feb 2026)
- **Fase 6** (P0) — Venue editor drag-and-drop + asientos numerados
- **Fase 3b** (P1) — Multi ticket types, multi-función, promo codes, descuentos avanzados
- **Fase 7** (P2) — Snapshots históricos de MRR (delta real mes a mes), churn, cohorts

## Fase 5.5 — Implementación (cerrada)

### Backend (paralelo)
- **`routers/admin_dashboard.py`** (nuevo) — requiere `super_admin`:
  - `GET /api/admin/dashboard/stats` — single payload con `$facet`: KPIs (MRR, GMV mes, fees mes, organizers activos), distribución por estado/plan, activity (tickets totales/mes, orders breakdown, eventos), top 5 organizers + top 5 eventos por GMV del mes.
  - `GET /api/admin/attention-items` — pending_organizers + stale_manual_orders (>24h) + past_due_subscriptions.
  - `GET /api/admin/organizers-rich` — listado enriquecido con filters (`status`, `subscription_status`, `plan_code`, `activity`, `created_from/to`, `search`), sort (`created_at`, `company_name`, `revenue`, `tickets_emitted`, `events_published`, `last_login`), paginación. Campos: revenue, tickets_emitted, events_published, last_login, plan_code/name, subscription_status.
  - `GET /api/admin/audit-log` — filtros action/actor/target_type/target_id/date_range, sort desc, enriquece actor con email.
- **`routers/admin_exports.py`** (nuevo) — UTF-8 BOM CSV:
  - `/api/admin/export/organizers.csv`
  - `/api/admin/export/events.csv`
  - `/api/admin/export/orders.csv`
  - `/api/admin/export/audit-log.csv`
  - `/api/admin/export/monthly-report.csv?year=&month=` (con fila TOTAL al final)
- **`routers/events.py`** — `admin_router` (`GET /api/admin/events`) extendido con `category`, `pricing_type`, `search`, `starts_from/to`, sort multi-campo. Enriquece cada evento con `organizer_company_name`, `organizer_slug`, `gmv_cents`, `fees_cents`.
- **`routers/admin.py`** — `GET /admin/dashboard/stats` viejo renombrado a `/stats-legacy` (deprecated) para no colisionar.

### Frontend
- **`AdminLayout`** — reescrito con sidebar fija (240px) con acento naranja, 7 items (Dashboard / Organizadores / Eventos / Planes / Funnel / Auditoría / Reportes), header con badge "Super Admin", avatar dropdown.
- **`AdminDashboard`** — KPIs (4 cards con delta %), 2 charts recharts (pie estado, bar plan), 3 activity cards, top 5 organizers + top 5 eventos tables, attention banner naranja.
- **`AdminEvents`** (nuevo) — `/admin/eventos` cross-tenant con search, status/category filters, sort por columna (header clickeable), GMV por evento, link al organizer, paginación.
- **`AdminAuditLog`** (nuevo) — `/admin/auditoria` con filtros action/target_type, badges colorados por acción, metadata expandible en dialog.
- **`AdminReports`** (nuevo) — `/admin/reportes` con 4 cards de export (organizers/events/orders/audit) + reporte ejecutivo mensual con selector año/mes.
- **`App.js`** — 3 rutas nuevas (`/admin/eventos`, `/admin/auditoria`, `/admin/reportes`).

### Tests
- `tests/test_phase5_5.py` — **17/17 PASS** (2.9s): payload shape, RBAC (3 niveles), filters, sort, exports válidos, monthly report con TOTAL row.

### Cleanup
- Seeds ephemeral test cleanup ya existente borra orders test-* / *@example.com / *@test.com al boot. Verificado: ~30 órdenes basura barridas; quedaron solo las 2 seed (`Test Transferencia` y `Test Efectivo`).

### Performance
- Dashboard stats < 200ms con datasets actuales (11 organizers + 13 órdenes paid + 8 eventos). Aggregation pipeline con `$facet` permite escalar a 10k+ ítems en un solo round-trip a Mongo.
- Organizers rich list filtra en Mongo (query directa) y enriquece in-memory con aggregation pipelines (revenue/tickets/events_published).

### Trade-offs Fase 5.5
1. **MRR delta vs mes anterior**: no hay snapshot histórico → `mrr_delta_pct = null` por ahora. La cifra es siempre la actual. Para tener delta real, hace falta job nocturno que guarde snapshot mensual de MRR. Pendiente Fase 7.
2. **GMV delta_pct**: sí funciona porque las órdenes pagas tienen `paid_at` datable.
3. **Sort de organizers-rich** es in-memory (después del query). Aceptable hasta 10k organizers; para más, se necesita mover el sort al pipeline.
4. **Last login**: viene de `users.last_login` — campo poblado en cada login. Si está vacío significa que el organizer no se ha logueado desde que se agregó el tracking.

## Backlog priorizado

### P0 — Fase 6 (Venues)
- CRUD venues + drag-and-drop seat map + asignación a evento

### P1 — Fase 3b
- Tipos de tickets múltiples, multi-función, promo codes, descuentos avanzados

### P2 — Fase 7 (Snapshots históricos)
- Job nocturno que guarda snapshot de MRR/GMV/churn → permite series de tiempo
- Charts de evolución MRR/GMV últimos 6 meses
- Métricas de churn y retention

## Credenciales
Ver `/app/memory/test_credentials.md`.
