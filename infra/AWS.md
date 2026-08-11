# AWS — Guía operativa (Staging + Producción)

> Documentación práctica de cómo desplegar, levantar, apagar y administrar la infraestructura AWS de Ticket Yourself. Para el diseño/arquitectura, ver [architecture.md](architecture.md). Para el código de infraestructura, ver [cdk/tys_stack.py](cdk/tys_stack.py).

## Cuenta y acceso

| Dato | Valor |
|------|-------|
| **AWS Account ID** | `203558332576` |
| **Región** | `us-east-1` |
| **Usuario IAM de despliegue** | `tys-deployer` (política `AdministratorAccess`) |
| **Profile local recomendado** | `tys-staging` (`~/.aws/config` / `~/.aws/credentials`) |

⚠️ `tys-deployer` tiene acceso administrador completo con **access keys estáticas** (no expiran). Trátalas como un secreto crítico:
- No las commitees ni las pegues en Slack/tickets.
- Si sospechas que se filtraron: `aws iam delete-access-key --user-name tys-deployer --access-key-id <ID>` y genera unas nuevas.
- No uses las credenciales **root** de la cuenta para nada del día a día — solo se usaron una vez para crear `tys-deployer`.

### Configurar el profile (primera vez en una máquina nueva)

```bash
aws configure --profile tys-staging
# Access Key ID / Secret Access Key del usuario tys-deployer
# Default region: us-east-1
# Default output: json
```

Verificar:
```bash
aws sts get-caller-identity --profile tys-staging
# Debe mostrar arn:aws:iam::203558332576:user/tys-deployer
```

## CDK — estructura

```
infra/cdk/
├── app.py              # entrypoint, lee --context env=staging|production
├── tys_stack.py         # todo el stack: _build_staging() / _build_production()
├── user-data.sh         # script de arranque de la EC2 de staging
├── requirements.txt
└── .venv/               # venv Python del propio CDK (no confundir con backend/.venv)
```

Stacks CloudFormation resultantes:
- `TysStaging` — 1 EC2 t4g.small + Docker Compose (activo hoy)
- `TysProduction` — VPC + ECS Fargate + RDS + S3/CloudFront (código listo, **no desplegado**)
- `CDKToolkit` — infraestructura interna de CDK (bucket de assets, roles), se crea una sola vez con `bootstrap`

### Bootstrap (una sola vez por cuenta/región, ya hecho)

```bash
cd infra/cdk
source .venv/bin/activate
npx cdk bootstrap aws://203558332576/us-east-1 --profile tys-staging
```

## Staging

| Dato | Valor |
|------|-------|
| **Instance ID** | `i-0ea9709d1e47de3c7` |
| **IP pública (Elastic IP)** | `32.194.57.53` (fija, no cambia al reiniciar/apagar) |
| **Tipo** | `t4g.small` (ARM), Amazon Linux 2023 |
| **Acceso remoto** | Solo SSM (no hay SSH/puerto 22 abierto, no hay key pair) |
| **Dominio** | `https://staging.ajcodelabs.ai` + **wildcard** `*.ajcodelabs.ai` (ambos → `32.194.57.53`) |
| **Frontend** | `https://staging.ajcodelabs.ai` (o directo por IP: `http://32.194.57.53:3000`) |
| **Microsites por organizador** | `https://<slug>.ajcodelabs.ai` (ej. `https://demo-org.ajcodelabs.ai`) — subdominio real, igual que en producción |
| **Backend / health** | `https://staging.ajcodelabs.ai/api/health` (o directo: `http://32.194.57.53:8000/api/health`) |
| **Costo aprox.** | ~$15/mes |

### Dominio + HTTPS (nginx reverse proxy + Let's Encrypt)

Se agregó un nginx a nivel de **host** (no dockerizado) delante de los contenedores, con certificado real de Let's Encrypt. Esto vive fuera de CDK/Docker Compose — es configuración manual sobre la instancia, documentada aquí para poder reproducirla si se recrea la EC2.

- Config: `/etc/nginx/conf.d/tys-staging.conf` — `server_name staging.ajcodelabs.ai *.ajcodelabs.ai;` (acepta el subdominio `staging` y **cualquier** subdominio de organizador)
  - `/` → `proxy_pass http://127.0.0.1:3000` (frontend)
  - `/api/` → `proxy_pass http://127.0.0.1:8000` (backend)
  - HTTP (80) redirige a HTTPS (443) para cualquiera de esos hosts
