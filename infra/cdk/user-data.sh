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

DOMAIN="tys-staging.ajcodelabs.ai"
WILDCARD_DOMAIN="ajcodelabs.ai"

ENV_FILE="/home/ec2-user/Ticketyourself/.env.prod"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<-EOF
ENV=staging
FRONTEND_URL=https://$DOMAIN
VITE_BACKEND_URL=https://$DOMAIN
PUBLIC_DOMAIN=$WILDCARD_DOMAIN
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

# ── HTTPS: nginx + Let's Encrypt wildcard cert via GoDaddy DNS-01 ─────────
# Only cert issuance is guarded by existence (it's the slow, external-API
# step). nginx install/conf/timer below run every boot unconditionally —
# a rebuilt instance can inherit an existing cert via a persisted EBS
# volume while still needing nginx itself reinstalled/reconfigured.
dnf install -y nginx python3-pip
systemctl enable --now nginx
pip3 install certbot certbot-nginx certbot-dns-godaddy

if [ ! -d "/etc/letsencrypt/live/$WILDCARD_DOMAIN" ]; then
  aws secretsmanager get-secret-value --secret-id "__GODADDY_SECRET_ARN__" --region us-east-1 \
    --query SecretString --output text > /tmp/godaddy_secret.json
  GODADDY_KEY=$(python3 -c "import json; print(json.load(open('/tmp/godaddy_secret.json'))['key'])")
  GODADDY_SECRET=$(python3 -c "import json; print(json.load(open('/tmp/godaddy_secret.json'))['secret'])")
  rm -f /tmp/godaddy_secret.json
  cat > /root/godaddy.ini <<-EOF
dns_godaddy_key = $GODADDY_KEY
dns_godaddy_secret = $GODADDY_SECRET
EOF
  chmod 600 /root/godaddy.ini
  chown root:root /root/godaddy.ini

  certbot certonly --authenticator dns-godaddy --dns-godaddy-credentials /root/godaddy.ini \
    --dns-godaddy-propagation-seconds 60 -d "$WILDCARD_DOMAIN" -d "*.$WILDCARD_DOMAIN" \
    --non-interactive --agree-tos -m admin@ticketyourself.com
fi

cat > /etc/nginx/conf.d/tys-staging.conf <<-EOF
server {
    listen 80;
    server_name $DOMAIN *.$WILDCARD_DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN *.$WILDCARD_DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$WILDCARD_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$WILDCARD_DOMAIN/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
nginx -t && systemctl reload nginx

# --deploy-hook only fires after a successful renewal, so nginx keeps
# serving the old (soon-to-expire) cert from memory until it's reloaded —
# without this, TLS silently starts failing ~90 days after issuance even
# though certbot itself reports success.
cat > /etc/systemd/system/certbot-renew.service <<-EOF
[Unit]
Description=Certbot Renewal

[Service]
Type=oneshot
ExecStart=/usr/local/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
EOF
cat > /etc/systemd/system/certbot-renew.timer <<-EOF
[Unit]
Description=Run certbot renew twice daily

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now certbot-renew.timer
