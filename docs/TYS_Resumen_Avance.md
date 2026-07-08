# TYS — Resumen de Avance del Backlog

**Fecha de auditoría:** 2026-07-08
**Fuente:** `docs/TYS_Requerimientos_Tecnicos.pdf` (v1.1) + `docs/TYS_Backlog_Monday.csv` + código fuente completo (backend, frontend, mobile, migraciones, tests)
**Detalle ticket por ticket:** ver `docs/TYS_Backlog_Monday_Revision.csv`

Metodología: para cada uno de los 42 tickets del backlog se buscó evidencia directa en el código (routers, modelos ORM, servicios, migraciones, componentes de frontend, tests) y se contrastó contra el requerimiento funcional literal del PDF. Un ticket solo se marcó como "Completado" si el flujo funciona de punta a punta (backend + frontend + validación); si solo existían piezas sueltas (un campo de modelo sin endpoint, un endpoint sin UI, un flag sin lógica) se clasificó como "Parcialmente implementado". No se modificó ningún archivo de código durante esta auditoría.

## Totales

| Métrica | Valor |
|---|---|
| Total de tickets | 42 |
| ✅ Completados | 5 |
| 🚧 En desarrollo | 0 |
| ⚠️ Parcialmente implementados | 25 |
| ❌ Pendientes | 12 |
| ❓ No determinados | 0 |
| **Avance general (promedio de % por ticket)** | **≈ 41%** |

El avance general se calculó como el promedio simple del progreso estimado de los 42 tickets. Es una medida de amplitud (cuánto de cada requerimiento está resuelto), no de esfuerzo ponderado — un ticket grande y uno pequeño cuentan igual.

**Tickets completados (✅):**
- Selección y aprobación de plan (95%)
- Tipos de evento — único/multifunción/subeventos/franjas/abono (90%)
- Motor de inventario y reserva temporal con timeout (85%)
- Selección de localidad y aplicación de descuento (95%)
- Diseñador visual de tickets y QR firmado (90%)

Nota: dos hallazgos contradicen al propio documento de requerimientos, que los marca como pendientes o faltantes — "Tipos de evento" (históricamente "Fase 8" pendiente según `CLAUDE.md`) y "Gestión de aforo" (marcado "FALTA" en el PDF) están, en la práctica, sustancialmente construidos. La documentación interna está desactualizada en estos dos puntos.

## Los 10 tickets más críticos pendientes

Ordenados por impacto de negocio y por ser bloqueantes de otros tickets de prioridad Alta.

1. **Integración de pasarelas de pago y billetera virtual** (20%) — Solo Stripe está integrado; Nuvei, Kushki, PayPhone y Datafast (requeridos explícitamente para el mercado ecuatoriano) no existen en el código, y la billetera virtual no tiene ningún artefacto.
2. **Login, registro y modo invitado en checkout** (10%) — El checkout actual es 100% anónimo; no hay OAuth (Google/Facebook/Apple) ni opción de iniciar sesión durante la compra, contradiciendo el requerimiento de "no compras 100% anónimas".
3. **Definición del dominio del micrositio** (0%) — Decisión de cliente pendiente que bloquea "Generación automática de subdominio" y "Dominio propio".
4. **Definición de precios de planes** (0%) — Los precios en `seeds.py` son placeholders (el plan "profesional" tiene el mismo precio que "evento_unico"); bloquea el lanzamiento comercial.
5. **Arquitectura base del sistema (Gateway, multi-tenant, Cloudflare)** (30%) — Sin WAF/CDN/rate limiting de ningún tipo; el backend queda expuesto directamente sin la capa de infraestructura que pide el documento.
6. **Editor visual de micrositio** (35%) — Solo 3 de las 45 plantillas mínimas requeridas existen (~93% de brecha en el criterio de aceptación central).
7. **Operación del evento** (35%) — No hay suspensión temporal real (solo despublicar todo el evento), ni reprogramación dedicada, ni comunicación masiva a compradores.
8. **Comisiones y liquidaciones a organizadores** (35%) — La comisión es un porcentaje global fijo vía variable de entorno; no existe reporte de liquidación accesible para el organizador (solo super-admin).
9. **Generación automática de subdominio y micrositio base** (40%) — La activación en base de datos funciona, pero no hay aprovisionamiento real de DNS ni automatización de SSL.
10. **Reportería para el organizador** (50%) — Sin exportación de ventas ni gráficos en el dashboard del organizador (Recharts solo se usa en el panel super-admin).

