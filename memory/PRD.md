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
- **Fase 5.5** — **Super-Admin enriquecido: dashboard global + audit + exports + lista cross-tenant** ✅ (Feb 24, 2026)
- **Fase 6a** — **Venue editor drag-and-drop básico (escenarios + zonas + filas rectas)** 🟡 EN CURSO (Feb 24, 2026)
- **Fase 6b** (P0) — Venue editor avanzado: filas curvas, mesas, asientos individuales, multi-select avanzado
- **Fase 7** (P0) — Compra con selección de asiento en evento usando venue
- **Fase 3b** (P1) — Multi ticket types, multi-función, promo codes, descuentos avanzados
- **Fase 8** (P2) — Snapshots históricos de MRR (delta real mes a mes), churn, cohorts

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

### Cleanup (Feb 24, 2026 — fix definitivo)
- `_cleanup_ephemeral_orders` (existente) borra orders cuyo buyer.email matchea patterns test/funnel/example/test.com; protege seed manual buyers. Última corrida boot: 83 orders barridas. Cleanup adicional one-shot post-pytest: **14 orders más, 6 tickets, 6 reservations** (los `phase5b+*@example.com` y `phase5bx+*@example.com` creados por pytest después del boot).
- `_cleanup_ephemeral_test_data` (extendido): se agregaron prefijos `funnel-test`, `test-bot`, `bot-onboard`, `prueba-test` al slug-list y `funnel_`, `funnel-test-`, `testbot+`, `testbot1` al email-list. Resultado tras boot: 7 organizers test wipeados, quedan solo **4 organizers reales** (3 seed + `alvaro-perez`).
- Resultado en KPIs (todos en `0` mes corriente para validar limpieza):
  - MRR: $150 → $100 ✓ (purgado testbot profesional)
  - GMV mes: $94.50 → $0 ✓
  - Fees mes: $4.50 → $0 ✓
  - Pending organizers: 7 → 1 ✓
  - Active orgs: 3 → 2 ✓

### Email column (Feb 24, 2026)
- Backend `SortableField` Literal incluye ahora `email`.
- Frontend `AdminOrganizers.jsx` agregó columna Email ordenable entre Empresa y Plan; subtitle bajo Empresa cambió de `email` a `/slug` para evitar redundancia. `data-testid="sort-email"` + `org-email-{slug}` para tests.

### Performance
- Dashboard stats < 200ms con datasets actuales (11 organizers + 13 órdenes paid + 8 eventos). Aggregation pipeline con `$facet` permite escalar a 10k+ ítems en un solo round-trip a Mongo.
- Organizers rich list filtra en Mongo (query directa) y enriquece in-memory con aggregation pipelines (revenue/tickets/events_published).

### Trade-offs Fase 5.5
1. **MRR delta vs mes anterior**: no hay snapshot histórico → `mrr_delta_pct = null` por ahora. La cifra es siempre la actual. Para tener delta real, hace falta job nocturno que guarde snapshot mensual de MRR. Pendiente Fase 7.
2. **GMV delta_pct**: sí funciona porque las órdenes pagas tienen `paid_at` datable.
3. **Sort de organizers-rich** es in-memory (después del query). Aceptable hasta 10k organizers; para más, se necesita mover el sort al pipeline.
4. **Last login**: viene de `users.last_login` — campo poblado en cada login. Si está vacío significa que el organizer no se ha logueado desde que se agregó el tracking.

## Fase 6a — Venue editor (en curso, Feb 24, 2026)

### Alcance
Editor visual drag-and-drop para construir mapas de venue con escenarios + zonas no numeradas + filas rectas de asientos. Cubre ~70% de los casos (cine/auditorio/teatro básico). Fase 6b agregará filas curvas, mesas y asientos individuales.

### Stack
- `react-konva` 19 + `konva` 9 — canvas 2D performante.
- `react-colorful` — color picker para localidades.
- Snap grid: **20px** fijo.
- Max seats por fila: **200**.
- Canvas default: 1200×800.

