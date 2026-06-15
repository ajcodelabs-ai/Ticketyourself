# PRD — Plataforma SaaS de Gestión Integral de Eventos y Venta de Entradas
### Ticket Yourself (TYS)

> **Versión:** 2.1 — Junio 2026  
> **Estado:** Documento vivo — actualizar con cada sprint  

---

## 1. Contexto y Objetivo

TYS es una plataforma SaaS multi-tenant que permite a organizaciones crear y monetizar eventos, vender entradas con múltiples métodos de pago, gestionar venues con asientos numerados y controlar el acceso el día del evento mediante QR.

**Modelo de negocio:** suscripción mensual + comisión por ticket (5% por defecto). El organizador contrata un plan que define sus límites y acceso a features premium.

**Mercado objetivo:** organizadores en Ecuador y latinoamérica. Moneda: USD. Idioma: español.

---

## 2. Roles y Permisos

### 2.1 Matriz de roles

| Capacidad | Super Admin | Org Owner | Org Staff | Comprador |
|---|:---:|:---:|:---:|:---:|
| Panel super admin | ✅ | ❌ | ❌ | ❌ |
| CRUD organizadores | ✅ | ❌ | ❌ | ❌ |
| CRUD planes globales | ✅ | ❌ | ❌ | ❌ |
| Ver estadísticas cross-tenant | ✅ | ❌ | ❌ | ❌ |
| Ver/editar propio perfil org | ❌ | ✅ | ✅ (lectura) | ❌ |
| CRUD eventos propios | ❌ | ✅ | ⚠️ (asignado) | ❌ |
| Publicar/despublicar eventos | ❌ | ✅ | ❌ | ❌ |
| Ver dashboard ventas | ❌ | ✅ | ⚠️ (asignado) | ❌ |
| Confirmar pagos manuales | ❌ | ✅ | ⚠️ (asignado) | ❌ |
| Validar QR en puerta | ❌ | ✅ | ✅ | ❌ |
| Comprar tickets | ❌ | ❌ | ❌ | ✅ |
| Ver historial de compras | ❌ | ❌ | ❌ | ✅ |

> ⚠️ = según permisos asignados por el Org Owner. **Rol `org_staff` no está implementado aún** (Fase 8+).

### 2.2 Definición de roles

**super_admin** — único por plataforma. Administra todo lo global: planes, organizadores, auditoría, reportes cross-tenant. No puede actuar sobre eventos de un organizador específico.

**organizer (owner)** — titular de la cuenta de organización. Acceso completo dentro de su tenant: crear/editar/publicar eventos, venues, ver ventas, gestionar staff.

**org_staff** *(pendiente)* — usuario creado por el owner dentro de su tenant. Puede tener permisos acotados: validar QR, cobrar en caja, ver ventas de ciertos eventos. No puede crear eventos ni cambiar configuración.

**buyer/attendee** — usuario final. Hoy compra como invitado (sin cuenta). En fases futuras podrá registrarse para gestionar su historial de compras.

---

## 3. Modelo SaaS Multi-Tenant

### 3.1 Aislamiento de datos

Cada organización es un **tenant** identificado por su `slug` único. El aislamiento se garantiza en capa de aplicación: todos los endpoints del organizador filtran por `organizer_id` derivado del JWT, nunca por input del usuario.

```
users.organizer_id  →  organizers.id  →  tenants.slug
events.organizer_id →  [mismo]
venues.organizer_id →  [mismo]
orders.organizer_id →  [mismo]
```

### 3.2 Resolución de tenant (acceso público)

El tenant activo para las rutas públicas se resuelve en este orden:

1. Subdominio `<slug>.ajcodelabs.ai` (producción)
2. Query param `?tenant=<slug>` (preview / links compartidos)
3. Ruta de path `/o/<slug>/...` (canónica)
4. `localStorage["tys.tenant_slug"]` (frontend web, persistencia de sesión)
5. Default `demo-org` (entorno de preview)

### 3.3 Planes y feature gating

```
Plan           | max_events | max_tickets | numbered | ai_design | custom_domain
---------------|-----------|-------------|----------|-----------|---------------
Evento Único   | 1         | 200         | ❌       | ❌        | ❌
Básico         | 5         | 500         | ❌       | ❌        | ❌
Profesional    | ∞         | ∞           | ✅       | ❌        | ❌
Enterprise     | ∞         | ∞           | ✅       | ✅        | ✅
```

Los límites se validan en backend antes de cada operación (crear evento, publicar, vincular venue).

---

## 4. Módulos y Historias de Usuario

---

### Módulo 1 — Landing Page y Marketing

**Objetivo:** convertir visitantes en organizadores registrados.

**Estado actual:** ⚠️ básica — falta sección de casos de uso, FAQ y contacto.

#### Historias de usuario

| ID | Como... | Quiero... | Para... |
|---|---|---|---|
| LP-01 | Visitante | Ver qué hace la plataforma en menos de 10 segundos | Decidir si me interesa |
| LP-02 | Visitante | Comparar los planes y sus precios | Elegir el que me conviene antes de registrarme |
| LP-03 | Visitante | Ver casos de uso reales (conciertos, ferias, conferencias) | Confirmar que aplica a mi tipo de evento |
| LP-04 | Visitante | Leer preguntas frecuentes | Resolver dudas sin hablar con soporte |
| LP-05 | Visitante | Enviar un mensaje de contacto | Consultar antes de comprar |
| LP-06 | Visitante | Hacer clic en "Empezar" y ser guiado al registro + selección de plan | Completar el onboarding en una sola sesión |

#### Funcionalidades requeridas
- Hero con CTA directo a `/registro`
- Sección de beneficios (3-4 cards con íconos)
- Sección de casos de uso con screenshots
- Tabla comparativa de planes (precio + features)
- Sección FAQ con acordeón (mínimo 8 preguntas)
- Formulario de contacto con email de destino configurable
- Footer con datos legales, enlaces y redes sociales

---

