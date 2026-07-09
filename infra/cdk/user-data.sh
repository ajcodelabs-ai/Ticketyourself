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

# ponytail: docker compose v2 comes bundled with `dnf install docker` on AL2023

cd /home/ec2-user
if [ -d Ticketyourself ]; then
  cd Ticketyourself && git pull
else
  git clone --branch main https://github.com/ajcodelabs/Ticketyourself Ticketyourself
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
