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
- **Fase 6a** — **Venue editor básico (escenarios + zonas + filas rectas)** ✅ (Feb 24, 2026)
- **Fase 6b** — **Venue editor avanzado (curvas + mesas + asientos individuales + transformer + multi-select)** ✅ (Feb 24, 2026)
- **Fase 7** — **Eventos × Venues + Compra con asientos numerados** ✅ (Feb 24, 2026)
- **Fase 9** — **QR Scanner & Door validation** ✅ (Feb 24, 2026)
- **Fase 8** (P1) — Multi ticket types, multi-función, promo codes, descuentos avanzados
- **Fase 10** (P2) — Snapshots históricos de MRR (delta real mes a mes), churn, cohorts

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
## Fase 6b — Venue editor avanzado ✅ (Feb 24, 2026)

### Elementos nuevos (4)
- **`seat_row_curved`** — Arco circular con `curve_radius` + `curve_arc_degrees` (10°-180°). Sweep LEFT→RIGHT para que la numeración LTR sea visualmente coherente. Geometría: centro del círculo arriba del anchor (cy = -curve_radius), seats sobre el bottom-arc.
- **`seat_individual`** — Asiento suelto. Click directo coloca; el label se auto-incrementa (`VIP-1` → `VIP-2`) con `bumpLabel`. La herramienta permanece activa hasta `Esc` para colocar varios.
- **`table_round`** — Mesa redonda con `chairs_count` (2-12), `table_radius`, `chair_distance`, `chair_radius`. Las sillas se distribuyen en círculo equiespaciadas.
- **`table_rect`** — Mesa rectangular con `chairs_per_side: {top, right, bottom, left}` (max 12 arriba/abajo, 8 lateral). Sillas alineadas en cada lado.

### Konva Transformer
- `<Transformer>` adjuntado dinámicamente a las refs de la selección via `tr.nodes([...])`.
- Resize estructural según kind: stage/zone/table_rect ajustan width/height; seat_row_straight ajusta `seats_count` proporcional al ancho; table_round ajusta `table_radius`; seat_row_curved ajusta `curve_radius`; seat_individual no resize.
- `rotationSnaps` cada 15° por defecto (configurable con Shift).
- onTransformEnd: reset scaleX/scaleY a 1 + persist patch.

### Multi-select (lo que faltaba de 6a + nuevo)
- ✅ **Ctrl/Cmd+Click**: toggle additivo.
- ✅ **Marquee**: drag en zona vacía con tool=select. `bboxIntersects` decide qué entra. Shift+drag para añadir a selección existente.
- ✅ **Group drag**: al arrastrar un elemento seleccionado, todos los demás seleccionados se mueven con el mismo delta. Snapshot al primer dragMove + apply via refs Konva directos (sin re-render); persist en dragEnd.
- ✅ **Alinear** 6 botones (L/CV/R/T/CH/B) en sidebar multi.
- ✅ **Distribuir** H/V (requiere ≥3 elementos).
- ✅ **Asignar localidad** batch desde panel Localidades ("Asignar a selección (N)").
- ✅ **Eliminar**, **Duplicar (Ctrl+D)**.

### Snap a alineación (5px tolerance)
- Durante drag, se computan bboxes de TODOS los elementos no seleccionados.
- Para cada eje (cx/minX/maxX vs cy/minY/maxY) se chequea coincidencia ±5px.
- Si match: snap + render línea guía verde dash en `<Layer>` de elementos durante el drag.
- Limpieza onDragEnd.

### Sidebar mejorado
- Multi-select: sección Alinear (3×2 grid) + Distribuir (2 botones) + Duplicar + Eliminar.
- Single-select: campos polimórficos según kind (curve_radius, chairs_count, chairs_per_side, etc.) + Z-index buttons (Bring to Front / Send to Back).

### Atajos
- `Delete` / `Backspace` · `Ctrl+A` · `Ctrl+C` · `Ctrl+V` · `Ctrl+D` · `Ctrl+Z` · `Ctrl+Shift+Z` · `Esc` · Arrow keys (Shift = 10px) · Right-click menú contextual.

### Context menu (right-click)
- Editar / Duplicar / Asignar localidad / Bring to Front / Send to Back / Eliminar.

### Seed
- **Auditorio Pequeño** rediseñado a status=published, 50 cap, 11 elementos × 6 tipos:
  1 escenario · 2 filas rectas A/B (10 + 10) · 1 fila curva C (10 seats, arc 80°) · 2 mesas redondas (6 sillas c/u) · 1 mesa rectangular (4 sillas top/bottom) · 4 asientos VIP individuales.