## Riesgos encontrados

- **Riesgo de mercado/regulatorio — pasarelas de pago locales ausentes:** el documento pide explícitamente Nuvei, Kushki, PayPhone y Datafast; hoy solo existe Stripe. Si el cliente considera estos procesadores locales indispensables para el lanzamiento en Ecuador, esto es un bloqueante mayor, no un detalle menor.
- **Fuga de ingresos por enforcement de planes desactivado:** `backend/services/plan_features.py` documenta explícitamente que la aplicación de límites/features por plan está "OFF por defecto". Un organizador en plan Básico puede usar funciones de Enterprise sin restricción alguna.
- **Bug funcional en visibilidad de eventos:** los eventos con `visibility="private"` son inalcanzables incluso por link directo (`get_public_event` los filtra), rompiendo un caso de uso central del control de acceso.
- **Descuentos legales no funcionales:** el toggle de descuento por ley (tercera edad/discapacidad) existe en la UI y el esquema pero nunca se aplica al precio final ni tiene verificación de identidad — riesgo de incumplimiento normativo si se comunica como una función disponible.
- **Sin reembolso masivo ante cancelación:** cancelar un evento no dispara reembolsos ni notificaciones; el organizador debe reembolsar orden por orden manualmente, lo cual es inviable en eventos grandes y genera riesgo de reclamos.
- **Configuración inerte de envío de tickets:** existen columnas (`ticket_delivery_mode`, `ticket_delivery_hours`) configurables desde la API pero ningún proceso las consume — un organizador puede configurar algo que no tiene ningún efecto, generando expectativas incumplidas.
- **Documentación desactualizada:** `CLAUDE.md` y el propio PDF de requerimientos contienen afirmaciones que el código contradice (Fase 8 "pendiente" cuando está construida; aforo "FALTA" cuando existe). Esto puede llevar a reconstruir funcionalidad ya existente o a subestimar el avance real ante el cliente.
- **App móvil sin funcionalidad real:** `mobile/` (Expo) es scaffolding sin cámara ni lógica de escaneo; toda la validación de acceso ocurre hoy vía navegador web (`html5-qrcode`), lo cual puede no ser aceptable para operación de puerta en eventos grandes.

## Recomendaciones para el siguiente sprint

1. **Cerrar las decisiones de cliente que bloquean desarrollo:** dominio del micrositio, precios de planes y definición de billetera virtual — son de bajo esfuerzo de desarrollo pero bloquean tickets de prioridad Alta ya en curso.
2. **Arreglar el bug de eventos privados** (`visibility="private"` inalcanzable) — es una corrección puntual y de alto impacto en `backend/routers/events.py`.
3. **Definir con el cliente el alcance real de pasarelas de pago** antes de seguir invirtiendo en otras áreas: confirmar si Stripe-only es aceptable para el lanzamiento o si Nuvei/Kushki/PayPhone/Datafast son obligatorios, dado el esfuerzo que implican.
4. **Activar el enforcement de `plan_features.py`** (`assert_feature` ya existe pero no se invoca) para cerrar la brecha de fuga de ingresos antes de facturar planes reales.
5. **Completar el envío automático de invitaciones** sobre listas verificadas (la importación ya funciona; falta únicamente el disparo de email).
6. **Conectar el envío parametrizable de e-ticket/QR** a un job programado real, ya que las columnas de configuración existen pero están desconectadas de cualquier proceso.
7. **Actualizar `CLAUDE.md` y el estado de fases** para reflejar que "Tipos de evento multifunción/abono" y "Gestión de aforo" ya están construidos, evitando retrabajo o subestimación del avance frente al cliente.
8. **Priorizar el módulo de reportería del organizador** (export de ventas + gráficos), dado que hoy esas capacidades solo existen en el panel de super-admin.
9. **Definir con el cliente la política de reembolsos ante cancelación** y automatizar el reembolso masivo — hoy es 100% manual, orden por orden.
10. **Evaluar si la ampliación de plantillas del micrositio (3 → 45) es viable como está definida**, o si conviene renegociar el alcance de ese criterio de aceptación con el cliente antes de comprometer el sprint a construir 42 plantillas adicionales.
