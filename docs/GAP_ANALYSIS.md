# Análisis de Brechas — FRD vs Estado Actual

> Comparación entre el Documento de Requerimientos Funcionales (DRF) entregado y lo implementado en TYS a junio 2026.

**Leyenda:** ✅ Implementado · ⚠️ Parcial · ❌ No implementado

---

## 2. Tipos de Usuarios

### 2.1 Super Administrador
| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Gestionar usuarios y organizaciones | ✅ | Admin puede ver, aprobar, rechazar, suspender organizadores |
| Gestionar planes de suscripción (CRUD + activar/desactivar) | ✅ | `/admin/planes` completo |
| Configurar métodos de pago | ❌ | No existe UI de admin para agregar/configurar métodos de pago. Stripe está hardcodeado en `.env` |
| Gestionar escenarios predeterminados | ❌ | No hay biblioteca de venues/escenarios predefinidos desde super admin |
| Supervisar eventos creados | ✅ | `/admin/eventos` con filtros cross-tenant |
| Consultar estadísticas generales | ✅ | Dashboard global con MRR, GMV, top eventos/organizers |
| Administrar suscripciones | ✅ | Panel de planes y suscripciones activas |
| Gestionar facturación | ⚠️ | Solo visible en panel Stripe; no hay módulo de facturación propio |
| Configurar parámetros globales de la plataforma | ⚠️ | Solo planes y fee %. Sin UI para otros parámetros globales |
| Gestionar permisos y roles | ⚠️ | Solo 2 roles fijos (super_admin / organizer). Sin gestión de permisos granulares desde UI |

### 2.2 Organizador de Eventos
| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Registrarse en la plataforma | ✅ | Registro con validación, slug único, approval flow |
| Contratar un plan de suscripción | ✅ | Stripe Checkout para planes mensuales y evento único |
| Administrar perfil organizacional | ✅ | Configuración: datos de empresa, seguridad, microsite |
| Crear múltiples eventos | ✅ | Con límite por plan |
| Editar eventos | ✅ | Wizard 6 tabs completo |
| Publicar o despublicar eventos | ✅ | Con guard para organizers pending |
| Configurar información del evento | ✅ | Nombre, desc, categoría, fechas, ubicación, imágenes |
| Administrar entradas | ⚠️ | Solo 1 tipo de entrada por evento (Fase 8 agrega multi-tipos) |
| Visualizar estadísticas de ventas | ✅ | Dashboard con KPIs + tabla de órdenes |
| Gestionar asistentes | ⚠️ | Solo vista de lista en validación; sin gestión completa de asistentes |
| Configurar página pública de cada evento | ✅ | Microsite + página de evento configurable |
| Gestionar personal de acceso al evento | ❌ | No existe sistema de usuarios colaboradores/staff |

### 2.3 Cliente / Asistente
| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Consultar eventos disponibles | ✅ | Microsite público + página de evento |
| Registrarse en la plataforma (opcional) | ❌ | Los compradores no tienen cuenta. Compra como invitado con email |
| Comprar entradas | ✅ | Modal de compra con selección de tickets y asientos |
| Realizar pagos en línea | ✅ | Stripe, transferencia, efectivo |
| Descargar entradas digitales | ✅ | PDF descargable desde `/orden/:id` |
| Recibir confirmaciones por correo electrónico | ✅ | Email con QR y PDF adjunto |
| Consultar información del evento | ✅ | Página pública del evento |
| Administrar sus compras | ❌ | Sin portal de compras para el asistente; solo URL directa de orden |

---

## 3. Landing Page Comercial

| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Presentación comercial (info, beneficios, funcionalidades, casos de uso) | ⚠️ | Landing existe pero es básica; sin sección de casos de uso ni beneficios detallados |
| Visualización y comparación de planes | ✅ | Tabla de planes en landing |
| Registro de usuarios y organizaciones | ✅ | `/registro` |
| Pago de suscripciones | ✅ | Stripe Checkout desde onboarding |
| Formulario de contacto | ❌ | No existe |
| Preguntas frecuentes (FAQ) | ❌ | No existe |
| Información comercial | ⚠️ | Footer con datos mínimos |