- Certificados (dos, ambos expiran 2026-10-07):
  - `/etc/letsencrypt/live/staging.ajcodelabs.ai/` — solo `staging.ajcodelabs.ai`, emitido por HTTP-01 (`certbot --nginx`)
  - `/etc/letsencrypt/live/ajcodelabs.ai/` — **wildcard**, cubre `ajcodelabs.ai` y `*.ajcodelabs.ai`, emitido por DNS-01 vía el plugin `certbot-dns-godaddy`. Este es el que usa nginx en `tys-staging.conf` (`ssl_certificate .../ajcodelabs.ai/fullchain.pem`).
- Renovación automática: systemd timer `certbot-renew.timer` (corre 2x/día, con `RandomizedDelaySec`) — cubre ambos certs, confirmado con `certbot renew --dry-run`. Verificar con:
  ```bash
  systemctl list-timers certbot-renew.timer
  certbot certificates
  ```
- Si se recrea la instancia desde cero, para reproducir el cert de `staging.ajcodelabs.ai` (HTTP-01, simple):
  ```bash
  dnf install -y nginx python3-pip
  systemctl enable --now nginx
  pip3 install certbot certbot-nginx
  # crear /etc/nginx/conf.d/tys-staging.conf con los location blocks de arriba
  nginx -t && systemctl reload nginx
  certbot --nginx -d staging.ajcodelabs.ai --non-interactive --agree-tos \
    -m admin@ticketyourself.com --redirect
  ```
- **Variables de `.env.prod` actualizadas para el dominio** (reemplazan los valores por IP de antes):
  ```
  FRONTEND_URL=https://staging.ajcodelabs.ai
  VITE_BACKEND_URL=https://staging.ajcodelabs.ai
  PUBLIC_DOMAIN=ajcodelabs.ai
  ```
  ⚠️ `VITE_BACKEND_URL` **no** lleva `/api` al final — el frontend arma `API_BASE = VITE_BACKEND_URL + "/api"` (`frontend/src/lib/api.ts:4`), así que agregarlo duplica la ruta (`/api/api/...`).
  ⚠️ `PUBLIC_DOMAIN` es el dominio **raíz** (`ajcodelabs.ai`), no el subdominio completo — el backend arma un regex de CORS que acepta cualquier subdominio de ese dominio (coincide con el patrón multi-tenant de prod, `<slug>.ajcodelabs.ai`).
  Después de cambiar `VITE_BACKEND_URL` siempre hay que reconstruir el frontend (`docker compose ... up -d --build`), porque Vite lo hornea en build time, no es dinámico en runtime.

### Subdominios de organizador (wildcard DNS + cert wildcard)

Para que `https://<slug>.ajcodelabs.ai` funcione para cualquier organizador (igual que en producción), se agregó:

