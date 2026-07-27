#!/bin/bash
set -e

if ! command -v docker &>/dev/null; then
  dnf install -y docker
  systemctl enable --now docker
  usermod -aG docker ec2-user
fi

if ! command -v git &>/dev/null; then
  dnf install -y git
fi

# The `docker compose` plugin does NOT come bundled with `dnf install docker`
# on Amazon Linux 2023, despite what an earlier version of this script assumed.
if ! docker compose version &>/dev/null; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  # ponytail: uname -m already matches docker compose's release asset naming
  # (aarch64/x86_64) — no separate arch map needed.
  curl -SL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

cd /home/ec2-user
if [ -d Ticketyourself ]; then
  cd Ticketyourself && git pull
else
  git clone --branch staging https://github.com/ajcodelabs-ai/Ticketyourself Ticketyourself
fi

ENV_FILE="/home/ec2-user/Ticketyourself/.env.prod"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<-EOF
ENV=staging
FRONTEND_URL=
PUBLIC_DOMAIN=ajcodelabs.ai
TYS_FEE_PERCENT=5
STRIPE_API_BASE=https://api.stripe.com
STRIPE_API_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
EMAIL_FROM=noreply@ticketyourself.com
ADMIN_EMAIL=admin@ticketyourself.com
ADMIN_PASSWORD=
JWT_SECRET=
POSTGRES_USER=tys
POSTGRES_PASSWORD=
POSTGRES_DB=tys_staging
EOF
  echo "==> .env.prod template created. Fill secrets then:"
  echo "    cd /home/ec2-user/Ticketyourself && docker compose -f docker-compose.prod.yml up -d"
fi
