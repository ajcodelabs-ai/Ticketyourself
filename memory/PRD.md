# Ticket Yourself (TYS) — PRD

## Resumen del proyecto
Plataforma SaaS web de ticketing multi-tenant. Stack: FastAPI + React + MongoDB. UI español (Ecuador), USD. Multi-tenancy por subdominio en prod (`<slug>.ajcodelabs.ai`); fallback `?tenant=<slug>` y `/o/<slug>` en preview.

URL preview actual: `https://ticket-poc.preview.emergentagent.com`

## Roadmap

- **Fase 0** — POC integraciones riesgosas ✅ COMPLETA (Feb 2026).
- **Fase 1** — Landing pública + auth + organizers + super-admin + Stripe subscription real ✅ COMPLETA.
- **Fase 2** — Microsite editor + público + activation funnel + welcome email ✅ COMPLETA.
- **Fase 3a** — Eventos básicos + demo shortcut ✅ COMPLETA.
- **Fase 4** — Compra pública de tickets + Stripe payment + JWT QR + PDFs + Dashboard de ventas ✅ COMPLETA (Feb 2026).
- **Fase 5** — **Reestructura panel organizer: sidebar 5 items + EventWizard 7 secciones + dashboard agregado + plan features + payment methods** ✅ COMPLETA (Feb 2026).
- **Fase 6** (P0) — Venue editor drag-and-drop + asientos numerados.
- **Fase 5b** (P1) — Pago manual público completo: comprador elige Stripe/Transfer/Cash en el modal, ve instrucciones; organizer confirma con botón "Marcar como pagado".
- **Fase 3b** (P1) — Tipos de tickets múltiples, multi-función, promo codes, descuentos avanzados.
- **Fase 7** (P2) — Super-admin enriquecido (GMV, MRR, churn, eventos de todos los organizers).

## Personas
- **Visitante** → landing → registro.
- **Organizador** → registra, sube docs, paga plan, gestiona dashboard/microsite/eventos/ventas.
- **Super-admin** → aprueba/rechaza/suspende organizadores, gestiona planes, ve funnel.
- **Comprador final** → microsite → evento → modal compra → ticket por email con QR.

## Fase 5 — Implementación (cerrada)

### Backend
- **`services/plan_features.py`** — feature flags por plan_code, `get_plan_features()`. Soporta `evento_unico`, `basico`, `profesional`, `enterprise`.
- **`routers/plans.py`** — endpoint `GET /api/plans/me/features` (auth Bearer).
- **`routers/dashboard.py`** (nuevo) — `GET /api/dashboard/me`: organizer + plan + stats del mes + 5 upcoming events + microsite + funnel. Single call.
- **`routers/events.py`** — Event extendido con `gallery_urls: [str]`, `sales_start`, `sales_end`, `payment_methods` (stripe/transfer/cash), `discounts` (disability_law/presale), `access_params` (visibility/access_type/max_per_purchase/max_per_email/refund_window_hours/show_buyer_name_on_ticket).
- **Gallery endpoints**:
  - `POST /api/events/me/{id}/gallery` (multipart, append, hasta 10)
  - `DELETE /api/events/me/{id}/gallery/{index}`
  - `PATCH /api/events/me/{id}/gallery/reorder` body `{order: [int]}`
- **`seeds.py`** — 3 eventos seed actualizados con `gallery_urls: []`, `payment_methods` (solo Stripe), `discounts` defaults, `access_params` defaults.

### Frontend
- **`components/OrganizerLayout.jsx`** — sidebar 240px fija (mobile: drawer con `Sheet`) con 5 items y iconos (LayoutDashboard/MapPin/Ticket/Palette/Settings) + header con avatar dropdown.
- **`App.js`** — rutas bajo `/app/*` + redirects de las rutas viejas:
  - `/dashboard` → `/app/dashboard`
  - `/eventos[/...]` → `/app/eventos[/...]`
  - `/microsite/editor` → `/app/microsite`
  - `/configuracion` → `/app/configuracion`
- **`pages/app/DashboardHome.jsx`** — plan card + status + 4 stat cards + upcoming events table + microsite card + funnel card.
- **`pages/app/Venues.jsx`** — empty state con ilustración fake seat map + botón "Crear venue" deshabilitado con tooltip "Próximamente — Fase 6".
- **`pages/app/Configuracion.jsx`** — 3 tabs: Perfil / Plan y facturación (link a portal Stripe) / Seguridad (placeholder).
- **`components/events/EventWizard.jsx`** — 7 tabs horizontales con indicadores ✓/⚠/○:
  1. General (título, descripciones, categoría)
  2. Fechas y ventas (start/end, timezone, sales window, multi-función deshabilitado)
  3. Media (poster + banner + galería multi-upload + reorder)
  4. Localidades (solo "General" editable, "Agregar localidad" deshabilitado con tooltip)
  5. Formas de pago (Stripe siempre on; Transfer + Cash opt-in con campos completos)
  6. Descuentos (disability_law toggle + presale con % y fecha)
  7. Accesos y parámetros (visibility, access_type, max_per_purchase, max_per_email, refund_window_hours, show_buyer_name)

### Trade-offs Fase 5
1. **Sin enforcement de feature flags** — la arquitectura existe (`plan_features.py` + `useFeatures` implícito), pero el wizard no bloquea features por plan. Sólo muestra "Próximamente". Decisión consciente del usuario.
2. **Pago manual público** — los toggles + datos bancarios se guardan en el evento, **pero la página pública de compra todavía sólo ofrece Stripe**. Falta extender `PurchaseModal` con selector de método y agregar status `pending_manual_payment` + endpoint `confirm-manual-payment` en el panel del organizer. → **Fase 5b** dedicada.
3. **Galería sin DnD nativo** — usa botones ↑↓ para reordenar en lugar de `dnd-kit`. Funcional pero no premium. Se mejora en Fase 6.
4. **Cambio de contraseña** — placeholder deshabilitado en Configuración. El endpoint `PATCH /auth/me/password` queda como TODO.

## Backlog priorizado

### P0 — Fase 5b (Pago manual público)
- Selector de método en `PurchaseModal` (Stripe/Transfer/Cash) si están enabled
- Backend acepta `payment_method` en POST /api/public/orders
- Status `pending_manual_payment` + página de éxito con instrucciones
- Botón "Marcar como pagado" en `EventDetail` → confirma orden + emite tickets + email

### P0 — Fase 6 (Venue editor)
- CRUD de venues, drag-and-drop seat map, multi-localidad por evento, compradores eligen butaca

### P1 — Fase 3b
- Tipos de tickets múltiples (VIP / Platea / General)
- Multi-función (varias fechas)
- Promo codes
- Descuentos avanzados (NxM, por cantidad, por método)
- Lista verificada + códigos de acceso

### P1 — Onboarding mejoras
- Demo shortcut visible solo en preview
- Pre-llenado de plan
- Validación de RUC/cédula EC

### P2 — Super-admin enriquecido (Fase 7)
- GMV, MRR, churn rate
- Vista de eventos de todos los organizers
- Análisis de uso por plan
- Exportación de reportes

### P2 — Otros
- Multi-moneda + payouts
- Custom domains
- IA design (Enterprise)
- Reportes contables (SRI Ecuador)

## Credenciales y test
Ver `/app/memory/test_credentials.md`.
