# Estado del contrato, fase por fase

**Fecha:** 12 de agosto de 2026
**Método:** auditoría del código real contra el pliego de 4 fases. Cada ítem se
verificó leyendo el código, no por el nombre de los archivos.

Los estados no se colapsan nunca:

| | |
|---|---|
| ✅ | **Implementado y verificado** — está y tiene tests o prueba documentada |
| 🟡 | **Parcial** — se dice exactamente qué parte falta |
| ⛔ | **No existe** |
| 🚫 | **No contemplado a propósito** — con el motivo |
| 💵 | **Bloqueado por una decisión de plata o de credenciales**, no por desarrollo |

---

## Resumen ejecutivo

**Fase 1 (arquitectura y white label): sustancialmente completa.** Multi-tenant
real, configuración por dominio, roles, perfiles, PWA. Falta el registro con
teléfono obligatorio — y eso está 💵: la capa de datos está entera, lo que no hay
es proveedor de SMS contratado.

**Fase 2 (red social y módulos): completa en lo grueso, con huecos concretos.**
Los siete módulos existen y funcionan. Lo que falta son piezas puntuales que el
pliego nombra: reseñas y horarios en Negocios, tipo de propiedad en Vivienda,
editar/eliminar publicaciones, y el plan de agencias inmobiliarias.

**Fase 3 (Creator Marketplace y monetización): el hueco más grande de todos.**
El marketplace funciona de punta a punta salvo por lo esencial: **el dinero no se
mueve**. Los pagos corren en modo demostración porque Stripe Connect no está
conectado. Eso es 💵, no desarrollo — pero sin eso, 10 de los 15 criterios de
aprobación de la fase no se pueden demostrar.

**Fase 4 (super admin, seguridad y lanzamiento): fuerte en lo construido, con
dos deudas serias.** El Super Admin, el broadcast y la prueba de white label
están y están probados. Las deudas: una **fuga de lectura entre comunidades** que
se está cerrando en esta misma entrega, y **ninguna restauración de backup
probada**, que el pliego exige explícitamente.

---

## Fase 1 — Arquitectura, diseño, usuarios y white label

| Bloque | Estado |
|---|---|
| Multi-tenant con `tenant_id` y resolución por dominio | ✅ |
| Configuración por dominio (nombre, logo, color, país, idioma, moneda, precios, admins) | ✅ en datos · 🟡 en pantalla: país, idioma, moneda y logo sólo se setean al crear el dominio o por SQL |
| Crear dominios nuevos sin tocar código | ✅ (script completo + panel) |
| Registro de acciones administrativas | ✅ |
| Prueba de aislamiento multidominio | ✅ documentada y ejecutada con tokens reales |
| Registro por correo, Google, Apple, recuperación de contraseña | ✅ |
| **Registro con teléfono obligatorio + SMS** | 💵 la capa de datos está completa (códigos, expiración, límite de intentos, una cuenta por teléfono). **No hay proveedor de SMS contratado**, así que el código se escribe en el log del servidor en vez de enviarse |
| Los 7 roles | 🟡 seis existen; **"profesional" no existe como rol de cuenta**, sólo como tipo de aviso |
| Perfil completo (foto, portada, bio, idiomas, seguidores, guardados, privacidad, bloqueo, score, insignias) | ✅ |
| Responsive + PWA (manifest por comunidad, service worker, offline) | ✅ |
| Navegación inferior de 5 ítems con botón central | ✅ |

**Lo que falta de verdad en Fase 1:** el proveedor de SMS (💵) y el rol de
profesional. Lo demás son pantallas de configuración que hoy se resuelven por
script.

---

## Fase 2 — Red social y módulos principales

| Bloque | Estado |
|---|---|
| Feed: publicar texto/foto/video, likes, comentarios, compartir, guardar, seguir, reportar | ✅ |
| **Etiquetar personas y música en publicaciones** | ✅ **entregado en esta tanda** |
| **Filtros y editor de fotos** | ✅ **entregado en esta tanda** |
| **Editar y eliminar publicaciones propias** | ⛔ → se entrega en esta tanda |
| Respuestas a comentarios (hilos) | ⛔ los comentarios son de un solo nivel |
| Ubicación en la publicación | ⛔ |
| Videos cortos: feed vertical, autoplay, categorías, likes/comentarios | ✅ |
| Compresión y transcodificación de video | ⛔ el video sube directo del navegador, sin procesamiento |
| Búsqueda global + autocompletado | ✅ |
| **Buscador propio en cada módulo** | ✅ **Empleos era el único que faltaba y se entrega en esta tanda** |
| Vivienda | 🟡 falta **tipo de propiedad** (se entrega en esta tanda) y el **plan de agencias con tope de 50 avisos** (⛔) |
| Eventos | 🟡 falta página propia del organizador y botón de seguir |
| **Negocios: reseñas y horario de atención** | ⛔ → se entregan en esta tanda |
| Negocios: resto (página, roles de administración, score, WhatsApp por plan) | ✅ |
| Profesionales | 🟡 faltan idiomas y horario como campos propios, y verificación de credenciales |
| Empleos (separado del Creator Marketplace, con 5 preguntas de filtro, panel de candidatos y estados) | ✅ · 🟡 "entrevista" es un estado, no una agenda con fecha |
| Marketplace (productos, tienda, plan mensual, botón comprar externo) | ✅ |
| Mensajes, bloqueo, reportes, notificaciones agrupadas | ✅ |
| Moderación con IA, cola manual, suspensiones, auditoría | ✅ · 🟡 **falta "advertencia"** como sanción intermedia |
| Video en los módulos de avisos (vivienda, eventos, negocios, marketplace) | ⛔ sólo fotos; el video existe en Feed y Videos Cortos |