---

## 4. Módulo de Administración Global

| Requerimiento FRD | Estado | Notas |
|---|---|---|
| CRUD planes + activar/desactivar | ✅ | Completo |
| Configurar límites por plan (max eventos, tickets) | ✅ | `max_events`, `max_tickets_per_event`, `includes_numbered` |
| Límite: número de asistentes | ❌ | No implementado como límite de plan |
| Límite: número de usuarios administradores/staff | ❌ | No hay usuarios staff todavía |
| Límite: capacidad de almacenamiento | ❌ | Sin control de storage |
| Funcionalidades premium por plan | ✅ | `plan_features.py` con feature flags |
| Gestión de métodos de pago (crear, activar, credenciales, comisiones) | ❌ | No existe. Stripe hardcodeado |
| Crear/editar/eliminar escenarios base predefinidos | ❌ | No hay biblioteca de templates de venues |
| Reportes globales (ventas, suscripciones, eventos, ingresos) | ✅ | Dashboard + 5 exports CSV |

---

## 5. Plataforma de Organizador

### Gestión de Eventos
| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Nombre, descripción, categoría, fecha/hora | ✅ | |
| Ubicación | ✅ | venue_name + address + city |
| Imagen principal y galería | ✅ | Poster + banner + galería hasta 10 imgs |
| Aforo máximo | ✅ | capacity field |
| Reglas y políticas | ❌ | Sin campo de reglas/políticas del evento |
| Agenda del evento | ❌ | Sin sección de agenda/horarios |
| Seleccionar escenario predefinido de biblioteca | ❌ | No hay biblioteca de templates |
| Crear escenario personalizado (editor Konva) | ✅ | Editor completo fases 6a+6b |

### Gestión de Entradas
| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Crear tipos de entrada (múltiples) | ⚠️ | Solo 1 tipo por evento. Multi-tipos es Fase 8 |
| Configurar precios y stock | ✅ | |
| Configurar fechas de venta (ventana) | ✅ | `sales_start` / `sales_end` |
| Generar códigos únicos | ✅ | JWT firmado con UUID |
| Configurar promociones y descuentos | ✅ | Promo codes + descuentos automáticos por cantidad |

### Gestión de Página del Evento
| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Banner, descripción, ubicación, galería, info organizador | ✅ | |
| Agenda | ❌ | Sin sección de agenda |
| Preguntas frecuentes | ❌ | Sin FAQ en página de evento |
| Entradas disponibles en página pública | ✅ | PurchaseModal embebido |

### Gestión de Ventas
| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Visualización de ventas e historial | ✅ | Lista de órdenes + exportación CSV |
| Estado de pagos | ✅ | pending / paid / rejected / refunded |
| Reembolsos | ⚠️ | Funcionalidad backend (`refund`), UI básica |
| Estadísticas de conversión | ❌ | Sin funnel de conversión por evento |

### Gestión de Personal
| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Crear usuarios colaboradores | ❌ | No implementado |
| Asignar permisos a colaboradores | ❌ | No implementado |
| Asignar acceso a eventos específicos | ❌ | No implementado |

---

## 6. Portal Público del Evento

| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Información del evento (detalles, ubicación, fecha, horarios, organizador) | ✅ | |
| Compra de entradas con pago en línea | ✅ | |
| Registro de asistentes + gestión de perfil | ❌ | Compradores sin cuenta |
| Generación de QR | ✅ | |
| Descarga en PDF | ✅ | |
| Envío por correo electrónico | ✅ | |

---

## 7. Sistema de Control de Acceso

| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Escaneo de código QR | ✅ | `html5-qrcode` en browser y app mobile |
| Búsqueda manual por nombre/email de asistente | ⚠️ | Solo por token JWT (paste manual), no por nombre/email |
| Validación de autenticidad | ✅ | JWT verificado en backend |
| Prevención de duplicados | ✅ | Estado `already_used` |
| Hora de ingreso | ✅ | `used_at` registrado |
| Estado de asistencia | ✅ | |
| Control de reingreso | ❌ | No implementado. Ticket queda `used` permanentemente |
| Monitoreo en tiempo real (asistentes, capacidad, ocupación por zona) | ❌ | Sin dashboard en tiempo real en puerta |
| Operación offline con sincronización posterior | ❌ | No implementado |

