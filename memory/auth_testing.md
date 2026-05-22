# TYS — Auth testing guide (Fase 1)

**Auth activo (JWT custom).** bcrypt + pyjwt HS256. Tokens viajan en httpOnly cookies (`tys_access`, `tys_refresh`) **y** soportan `Authorization: Bearer <token>` para curl/testing.

## Roles
- `super_admin` — único: `admin@ticketyourself.com / Admin123!`
- `organizer` — 3 demos (ver `test_credentials.md`)

## Cookies vs Bearer
La response de login devuelve el body con `user` + `organizer` **y** setea las cookies. Para curl con cookies usá `-c cookies.txt` en login y `-b cookies.txt` en los siguientes calls. Para Bearer, login con `withCredentials: false` no devuelve los tokens en body (los entrega vía cookies por defecto) — usá cookies en lugar de Bearer para los tests, es más cercano al uso real del frontend.

## Endpoints auth
- `POST /api/auth/register` body `{email, password, company_name, legal_id, org_type, phone, country, slug?}` → 200 con `{user, organizer}`. **No** autologin.
- `POST /api/auth/login` `{email, password}` → 200 con `{user, organizer}` + cookies.
- `POST /api/auth/logout` → limpia cookies.
- `POST /api/auth/refresh` (lee refresh cookie) → emite nuevo access cookie.
- `GET /api/auth/me` → `{user, organizer?}`.
- `POST /api/auth/check-slug` `{slug}` → `{slug, available, suggestion?}`.

## RBAC
- `Depends(get_current_user)` exige access cookie/Bearer.
- `Depends(require_role("super_admin"))` o `("organizer")` exige rol exacto.
- Sin sesión → HTTP 401. Rol incorrecto → HTTP 403.

## Comportamientos especiales
1. **Suspended**: el login retorna OK con `organizer.status=suspended`. El frontend muestra dashboard bloqueado con motivo. (No bloqueamos login porque el usuario debe ver el motivo.)
2. **Rejected**: igual al anterior pero con `rejection_reason` visible y CTA "Editar documentos".
3. **Slug**: validado al registro, único, normalizado (lowercase, sin acentos). Inmutable post-registro.

## Smoke flow E2E

```bash
API=https://d049ce64-7122-4dac-92d0-1c8f818c9d2b.preview.emergentagent.com/api

# Admin
curl -c /tmp/ac -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@ticketyourself.com","password":"Admin123!"}'
curl -b /tmp/ac "$API/auth/me"
curl -b /tmp/ac "$API/admin/dashboard/stats"
curl -b /tmp/ac "$API/admin/organizers?status=pending"

# Organizer pending
curl -c /tmp/oc -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"prueba@ticketyourself.com","password":"Organizer123!"}'
curl -b /tmp/oc "$API/auth/me"
curl -b /tmp/oc "$API/organizers/me/documents"

# Forbidden
curl -o /dev/null -w "%{http_code}\n" -b /tmp/oc "$API/admin/dashboard/stats"   # 403
curl -o /dev/null -w "%{http_code}\n" "$API/admin/dashboard/stats"              # 401
```

## Reset de credenciales
- El seed re-actualiza el password del super-admin si cambia en `.env` (envuelto en bcrypt check).
- Para resetear los demos, borrá las collections `users` y `organizers` o borrá los usuarios específicos y reiniciá el backend.
