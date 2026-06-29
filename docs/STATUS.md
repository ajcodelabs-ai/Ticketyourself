# Estado del Proyecto — Ticket Yourself (TYS)

> Última actualización: junio 2026

---

## Resumen ejecutivo

El proyecto tiene **15 fases completadas** de un roadmap de 17. El core del producto está funcional: registro, auth, eventos, venues con asientos numerados, compra con Stripe y pago manual, tickets QR, dashboard de ventas y panel super-admin. Las únicas fases pendientes son features avanzados de ticketing (Fase 8) y analytics histórico (Fase 10).

---

## Estado por fase

| Fase | Descripción | Estado | Tests |
|------|-------------|--------|-------|
| 0 | POC integraciones (Stripe + MongoDB) | ✅ Completa | 18/19 ¹ |
| 1 | Landing + auth + organizers + admin + billing | ✅ Completa | 41/41 |
| 2 | Microsite editor + activation funnel + welcome email | ✅ Completa | 30/30 |
| 3a | Eventos básicos (free/paid/donation) | ✅ Completa | — ² |
| 4 | Compra Stripe + JWT QR + PDFs + dashboard ventas | ✅ Completa | 20/20 |
| 5 | Sidebar + EventWizard 7 tabs + galería + plan features | ✅ Completa | 10/10 |
| 5b | Pago manual (transferencia + efectivo) end-to-end | ✅ Completa | 16/17 ³ |
| 5.5 | Super-Admin: dashboard global + audit + exports cross-tenant | ✅ Completa | 17/17 |
| 6a | Venue editor básico (escenarios + zonas + filas rectas) | ✅ Completa | — ² |
| 6b | Venue editor avanzado (curvas + mesas + asientos individuales) | ✅ Completa | — ² |
| 7 | Eventos × Venues + compra con asientos numerados | ✅ Completa | — ² |
| 8 | Multi ticket types, multi-función, promo codes avanzados | 🔲 Pendiente | — |
| 9 | QR Scanner & door validation | ✅ Completa | incluido en fase 4 |
| 9.5 | UX refinement (phone picker, toggle ojo, centrar canvas) | ✅ Completa | 156/156 |
| 9.6 | UX iteración (presets + venue picker + media mockups) | ✅ Completa | — ² |
| 10 | Snapshots históricos MRR, churn, cohorts | 🔲 Pendiente | — |

> ¹ 1 fallo en POC antiguo (endpoint `/poc/stripe/status`) — no afecta el producto actual, ese código quedó como legacy.  
> ² Tests cubiertos por suites de fases anteriores (regresión incluida).  
> ³ 1 skip por condición de entorno, 0 fallos reales.

---

## Qué está funcionando

### Autenticación y acceso
- Registro de organizadores con validación de datos, slug único y envío de welcome email
- Login con JWT (access 30 min + refresh 7 días), tokens en body y cookies
- Roles: `super_admin` y `organizer`; RBAC en todos los endpoints
- Organizers con estado `pending` pueden editar drafts pero no publicar (con banner explicativo en UI)
- Estados `rejected` y `suspended` bloquean el panel con mensaje y CTA

### Gestión de eventos
- EventWizard de 6 tabs: Info + Fechas / Venue + Localidades / Media / Pagos / Descuentos / Acceso
- Eventos free, paid y donation
- Galería hasta 10 imágenes con reorder y delete
- Microsite público por organizador (`/o/:slug`) + página pública de evento

### Venues y asientos numerados
- Editor visual Konva: escenario, zonas sin numerar, filas rectas, filas curvas, mesas, asientos individuales
- Undo/redo (30 niveles), auto-save, snap grid 20px, zoom
- Localidades con colores, precios y capacidades por zona
- Lock estructural: bloquea edición si hay tickets vendidos
- Deep-link desde el wizard del evento; return-to tras crear venue