### Módulo 2 — Autenticación y Gestión de Cuenta

**Estado actual:** ✅ mayormente completo (JWT, bcrypt, roles, refresh, cookies + Bearer). Brecha: AUTH-04.

#### Historias de usuario

| ID | Como... | Quiero... | Para... | Estado |
|---|---|---|---|---|
| AUTH-01 | Nuevo organizador | Registrarme con email, empresa, RUC y teléfono | Crear mi cuenta con datos válidos | ✅ |
| AUTH-02 | Organizador | Iniciar sesión y que mi sesión persista 7 días | No tener que re-loguearme a diario | ✅ |
| AUTH-03 | Organizador | Cambiar mi contraseña desde Configuración | Mantener segura mi cuenta | ✅ |
| AUTH-04 | Organizador | Recuperar mi contraseña por email si la olvidé | Retomar el acceso sin soporte | ❌ |
| AUTH-05 | Super admin | Iniciar sesión con mis credenciales | Acceder al panel global | ✅ |

**Brecha pendiente:** AUTH-04 — recuperación de contraseña por email no está implementada.

---

### Módulo 3 — Organización y Perfil (Tenant)

**Estado actual:** ✅ mayormente completo. Falta gestión de usuarios staff.

#### Historias de usuario

| ID | Como... | Quiero... | Para... |
|---|---|---|---|
| ORG-01 | Organizador | Completar el perfil de mi organización (logo, colores, descripción) | Tener una identidad de marca en mi microsite |
| ORG-02 | Organizador | Configurar mi microsite público | Que los asistentes tengan una página de referencia de mi organización |
| ORG-03 | Organizador | Agregar colaboradores a mi cuenta | Delegar tareas sin compartir mi contraseña |
| ORG-04 | Organizador | Asignar roles a mis colaboradores (scanner, cajero, admin de evento) | Controlar qué puede hacer cada uno |
| ORG-05 | Super admin | Aprobar o rechazar un nuevo organizador | Controlar quién usa la plataforma |
| ORG-06 | Super admin | Suspender temporalmente un organizador | Detener su actividad ante incumplimientos |

**Brecha pendiente:** ORG-03, ORG-04 — gestión de usuarios staff (Módulo de Personal).

---

### Módulo 4 — Planes y Suscripciones (Billing)

**Estado actual:** ✅ completo para flujo Stripe. Falta UI admin para métodos de pago alternativos.

#### Historias de usuario

| ID | Como... | Quiero... | Para... |
|---|---|---|---|
| PLAN-01 | Organizador | Seleccionar y pagar un plan al registrarme | Activar mi cuenta y comenzar a crear eventos |
| PLAN-02 | Organizador | Ver en qué plan estoy y sus límites | Saber cuándo necesito hacer upgrade |
| PLAN-03 | Organizador | Hacer upgrade a un plan superior | Acceder a más eventos o features |
| PLAN-04 | Organizador | Cancelar mi suscripción cuando quiera | Dejar de ser cobrado |
| PLAN-05 | Super admin | Crear, editar y eliminar planes | Gestionar la oferta comercial |
| PLAN-06 | Super admin | Ver qué organizadores están en cada plan | Tener visibilidad de la distribución de ingresos |

---

### Módulo 5 — Gestión de Eventos

**Estado actual:** ✅ mayormente completo. El EventWizard de 7 pasos cubre creación, galería, venue, media, descuentos y control de acceso. Faltan: agenda, FAQ del evento, reglas/políticas, multi-función y duplicar evento.

#### Historias de usuario

| ID | Como... | Quiero... | Para... | Estado |
|---|---|---|---|---|
| EVT-01 | Organizador | Crear un evento con nombre, descripción, categoría, fecha y ubicación | Tener la información básica publicable | ✅ |
| EVT-02 | Organizador | Subir imagen principal, banner y galería (hasta 10 imágenes con reorder) | Hacer atractiva la página del evento | ✅ |
| EVT-03 | Organizador | Agregar una agenda con bloques de horario | Que los asistentes sepan qué pasará en cada momento | ❌ Fase 8 |
| EVT-04 | Organizador | Agregar reglas y políticas del evento | Informar condiciones de asistencia y reembolso | ❌ Fase 8 |
| EVT-05 | Organizador | Agregar preguntas frecuentes específicas del evento | Reducir consultas repetitivas al organizador | ❌ Fase 11 |
| EVT-06 | Organizador | Publicar o despublicar el evento con un click | Controlar la visibilidad pública | ✅ |
| EVT-07 | Organizador | Crear un evento con múltiples fechas/funciones | Gestionar una obra de teatro, tour o ciclo de conferencias | ❌ Fase 8 |
| EVT-08 | Visitante | Ver la página pública del evento con toda la información | Decidir si asistir y comprar el ticket | ✅ |
| EVT-09 | Organizador | Duplicar un evento existente | Ahorrar tiempo al crear eventos recurrentes similares | ❌ Fase 8 |

**Brechas:** EVT-03 (agenda), EVT-04 (reglas), EVT-07 (multi-función), EVT-09 (duplicar evento) — todas Fase 8. EVT-05 (FAQ evento) — Fase 11.

---

### Módulo 6 — Venue Editor y Escenarios

**Estado actual:** ✅ completo (fases 6a + 6b). Falta: biblioteca de templates predefinidos desde super admin.

#### Historias de usuario

| ID | Como... | Quiero... | Para... |
|---|---|---|---|
| VEN-01 | Organizador | Crear un venue desde cero con el editor visual | Tener el mapa exacto de mi lugar |
| VEN-02 | Organizador | Seleccionar un escenario predefinido de la biblioteca | Ahorrar tiempo si mi lugar es estándar (teatro, auditorio) |
| VEN-03 | Organizador | Definir localidades con colores y precios | Diferenciar zonas de precio (VIP, platea, tribuna) |
| VEN-04 | Organizador | Publicar el venue para vincularlo a eventos | Dejarlo disponible para mi catálogo de eventos |
| VEN-05 | Super admin | Crear y publicar escenarios predefinidos reutilizables | Que los organizadores no tengan que crear desde cero teatros y auditorios comunes |
| VEN-06 | Asistente | Ver el mapa interactivo del venue y seleccionar mi asiento | Elegir mi lugar específico antes de comprar |

