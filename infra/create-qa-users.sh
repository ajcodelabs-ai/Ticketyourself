#!/usr/bin/env bash
# Idempotent: ensures a set of super_admin + approved-organizer QA accounts
# exist on TYS staging. Safe to re-run after any deploy/DB reset:
#   - admin email not found      -> creates it with a fresh random password
#   - admin email exists, wrong role -> promotes it to super_admin (password untouched)
#   - admin email already super_admin -> no-op
#   - organizer email not found  -> registers + approves it with a fresh password
#   - organizer email exists     -> no-op (password unknown/unchanged)
# Passwords are generated fresh each run and only printed for accounts
# actually created — never hardcoded in this file.
#
# Usage: ./create-qa-users.sh
set -euo pipefail

STAGING_URL="https://tys-staging.ajcodelabs.ai"
AWS_PROFILE="tys-staging"
INSTANCE_ID="i-08b4ac1cee0d49693"
REGION="us-east-1"

ADMIN_EMAILS=("qa-admin@ticketyourself.com" "aperez+2@ajcodelabs.ai")
# email | company_name | legal_id | org_type | phone
ORGANIZERS=(
    "qa1@ticketyourself.com|QA Organizer 1|1712345678|individual|+593999000001"
    "qa2@ticketyourself.com|QA Organizer 2|1798765432|company|+593999000002"
)

genpw() { python3 -c "
import secrets, string
a = string.ascii_letters + string.digits
print(''.join(secrets.choice(a) for _ in range(16)) + '!' + str(secrets.randbelow(10)))
"; }

# Runs a python script (read from stdin) inside the backend container via SSM.
ssm_python() {
    local b64 cmd_json cmd_id status
    b64=$(base64 -w0)
    cmd_json=$(python3 -c "import json,sys; print(json.dumps({'commands':[sys.argv[1]]}))" \
        "echo $b64 | base64 -d | docker exec -i -w /app ticketyourself-backend-1 python3 -")
    cmd_id=$(aws ssm send-command --profile "$AWS_PROFILE" --region "$REGION" \
        --instance-ids "$INSTANCE_ID" --document-name "AWS-RunShellScript" \
        --parameters "$cmd_json" --output text --query "Command.CommandId")
    for _ in $(seq 1 15); do
        status=$(aws ssm get-command-invocation --profile "$AWS_PROFILE" --region "$REGION" \
            --command-id "$cmd_id" --instance-id "$INSTANCE_ID" --query "Status" --output text 2>/dev/null || echo "Pending")
        [[ "$status" != "Pending" && "$status" != "InProgress" ]] && break
        sleep 2
    done
    aws ssm get-command-invocation --profile "$AWS_PROFILE" --region "$REGION" \
        --command-id "$cmd_id" --instance-id "$INSTANCE_ID" \
        --query "StandardOutputContent" --output text
}

# ensure_admin <email> -> prints CREATED|PROMOTED|OK, and the password on stdout (only for CREATED)
ensure_admin() {
    local email="$1" pw
    pw=$(genpw)
    ssm_python <<PY
import asyncio
from sqlalchemy import select
from database import AsyncSessionLocal
from orm_models import User
from security import hash_password
import uuid

async def main():
    async with AsyncSessionLocal() as s:
        u = await s.scalar(select(User).where(User.email == "$email"))
        if u is None:
            u = User(id=str(uuid.uuid4()), email="$email",
                      password_hash=hash_password("$pw"), role="super_admin")
            s.add(u)
            await s.commit()
            print("CREATED")
        elif u.role != "super_admin":
            u.role = "super_admin"
            await s.commit()
            print("PROMOTED")
        else:
            print("OK")

asyncio.run(main())
PY
    echo "$pw"
}

echo "== Admins =="
for email in "${ADMIN_EMAILS[@]}"; do
    result=$(ensure_admin "$email")
    status=$(echo "$result" | head -1)
    pw=$(echo "$result" | tail -1)
    echo "-- $email: $status"
    [[ "$status" == "CREATED" ]] && echo "   password: $pw"
    if [[ "$email" == "qa-admin@ticketyourself.com" && ( "$status" == "CREATED" || "$status" == "OK" || "$status" == "PROMOTED" ) ]]; then
        QA_ADMIN_PW="$pw" # only meaningful when CREATED this run; used below to approve organizers
    fi
done

register_organizer() {
    local email="$1" name="$2" legal_id="$3" org_type="$4" phone="$5"
    local pw resp status body org_id
    pw=$(genpw)
    echo "== Organizer: $email =="
    resp=$(curl -s -w '\n%{http_code}' -X POST "$STAGING_URL/api/auth/register" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$pw\",\"company_name\":\"$name\",\"legal_id\":\"$legal_id\",\"org_type\":\"$org_type\",\"phone\":\"$phone\",\"country\":\"Ecuador\"}")
    status=$(echo "$resp" | tail -1)
    body=$(echo "$resp" | sed '$d')
    if [[ "$status" == "200" ]]; then
        org_id=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['organizer']['id'])")
        if [[ -n "${ADMIN_TOKEN:-}" ]]; then
            curl -s -X POST "$STAGING_URL/api/admin/organizers/$org_id/approve" \
                -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' > /dev/null
            echo "  created + approved"
        else
            echo "  created (pending — no admin token to approve with)"
        fi
        echo "  password: $pw"
    else
        echo "  already exists or failed ($status), skipping"
    fi
}

# Only usable to auto-approve new organizers when qa-admin was CREATED this
# run (fresh known password). Otherwise organizers are created pending —
# approve manually from the admin panel.
if [[ -n "${QA_ADMIN_PW:-}" ]]; then
    ADMIN_TOKEN=$(curl -s -X POST "$STAGING_URL/api/auth/login" -H "Content-Type: application/json" \
        -d "{\"email\":\"qa-admin@ticketyourself.com\",\"password\":\"$QA_ADMIN_PW\"}" \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)
fi

echo
echo "== Organizers =="
for entry in "${ORGANIZERS[@]}"; do
    IFS='|' read -r email name legal_id org_type phone <<< "$entry"
    register_organizer "$email" "$name" "$legal_id" "$org_type" "$phone"
done