---

## 8. Requerimientos No Funcionales

| Requerimiento FRD | Estado | Notas |
|---|---|---|
| Autenticación segura (JWT + bcrypt) | ✅ | |
| Gestión de roles y permisos | ✅ | RBAC básico (2 roles) |
| Cifrado de datos sensibles | ✅ | Passwords bcrypt, tokens JWT HS256 |
| Arquitectura multi-tenant | ✅ | Slug por subdomain, query param y ruta |
| Auditoría (registro actividades, trazabilidad) | ✅ | `audit_log` collection |
| Disponibilidad 99.9% | N/A | Depende del hosting |

---

## Lo que existe en TYS pero NO está en el FRD

Estas funcionalidades fueron construidas pero no estaban especificadas en el documento original:

| Funcionalidad | Descripción |
|---|---|
| **Microsite editor por organizador** | Cada organizador tiene un microsite con branding propio (logo, banner, colores, tipografía, template). Editor WYSIWYG con previsualización |
| **Activation funnel tracking** | Seguimiento del funnel de onboarding del organizador (email enviado → link clicado → perfil completado) visible en super admin |
| **Email log de desarrollo** | Log interno de todos los emails enviados (`/api/_dev/emails`) para debugging sin Resend real |
| **Múltiples métodos de pago por evento** | Cada evento puede activar individualmente Stripe, transferencia bancaria y efectivo, con instrucciones customizadas por organizador |
| **Venue editor visual avanzado** | Editor Konva con escenarios, zonas, filas rectas y curvas, mesas, asientos individuales. Undo/redo, auto-save, snap grid, zoom. Lock estructural ante ventas |
| **Descuentos avanzados con promo codes** | Reglas de descuento con tipo (promo_code / auto / quantity), ventana de validez, cuota de usos, filtro por localidad, stacking promo + auto |
| **Preview de orden antes de pagar** | Endpoint `/orders/preview` que calcula subtotal, descuentos, fees y total sin crear la orden |
| **Feature flags por plan** | `plan_features.py` controla qué features activa cada plan (numbered seats, AI design, custom domain, max events/tickets) |
| **Funnel de activación admin** | Gráficas de conversión del funnel de onboarding de nuevos organizadores |
| **Exports CSV multi-dimensionales** | 5 tipos de export desde super admin: organizadores, eventos, órdenes, auditoría, reporte mensual ejecutivo |
| **App mobile (Expo)** | Scanner QR nativo para validación en puerta (mencionado como "futuro" en FRD) |

---

## Resumen de Brechas Críticas

### Prioridad Alta (bloquean uso real en producción)
1. **Gestión de personal/staff** — sin poder crear usuarios validadores, el organizador debe darle su propia cuenta a cada persona de puerta
2. **Multi ticket types** — sin esto, eventos con VIP/General/Early Bird no son viables
3. **Búsqueda manual de asistentes** — por nombre/email, no solo por token
4. **Portal del asistente** — historial de compras, re-descarga de tickets

### Prioridad Media (UX incompleta)
5. **Agenda del evento** — campo básico que los asistentes esperan
6. **FAQ en landing y evento** — contenido de conversión y soporte
7. **Reglas y políticas del evento** — requerido legalmente para muchos eventos
8. **Multi-función (múltiples fechas)** — eventos de varios días/horarios
9. **Control de reingreso** — escenarios de conciertos y festivales

### Prioridad Baja (valor futuro)
10. **Escenarios predefinidos desde super admin** — templates reutilizables
11. **Registro de asistentes con cuenta** — historial y gestión propia
12. **Monitoreo tiempo real en puerta** — capacidad ocupada por zona en vivo
13. **Gestión de métodos de pago desde admin** — agregar Kushki, PayPal, etc.
14. **Operación offline** — para eventos en lugares sin conectividad