1. **Registro DNS wildcard en GoDaddy**: `A` `*` → `32.194.57.53`. ⚠️ Esto afecta **todo** el dominio `ajcodelabs.ai`, no solo staging — cualquier subdominio sin registro propio cae aquí (los registros específicos existentes siguen ganando sobre el wildcard).
2. **Certificado wildcard** vía DNS-01 con el plugin `certbot-dns-godaddy` (Let's Encrypt no puede emitir wildcards por HTTP-01):
   ```bash
   pip3 install certbot-dns-godaddy
   # /root/godaddy.ini (permisos 600, root:root):
   #   dns_godaddy_key = <API key de https://developer.godaddy.com/keys>
   #   dns_godaddy_secret = <API secret>
   certbot certonly --authenticator dns-godaddy \
     --dns-godaddy-credentials /root/godaddy.ini \
     --dns-godaddy-propagation-seconds 60 \
     -d ajcodelabs.ai -d "*.ajcodelabs.ai" \
     --non-interactive --agree-tos -m admin@ticketyourself.com
   ```
3. **nginx** (`/etc/nginx/conf.d/tys-staging.conf`) con `server_name staging.ajcodelabs.ai *.ajcodelabs.ai;` y `ssl_certificate` apuntando al cert `ajcodelabs.ai` (el wildcard), no al de `staging.ajcodelabs.ai`.

⚠️ **`/root/godaddy.ini` contiene una API key de GoDaddy con acceso a gestionar DNS del dominio.** Si se necesita rotar/revocar, hacerlo desde developer.godaddy.com/keys y actualizar el archivo (`chmod 600`, dueño root).

El backend ya resuelve el tenant correcto a partir del subdominio (`backend/routers/tenants.py`, función `_extract_subdomain`) — no hace falta ninguna config extra por organizador, solo que exista con ese `slug` en la tabla `Tenant` con `status = "active"`.

### Desplegar / actualizar la infraestructura (CDK)

```bash
cd infra/cdk
source .venv/bin/activate
npx cdk deploy TysStaging --context env=staging --profile tys-staging
```

Esto solo toca la infraestructura (VPC, EC2, security group, EIP). **No** reconstruye la app — eso es un paso aparte (ver abajo).

### Conectarse a la instancia

```bash
aws ssm start-session --target i-0ea9709d1e47de3c7 --profile tys-staging --region us-east-1
```

Para correr comandos sin sesión interactiva (útil para automatizar diagnósticos):

```bash
aws ssm send-command \
  --instance-ids i-0ea9709d1e47de3c7 \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["<tu comando>"]}' \
  --profile tys-staging --region us-east-1 \
  --output text --query "Command.CommandId"

# luego, con el CommandId devuelto:
aws ssm get-command-invocation \
  --command-id <CommandId> \
  --instance-id i-0ea9709d1e47de3c7 \
  --profile tys-staging --region us-east-1 \
  --query "[Status,StandardOutputContent,StandardErrorContent]" --output text
```

### Desplegar / actualizar la app

La EC2 de staging tiene 2 GB de RAM. Si se hace `docker compose up --build` con los contenedores viejos corriendo, el build del frontend y elarranque simultáneo de los 3 contenedores pueden provocar OOM. **El flujo correcto es: bajar todo, luego pull + build + subir.**

#### Dry run — revisar antes de tocar la instancia

```bash
# 1. ¿Qué hay en main remoto que no está en la instancia?
aws ssm send-command \
  --instance-ids i-0ea9709d1e47de3c7 \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["cd /home/ec2-user/Ticketyourself && git fetch origin main && git log --oneline HEAD..origin/main"]}' \
  --profile tys-staging --region us-east-1 \
  --output text --query "Command.CommandId"

# 2. Ver el diff que se va a aplicar
aws ssm send-command \
  --instance-ids i-0ea9709d1e47de3c7 \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["cd /home/ec2-user/Ticketyourself && git fetch origin main && git diff HEAD origin/main --stat"]}' \
  --profile tys-staging --region us-east-1 \
  --output text --query "Command.CommandId"

# 3. Estado actual de los contenedores
aws ssm send-command \
  --instance-ids i-0ea9709d1e47de3c7 \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["docker ps --format \"table {{.Names}}\t{{.Status}}\t{{.Ports}}\""]}' \
  --profile tys-staging --region us-east-1 \
  --output text --query "Command.CommandId"

# Para cada uno, leer resultado con:
aws ssm get-command-invocation \
  --command-id <CommandId> \
  --instance-id i-0ea9709d1e47de3c7 \
  --profile tys-staging --region us-east-1 \
  --query "[Status,StandardOutputContent,StandardErrorContent]" --output text
```

#### Deploy completo (el que se usa en la práctica)

```bash
# Helper: enviar un comando y esperar resultado
ssm-run() {
  local CMD_ID=$(aws ssm send-command \
    --instance-ids i-0ea9709d1e47de3c7 \
    --document-name "AWS-RunShellScript" \
    --parameters "{\"commands\":[\"$1\"]}" \
    --profile tys-staging --region us-east-1 \
    --output text --query "Command.CommandId")
  sleep 8
  aws ssm get-command-invocation \
    --command-id "$CMD_ID" \
    --instance-id i-0ea9709d1e47de3c7 \
    --profile tys-staging --region us-east-1 \
    --query "[Status,StandardOutputContent,StandardErrorContent]" --output text
}

# 1. Bajar contenedores (libera RAM para el build)
ssm-run "cd /home/ec2-user/Ticketyourself && docker compose --env-file .env.prod -f docker-compose.prod.yml down"

# 2. Pull últimos cambios de main
ssm-run "cd /home/ec2-user/Ticketyourself && git checkout -- . && git pull origin main"

# 3. Rebuild + levantar
ssm-run "cd /home/ec2-user/Ticketyourself && docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build"

# 4. Verificar
ssm-run "docker ps --format 'table {{.Names}}\t{{.Status}}' && curl -s http://localhost:8000/api/health"
```

> **`make prod-up` NO funciona en esta instancia** — la AMI Amazon Linux 2023 no trae `make` instalado. Usa `docker compose` directo.

### Apagar la app (sin borrar infraestructura)

```bash
cd /home/ec2-user/Ticketyourself
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

### Ver logs / estado

```bash
docker ps
docker logs ticketyourself-backend-1 --tail 100 -f
docker logs ticketyourself-frontend-1 --tail 100 -f
docker logs ticketyourself-postgres-1 --tail 100 -f
```

### `.env.prod` de staging

Vive en `/home/ec2-user/Ticketyourself/.env.prod` en la instancia (no en git, no lo commitees). Variables actuales:

```
ENV=staging
FRONTEND_URL=http://32.194.57.53:3000
VITE_BACKEND_URL=http://32.194.57.53:8000
PUBLIC_DOMAIN=32.194.57.53
TYS_FEE_PERCENT=5
STRIPE_API_BASE=https://api.stripe.com
STRIPE_API_KEY=              # vacío — sin Stripe configurado aún
STRIPE_WEBHOOK_SECRET=       # vacío
RESEND_API_KEY=              # vacío — sin envío de emails aún
EMAIL_FROM=noreply@ticketyourself.com
ADMIN_EMAIL=admin@ticketyourself.com
ADMIN_PASSWORD=<generado aleatoriamente, ver credenciales abajo>
JWT_SECRET=<generado aleatoriamente>
POSTGRES_USER=tys
POSTGRES_PASSWORD=<generado aleatoriamente>
POSTGRES_DB=tys_staging
```

Para editarlo: entra por SSM y `vim .env.prod`, luego vuelve a correr el `docker compose up -d --build` de arriba (los contenedores con config cambiada se recrean solos).

### Credenciales de acceso a la app (staging)

| Rol | Usuario | Password |
|-----|---------|----------|
| Super Admin | `admin@ticketyourself.com` | generada al desplegar — pregúntame o revisa `.env.prod` en la instancia (`ADMIN_PASSWORD`) |
| Organizador demo (aprobado) | `demo@ticketyourself.com` | `Organizer123!` (fija, viene del código de seeds, no del env) |

### Dar de baja staging por completo

```bash
cd infra/cdk
source .venv/bin/activate
npx cdk destroy TysStaging --context env=staging --profile tys-staging
```

Esto borra la EC2, el security group, la VPC y libera la Elastic IP (la IP `32.194.57.53` **no** se conserva para un futuro redeploy).

## Producción (código listo, no desplegado)

Requiere, además del bootstrap ya hecho:
- Un dominio propio y un certificado ACM (`--context domain=... --context cert_arn=...`)
- Secrets reales en Secrets Manager: se crean automáticamente vacíos (`tys-prod-jwt-secret`, `tys-prod-stripe-api-key`, `tys-prod-stripe-webhook-secret`, `tys-prod-resend-api-key`, `tys-prod-admin-password`) — hay que rellenarlos después del primer deploy
- Build y push de la imagen del backend a ECR
- Build del frontend y sync a S3

```bash
# 1. Build y push backend a ECR
cd infra/cdk
docker build -t tys-backend:latest -f ../../production/Dockerfile.aws ../../backend
aws ecr get-login-password --profile tys-staging --region us-east-1 | \
  docker login --username AWS --password-stdin 203558332576.dkr.ecr.us-east-1.amazonaws.com
docker tag tys-backend:latest 203558332576.dkr.ecr.us-east-1.amazonaws.com/tys-prod-backend:latest
docker push 203558332576.dkr.ecr.us-east-1.amazonaws.com/tys-prod-backend:latest

# 2. Frontend a S3
cd ../../frontend && yarn install && yarn build
aws s3 sync dist/ s3://tys-prod-frontend/ --delete --profile tys-staging

# 3. Deploy de infraestructura
cd ../infra/cdk
npx cdk deploy TysProduction --context env=production \
  --context domain=ticketyourself.com --context cert_arn=arn:aws:acm:us-east-1:203558332576:certificate/<id> \
  --profile tys-staging

# 4. Rellenar secrets reales (una vez por secret)
aws secretsmanager put-secret-value --secret-id tys-prod-stripe-api-key --secret-string "sk_live_..." --profile tys-staging
aws secretsmanager put-secret-value --secret-id tys-prod-stripe-webhook-secret --secret-string "whsec_..." --profile tys-staging
aws secretsmanager put-secret-value --secret-id tys-prod-resend-api-key --secret-string "re_..." --profile tys-staging
```

### Administrar producción (una vez desplegada)

```bash
# Ver tasks / estado del servicio ECS
aws ecs describe-services --cluster <ClusterName> --services <ServiceName> --profile tys-staging --region us-east-1

# Forzar un nuevo deploy (nueva imagen en ECR con el mismo tag)
aws ecs update-service --cluster <ClusterName> --service <ServiceName> --force-new-deployment --profile tys-staging --region us-east-1

# Ver logs
aws logs tail /aws/ecs/<log-group> --follow --profile tys-staging --region us-east-1
```

### Dar de baja producción

```bash
npx cdk destroy TysProduction --context env=production --profile tys-staging
```

⚠️ El bucket de frontend (`tys-prod-frontend`), el repo ECR y la RDS tienen `RemovalPolicy.RETAIN` / `deletion_protection=True` — **no se borran solos** con `cdk destroy`, hay que borrarlos manualmente si de verdad quieres eliminar todo (y la RDS pide desactivar `deletion_protection` primero).

## Apagado/encendido automático (pendiente de implementar)

Plan acordado: instancia de staging encendida de **8am a 9pm** — falta confirmar si es todos los días o solo L-V para calcular el cron exacto.

Mecanismo planeado (se agrega a `tys_stack.py`, no es manual):
- Dos reglas de EventBridge (`aws_events.Rule`) con expresión `cron(...)` en UTC
- Cada una dispara un target `aws_events_targets.AwsApi` que llama directo a `EC2.StartInstances` / `EC2.StopInstances` sobre `i-0ea9709d1e47de3c7`
- CDK genera automáticamente la Lambda mínima y el rol IAM acotado — no hay Lambda a mantener a mano
- La IP pública no cambia (Elastic IP ya asociada), así que las URLs siguen funcionando igual cuando se reactiva

## Problemas conocidos / gotchas

1. **`make prod-up` no funciona en la EC2 de staging** — la AMI no trae `make`. Usar el comando `docker compose` directo (documentado arriba).
2. **El plugin `docker compose` no viene con `dnf install docker`** en Amazon Linux 2023, a pesar de lo que dice el comentario en `user-data.sh:14`. Si se recrea la instancia desde cero, hay que instalarlo a mano:
   ```bash
   mkdir -p /usr/local/lib/docker/cli-plugins
   curl -SL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-aarch64 \
     -o /usr/local/lib/docker/cli-plugins/docker-compose
   chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
   ```
   (Pendiente: mover esto al propio `user-data.sh` para que no vuelva a pasar.)
3. **`PUBLIC_DOMAIN` faltaba en `docker-compose.prod.yml`** — el backend lo exige (`server.py:114`, sin default) para armar el regex de CORS multi-tenant, pero el compose de producción no lo pasaba al contenedor. Ya se corrigió en `docker-compose.prod.yml` (rama `cl/infra-cdk`). Pendiente: mergear a `main` y agregar `PUBLIC_DOMAIN=` a la plantilla de `.env.prod` que genera `user-data.sh` (hoy también le falta).
4. **Sin Stripe ni Resend configurados en staging** — el checkout con pago real y el envío de emails van a fallar hasta que se agreguen llaves de test.
5. **`"staging"` faltaba en las listas `RESERVED_SUBDOMAINS`** de `frontend/src/lib/config.ts:18` y `backend/routers/tenants.py:13` — como `staging.ajcodelabs.ai` calza con el patrón `<slug>.ajcodelabs.ai` del multi-tenant, el sistema trataba `"staging"` como si fuera el slug de un organizador (inexistente) y mostraba "Microsite no disponible" en vez de caer al tenant demo. Ya se corrigió en ambas listas (rama `cl/infra-cdk`, también parcheado en caliente en la instancia). Pendiente: mergear a `main`. Si se agregan más subdominios de infraestructura en el futuro (`dev`, `preview`, `qa`), hay que agregarlos a **ambas** listas — no están compartidas entre frontend y backend.

## Notas de seguridad

- Staging usa HTTPS real (Let's Encrypt) en `staging.ajcodelabs.ai` y `*.ajcodelabs.ai` — pero el acceso directo por IP (`:3000`, `:8000`) sigue siendo HTTP plano sin cifrar; usar siempre la URL con dominio.
- Secrets de staging viven en texto plano en `.env.prod` dentro de la instancia (no en Secrets Manager, a diferencia de producción). Cualquiera con acceso SSM a la instancia puede leerlos. Lo mismo aplica a `/root/godaddy.ini` (API key de GoDaddy).
- `tys-deployer` tiene `AdministratorAccess` — evaluar acotar permisos si se le da acceso a más personas.