**Brecha pendiente:** VEN-02 y VEN-05 — biblioteca de templates desde super admin.

---

### Módulo 7 — Gestión de Entradas (Ticket Types)

**Estado actual:** ⚠️ solo 1 tipo por evento. Promo codes y descuentos automáticos implementados. Multi-tipos es Fase 8.

#### Historias de usuario

| ID | Como... | Quiero... | Para... | Estado |
|---|---|---|---|---|
| TKT-01 | Organizador | Crear múltiples tipos de entrada para un evento (VIP, General, Early Bird) | Segmentar la audiencia y el precio | ❌ Fase 8 |
| TKT-02 | Organizador | Definir stock, precio y ventana de venta por tipo | Controlar disponibilidad de cada categoría | ❌ Fase 8 |
| TKT-03 | Organizador | Crear tipos de entrada gratuitos (lista de invitados) | Gestionar accesos sin cobro | ❌ Fase 8 |
| TKT-04 | Organizador | Configurar un máximo de tickets por comprador por tipo | Evitar la reventa o acaparamiento | ❌ Fase 8 |
| TKT-05 | Organizador | Crear códigos de descuento (promo codes) y descuentos automáticos por cantidad | Ofrecer descuentos segmentados | ✅ |
| TKT-06 | Asistente | Ver todos los tipos disponibles y sus precios antes de comprar | Elegir el que más me conviene | ⚠️ Solo 1 tipo hoy |

**Brecha:** TKT-01 a TKT-04 (multi-tipos, Fase 8).

---

### Módulo 8 — Flujo de Compra (Purchase Flow)

**Estado actual:** ✅ completo para Stripe + manual (transferencia + efectivo) + descuentos + asientos numerados. Faltan métodos LatAm.

#### Historias de usuario

| ID | Como... | Quiero... | Para... | Estado |
|---|---|---|---|---|
| PUR-01 | Asistente | Seleccionar tickets y ver el precio total antes de pagar | No tener sorpresas en el checkout | ✅ |
| PUR-02 | Asistente | Pagar con tarjeta de crédito/débito (Stripe) | Compra instantánea y segura | ✅ |
| PUR-03 | Asistente | Pagar por transferencia bancaria y recibir instrucciones | Comprar si no tengo tarjeta | ✅ |
| PUR-04 | Asistente | Pagar en efectivo y recibir instrucciones de dónde | Comprar en puntos de pago físico | ✅ |
| PUR-05 | Asistente | Aplicar un código de descuento y ver el nuevo total | Aprovechar promociones | ✅ |
| PUR-06 | Asistente | Recibir email con mis tickets (QR + PDF) al confirmar pago | Tener evidencia de mi compra | ✅ |
| PUR-07 | Asistente | Seleccionar asientos específicos en un mapa del venue | Elegir mi lugar exacto | ✅ |
| PUR-08 | Organizador | Confirmar o rechazar un pago manual con un click | Gestionar cobros fuera de Stripe | ✅ |
| PUR-09 | Asistente | Pagar con PayPal | Tener una opción internacional adicional | ❌ Fase 9 |
| PUR-10 | Asistente | Pagar con Kushki (Ecuador) / Wompi (Colombia) / Mercado Pago | Usar el método local más conveniente | ❌ Fase 9 |

**Brechas:** PUR-09, PUR-10 — métodos de pago adicionales (Fase 9).

---

### Módulo 9 — Tickets Digitales y QR

**Estado actual:** ✅ completo.

#### Historias de usuario

| ID | Como... | Quiero... | Para... |
|---|---|---|---|
| QR-01 | Asistente | Recibir mi ticket con código QR por email | Tenerlo listo para el evento |
| QR-02 | Asistente | Descargar mi ticket en PDF | Guardarlo o imprimirlo |
| QR-03 | Asistente | Ver el estado de mi ticket (válido / usado) | Saber si ya fue escaneado |
| QR-04 | Organizador | Reenviar los tickets de una orden al email del comprador | Ayudar si el asistente los perdió |

---

### Módulo 10 — Control de Acceso (Door Validation)

**Estado actual:** ⚠️ funcional (QR scan + input manual + nombre/tipo en pantalla). Faltan: búsqueda por nombre/email, dashboard en tiempo real, reingreso y modo offline.

#### Historias de usuario

| ID | Como... | Quiero... | Para... | Estado |
|---|---|---|---|---|
| ACC-01 | Staff validador | Escanear el QR con la cámara y saber en 1 segundo si es válido | Dar un flujo ágil en la entrada | ✅ |
| ACC-02 | Staff validador | Pegar un código manualmente si la cámara falla | Tener fallback ante problemas técnicos | ✅ |
| ACC-03 | Staff validador | Buscar a un asistente por nombre o email | Ayudar a quien olvidó el ticket | ❌ Fase 8 |
| ACC-04 | Staff validador | Ver en pantalla el nombre del titular y el tipo de ticket | Confirmar la identidad rápidamente | ✅ |
| ACC-05 | Organizador | Ver en tiempo real cuántas personas han ingresado | Monitorear ocupación durante el evento | ❌ Fase 12 |
| ACC-06 | Organizador | Ver ocupación por zona/localidad en tiempo real | Gestionar el aforo por sector | ❌ Fase 12 |
| ACC-07 | Staff validador | Permitir el reingreso de un asistente ya escaneado | Para eventos donde se puede salir y volver | ❌ Fase 12 |
| ACC-08 | Staff validador | Validar entradas sin internet (offline) y sincronizar después | Para venues con conectividad limitada | ❌ Fase 12 |