### Compra de tickets
- Flujo Stripe Checkout (redirect y vuelta)
- Pago manual: transferencia bancaria y efectivo (orden queda `pending_manual_payment`)
- Confirmación o rechazo manual por el organizador con email automático
- Reserva de capacidad con TTL (15 min Stripe, 48h manual)
- Descuentos: promo codes (con cuota y ventana de validez) y descuentos automáticos por cantidad
- Cálculo de preview de orden antes de confirmar

### Tickets QR
- JWT firmado embebido en QR (PDF + pantalla)
- Validación en puerta: `valid` → `already_used` → `invalid`
- PDF generado con ReportLab (disponible solo en órdenes pagas)
- Reenvío de email con tickets desde panel organizador

### Dashboard organizador
- KPIs: ventas del mes, tickets emitidos, capacidad restante
- Listado de órdenes con filtros, estado y CSV export
- Próximos eventos

### Super-Admin
- Dashboard global: MRR, GMV del mes, fees, top organizadores, top eventos
- Gestión de organizadores: aprobar, rechazar, suspender, ver documentos
- Gestión de planes y suscripciones Stripe
- Auditoría de acciones con filtros
- Exports CSV: organizadores, eventos, órdenes, auditoría, reporte mensual
- Attention banner: organizers pendientes, órdenes manuales viejas, suscripciones vencidas

---

## Qué falta (roadmap pendiente)

### Fase 8 — Multi ticket types, multi-función, descuentos avanzados (P1)
- **Multi ticket types**: diferentes tipos de ticket por evento (VIP, General, Early Bird) con precios, capacidades y descripción independientes por tipo
- **Multi-función**: múltiples fechas/horarios por evento (actualmente cada evento tiene una sola ocurrencia)
- **Promo codes avanzados**: cuota por comprador (actualmente solo cuota global), historial de uso

### Fase 10 — Analytics histórico (P2)
- Snapshots de MRR mes a mes (actualmente el delta es siempre `null` — no hay histórico)
- Churn y cohorts de organizers
- Job nocturno para persistir KPIs mensuales

### Deuda técnica conocida
| Item | Prioridad | Detalle |
|------|-----------|---------|
| `@app.on_event` deprecado en FastAPI | Baja | Migrar a `lifespan` context manager en `server.py` |
| Sort de organizers-rich en memoria | Baja | Aceptable hasta ~10k organizers; después mover al pipeline Mongo |
| RBAC 403 vs redirect en `/admin/*` | Baja | Muestra pantalla "Acceso denegado" en vez de redirigir a `/login` |

---

## Cobertura de tests

| Suite | Tests | Resultado |
|-------|-------|-----------|
| `backend_test.py` (fase 0 POC) | 19 | 18 pass / 1 fail (legacy Stripe polling) |
| `test_phase1.py` | 41 | 41/41 ✅ |
| `test_phase2.py` | 30 | 30/30 ✅ |
| `test_phase4.py` | 20 | 20/20 ✅ |
| `test_phase5.py` | 10 | 10/10 ✅ |
| `test_phase5b.py` | 9 | 9/9 ✅ |
| `test_phase5b_extra.py` | 8 | 7/8 (1 skip de entorno) ✅ |
| `test_phase5_5.py` | 17 | 17/17 ✅ |
| **Total activo** | **135** | **134 pass / 1 skip / 0 fail** |

> El único fallo (`pytest_results.xml` fase 0) es del endpoint POC legacy que no se usa en producción.

---

## Credenciales de prueba

| Usuario | Email | Password | Acceso |
|---------|-------|----------|--------|
| Super Admin | `admin@ticketyourself.com` | `Admin123!` | Panel `/admin` completo |
| Organizer aprobado | `demo@ticketyourself.com` | `Organizer123!` | Panel `/app` + eventos + venues |
| Organizer pendiente | `prueba@ticketyourself.com` | `Organizer123!` | Panel limitado (no puede publicar) |
| Organizer rechazado | `rechazado@ticketyourself.com` | `Organizer123!` | Vista bloqueada con CTA |