### Backend (`routers/venues.py` nuevo)
Colección Mongo `venues` con elementos embebidos. Endpoints organizer (`/api/venues/me`):
- `GET /` (list con `events_count` + `max_venues` per plan) · `POST /` (create draft) · `GET /:id` (con `lock_status`) · `PUT /:id` (idempotent save con validación + clamp + 409 si locked) · `DELETE /:id` (rechaza si hay eventos vinculados) · `POST /:id/duplicate` (nuevos UUIDs) · `POST /:id/publish` (valida ≥1 elemento) · `POST /:id/archive` · `GET /:id/lock-status`
- Localidades sub-CRUD: `POST/PUT/DELETE /:id/localities/[:loc_id]` (DELETE rechaza si tiene elementos asignados).
- Público: `GET /api/public/venues/:tenant_slug/:venue_slug` (solo published).

### Validaciones
- `unnumbered_zone.capacity` > 0
- `seat_row_straight.seats_count` ∈ [1, 200]
- `locality_id` debe existir si está referenciado
- `clamp_elements`: x,y dentro de canvas
- Lock estructural: si hay eventos con `tickets_sold > 0`, diff de `elements` o `locality.color/price` → 409. Permite rename + descripción + bg color.

### Frontend
- `pages/app/Venues.jsx` — grid cards con thumbnail + status badge + acciones (Editor / Preview / Duplicar / Archivar / Eliminar). Filtros estado/tipo/search. Quota `X de N venues` + tooltip cuando llegás al límite.
- `pages/app/VenueEditor.jsx` — header con nombre editable + status badge + Guardar/Publicar/Preview. Auto-save 30s. Undo/redo (30 niveles). Toolbar shortcuts. Snapshot diff en localStorage no, va al backend directo.
- `pages/VenuePreview.jsx` — readonly canvas + locality legend + descripción. Sin auth.
- `components/venues/EditorCanvas.jsx` — Stage react-konva con zoom-wheel + reset, grid 20px (líneas más fuertes cada 100px), drag-and-drop con snap, click vacío deselecciona.
- `components/venues/ElementShape.jsx` — render polimorfico: `stage` (Rect+Text), `zone` (Rect translúcido con color de locality + capacidad), `row` (Group con N Circles + label A/B/C + número en cada asiento si zoom*spacing ≥22).
- `components/venues/EditorToolbar.jsx` — Select / Stage / Zone / Row activos. Spline / Tables / Seat disabled con tooltip "Próximamente Fase 6b".
- `components/venues/PropertiesPanel.jsx` — props del seleccionado (label/posición/tamaño/locality/seats_count/dirección numeración/color). Multi-select muestra solo "Eliminar".
- `components/venues/LocalitiesPanel.jsx` — CRUD + color picker (palette + HexColorPicker custom) + capacidad asignada + "Asignar a selección".
- 2 dialogs de configuración inicial (zone + row) tras hacer click en canvas con la tool activa.
- `lib/venues.js` — factories puras (`makeStage`, `makeZone`, `makeRow`) + `computeCapacity` + `capacityByLocality` + `venuesApi`.

### Atajos teclado
- `Delete` / `Backspace` → eliminar selección
- `Ctrl/Cmd + Z` → undo · `Ctrl/Cmd + Shift + Z` → redo
- `Esc` → deselect + select tool
- Flechas → mover 1px (10px con Shift)
- Ctrl/Cmd+click → multi-select toggle

### Seed
2 venues para `demo-org`: **Teatro Demo** (theater, published, 84 cap: escenario + 3 filas A/B/C + gradería; 3 localidades Platea/Tribuna/General) y **Auditorio Pequeño** (auditorium, draft, 50 cap: escenario + 5 filas A-E; 1 localidad General). Idempotente — skip si existen y están vinculados a eventos.

### Plan max_venues (preparación)
`get_plan_features` ya retorna `max_venues` por plan. La UI de listado bloquea el botón "Crear venue" si `active_count >= max_venues` (con `-1` = unlimited).

### Pending (no parte de 6a)
- Vincular venue a evento (event.venue_id) — viene en Fase 7.
- Selección de asientos durante compra (event-level seat hold) — Fase 7.
- Filas curvas, mesas, asientos individuales — Fase 6b.
- Performance: probado con ~80 elementos en el seed Teatro Demo, fluido. Target spec: 500 elementos OK.

## Credenciales
Ver `/app/memory/test_credentials.md`.