**Brechas:** ACC-03 (búsqueda) — Fase 8. ACC-05 a ACC-08 — Fase 12.

---

### Módulo 11 — Gestión de Personal (Staff)

**Estado actual:** ❌ no implementado.

#### Historias de usuario

| ID | Como... | Quiero... | Para... |
|---|---|---|---|
| STF-01 | Organizador | Crear cuentas de usuario para mi equipo (validators, cajeros, admins de evento) | No compartir mi contraseña maestra |
| STF-02 | Organizador | Asignar a un staff member a uno o varios eventos específicos | Que solo vea lo que le corresponde |
| STF-03 | Organizador | Definir qué puede hacer cada staff (solo validar QR / solo cobrar / ver ventas) | Tener control granular de permisos |
| STF-04 | Organizador | Desactivar un usuario staff cuando ya no trabaja con nosotros | Revocar acceso inmediatamente |
| STF-05 | Staff | Iniciar sesión con mis credenciales propias | Acceder solo a mis eventos asignados |

---

### Módulo 12 — Dashboard y Reportes del Organizador

**Estado actual:** ✅ KPIs básicos, tabla de órdenes con filtros, CSV export. Faltan: funnel de conversión y analytics por evento (Fase 10).

#### Historias de usuario

| ID | Como... | Quiero... | Para... | Estado |
|---|---|---|---|---|
| RPT-01 | Organizador | Ver cuántos tickets se vendieron hoy/semana/mes | Monitorear el ritmo de ventas | ✅ |
| RPT-02 | Organizador | Ver el revenue total y por evento | Saber cuánto gané | ✅ |
| RPT-03 | Organizador | Ver el funnel de conversión (visitas → clicks → compras) | Identificar dónde pierdo a los compradores | ❌ Fase 10 |
| RPT-04 | Organizador | Exportar la lista de asistentes a CSV | Importarla a otras herramientas | ✅ |
| RPT-05 | Organizador | Ver el desglose de pagos (Stripe / transferencia / efectivo) | Conciliar con mi contabilidad | ✅ |
| RPT-06 | Organizador | Ver cuántos tickets están pendientes de confirmar (manuales) | Gestionar la caja de cobros pendientes | ✅ |

---

### Módulo 13 — Portal del Asistente (Buyer Account)

**Estado actual:** ❌ no existe. Compradores son invitados.

#### Historias de usuario

| ID | Como... | Quiero... | Para... |
|---|---|---|---|
| BUY-01 | Asistente | Registrarme con email y contraseña | Tener una cuenta propia |
| BUY-02 | Asistente | Ver el historial de todas mis compras | Encontrar tickets de eventos pasados y futuros |
| BUY-03 | Asistente | Re-descargar mis tickets desde mi cuenta | No depender del email original |
| BUY-04 | Asistente | Cancelar una compra si el evento lo permite | Gestionar mis planes |

---

### Módulo 14 — Panel Super Admin

**Estado actual:** ✅ mayormente completo — KPIs globales, gestión de organizadores, planes Stripe, auditoría, exports CSV, attention banners. Faltan: gestión de métodos de pago (ADM-03), templates de venue (ADM-04) y snapshots históricos MRR (ADM-07).

#### Historias de usuario

| ID | Como... | Quiero... | Para... | Estado |
|---|---|---|---|---|
| ADM-01 | Super admin | Ver KPIs globales (MRR, GMV, tickets vendidos, nuevos orgs) | Tener el pulso del negocio | ✅ |
| ADM-02 | Super admin | Ver y gestionar todos los organizadores (aprobar, rechazar, suspender) | Controlar quién usa la plataforma | ✅ |
| ADM-03 | Super admin | Configurar los métodos de pago disponibles para los organizadores | Activar Kushki, PayPal, Wompi, etc. por region | ❌ Fase 9 |
| ADM-04 | Super admin | Crear templates de venue reutilizables | Ahorrar tiempo a los organizadores con venues estándar | ❌ Fase 13 |
| ADM-05 | Super admin | Ver el log de auditoría de todas las acciones | Investigar incidentes | ✅ |
| ADM-06 | Super admin | Exportar datos de organizers/events/orders a CSV | Análisis externo y contabilidad | ✅ |
| ADM-07 | Super admin | Ver el historial mensual de MRR y GMV | Evaluar crecimiento real mes a mes | ❌ Fase 10 |

**Brechas:** ADM-03 — Fase 9. ADM-04 — Fase 13. ADM-07 — Fase 10.

---

## 5. Arquitectura Técnica

### 5.1 Diagrama de alto nivel

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTES                                 │
│  Browser (React SPA)    Mobile (Expo RN)    Webhooks (Stripe)   │
└────────────┬──────────────────┬───────────────────┬─────────────┘
             │ HTTPS            │ HTTPS             │ HTTPS
