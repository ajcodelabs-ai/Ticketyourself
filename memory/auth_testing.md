# TYS — Auth testing guide (Fase 1)

**Auth activo (JWT custom).** bcrypt + pyjwt HS256. Tokens vienen en el **body** del login/refresh (`access_token`/`refresh_token`) y deben enviarse en cada request como `Authorization: Bearer <access_token>`. **Las cookies se siguen seteando como fallback** (mobile/SSR/curl con `-c`/`-b`), pero el frontend web no las usa porque el ingress de la plataforma reescribe `Access-Control-Allow-Origin: *`, lo cual es incompatible con `credentials:true`.

## Roles
- `super_admin` — único: `admin@ticketyourself.com / Admin123!`
- `organizer` — 3 demos (ver `test_credentials.md`)

## Bearer vs Cookies
**Recomendado para tests y frontend web**: Bearer.
- `POST /api/auth/login` → response body incluye `{user, organizer, access_token, refresh_token}` + setea cookies como bonus.
- En cada call autenticado: `-H "Authorization: Bearer $TOKEN"`.
- El frontend guarda los tokens en `localStorage` (`tys_access_token` / `tys_refresh_token`) y los inyecta automáticamente vía interceptor axios.
- `POST /api/auth/logout` limpia las cookies (server-side); el frontend además limpia localStorage.

Para tests con cookies (curl `-c`/`-b`) sigue funcionando localmente y desde mobile, pero **no funciona desde el browser web cross-origin** por el ingress.

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