### Smoke tests (curl)
| Caso | Resultado |
| --- | --- |
| PUT con stage + curved + seat + table_round + table_rect | 200 ✓ |
| capacity_calculated = 21 (= 8 curved + 1 seat + 6 round + 6 rect) | ✓ |
| arc_degrees=200 → 422 | ✓ |
| chairs_count=15 (>12) → 422 | ✓ |

### Performance
- Grid en su propio `<Layer listening={false}>` — no se re-renderiza al mover elementos.
- Group drag mueve nodos Konva directamente sin disparar render por cada delta.
- Probado con los 11 elementos del Auditorio: fluido. Target spec 200+ elementos viable.


## Fase 7 — Eventos × Venues + Compra con asientos numerados ✅ (Feb 24, 2026)

### Modelo
- `events` extendido con `venue_id`, `venue_slug`, `locality_pricing: [{locality_id, price_cents, max_tickets_per_purchase}]`, `seat_holds_window_minutes` (default 10).
- Nueva colección `seat_holds`: `{id, event_id, venue_id, seat_id, holder.{session_token, buyer_email}, status: held|converted, held_at, expires_at, order_id}`.
- Nueva colección `event_seat_assignments`: `{event_id, venue_id, seat_id, ticket_id, order_id, holder_email, locality_id, assigned_at}` (one row per sold seat).
- `tickets` ahora tiene `seat_label`, `seat_id`, `locality_id` cuando el evento es numerado.

### Seat-id schema (en `services/seats.py`)
- `seat_row_straight`/`seat_row_curved`: `"{element_id}::s::{index}"` con label `"{row_label}-{N}"` (respeta numbering_direction).
- `seat_individual`: `"{element_id}"`, label = `element.label`.
- `table_round`/`table_rect`: `"{element_id}::c::{index}"`, label `"{table_label}-{index+1}"`.
- Stage y unnumbered_zone NO tienen seat_id.

### Endpoints nuevos
- Organizer: `PUT /api/events/me/{id}/venue` (body `{venue_id, locality_pricing[], seat_holds_window_minutes}`) → valida ownership + coverage + ticket-lock; `DELETE /api/events/me/{id}/venue`.
- Público: `GET /api/public/events/...` ahora incluye `venue` completo + `locality_pricing` + `seats_status[]` cuando es numerado.
- Público: `POST /api/public/events/.../seat-holds` body `{seat_ids[], session_token}` — atomic check + crea holds 10min; 409 con `unavailable_seat_ids` si choque.
- Público: `DELETE /api/public/events/.../seat-holds` body `{session_token}` — libera holds.
- `POST /api/public/orders` extendido: acepta `seat_ids[]` + `seat_holds_session_token`. Recalcula total con `compute_totals_with_seats` + transiciona holds `held → converted`.

### Flow de pago
- Stripe webhook + Manual confirm → `_assign_seats_if_needed` → `assign_seats_to_tickets` (crea event_seat_assignments + actualiza tickets con seat_label).
- Validación publicar: requiere `locality_pricing` completo cuando hay `venue_id`.

### Frontend
- `lib/seats.js`: session_token UUID v4 (localStorage), `seatWorldPos` (geometría por kind), totals helpers.
- `SeatPickerCanvas.jsx`: readonly + clickable seats (colores por status/locality), drag-to-pan, wheel-zoom, auto-fit.
- `NumberedSeatSection.jsx`: grid mapa + sidebar (localidades/selección/total), refresh seats cada 15s, "Reservar y continuar".
- `EventPublic.jsx`: modo dual — `venue_id` ⇒ NumberedSeatSection; si no ⇒ CTA actual.
- `EventVenueLink.jsx`: dialog en wizard tab Localidades — lista venues published + grid precios por locality activa + preview + desvincular.
- `PurchaseModal.jsx`: si recibe `seatHoldsInfo`, oculta quantity + muestra seats summary + pasa `seat_ids` + `seat_holds_session_token` al POST.
- `OrderSuccess.jsx`: cada ticket muestra `🎫 {seat_label}`.

### Seed
- **"Función Especial — Demo Numerado"** linkeado a `teatro-demo`, status=published, +20 días.
- Pricing: Platea $25 · Tribuna $15 · General $10.
- Pre-cargados: 3 seats vendidos (A-1/A-2/C-5) + 1 hold (A-3) → los 3 estados visuales se ven al instante.

### Smoke E2E ✅
| Caso | Resultado |
| --- | --- |
| Hold 2 seats | 200 + expires_at +10min ✓ |
| Create order con seat_ids + session_token (transfer) | 200 + total recalculado por locality ✓ |
| Confirm manual payment | 200 + 2 tickets `seat_label="A-4 · Platea"` / `"A-5 · Platea"` ✓ |
| Public seats_status post-venta | A-4 y A-5 → sold ✓ |
| Counts finales | 5 sold / 1 held / 28 available ✓ |

