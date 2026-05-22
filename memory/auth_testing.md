# TYS — Auth status

**Fase 0 (POC) no tiene autenticación.**

No hay login, no hay JWT, no hay seed de admins ni de usuarios. Los endpoints
del POC son públicos a propósito porque sólo validan dos cosas:

1. La integración con Stripe end-to-end (checkout + webhook/polling).
2. La resolución de tenant por subdominio / query param.

## Cuándo se agrega auth

En **Fase 1** se implementa:
- Auth de **organizadores** (JWT-based, custom). Antes de codear se DEBE llamar a
  `integration_playbook_expert_v2` con la query "JWT auth FastAPI + React".
- Modelo `Organizer` 1:1 con `Tenant`.
- Onboarding del organizador (crea su tenant + microsite básico).

El comprador final no requiere auth en Fase 2 (compra como invitado, email + nombre).