┌────────────▼──────────────────▼───────────────────▼─────────────┐
│                      API GATEWAY / INGRESS                       │
│         Subdominio slug.ajcodelabs.ai → ?tenant=slug             │
│         Rutas: /api/* → FastAPI  |  /* → React SPA               │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      BACKEND (FastAPI)                           │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  Auth    │ │  Events  │ │  Venues  │ │  Orders/Tickets  │  │
│  │  /auth/* │ │  /events │ │ /venues  │ │ /orders /tickets │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Organiz. │ │  Admin   │ │ Billing  │ │   Microsite      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  SERVICES: email · pdf · ticket_jwt · seats · discounts │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
          ┌──────────────────┼─────────────────────┐
          │                  │                      │
┌─────────▼──────┐  ┌────────▼──────┐   ┌──────────▼──────┐
│  PostgreSQL 16 │  │   Stripe API  │   │   Resend API    │
│ (SQLAlchemy    │  │  (pagos)      │   │  (email)        │
│  async + asyncpg│ └───────────────┘   └─────────────────┘
│  + Alembic)    │
└────────────────┘
```

### 5.2 Frontend (React SPA)

| Tecnología | Uso |
|---|---|
| React 19 + React Router v7 | SPA con routing client-side |
| Vite 6 + TypeScript | Build y dev server; alias `@` → `src/` |
| Tailwind CSS + shadcn/ui | Sistema de diseño (Radix primitives) |
| react-konva + konva | Editor de venues (canvas 2D) |
| Axios | Cliente HTTP con interceptores JWT |
| TanStack Query v5 | Data fetching, caché y sincronización |
| TanStack Table v8 | Tablas con ordenamiento, filtros y paginación |
| react-hook-form + zod | Formularios con validación |
| @dnd-kit | Drag & drop (galería, reordenamiento) |
| Tiptap | Editor de texto enriquecido (descripciones) |
| Recharts | Gráficas de dashboard |
| Sonner | Toasts |
| html5-qrcode | Scanner QR en browser |
| qrcode.react | Generación de QR en cliente |
| next-themes | Soporte dark/light mode |
| Vitest + jsdom | Tests unitarios |

**Estructura de rutas:**
- `/` — público (landing, microsite, evento público, órdenes)
- `/app/*` — panel organizador (requiere `role=organizer`)
- `/admin/*` — panel super admin (requiere `role=super_admin`)

**Gestión de auth:** Bearer token en localStorage + interceptor Axios. Refresh automático vía cookie como fallback.

### 5.3 Backend (FastAPI)

| Tecnología | Uso |
|---|---|
| FastAPI 0.110 + uvicorn | API REST async |
| SQLAlchemy 2 async + asyncpg | ORM async para PostgreSQL |
| Alembic | Migraciones de esquema |
| Pydantic v2 | Validación de modelos (`ConfigDict(extra="ignore")`) |
| PyJWT + bcrypt | Autenticación JWT HS256 + hashing |
| Stripe SDK v15 | Pagos con tarjeta |
| ReportLab | Generación de PDFs de tickets |
| Resend | Emails transaccionales |
| python-dotenv | Configuración por entorno |
| pytest | Tests de integración (requieren backend + PostgreSQL activos) |

**Convenciones de routers:**
```
/api/events/me/*        → organizer (auth requerida)
/api/public/events/*    → público (sin auth)
/api/admin/events/*     → super_admin
/api/events/assets/*    → servicio de archivos estáticos
```

**Regla de aislamiento:** los routers del organizador siempre derivan el `organizer_id` del JWT, nunca del body ni de query params.

### 5.4 Base de Datos (PostgreSQL 16)

El esquema lo gestiona Alembic. Los modelos ORM viven en `backend/orm_models.py`. Las migraciones en `backend/alembic/versions/`.

| Tabla | Descripción |
|---|---|
| `users` | Cuentas de usuario (email, password_hash, role) |
| `organizers` | Perfiles de organizador (status, plan, slug único, docs) |
| `tenants` | Slugs y configuración de multi-tenancy |
| `subscription_plans` | Planes del catálogo global |
| `organizer_subscriptions` | Suscripciones activas por organizer |
| `events` | Eventos (JSONB para galería, configuración de pago) |
| `venues` | Venues con elementos Konva en JSONB |
| `orders` | Órdenes de compra (status, payment_method, discounts) |
| `tickets` | Tickets emitidos con JWT payload |
| `ticket_reservations` | Reservas temporales con TTL (15 min Stripe, 48 h manual) |
| `audit_log` | Log de acciones del super admin |
| `activation_tokens` | Tokens del funnel de activación |
| `discount_codes` | Promo codes y reglas de descuento automáticas |
| `microsite_config` | Configuración de branding del microsite por organizer |

**IDs:** UUID v4 almacenado como `String(36)` — contratos de API sin cambios frente a una futura migración a UUID nativo.

**Números de orden:** secuencia PostgreSQL `ticket_order_seq`, formateados como `TYS-XXXXXX`.

**Índices críticos:** `events.organizer_id`, `orders.event_id`, `tickets.order_id`, `organizers.slug` (unique), `users.email` (unique).

**Flujo de sesión:** `AsyncSession = Depends(get_db)` — auto-commit en éxito, rollback en excepción. Convertir fila ORM a dict con `row_to_dict(row)` antes de parsear con Pydantic.

### 5.5 Mobile (Expo React Native)

Principalmente para escaneo QR en puerta. Usa Expo Router con file-based routing. Se comunica con el mismo backend via `EXPO_PUBLIC_BACKEND_URL`.

En el futuro podría expandirse a: app del asistente, app del organizador mobile.

---

## 6. Integraciones de Pago

### 6.1 Estado actual

| Método | Estado | Notas |
|---|---|---|
| Stripe (tarjeta) | ✅ | Checkout redirect + webhook |
| Transferencia bancaria | ✅ | Manual: organizador confirma manualmente |
| Efectivo | ✅ | Manual: organizador confirma manualmente |

### 6.2 Integraciones planificadas

El modelo de integración de pagos debe ser **configurable por super admin**: cada método tiene credenciales propias y se activa/desactiva por plataforma o por plan.

#### Prioridad 1 — Ampliar cobertura en LatAm

| Proveedor | Mercado | Método | Prioridad |
|---|---|---|---|
| **Kushki** | Ecuador, Colombia, México, Chile | Tarjeta, PSE, transferencia | 🔴 Alta — mercado principal |
| **PayPal** | Internacional | Tarjeta, balance PayPal | 🔴 Alta — muy solicitado |
| **Mercado Pago** | Argentina, Colombia, Chile, México, Brasil, Perú, Uruguay | Tarjeta, efectivo, transferencia | 🟡 Media |
| **Wompi** | Colombia | Tarjeta, PSE, Bancolombia, nequi | 🟡 Media |
| **PayU** | Colombia, México, Perú, Chile, Argentina, Panamá | Tarjeta, PSE, efectivo | 🟡 Media |

#### Prioridad 2 — Cobertura extendida

| Proveedor | Mercado | Método |
|---|---|---|
| **dLocal** | LatAm general | Agregador regional |
| **Conekta** | México | Tarjeta, OXXO, SPEI |
| **Placetopay / ePayco** | Colombia | Tarjeta, PSE |
| **Clip** | México | POS físico |

### 6.3 Arquitectura de la integración de pagos

```
┌─────────────────────────────────────────────────────────┐
│              payment_providers (tabla PostgreSQL)        │
│  { id, name, type: "stripe|kushki|mercadopago|...",     │
│    active, regions, config_schema, credentials_enc }    │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              payment_gateway (service)                   │
│  .createCheckout(provider, order) → {url, session_id}  │
│  .handleWebhook(provider, payload) → finalize_order    │
│  .refund(provider, transaction_id)                     │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼──────────────────┐
    StripeAdapter   KushkiAdapter   MercadoPagoAdapter ...
```

Cada adapter implementa la misma interfaz: `create_session`, `verify_webhook`, `refund`. El backend orquesta sin conocer el proveedor específico.

### 6.4 Flujo general de pago

```
Buyer selecciona tickets
        ↓
POST /public/orders/preview  (calcular totales + descuentos)
        ↓
POST /public/orders          (crear orden reservando capacidad)
        ↓
  ┌─────────────────────────────────────────────────────┐
  │ payment_method                                       │
  │  stripe / kushki / mercadopago → redirect checkout  │
  │  paypal                         → redirect paypal   │
  │  transfer / cash                → instrucciones UI  │
  └─────────────────────────────────────────────────────┘
        ↓
  Webhook recibido (stripe/kushki/mp) o confirmación manual
        ↓
  finalize_paid_order → emit tickets → send email PDF (según delivery_mode)
```

### 6.5 Flujo de compra actualizado (con Guest Mode y retry)

```
Comprador llega a la página del evento
        ↓
Selecciona FUNCIÓN (si el evento tiene multi-función)
        ↓
Selecciona ASIENTOS / cantidad de tickets
  └── El precio se determina por la localidad del asiento (VIP, General, etc.)
  └── Respeta límite máximo por comprador (configurable por super admin / organizador)
        ↓
Formulario GUEST: nombre + email (sin contraseña)
  └── Se crea una "orden de invitado" vinculada al email
        ↓
Selecciona método de pago
        ↓
  ┌─────────────────────────────────────────────────────┐
  │ Stripe → redirect checkout (Stripe maneja reintentos│
  │          dentro de su página)                       │
  │                                                     │
  │ Si el pago falla al regresar a TYS:                 │
  │   → /checkout/resultado?order_id=...&status=failed  │
  │   → UI muestra error + opciones:                    │
  │       [Reintentar con tarjeta]  → mismo order       │
  │       [Pagar por transferencia] → cambia método     │
  │       [Cancelar] → orden expira en TTL              │
  │                                                     │
  │ Transferencia / Efectivo → instrucciones UI         │
  └─────────────────────────────────────────────────────┘
        ↓
  Webhook OK o confirmación manual
        ↓
  finalize_paid_order → reservar asientos definitivamente
        ↓
  Email de CONFIRMACIÓN (sin eTicket, solo resumen + link de orden)
  El link de orden contiene: estado, detalle, QR accesible con token seguro
        ↓
  eTicket (QR + PDF) se envía según DELIVERY MODE del evento:
    - al_momento       → inmediatamente (congreso, print-at-home)
    - horas_antes      → X horas antes de la función (configurable)
    - fecha_especifica → fecha/hora exacta configurada por organizador
    - manual           → organizador hace clic "Enviar tickets ahora"
```

### 6.6 Link seguro de orden (Guest Order Token)

El comprador NO necesita crear cuenta para acceder a su orden. El sistema genera un **UUID v4 unguessable** (`order_token`) almacenado en la orden.

- El email de confirmación incluye `https://tys.app/orden/{order_token}`
- El token no expira hasta 30 días después de la fecha del evento
- La página muestra: detalle de la orden, QR(s), estado de entrega del eTicket
- Si el comprador pierde el email: puede ir a `/orden/reenviar`, ingresar su email y se le envía un nuevo link (no expone si el email existe o no — siempre dice "si tienes órdenes, te las enviamos")
- Fase 11: al crear cuenta con el mismo email, las órdenes anteriores se asocian automáticamente

---

## 7. MVP vs Fases Posteriores

### MVP — Lo que hace el producto viable hoy ✅

> Todo esto está **implementado y funcionando**.

- Landing con planes y registro de organizadores
- Auth completo (JWT, roles, onboarding con approval)
- Microsite por organizador (branding, logo, colores)
- Crear y publicar eventos (datos básicos, imágenes, fechas)
- Venue editor visual con localidades y precios
- Venta de tickets con Stripe (redirect checkout)
- Pago manual: transferencia y efectivo
- Descuentos: promo codes y reglas automáticas
- Tickets digitales: QR + PDF + email
- Validación QR en puerta (browser + mobile)
- Dashboard básico del organizador (ventas, órdenes)
- Panel super admin completo (KPIs, gestión, auditoría, exports)

---

### Fase 8 — Multi-tickets, Multi-función, Staff, Guest Mode (P1)

> Desbloquea casos de uso críticos que hoy bloquean ventas reales.

#### 8A — Guest Mode (comprador identificado sin cuenta)

| Decisión | Detalle |
|---|---|
| El comprador provee nombre + email antes del pago | Sin contraseña. Sin cuenta. |
| Se crea `order_token` UUID v4 | Link único e inacabable para ver la orden |
| Email de confirmación sin eTicket | Solo resumen + link de orden seguro |
| eTicket se envía según `delivery_mode` del evento | Ver sección 6.5 |
| Reenvío de link por email sin revelar existencia | Siempre responde "si tienes órdenes, te las enviamos" |
| Social login (Google/Facebook/Apple) | ❌ Fase 11 (para cuentas de asistente completas) |

#### 8B — eTicket Delivery Mode

Campo `ticket_delivery_mode` en el evento, configurable por el organizador:

| Modo | Comportamiento |
|---|---|
| `al_momento` | QR+PDF enviado al confirmar el pago. Para congresos y print-at-home. |
| `horas_antes` | Job envía X horas antes de la función. `ticket_delivery_hours` configurable. |
| `fecha_especifica` | Job envía en `ticket_delivery_at` (datetime). |
| `manual` | Organizador pulsa "Enviar tickets ahora" desde el panel. |

El QR siempre es accesible desde el link de la orden, independientemente del modo.

#### 8C — Multi Ticket Types

| Decisión | Detalle |
|---|---|
| Múltiples tipos por evento | VIP, General, Early Bird, Lista de invitados, etc. |
| El precio viene de la localidad del venue | El comprador elige asiento → la localidad determina el tipo y precio |
| Se pueden mezclar tipos en una orden | Ej: 2 asientos VIP + 1 General en un solo checkout |
| Límite máximo por comprador | Configurable en 3 niveles: plataforma (super admin) → organizer → evento |
| Early Bird | Configurable por fecha de cierre **y/o** por cupo máximo (se cierra lo primero que ocurra) |
| Ventana de venta por tipo | Fecha de apertura y cierre por tipo de ticket |

#### 8D — Multi-función

| Decisión | Detalle |
|---|---|
| Flujo de compra | Evento → **Función** → Asiento → Checkout |
| Precios por función | Configurables independientemente (el organizador decide si varían) |
| Venue por función | Cada función puede tener un venue distinto |
| Stock por función | Independiente por función y por tipo de ticket |
| Funciones en el EventWizard | Nueva pestaña "Funciones" reemplaza la fecha única actual |

#### 8E — Gestión de Staff

| Decisión | Detalle |
|---|---|
| Creación | Organizador asigna email + contraseña directamente (sin email de invitación) |
| Roles (multi-selección) | `scanner` (validar QR), `cajero` (cobrar en caja), `admin_evento` (ver ventas de sus eventos) |
| Asignación a eventos | Staff puede estar asignado a múltiples eventos |
| Selección de evento en login | Al iniciar sesión, el staff ve un selector de "¿En qué evento trabajas hoy?" antes de cualquier acción |
| Visibilidad de datos | `scanner`: solo validación. `cajero`: cobros + confirmación manual. `admin_evento`: dashboard de ventas de sus eventos asignados. |
| Desactivación | Organizador puede suspender el acceso inmediatamente |

#### 8F — Otras features de Fase 8

| Feature | Descripción |
|---|---|
| **Retry de pago fallido** | Retorno desde Stripe con error → pantalla con opciones de reintento o cambio de método |
| **Agenda del evento** | Bloques de horario (hora inicio, hora fin, título, descripción opcional) en la página pública |
| **Reglas y políticas** | Campo de texto enriquecido (Tiptap) en el evento; visible en la página pública |
| **Búsqueda en puerta** | Buscar asistente por nombre, email o número de orden desde la pantalla de validación |
| **Duplicar evento** | Copia datos básicos, tipos de ticket y funciones. El organizador ajusta fechas y publica |
| **Límite de promo code por comprador** | Campo `max_per_buyer` en el código de descuento; se valida contra el email del guest |

---

### Fase 9 — Métodos de Pago Adicionales (P1)

| Feature | Descripción |
|---|---|
| **Kushki** | Ecuador y Colombia — tarjeta local, transferencia, PSE |
| **PayPal** | Internacional — tarjeta y balance PayPal |
| **Mercado Pago** | LatAm — tarjeta, efectivo, QR, transferencia |
| **UI admin para métodos** | Panel de super admin para configurar credenciales y activar/desactivar por region |
| **Wompi** | Colombia — tarjeta, PSE, Bancolombia, Nequi |

---

### Fase 10 — Analytics Histórico y Snapshots (P2)

| Feature | Descripción |
|---|---|
| **Snapshots MRR mensuales** | Job nocturno que persiste KPIs. Habilita delta % real |
| **Churn tracking** | Organizadores que cancelaron su suscripción |
| **Cohorts** | Retención de organizadores por mes de registro |
| **Funnel de conversión por evento** | Visitas → clicks en "Comprar" → inicio de pago → pago completado |
| **Reporte de capacidad** | % de ocupación por evento y por zona |

---

### Fase 11 — Portal del Asistente y Experiencia Post-Compra (P2)

| Feature | Descripción |
|---|---|
| **Cuenta de asistente** | Registro con email+contraseña. Las órdenes de guest con el mismo email se asocian automáticamente. |
| **Social login** | Google, Facebook y Apple — para compradores. Para organizadores: evaluar en esta misma fase. |
| **Re-descarga de tickets** | Desde portal propio; no depende del email original ni del order_token. |
| **FAQ en landing y eventos** | Acordeón configurable por organizador en la página del evento. |
| **Cancelación de compra** | Según política de reembolso configurada por el organizador en el evento. |
| **Reseñas post-evento** | Rating y comentario del asistente después del evento. |

---

### Fase 12 — Control de Acceso Avanzado (P3)

| Feature | Descripción |
|---|---|
| **Dashboard en tiempo real** | Ocupación total y por zona en vivo (WebSocket o polling) |
| **Control de reingreso** | Permitir que un ticket ya escaneado se re-valide (configurable) |
| **Operación offline** | Service Worker + SQLite local + sincronización posterior |
| **Búsqueda manual avanzada** | Por nombre, email, número de orden, teléfono |
| **Venta en caja** | Interfaz de punto de venta físico para cobrar en efectivo en el evento |

---

### Fase 13 — Integraciones y Ecosystem (P3 / Opcionales FRD)

| Feature | Descripción |
|---|---|
| **Biblioteca de escenarios** | Super admin crea templates reutilizables (Teatro Nacional, Auditorio típico) |
| **Integración marketing email** | Mailchimp, SendGrid — listas de asistentes automáticas |
| **Integración WhatsApp** | Envío de tickets y recordatorios por WhatsApp Business |
| **Facturación electrónica** | Emisión de facturas SRI (Ecuador) al confirmar compra |
| **Programa de afiliados** | Links de referido con comisión por venta |
| **Venta de productos adicionales** | Merchandise, F&B, estacionamiento dentro del flujo de compra |
| **Streaming** | Evento híbrido con link de acceso digital como "ticket" |
| **App mobile organizador** | Gestión desde móvil (Expo — extensión del proyecto actual) |
| **Analytics avanzada** | Dashboards con comportamiento de audiencia, mapa de calor de asientos |

---

## 8. Criterios de Aceptación por Módulo

### Guest Mode (Fase 8A)

**Dado que** soy un visitante sin cuenta,  
**cuando** completo la compra con mi nombre y email,  
**entonces** recibo un email de confirmación con un link único (`/orden/{token}`) que muestra mi orden y el QR, sin necesidad de login.

**Dado que** perdí el email de confirmación,  
**cuando** voy a `/orden/reenviar` e ingreso mi email,  
**entonces** recibo un nuevo link — el sistema no revela si el email tiene órdenes o no.

### eTicket Delivery (Fase 8B)

**Dado que** soy organizador y configuré mi evento en modo `horas_antes` con 24 horas,  
**cuando** se confirma un pago,  
**entonces** el email de confirmación llega inmediatamente sin eTicket, y el QR+PDF se envía exactamente 24 horas antes de la hora de la función.

**Dado que** el organizador cambia el modo a `manual`,  
**cuando** el organizador hace clic en "Enviar tickets ahora",  
**entonces** todos los compradores confirmados de esa función reciben el email con QR+PDF en ese momento.

### Multi Ticket Types (Fase 8C)

**Dado que** un venue tiene Sector VIP (precio $80) y Platea General (precio $30),  
**cuando** el comprador selecciona 1 asiento VIP y 2 de Platea en una sola orden,  
**entonces** el total es $140 y cada ticket lleva el tipo y precio correcto.

**Dado que** hay un Early Bird con cupo máximo 50 y fecha límite 2026-08-01,  
**cuando** se vende el ticket 50 o se pasa la fecha (lo que ocurra primero),  
**entonces** el tipo Early Bird desaparece del checkout y no puede seleccionarse.

### Multi-función (Fase 8D)

**Dado que** soy organizador con plan Profesional y creo un evento con 3 funciones (vie 20h / sáb 18h / sáb 21h), cada una con su venue y precios,  
**cuando** un visitante abre la página del evento,  
**entonces** ve un selector de función; al elegir una, se carga el mapa del venue correspondiente y los precios de esa función.

### Gestión de Staff (Fase 8E)

**Dado que** soy organizador y creo un staff con rol `scanner` asignado al Evento A,  
**cuando** ese usuario inicia sesión,  
**entonces** ve un selector "¿En qué evento trabajas hoy?" que muestra solo Evento A; al seleccionarlo entra directamente a la pantalla de validación QR sin ver dashboard ni configuración.

**Dado que** creo un staff con roles `scanner` + `cajero`,  
**entonces** puede validar QR Y confirmar pagos manuales, pero no ve el dashboard de ventas ni configuración del organizador.

### Búsqueda en puerta (Fase 8F)

**Dado que** un asistente llegó sin QR,  
**cuando** el staff escribe su nombre o email en el buscador de la pantalla de validación,  
**entonces** aparece la orden con su estado (válido/usado/pendiente) y el staff puede marcarla como ingresada.

### Kushki (Fase 9)

**Dado que** soy asistente en Ecuador,  
**cuando** selecciono "Tarjeta (Kushki)" en el checkout,  
**entonces** soy redirigido al iframe de Kushki, pago con mi tarjeta, y al confirmar recibo el email de confirmación (eTicket según delivery_mode).

---

## 9. Requerimientos No Funcionales

| Atributo | Requerimiento | Estado actual |
|---|---|---|
| **Seguridad** | JWT HS256, bcrypt, HTTPS, sin `_id` expuesto | ✅ |
| **Multi-tenancy** | Aislamiento total por organizer_id en todos los queries | ✅ |
| **Rendimiento** | Dashboard stats < 500ms (queries SQL con índices) | ✅ |
| **Escalabilidad** | Sin estado en backend (tokens en cliente). PostgreSQL escalable verticalmente; arquitectura lista para réplicas de lectura | ✅ arquitectura |
| **Disponibilidad** | 99.9% — depende del proveedor de hosting | N/A |
| **Auditoría** | Registro de todas las acciones admin en `audit_log` | ✅ |
| **Concurrencia** | Reserva de asientos con transacciones atómicas (TTL 15min) | ✅ |
| **Idempotencia** | Finalización de pago idempotente (no duplica tickets) | ✅ |
| **Offline (futuro)** | Service Worker para validación QR sin internet | ❌ Fase 12 |
| **Mobile** | Responsive web + app Expo para validación | ✅ básico |

---

## 10. Glosario

| Término | Definición |
|---|---|
| **Tenant** | Una organización/empresa en la plataforma, identificada por su slug |
| **Organizer** | Usuario dueño de un tenant, con cuenta de pago |
| **Staff** | Usuario colaborador dentro de un tenant, con permisos limitados |
| **Venue** | Recinto/escenario configurado visualmente con zonas y asientos |
| **Locality** | Zona dentro de un venue (Platea, VIP, Tribuna) con precio propio |
| **Función** | Fecha/horario específico dentro de un evento multi-función |
| **Ticket type** | Tipo de entrada (General, VIP, Early Bird) dentro de un evento |
| **Order** | Transacción de compra de uno o más tickets |
| **GMV** | Gross Merchandise Value — valor total de ventas brutas |
| **MRR** | Monthly Recurring Revenue — ingresos mensuales recurrentes por suscripciones |
| **Promo code** | Código de descuento creado por el organizador, con cuota y ventana de validez |