### Pendiente (no parte del alcance)
- Comprar tickets de unnumbered_zone — se venderá como cupo en Fase 8.
- "Extender hold" cada 2min — TTL fijo 10min suficiente.
- Mini-mapa con el asiento highlighted en el PDF del ticket (mejora visual Fase 8).

## Fase 9 — QR Scanner & Door validation ✅ (Feb 24, 2026)

### Backend
- `routers/tickets.py` extendido:
  - `POST /api/tickets/validate` ahora es **concurrent-safe** vía `find_one_and_update({status: {$nin: [used, revoked]}}, {$set: {used}})` — 2 staff escaneando el mismo ticket → uno gana (200 valid), el otro recibe `{valid: false, reason: "already_used"}`.
  - Cada validación (incluso rechazos por token inválido / wrong organizer / revoked) escribe una fila en `ticket_scans` para auditoría.
  - Nueva colección `ticket_scans`: `{id, event_id, ticket_id, scanned_by, scanned_at, result, reason?, holder_name, seat_label}`.
  - Nuevos endpoints: `GET /api/events/me/{id}/scan-log?page=&limit=`, `GET .../scan-log.csv`, `GET .../scan-stats` (total/scanned/valid/rejected/last_scan_at/scan_rate_per_minute/scanned_by_locality).

### Fix paralelo
- `services/pdf_service.py`: PDF del ticket ahora muestra **ASIENTO {seat_label}** prominente entre ASISTENTE y PRECIO (con color primary, fuente bold 16pt). Solo se renderiza si el ticket es de evento numerado. PRECIO se desplaza 50px abajo cuando aparece ASIENTO.

### Frontend
- `pages/app/EventValidation.jsx`: scanner page con `html5-qrcode` integrado.
  - Header sticky con título + venue + fecha + counter "X de Y escaneados" + toggle sonido + drawer historial + botón "Salir".
  - Camera frame (con `facingMode: "environment"` para móvil) + botón Iniciar/Parar cámara.
  - Modal de resultado grande (auto-dismiss 3s) con 3 variantes: verde "VÁLIDO" / amarillo "YA USADO" / rojo "INVÁLIDO"|"REVOCADO". Muestra holder name, email, seat_label, used_at.
  - Beeps distintos por tipo (Web Audio API): valid = 880→1320Hz, already_used = 440Hz, invalid = 180Hz.
  - Cooldown 1.5s anti-spam por mismo JWT.
  - Manual input para pegar JWT (cuando la cámara no funciona).
  - Strip de stats: Escaneados / Válidos / Rechazados / Ritmo (últimos 10min).
- `pages/events/EventDetail.jsx`: nuevo botón verde "Validar entradas" en el header del evento (solo si status=published).
- Sidebar Sheet con últimos 50 scans (session-local) + botón "Exportar CSV completo" → descarga server-side `/scan-log.csv`.

### Smoke E2E ✅
| Caso | Resultado |
| --- | --- |
| First validate (issued ticket) | 200, valid=True, seat_label="B-1 · Platea" ✓ |
| Second validate (same token) | 200, valid=False, reason="already_used", used_at presente ✓ |
| Bogus JWT | 200, valid=False, reason="invalid_token" ✓ |
| GET `/scan-log?limit=5` | total=2, 2 rows (valid + already_used) con holder_name + seat_label ✓ |
| GET `/scan-stats` | total/scanned/valid/rejected/last_scan_at/rate/by_locality todo correcto ✓ |

### Decisiones técnicas
- Librería **html5-qrcode** elegida porque tiene la API más estable cross-browser para `getUserMedia` + zxing en web. Genera 23 warnings de source-map (faltan .ts upstream) — solo cosmético.
- Concurrencia resuelta a nivel DB (find_one_and_update) en vez de mutex aplicativo — más simple y robusta.
- Historial de scans es session-local en frontend (max 50) por velocidad; el log persistente se lee del backend vía `/scan-log` con paginación y se exporta como CSV.
- Offline fallback NO se implementó (spec opcional): el preview siempre tiene HTTPS y red. Si en el futuro hay tablets ocasionalmente offline, agregaríamos validación local de firma JWT + cola para reintentos.

### Pendiente menor (no parte del alcance)
- Tab "Estadísticas" del wizard del evento podría sumar el bloque "Acceso al evento" con link al scanner — hoy el link está en el header del event detail, lo cual cumple el spec funcional.
- Roles staff para que el organizer comparta el scanner sin compartir cuenta — diferido a Fase 10.

## Credenciales
Ver `/app/memory/test_credentials.md`.