---

## Fase 3 — Creator Marketplace y monetización

| Bloque | Estado |
|---|---|
| Solicitud de creador, revisión y aprobación | ✅ |
| **Requisitos de elegibilidad configurables desde el panel** | ✅ los 11 que pide el pliego, ninguno hardcodeado |
| Verificación de identidad (Stripe Identity) | ✅ integrada · 💵 degradada en producción por credenciales de prueba |
| **Stripe Connect para que el creador cobre** | 💵 **las tablas están listas y vacías. No hay onboarding ni transferencias.** Es el bloqueante número uno de la fase |
| **Los pagos del marketplace** | 💵 **corren en modo demostración**: la máquina de estados (financiado → entregado → liberado) es real, pero mueve un estado en la base, no dinero |
| Comisión 20/80 configurable por comunidad y congelada al firmar | ✅ **entregado ayer** |
| Job ID `CL-CM-2026-000001` | 🟡 existe y es sólido, pero aparece en 2 de los 12 puntos que pide el pliego (falta en chat, recibos, entregables, moderación y reseñas) |
| Entregables y solicitudes de cambio | 🟡 las tablas existen desde hace meses, **sin ninguna pantalla que las use** |
| Disputas de contrato | 🟡 el estado existe, **no hay panel donde resolverlas** |
| Paneles financieros (creador, negocio, administración) | ⛔ |
| **Boost local / nacional / global** | ⛔ → se entrega en esta tanda. Hoy el impulso es sólo por duración (7/14/30 días) |
| Estadísticas de campaña | 🟡 hay vistas, likes, alcance y clics; faltan impresiones y reproducciones |
| Suscripciones (tiendas, renovación, pagos fallidos, cancelación) | ✅ |
| Planes de agencias inmobiliarias | ⛔ |
| Insignia paga "Community Latina Verified" | ⛔ existe la verificación de identidad (gratis) y los planes premium, pero no la insignia como producto |
| Verificación de identidad **separada** de la insignia paga | ✅ son dos cosas distintas en el código, como pide el pliego |
| **Content Integrity completo** | ✅ SHA-256, huella de imagen, de video y de audio, duplicados, similares, procedencia, declaraciones, alertas, disputas y umbrales por comunidad |
| Arquitectura lista para lives/regalos/monedas/wallet/PPV | 🟡 la estructura no bloquea nada y hay webhooks de Stripe, pero **no existe el libro contable (ledger)** ni tabla de retiros — está documentado como pendiente deliberado |

---

## Fase 4 — Super Admin, seguridad, pruebas y lanzamiento

| Bloque | Estado |
|---|---|
| Super Admin: crear tenants, dominios, admins, ver todo, precios, métricas, auditoría | ✅ |
| Broadcast global a uno, varios o todos los dominios | ✅ probado con peticiones reales · 🟡 **no se puede editar ni borrar un broadcast desde ninguna pantalla** |
| Administrador local encerrado en su dominio | ✅ verificado con tokens reales contra la base, no sólo ocultando botones |
| **Aislamiento de lectura entre comunidades** | ⛔ → **se cierra en esta entrega.** 13 tablas tenían lectura abierta: un usuario de una comunidad podía leer datos administrativos de otra |
| Permisos verificados en el servidor | ✅ 37 acciones auditadas sin fallas |
| Límites de solicitudes (rate limiting) | ✅ · 🟡 vive en memoria de cada instancia, no escala a varias regiones |
| **Validación de archivos en el almacenamiento** | ✅ **cerrado en esta entrega**: los cinco buckets ya tienen tope de tamaño y tipos permitidos |
| Segundo factor (MFA) en cuentas administrativas | ⛔ cero usuarios con MFA, incluidas las cuentas con acceso a todas las comunidades |
| **Restauración de backup probada** | ⛔ **el pliego lo exige explícitamente y no hay ninguna constancia de haberlo hecho** |
| Plan de recuperación ante desastres | ⛔ sólo existe un borrador conceptual, nunca convertido en documento de entrega |
| Pruebas de carga | ⛔ |
| Pruebas en iPhone, Android, Safari, Chrome, tablet y computadora | ⛔ sin evidencia automatizada ni manual |
| Integración continua (CI) | ⛔ no hay pipeline; todo corre a mano |
| Documentación de APIs, arquitectura, manuales de Super Admin y admin local, crear dominio, servicios y costos | ✅ los 6 documentos existen |
| Documento de traspaso de accesos (hosting, base, almacenamiento, Stripe) | ⛔ |
| Capacitación, runbook de lanzamiento, garantía | ⛔ |
| **Prueba final de white label** | ✅ es la pieza más sólida de la entrega: tenant temporal creado, probado minuto a minuto y borrado |

---

## Lo que hay que decidir, no programar

Estas cinco cosas no avanzan por más horas de desarrollo que se les pongan:

1. **Stripe Connect en producción.** Sin esto el Creator Marketplace no mueve
   dinero y la Fase 3 no se puede aprobar. Es la decisión más urgente.
2. **Proveedor de SMS.** El registro con teléfono está construido y apagado.
3. **Credenciales reales de Stripe** (hoy en modo prueba) y de los servicios de
   moderación de imagen.
4. **Reconocimiento de música comercial y de rostros/escenas**: requiere un
   proveedor con catálogo licenciado. Presupuesto estimado por el propio pliego:
   US$200–500 por mes.
5. **Ventana para probar una restauración de backup.** Es un ejercicio de una
   tarde, pero hay que hacerlo y documentarlo: el pliego dice, con razón, que
   activar backups no alcanza.
