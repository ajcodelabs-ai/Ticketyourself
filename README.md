# Ticket Yourself (TYS)

Plataforma SaaS de ticketing multi-tenant: eventos, venta de entradas (Stripe, transferencia, efectivo), venues con asientos numerados y validación QR.

## Contenido

1. [Inicio en 2 minutos](#inicio-en-2-minutos)
2. [Servicios, URLs y demos](#servicios-urls-y-demos)
3. [Desarrollo](#desarrollo)
   - [Base de datos local](#base-de-datos-local)
4. [Arquitectura](#arquitectura)
5. [Documentación adicional](#documentación-adicional)

---

## Inicio en 2 minutos

**Requisitos:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) y `make`.

```bash
make up      # crea .env, levanta PostgreSQL + backend + frontend
make logs    # opcional — ver arranque y migraciones
```


| Qué     | Dónde                                                            |
| ------- | ---------------------------------------------------------------- |
| App web | [http://localhost:3000](http://localhost:3000)                   |
| API     | [http://localhost:8000](http://localhost:8000)                   |
| Swagger | [http://localhost:8000/api/docs](http://localhost:8000/api/docs) |


Datos demo se cargan solos al arrancar el backend. Para probar sin login: [concierto demo](http://localhost:3000/o/demo-org/e/concierto-acustico-demo).  
Credenciales y URLs por rol → [Servicios, URLs y demos](#servicios-urls-y-demos).

```bash
make down    # detener
make clean   # detener + borrar volúmenes (reset DB)
```

---

## Servicios, URLs y demos

Base local: **web** `http://localhost:3000` · **API** `http://localhost:8000`

### Infraestructura


| Servicio                                  | URL                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Frontend (Vite; nginx con `make prod-up`) | [http://localhost:3000](http://localhost:3000)                       |
| Backend API                               | [http://localhost:8000](http://localhost:8000)                       |
| Swagger                                   | [http://localhost:8000/api/docs](http://localhost:8000/api/docs)     |
| Health                                    | [http://localhost:8000/api/health](http://localhost:8000/api/health) |
| PostgreSQL                                | `postgresql://tys:tys_dev@localhost:5432/tys_dev`                    |


### Guía rápida por rol


| Quiero…                    | URL                                                                                                                      | Login                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Comprar entradas (público) | [http://localhost:3000/o/demo-org/e/concierto-acustico-demo](http://localhost:3000/o/demo-org/e/concierto-acustico-demo) | —                           |
| Panel organizador          | [http://localhost:3000/app/dashboard](http://localhost:3000/app/dashboard)                                               | `demo@ticketyourself.com`   |
| Validar QR en puerta       | [http://localhost:3000/app/eventos/{event_id}/validacion](http://localhost:3000/app/eventos/{event_id}/validacion)       | `demo@ticketyourself.com`   |
| Super admin                | [http://localhost:3000/admin/organizadores](http://localhost:3000/admin/organizadores)                                   | `admin@ticketyourself.com`  |
| Registro (elegir plan)     | [http://localhost:3000/registro](http://localhost:3000/registro)                                                         | —                           |
| Onboarding pendiente       | [http://localhost:3000/onboarding](http://localhost:3000/onboarding)                                                     | `prueba@ticketyourself.com` |


> `{event_id}`: ábrelo en el panel en **Eventos** y míralo en la URL del navegador.

### Credenciales demo

Se insertan al arrancar el backend (seeds idempotentes).


| Rol                   | Email                          | Password        | Notas                                         |
| --------------------- | ------------------------------ | --------------- | --------------------------------------------- |
| Super admin           | `admin@ticketyourself.com`     | `Admin123!`     | Override con `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| Organizador aprobado  | `demo@ticketyourself.com`      | `Organizer123!` | Tenant `demo-org`                             |
| Organizador pendiente | `prueba@ticketyourself.com`    | `Organizer123!` | Flujo onboarding                              |
| Organizador rechazado | `rechazado@ticketyourself.com` | `Organizer123!` | Dashboard bloqueado                           |


### URLs por zona

**Marketing** (sin login)


| Uso              | URL                                                              |
| ---------------- | ---------------------------------------------------------------- |
| Landing producto | [http://localhost:3000/](http://localhost:3000/)                 |
| Login            | [http://localhost:3000/login](http://localhost:3000/login)       |
| Registro + plan  | [http://localhost:3000/registro](http://localhost:3000/registro) |
| Planes (ancla)   | [http://localhost:3000/#planes](http://localhost:3000/#planes)   |




**Super admin** — `admin@ticketyourself.com`


| Uso           | URL                                                                                    |
| ------------- | -------------------------------------------------------------------------------------- |
| Dashboard     | [http://localhost:3000/admin](http://localhost:3000/admin)                             |
| Organizadores | [http://localhost:3000/admin/organizadores](http://localhost:3000/admin/organizadores) |
| Planes        | [http://localhost:3000/admin/planes](http://localhost:3000/admin/planes)               |
| Funnel        | [http://localhost:3000/admin/funnel](http://localhost:3000/admin/funnel)               |
| Eventos       | [http://localhost:3000/admin/eventos](http://localhost:3000/admin/eventos)             |
| Auditoría     | [http://localhost:3000/admin/auditoria](http://localhost:3000/admin/auditoria)         |
| Reportes      | [http://localhost:3000/admin/reportes](http://localhost:3000/admin/reportes)           |




**Organizador / staff** — `demo@ticketyourself.com`


| Uso           | URL                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Dashboard     | [http://localhost:3000/app/dashboard](http://localhost:3000/app/dashboard)                                         |
| Eventos       | [http://localhost:3000/app/eventos](http://localhost:3000/app/eventos)                                             |
| Nuevo evento  | [http://localhost:3000/app/eventos/nuevo](http://localhost:3000/app/eventos/nuevo)                                 |
| Venues        | [http://localhost:3000/app/venues](http://localhost:3000/app/venues)                                               |
| Microsite     | [http://localhost:3000/app/microsite](http://localhost:3000/app/microsite)                                         |
| Configuración | [http://localhost:3000/app/configuracion](http://localhost:3000/app/configuracion)                                 |
| Validación QR | [http://localhost:3000/app/eventos/{event_id}/validacion](http://localhost:3000/app/eventos/{event_id}/validacion) |




**Público / venta** — tenant `demo-org`


| Uso                | URL                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Microsite          | [http://localhost:3000/o/demo-org](http://localhost:3000/o/demo-org)                                                                   |
| Concierto demo     | [http://localhost:3000/o/demo-org/e/concierto-acustico-demo](http://localhost:3000/o/demo-org/e/concierto-acustico-demo)               |
| Asientos numerados | [http://localhost:3000/o/demo-org/e/funcion-especial-demo-numerado](http://localhost:3000/o/demo-org/e/funcion-especial-demo-numerado) |
| Preview venue      | [http://localhost:3000/o/demo-org/venues/teatro-demo/preview](http://localhost:3000/o/demo-org/venues/teatro-demo/preview)             |




**Mobile** (escáner QR, opcional)

Ver [mobile/](mobile/). Variable `EXPO_PUBLIC_BACKEND_URL=http://localhost:8000` (usa IP LAN en dispositivo físico).



---

## Desarrollo

### Docker + Make (recomendado)

El stack de desarrollo monta `backend/` y `frontend/` con hot-reload, ejecuta **Alembic** al arrancar y persiste uploads en volúmenes Docker.

**Variables de entorno** — archivos activos (no se commitean):


| Entorno             | Archivo         | Plantilla                    | Comando                                                           |
| ------------------- | --------------- | ---------------------------- | ----------------------------------------------------------------- |
| Docker dev          | `.env`          | `.env.example.local`         | `make env-local` (auto con `make up`)                             |
| Docker prod local   | `.env.prod`     | `.env.example.prod`          | `make env-prod` (auto con `make prod-up`)                         |
| Backend sin Docker  | `backend/.env`  | `backend/.env.example.local` | `make env-backend-local`                                          |
| Frontend sin Docker | `frontend/.env` | —                            | `VITE_BACKEND_URL` — ver [frontend/README.md](frontend/README.md) |


Copia mínima para desarrollo (detalle en `.env.example.local`):

```env
VITE_BACKEND_URL=http://localhost:8000   # URL que usa el navegador, no el hostname Docker interno
JWT_SECRET=dev-secret-cambia-en-produccion
FRONTEND_URL=http://localhost:3000
```

**Stripe webhooks en local:**

```bash
stripe listen --forward-to http://localhost:8000/api/stripe/webhook
```

**Stack de producción local** (nginx + uvicorn sin reload): `make prod-up` / `make prod-down`

#### Comandos Make

`make help` lista todo. Referencia:


| Comando                                                        | Descripción                             |
| -------------------------------------------------------------- | --------------------------------------- |
| `make up` / `make down`                                        | Levantar / detener desarrollo           |
| `make build`                                                   | Construir imágenes                      |
| `make logs` / `make ps` / `make restart`                       | Operación diaria                        |
| `make clean`                                                   | Down + **elimina volúmenes** (reset DB) |
| `make migrate`                                                 | Alembic en contenedor backend           |
| `make migrate-local`                                           | Alembic con backend local               |
| `make shell-backend` / `make shell-frontend` / `make shell-db` | Shells                                  |
| `make test-backend` / `make test-frontend`                     | Tests en contenedor                     |
| `make prod-up` / `make prod-down` / `make prod-logs`           | Stack prod local                        |
| `make env-local` / `make env-prod` / `make env-backend-local`  | Crear `.env` desde plantillas           |


### Base de datos local

Con `make up`, PostgreSQL queda expuesto en el host. El backend **dentro de Docker** habla con la base vía PgBouncer; herramientas externas (psql, DBeaver, TablePlus, etc.) se conectan **directo a Postgres** en el puerto publicado.

**Credenciales por defecto** (sobreescribibles en `.env` con `POSTGRES_*`):


| Campo    | Valor     |
| -------- | --------- |
| Host     | `localhost` |
| Puerto   | `5432`    |
| Usuario  | `tys`     |
| Password | `tys_dev` |
| Base     | `tys_dev` |


**Cadenas de conexión**

```text
# Clientes SQL (psql, GUI, migraciones desde el host)
postgresql://tys:tys_dev@localhost:5432/tys_dev

# Backend Python (SQLAlchemy async) — backend/.env o .env en la raíz
postgresql+asyncpg://tys:tys_dev@localhost:5432/tys_dev
```

**psql rápido** (contenedor ya levantado):

```bash
make shell-db
```

**psql desde tu máquina** (requiere cliente `psql` instalado):

```bash
psql postgresql://tys:tys_dev@localhost:5432/tys_dev
```

**Cliente gráfico** (DBeaver, pgAdmin, DataGrip, TablePlus…): crea una conexión PostgreSQL con los valores de la tabla anterior. SSL desactivado en local.

**Solo PostgreSQL** (útil si corres el backend sin Docker pero no quieres instalar Postgres nativo):

```bash
make env-local
docker compose --env-file .env -f docker-compose.yml up -d postgres
make migrate-local   # aplica Alembic desde backend/.env
```

Los datos persisten en el volumen Docker `postgres_data`. `make clean` borra ese volumen y resetea la base.

### Sin Docker

**Backend** (PostgreSQL en `localhost:5432` — ver [Base de datos local](#base-de-datos-local))

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
make env-backend-local    # desde la raíz, o cp backend/.env.example.local backend/.env
alembic upgrade head
uvicorn server:app --reload --port 8000
```

**Frontend**

```bash
cd frontend && yarn install
echo "VITE_BACKEND_URL=http://localhost:8000" > .env
echo "VITE_PUBLIC_DOMAIN=localhost" >> .env
yarn start    # http://localhost:3000
```

**Mobile** (opcional): `cd mobile && yarn install` — ver [mobile/](mobile/).

Requisitos: Python 3.11+, Node 18+ / Yarn 1.x, PostgreSQL 14+.

---

## Arquitectura

### Stack


| Capa          | Tecnología                                         |
| ------------- | -------------------------------------------------- |
| Backend       | Python 3.11 · FastAPI · SQLAlchemy async · Alembic |
| Frontend      | React 19 · Vite · Tailwind · shadcn/ui             |
| Mobile        | Expo 54 · React Native                             |
| Base de datos | PostgreSQL 16                                      |
| Pagos / email | Stripe · Resend                                    |
| DevOps        | Docker Compose · Make                              |


### Estructura del repo

```
backend/                  API REST
frontend/                 SPA (marketing, /app, /admin, /o/:slug)
mobile/                   Escáner QR (Expo)
docs/                     PRD, status, guías
tools/                    Scripts — [tools/README.md](tools/README.md)
docker-compose.yml        Desarrollo
docker-compose.prod.yml   Prod local
Makefile
.env.example.local        → .env
.env.example.prod         → .env.prod
```

Más detalle: [backend/README.md](backend/README.md) · [frontend/README.md](frontend/README.md)

### Multi-tenancy

Orden de resolución del tenant:

1. Subdominio `<slug>.ajcodelabs.ai` (producción)
2. Query `?tenant=<slug>`
3. Ruta `/o/<slug>`
4. `localStorage` (web)
5. Default `demo-org` en preview

---

## Documentación adicional


| Documento                                      | Contenido                         |
| ---------------------------------------------- | --------------------------------- |
| [docs/CLAUDE.md](docs/CLAUDE.md)               | Arquitectura para desarrollo / IA |
| [docs/PRD_DETALLADO.md](docs/PRD_DETALLADO.md) | PRD detallado                     |
| [docs/STATUS.md](docs/STATUS.md)               | Estado por fases                  |
| [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md)   | Brechas FRD vs implementación     |
| [docs/auth_testing.md](docs/auth_testing.md)   | Auth y smoke tests                |


