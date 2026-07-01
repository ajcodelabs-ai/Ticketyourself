# Ticket Yourself — Arquitectura AWS

> Target: 1–20 tasks ECS · Multi-AZ · Alta concurrencia en flash sales

## Estado actual (hoy)

Hoy la app corre en Docker Compose. El código ya soporta varios patrones de escalabilidad aunque la infraestructura cloud aún no existe.

```mermaid
flowchart LR
    subgraph "Docker Compose (hoy)"
        U["Usuarios"] --> FE["nginx · Frontend SPA<br/>Docker container"]
        U --> BE["uvicorn 1 worker · Backend API<br/>Docker container"]
        BE --> PGB["PgBouncer · Pool"]
        PGB --> PG[("PostgreSQL 16")]
    end
```

### Lo que ya está listo en código

| Componente | Código | Estado |
|------------|--------|--------|
| **API async** | FastAPI + asyncpg + SQLAlchemy async | ✅ Listo. Pool nativo maneja centenares de conexiones |
| **PgBouncer compat** | `database.py` detecta `PGBOUNCER=true`, desactiva statement cache | ✅ Listo. Ya corre en dev compose |
| **Seat holds** | `orm_models.SeatHold` + `services/seats.py` (create/release/consume/assign) | ✅ Listo. Cleanup periódico pendiente |
| **JWT stateless** | `security.py` — HS256, Bearer token | ✅ Listo. Escala horizontal sin cambios |
| **Health check** | `GET /api/health` | ✅ Listo. Para ALB target group |
| **Stripe webhooks** | Flujo completo de confirmación de pago síncrono | ✅ Listo. |
| **Email async** | `BackgroundTasks` + `asyncio.create_task` vía Resend | ⚠️ Fire-and-forget. Sin cola persistente. Suficiente hoy |
| **8 workers** | `Dockerfile` CMD sin `--workers` | ❌ Pendiente. Hoy corre 1 worker |
| **Cleanup seat holds** | No existe | ❌ Pendiente. `DELETE WHERE expires_at < NOW()` |

### Target AWS

```mermaid
flowchart TB
    classDef edge fill:#e8f4f8,stroke:#2980b9,stroke-width:2px
    classDef frontend fill:#fef9e7,stroke:#f39c12,stroke-width:2px
    classDef compute fill:#d5f5e3,stroke:#27ae60,stroke-width:2px
    classDef external fill:#f4ecf7,stroke:#8e44ad,stroke-width:2px
    classDef db fill:#fadbd8,stroke:#c0392b,stroke-width:2px

    subgraph "🌐 Internet"
        U(("Usuarios"))
    end

    subgraph "AWS Edge"
        R53[("Route53 · DNS")] --> WAF["WAF · Firewall"] --> CF["CloudFront · CDN"]
    end

    subgraph "AWS Global"
        S3_FE["S3 · Frontend Estático<br/>Vite + React SPA"]
    end

    subgraph "VPC"
        subgraph "Pública"
            ALB["ALB · Load Balancer<br/>Target: /api/*"]
        end
        subgraph "Privada · Cómputo"
            ECS["ECS Fargate · Backend API<br/>1–20 tasks · 8 workers c/u"]
        end
        subgraph "Privada · Datos"
            PGB["PgBouncer · Pool Conexiones"]
            RDS[("RDS PostgreSQL 16<br/>Multi-AZ")]
            S3_A["S3 · Assets Eventos"]
        end
    end

    subgraph "Externos"
        STRIPE[("Stripe · Pagos")]
        RESEND[("Resend · Email")]
    end

    U --> R53
    CF -- "/*" --> S3_FE
    CF -- "/api/*" --> ALB
    ALB --> ECS
    ECS --> PGB --> RDS
    ECS --> S3_A
    ECS --> STRIPE
    ECS --> RESEND

    class U,R53,WAF,CF edge
    class S3_FE frontend
    class ALB compute
    class ECS,PGB compute
    class S3_A,RDS db
    class STRIPE,RESEND external
```

