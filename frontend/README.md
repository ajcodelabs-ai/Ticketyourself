# TYS Frontend

SPA React 19 con Vite. Interfaz en español (Ecuador), USD.

## Requisitos

- Node.js 18+
- Yarn 1.x
- Backend TYS corriendo (ver [../backend/README.md](../backend/README.md))

## Instalación y arranque

```bash
cd frontend
yarn install

# Variables de entorno
echo "VITE_BACKEND_URL=http://localhost:8000" > .env

yarn start    # http://localhost:3000
```

## Variables de entorno (`frontend/.env`)

```env
# URL base del backend (sin barra al final)
VITE_BACKEND_URL=http://localhost:8000
```

## Comandos disponibles

```bash
yarn start        # servidor de desarrollo (hot-reload)
yarn build        # build de producción en /dist
yarn test         # Vitest (run once)
yarn test:watch   # Vitest (watch mode)
```

## Estructura del frontend

El SPA agrupa **cuatro zonas de producto** en un solo repo, con carpetas por dominio y lazy loading por ruta:

```
src/
├── App.tsx                 # Shell: providers + router
├── routes/
│   ├── AppRoutes.tsx       # Definición de rutas
│   ├── lazyPages.ts        # React.lazy() por zona
│   ├── LazyPage.tsx        # Wrapper Suspense + fallback
│   └── layouts.tsx         # PublicLayout / OrganizerLayout / AdminLayout
├── pages/
│   ├── marketing/          # Landing, login, registro          → /
│   ├── public/             # Microsite, evento, órdenes        → /o/:slug/*
│   ├── organizer/          # Panel del organizador             → /app/*
│   │   └── events/
│   ├── admin/              # Super admin                       → /admin/*
│   └── legacy/             # POC antiguo                       → /poc/*
├── components/             # UI compartida (shadcn, venues, events, orders)
├── contexts/               # AuthContext, TenantContext
└── lib/                    # api, events, venues, orders, etc.
```

### Code splitting

Cada zona se carga bajo demanda con `React.lazy()` + `Suspense`. Vite genera chunks nombrados:

| Chunk | Contenido |
|-------|-----------|
| `pages-marketing` | Landing, auth, registro |
| `pages-public` | Microsite, evento público, flujo de órdenes |
| `pages-organizer` | Dashboard, eventos, venues, validación QR |
| `pages-admin` | Panel super admin |
| `pages-legacy` | Rutas POC (`/poc/*`) |
| `vendor-konva` | Editor de venues (solo carga en `/app/venues/:id/editor`) |
| `vendor-recharts` | Gráficas de dashboard |
| `vendor-qrcode` | Scanner QR en validación |

Para añadir una página nueva:

1. Crear el componente en la carpeta de zona correcta (`pages/organizer/…`, etc.).
2. Registrar el `lazy()` en `routes/lazyPages.ts`.
3. Añadir la ruta en `routes/AppRoutes.tsx`.

## Áreas de la aplicación

| Ruta | Descripción |
|------|-------------|
| `/` | Landing pública |
| `/login` | Inicio de sesión |
| `/registro` | Registro de nuevo organizador |
| `/o/:slug` | Microsite público del organizador |
| `/o/:slug/e/:event_slug` | Página pública de evento |
| `/app/*` | Panel del organizador (requiere auth) |
| `/admin/*` | Panel super-admin (requiere rol `super_admin`) |

### Panel Organizador (`/app`)

- **Dashboard** — resumen de ventas y eventos activos
- **Eventos** — listado, creación (wizard 7 pasos), edición, estadísticas
- **Venues** — editor de recintos con Konva (escenarios, zonas, filas, asientos numerados)
- **Validación QR** — escaneo de tickets en puerta
- **Configuración** — datos del organizador y microsite

### Panel Super-Admin (`/admin`)

- Dashboard global con métricas cross-tenant
- Gestión de organizadores (aprobar, rechazar, suspender)
- Gestión de planes y suscripciones
- Auditoría de acciones
- Reportes y exports

## Arquitectura del cliente

**Routing:** `routes/AppRoutes.tsx` define todas las rutas. `App.tsx` solo monta providers y el router.

**Lazy loading:** `routes/lazyPages.ts` centraliza los imports dinámicos. `LazyPage` envuelve cada página en `<Suspense>` con un spinner compartido (`components/PageLoader.tsx`).

**Cliente HTTP:** `src/lib/api.ts` — Axios con interceptor que inyecta `Authorization: Bearer <token>` en cada request y emite `tys:unauthorized` ante 401.

**Tokens:** guardados en `localStorage` (`tys_access_token` / `tys_refresh_token`). No se usa `credentials: true` porque el ingress de la plataforma fuerza `Access-Control-Allow-Origin: *`.

**Contextos globales:**
- `AuthContext` — sesión actual (user + organizer), check al montar, escucha `tys:unauthorized`
- `TenantContext` — slug del tenant activo; prioridad: `?tenant=` param → `localStorage` → `"demo-org"`

**Alias de paths:** `@/` apunta a `src/` (configurado en `vite.config.ts`).

## Stack UI

- **shadcn/ui** — componentes accesibles sobre Radix UI primitives
- **Tailwind CSS** — utilidades de estilo
- **TanStack Query** — cache y fetching de datos del API
- **TanStack Table** — tablas con columnas tipadas (admin)
- **TipTap** — editor rich text (políticas, FAQ)
- **react-dropzone** — upload drag & drop de imágenes
- **@dnd-kit** — reordenar galería en el wizard
- **Sonner** — toasts
- **Recharts** — gráficas de ventas y dashboard
- **react-konva** — canvas para el editor de venues
- **react-hook-form + zod** — formularios con validación
- **react-router-dom v7** — routing

## Flujo de compra

1. Comprador elige tickets en la página pública del evento (`EventPublic`)
2. `PurchaseModal` crea una orden vía `POST /api/orders`
3. Redirige a Stripe Checkout o muestra instrucciones de pago manual
4. Webhook de Stripe (o confirmación manual del organizador) activa la emisión de tickets
5. Comprador recibe email con PDF y QR firmado