## Especificaciones target

| Capa | Servicio | Detalle |
|------|----------|---------|
| Edge | Route53 → WAF → CloudFront | 250K RPS / 150 Gbps base. `/*` → S3, `/api/*` → ALB |
| Frontend | S3 | Build estático Vite + React. CloudFront al frente, S3 nunca recibe tráfico directo |
| Cómputo | ECS Fargate | 1–20 tasks. 8 workers uvicorn + PgBouncer sidecar por task |
| Base de datos | RDS PostgreSQL 16 | ~500 conexiones vía PgBouncer. Seat holds con tabla + cleanup periódico |
| Assets | S3 | Posters, banners, galerías |
| Pagos | Stripe | API + webhooks |
| Email | Resend | Confirmaciones, recuperación. `BackgroundTasks` hoy |

## Flujo de pago

```mermaid
sequenceDiagram
    actor U as Usuario
    participant API as Backend API
    participant PG as PostgreSQL
    participant STRIPE as Stripe

    U->>API: POST /checkout {seat_ids}
    API->>PG: INSERT seat_hold (session_token, seat_id, expires_at)
    API->>STRIPE: PaymentIntent.create
    STRIPE-->>API: requires_confirmation
    U->>API: POST /confirm {payment_intent_id}
    API->>STRIPE: PaymentIntent.confirm
    STRIPE-->>API: succeeded
    API->>PG: BEGIN TRANSACTION
    API->>PG: INSERT order + tickets
    API->>PG: DELETE seat_hold
    API->>PG: COMMIT
    Note over API: QR generado síncrono (ticket_jwt.py)
    Note over API: Email vía BackgroundTasks
    API-->>U: 200 OK {order, tickets}
```

## Decisiones

| Excluido | Por qué |
|----------|---------|
| **Kubernetes** | 20 tasks no lo justifican. Se evalúa > 50 tasks |
| **Multi-región** | CloudFront en el edge alcanza. Una región basta |
| **Microservicios** | Monolito FastAPI alcanza. Se divide > 5 devs |
| **RDS Proxy** | PgBouncer sidecar cumple la misma función y ya está en docker-compose.yml |
| **Kafka** | Overkill. SQS si se necesita cola durable, pero hoy el flujo síncrono + BackgroundTasks funciona |
| **SQS** | No implementado. Emisión síncrona (INSERT + QR + email en el mismo request). SQS agrega complejidad sin beneficio demostrado. Se agrega si hay pérdida de emails o backpressure |
| **Lambda** | FastAPI mantiene pool stateful (PgBouncer, asyncpg). Refactor innecesario |
| **Redis / Valkey / Dragonfly** | PG cubre seat holds y rate limiting. `functools.lru_cache` para data cuasi-estática. Cero infraestructura extra |
| **Auto-scaling** | 1 task fijo hoy. Escalar manual a 2-3 antes de alarmas |
| **Multi-AZ RDS** | Single-AZ hoy. Multi-AZ cuando haya datos que justifiquen el doble de costo |
| **CloudFront** | Hoy sirve nginx Docker. Migrar a S3 + CF cuando haya tráfico global |
| **CDK / IaC** | Se escribe cuando se despliegue. Hoy no hay infra que versionar |

## Código reutilizable en AWS

| Artefacto | Uso en AWS | Cambios necesarios |
|-----------|------------|-------------------|
| `backend/Dockerfile` | Imagen ECS | `--workers 8` sin `--reload` |
| `frontend/Dockerfile` | Build multi-stage → deploy a S3 | Script de deploy a S3 |
| `docker-compose.yml` | Config PgBouncer como sidecar | Ninguno |
| `backend/database.py` | SQLAlchemy async + asyncpg → RDS | Ninguno, ya soporta PgBouncer |
| `backend/security.py` | JWT HS256 — auth stateless | Ninguno, escala horizontal |
| `backend/services/seats.py` | Seat holds en RDS | Agregar cleanup periódico (`DELETE WHERE expires_at < NOW()`) |
