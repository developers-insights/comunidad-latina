# PLAN MAESTRO — Comunidad Latina (alias NYLabel)

**Red social white-label multi-tenant (PWA) para la diáspora latina en EE.UU./Europa**

| | |
|---|---|
| **Cliente** | Geovanny (Global Super Admin, operador de la red) |
| **Desarrollo** | INSIGHTS |
| **Versión** | 1.0 — Plan Maestro consolidado |
| **Fecha** | 2026-07-06 |
| **Estado** | CANON — fuente de verdad única del proyecto |
| **Ejecutor previsto** | Enjambre de agentes orquestados (Fable 5, modo Workflow) en sesión separada |
| **Insumos** | 7 informes de investigación en `docs/investigacion/` (referenciados a lo largo del documento, nunca repetidos íntegros) |

> Este documento consolida, reconcilia y da forma ejecutable a la investigación de 7 especialistas (arquitectura de datos, app Next.js, benchmark de producto, pagos, IA/moderación, módulos sociales, infraestructura/DevOps). Donde los informes chocaban, este documento toma una decisión firme y la marca como **CANON**. No hay "podría ser A o B" en este documento salvo en la sección 14 (Decisiones Pendientes de Geovanny), que son las únicas incógnitas legítimas que dependen del dueño del negocio, no del arquitecto.

---

## Índice

1. [Resumen ejecutivo y visión del producto](#1-resumen-ejecutivo-y-visión-del-producto)
2. [Principios de arquitectura](#2-principios-de-arquitectura)
3. [Stack y servicios finales (con costos)](#3-stack-y-servicios-finales-con-costos)
4. [Modelo de datos canónico](#4-modelo-de-datos-canónico)
5. [Seguridad multi-tenant](#5-seguridad-multi-tenant)
6. [Mapa de módulos y épicas (grafo de dependencias)](#6-mapa-de-módulos-y-épicas-grafo-de-dependencias)
7. [Monetización](#7-monetización)
8. [IA de moderación + media pipeline](#8-ia-de-moderación--media-pipeline)
9. [Paneles de administración + Broadcast Global](#9-paneles-de-administración--broadcast-global)
10. [Roadmap del producto completo por fases/épicas](#10-roadmap-del-producto-completo-por-fasesépicas)
11. [Plan de ejecución para el enjambre (Fase 3)](#11-plan-de-ejecución-para-el-enjambre-fase-3)
12. [Entorno y prerequisitos](#12-entorno-y-prerequisitos)
13. [Riesgos y mitigaciones](#13-riesgos-y-mitigaciones)
14. [Decisiones pendientes de Geovanny](#14-decisiones-pendientes-de-geovanny)
15. [Referencias a los 7 informes](#15-referencias-a-los-7-informes)

---

## 1. Resumen ejecutivo y visión del producto

### 1.1 Qué estamos construyendo

**Comunidad Latina** es un **motor único** (Next.js + Supabase) que sirve **N redes sociales independientes por país de origen** — `colombianos.com`, `dominicanos.com`, `mexicanos.com`, `venezolanos.net`, etc. — cada una con su propio dominio, branding, moneda e idioma, pero compartiendo el mismo código, la misma base de datos y el mismo ciclo de deploy. Los datos de cada comunidad están **aislados por `tenant_id` + Row Level Security (RLS)**, no por infraestructura separada. Un **Global Super Admin** (Geovanny) administra todas las comunidades desde un panel único y puede publicar **Broadcast Global** (alertas cross-tenant, p. ej. persona desaparecida) que llegan a todos los dominios a la vez.

No es un MVP. Es el **producto completo**: 5 feeds sociales (Principal, Propiedades, Negocios, Eventos, Profesionales), Trust Score anti-fraude, Stories efímeras, Grupos con Q&A, Creator Marketplace con escrow, Marketplace de Tiendas con Stripe Connect, moderación de IA en 3 niveles (texto/imagen/video), y 3 paneles de administración (Global, Domain Admin, Moderador).

### 1.2 Por qué este modelo y no otro

El brief original y el informe de benchmark (03) coquetearon con vender el motor como SaaS a terceros ($2-5k/mes por licencia de dominio). **Ese no es el modelo core.** El modelo real es: **Geovanny opera las comunidades y monetiza a los usuarios finales** — membresías de Propiedades/Negocios/Profesionales/Eventos, Boost geolocalizado, publicidad en el Feed Principal, 20% de comisión en el Creator Marketplace, y mensualidad de las Tiendas. "Vender el sistema completo a terceros" queda en el backlog como oportunidad futura, no como parte del roadmap core — no diseñamos para eso hoy, aunque la arquitectura shared-schema no lo impide si se decide más adelante.

### 1.3 Por qué el modelo de datos es el corazón del proyecto

El informe `01-arquitectura-multitenant-datos.md` es la **fuente de verdad transversal** de este plan. La decisión más importante del proyecto — **shared schema + `tenant_id` + RLS** en vez de schema-per-tenant o database-per-tenant — está tomada porque:

1. El Broadcast Global cross-tenant (feature estrella del Super Admin) es trivial en shared schema y una pesadilla de fan-out en cualquier otra estrategia.
2. Con ambición de decenas de dominios, schema-per-tenant colapsa el catálogo de Postgres y las migraciones se vuelven O(N).
3. Supabase es un solo proyecto Postgres con Auth viviendo en el schema `auth` — pelear contra eso con schema-per-tenant es nadar contra la corriente del proveedor elegido.
4. Agregar un tenant nuevo cuesta **una fila en una tabla**, no infraestructura nueva. Esto es lo que habilita "crear un dominio en minutos".

El costo de esta decisión es que el aislamiento es **lógico, no físico** — por eso la seguridad multi-tenant (sección 5) es, con diferencia, la sección más crítica de todo el documento, y **una fuga cross-tenant es el Riesgo #1 del proyecto**.

### 1.4 Para quién es este documento

- **Geovanny (cliente):** secciones 1, 10, 13, 14 — visión, roadmap, riesgos, y qué decisiones le tocan a él.
- **Arquitectos/tech leads:** secciones 2, 4, 5, 6 — principios, modelo de datos, seguridad, mapa de dependencias.
- **El enjambre de agentes que ejecuta (Fable 5):** sección 11 — es el input directo, épica por épica, tarea por tarea, con agente sugerido y criterio de "hecho".
- **DevOps/infra:** secciones 3, 9, 12 — stack, paneles, prerequisitos de entorno.

---

## 2. Principios de arquitectura

Estos cinco principios son innegociables. Toda decisión de diseño posterior en este documento se deriva de ellos. Cualquier propuesta futura que los viole debe rechazarse o escalarse explícitamente como excepción documentada.

### 2.1 Multi-tenant por defecto, en todas las capas

No solo la base de datos es multi-tenant — **toda** capa del sistema lo es: el middleware de Next.js resuelve tenant por hostname, el JWT lleva el tenant como claim firmado, el Storage particiona por `tenant_id/...`, los canales de Realtime se nombran por tenant, y hasta la generación de branding por IA se ejecuta "por tenant". No existe una ruta, tabla, canal o bucket que sea "compartido sin aislamiento" salvo el puñado de entidades explícitamente globales documentadas en §4.2.

### 2.2 Seguridad zero-trust: la capa de aplicación nunca es la última línea de defensa

El middleware de Next.js **solo enruta** — nunca es la capa de autorización (lección directa del CVE-2025-29927 documentado en el informe 02). La autorización real vive en tres lugares redundantes: Server Actions/Route Handlers (validan módulo + rol + tenant), y **RLS en Postgres como garantía final e innegociable**. Si el middleware fallara, si un header fuera spoofeado, si un desarrollador olvidara un chequeo — RLS sigue filtrando por `tenant_id` derivado del JWT firmado por Supabase Auth. Ningún dato sensible se sirve confiando en una sola capa.

### 2.3 PWA-first, no apps nativas

El producto es una **Progressive Web App instalable desde el navegador**, sin fricción de App Store/Google Play. Esto es canon para el roadmap core. Apps nativas iOS/Android (Flutter, como sugirió el benchmark 03) son una **Fase 2+ fuera del alcance de este plan** — se documentan como posibilidad futura en el backlog, no se planifican épicas para ellas aquí. La razón de negocio: la fricción de instalación de una PWA es cero (un tap en "Agregar a inicio"), mientras que apps nativas exigen revisión de tienda, cuentas de developer, y un ciclo de release completamente distinto — inversión que no se justifica antes de validar retención con la PWA.

### 2.4 Provider-agnostic en las piezas que rotan rápido

Los proveedores de IA (moderación de texto/imagen/video) y de media (streaming de video) cambian de precio y de estado (Perspective API se discontinúa a fines de 2026) más rápido que el ciclo de vida del producto. Por eso el pipeline de moderación se diseña detrás de **interfaces** (`TextModerator`, `ImageModerator`, `VideoModerator`, `VideoProvider`, `StorageProvider`) — cambiar de OpenAI a otro proveedor de moderación, o de Cloudflare Stream a otro proveedor de video, es una migración de un adaptador, no una reescritura del orquestador. Esto no es over-engineering especulativo: es una respuesta directa a un riesgo ya documentado (discontinuación real de un proveedor de la categoría).

### 2.5 Realtime y feeds a escala: fan-out on read, nunca on write masivo

Con potencialmente decenas de tenants y miles de usuarios por tenant, cualquier patrón que escriba una fila por destinatario en el momento de publicar (fan-out on write) explota en storage y en latencia de publicación. El canon del proyecto es **fan-out on read** (el feed se arma en el momento de la consulta, filtrado por RLS + `tenant_id` + `feed_type`, con **keyset pagination**, nunca OFFSET) combinado con **Broadcast from Database** de Supabase Realtime (una escritura dispara un evento liviano a un canal, no N escrituras). El mismo principio resuelve el Broadcast Global: modelo **pull** (`broadcasts` + `broadcast_targets` + `broadcast_receipts` bajo demanda), no fan-out masivo de millones de filas al publicar.

---

## 3. Stack y servicios finales — tabla con costos

### 3.1 Servicios y su rol

| Servicio | Rol en el producto | Por qué este y no otro |
|---|---|---|
| **Supabase** (Postgres 15/17 + Auth + Storage + Realtime + Edge Functions + pgmq + pg_cron) | Base de datos única (shared schema), autenticación, cola de moderación, funciones serverless, tiempo real | Un solo proyecto sirve todos los tenants; RLS nativo; Auth Hooks para JWT claims; pgmq evita infra de colas externa |
| **Vercel** (Pro/Enterprise) | Hosting Next.js, dominios custom por tenant, Edge Config, previews por PR | "For Platforms" soporta dominios ilimitados con plan pagado; SSL automático; API programática de dominios |
| **Cloudflare R2** | Storage de media pública (fotos de posts, listings, thumbnails, branding) | Egress **$0** — decisivo para un feed de alto tráfico de imágenes |
| **Cloudflare Stream** | Video social (grueso del volumen) | Precio por minuto predecible, sin sorpresas de egress regional (Sudamérica no penalizada) |
| **Bunny Stream** | Video premium con DRM (solo tier pago del Creator Marketplace) | Único de los dos con DRM real (MediaCage); reservado para donde el DRM se justifica económicamente |
| **Stripe Connect** (Express) | Pagos: membresías, Boost, Creator Marketplace (escrow), Tiendas | Única forma legal de que Geovanny no sea money transmitter; Express minimiza fricción de KYC para creadores/vendedores informales |
| **OpenAI Moderation API** (`omni-moderation-latest`) | Primera línea de moderación de texto | Gratis, +42% en eval multilingüe, español supera al inglés del modelo anterior |
| **Google Cloud Vision** (SafeSearch + Label Detection) | Moderación de imágenes + frames de video | Ya confirmado por el cliente; SafeSearch sale gratis si se corre junto con Label Detection |
| **Gemini 2.5 Flash** | Segunda opinión de texto en zona gris (score 0.3–0.7) | 3.3x más barato que Claude Haiku para clasificación de alto volumen; solo se invoca en el ~10% ambiguo |
| **Twilio** | Verificación SMS (Trust Score), SMS transaccional | Estándar de la industria para OTP; necesario para badge "Verificado" |
| **Resend** | Email transaccional (bienvenida, notificaciones, digest, dunning) | API moderna, buena entregabilidad, soporta remitente por tenant |
| **Sentry** | Error tracking cross-tenant (filtrable por `tenant_id`) | Tags nativos, releases, alertas |
| **nano banana (Gemini image)** | Generación de kit de branding por tenant (logo, banners, onboarding) | MCP ya disponible; genera y edita imágenes 2D con edición conversacional |

### 3.2 Estimación de costos

> Todas las cifras son estimaciones a julio 2026 (fuentes en informes 04, 05, 02). Re-validar antes de firmar contratos — los proveedores cambian tarifas.

**Costo por tenant (10.000 usuarios activos/mes, volumen moderado — desglose completo en informe 05 §9):**

| Partida | Costo/mes | Nota |
|---|---|---|
| Moderación de texto (OpenAI + Gemini zona gris) | ~$1 | OpenAI gratis; Gemini solo ~10% zona gris |
| Moderación de imagen (Vision Label+SafeSearch) | ~$50–148 | Con muestreo por Trust Score alto: baja a ~$50-70 |
| Moderación de video (frames) | ~$45 | 5k videos cortos/mes × ~6 frames |
| Video — Cloudflare Stream | ~$56 | Storage + delivery, 50k min vistos/mes |
| Storage imágenes — R2 | ~$3 | Egress $0 es la palanca principal |
| **Subtotal moderación + media por tenant** | **~$120–253/mes** | Con optimizaciones (cache de hash, muestreo): ~$120-160 |

**Costo de plataforma (global, no escala 1:1 por tenant):**

| Servicio | Plan / costo estimado | Nota |
|---|---|---|
| **Vercel Pro/Enterprise** | Pro desde $20/mes/asiento + uso; Enterprise a cotizar | **Obligatorio** para superar el límite de 50 dominios de Hobby. Con ambición de decenas de tenants, evaluar Enterprise si se supera el límite práctico de Pro. Cuantificar con Vercel Sales antes de firmar — "unlimited" de Vercel for Platforms está atado a un tier de contrato, no es gratis. |
| **Supabase** | Pro $25/mes base + overage (storage, compute, egress de DB) | Un solo proyecto para todos los tenants; escalar a Team/Enterprise si el volumen de conexiones/compute lo exige (ver §1.3 del informe 01, criterios de silo) |
| **Stripe Connect** | Sin costo fijo; 2.9%+30¢ por cargo + comisión Connect | Costo variable, proporcional al GMV de la red |
| **Twilio** | ~$0.0079/SMS (EE.UU.) + número(s) | Verificación SMS masiva es el costo variable principal |
| **Resend** | Free hasta 3.000 emails/mes, luego desde $20/mes | Escala con volumen de notificaciones |
| **Sentry** | Team $26/mes o superior según volumen de eventos | |
| **Bunny Stream (premium)** | Solo activo cuando existan creadores premium con DRM | Costo marginal, no fijo |

**Regla de oro de costos (de informe 05):** el video domina el costo de media, no la IA de moderación. Por eso el video corto es gratis con límite de 15s (control de gasto) y el video largo es premium (quien lo consume/produce ayuda a pagarlo).

---

## 4. Modelo de datos canónico

> **El informe `01-arquitectura-multitenant-datos.md` es la fuente de verdad completa del DDL.** Esta sección resume las ~35 tablas y documenta explícitamente cómo se integran las tablas propuestas por los informes de pagos (04), moderación (05) y social (06) bajo el esquema del 01 — no se repite el DDL íntegro aquí; se referencia por sección del informe 01 y se anota cada reconciliación.

### 4.1 Estándares no negociables de toda tabla de negocio

1. `tenant_id uuid NOT NULL` con FK a `tenants(id)`, salvo las excepciones globales de §4.2.
2. **`id` es UUID v7**, no UUID v4 aleatorio — **esta es una corrección de arquitectura sobre el DDL literal del informe 01** (ver Choque #13 en la nota de conciliación al final de esta sección).
3. `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz` con trigger.
4. RLS habilitado y **`FORCE`** en el 100% de las tablas de negocio.
5. Índice compuesto con `tenant_id` **siempre primera columna**.
6. FKs "tenant-aware": relaciones padre-hijo validadas por trigger `assert_same_tenant` o FK compuesta `(tenant_id, id)` donde el volumen lo justifique.
7. `WITH CHECK` en toda policy de INSERT/UPDATE.

### 4.2 Tablas globales (sin `tenant_id`, por diseño)

| Tabla | Rol |
|---|---|
| `tenants`, `tenant_domains`, `tenant_config`, `tenant_modules` | Identidad, routing, branding, feature flags del tenant (la fila ES el tenant) |
| `platform_admins` | Global Super Admins (cross-tenant por definición) |
| `plans_catalog` | Catálogo maestro de planes/precios (override por tenant en `tenant_config`) |
| `admin_audit_log` | Auditoría de acciones administrativas cross-tenant |
| `broadcasts`, `broadcast_targets`, `broadcast_receipts` | Broadcast Global — modelo pull (§9.3) |
| `stripe_events_processed` | Idempotencia de webhooks Stripe — infraestructura interna, sin necesidad de aislamiento por tenant |

### 4.3 Núcleo de tablas por dominio funcional (resumen)

| Dominio | Tablas (ver DDL en informe 01, sección indicada) | Reconciliación aplicada |
|---|---|---|
| **Usuarios y confianza** | `profiles`, `trust_scores`, `trust_events`, `follows` (01 §7.2) | + `trust_weights` (tabla de pesos versionada, propuesta por informe 06 §3.1) para poder ajustar la fórmula de Trust Score sin deploy |
| **Social base** | `posts`, `post_likes`, `comments` (01 §7.3) | + tablas satélite 1:1 opcionales `post_properties`, `post_business`, `post_event`, `post_professional` (patrón "STI ligero" del informe 06 §2.1) en vez de las tablas standalone `properties`/`businesses`/`professionals`/`events` del informe 01 §7.4 tal cual — **decisión de este plan**: se mantienen como **tablas propias** (`properties`, `businesses`, `professionals`, `events` del 01) por su riqueza de campos específicos (precio, m2, horarios, matrícula profesional), pero cada una añade `post_id` opcional si necesita aparecer también en el índice unificado de ranking; no se fuerza el patrón STI del 06 si la tabla vertical ya es suficientemente rica. Los campos de ranking (`boost_tier`, `boost_expires_at`, `author_plan_tier`, `rank_score`, `engagement_count`) del informe 06 §2.1 se añaden a **cada** tabla de feed (`posts`, `properties`, `businesses`, `professionals`, `events`), no solo a `posts` |
| **Verticales (feeds dedicados)** | `properties`, `businesses`, `professionals`, `events`, `event_rsvps` (01 §7.4) | Enriquecidas con columnas de ranking (ver arriba) |
| **Comunidad** | `groups`, `group_members`, `questions`→renombrada `qa_questions`, `answers`→renombrada `qa_answers`, `stories` (01 §7.5) | + `qa_votes` (constraint único `(target_type, target_id, user_id)`, informe 06 §5.1) reemplaza el `vote_count` simple del 01 con un modelo de votos auditable y anti-doble-voto; + `story_views` (informe 06 §4.3) |
| **Pagos y monetización** | `subscriptions`, `payments`, `ad_campaigns` (01 §7.7), `creator_jobs`, `creator_applications`, `stores`, `products` (01 §7.6) | **Reconciliación mayor** (ver §7.6 de este plan): la tabla `payments` del informe 01 se **fusiona** con la propuesta más rica del informe 04 §8, agregando columnas `flow`, `connected_account_id`, `application_fee_amount` sobre la base `kind`/`platform_fee_cents`/`ref_table`/`ref_id` del 01. Se agregan las tablas nuevas del informe 04: `connected_accounts`, `transfers`, `boosts` (esta última especializa/reemplaza el uso genérico de `ad_campaigns` para el caso Boost) |
| **Moderación** | `moderation_queue` (01 §7.8) | Se **enriquece** con las columnas del `moderation_jobs` del informe 05 §7: `modalities text[]`, `ai_scores jsonb` (crudo por proveedor, auditable), `decision_reason text`. Se mantiene el nombre `moderation_queue` del informe 01 como canónico (evitar dos tablas con el mismo propósito) |
| **Reportes** | — | `content_reports` (informe 05 §7 y 07 §10.4, coinciden) con `reporter_trust_at_time` (snapshot de peso, clave para el modelo anti-abuso del 06 §3) |
| **Notificaciones** | `notifications` (01 §7.8) | + `notification_outbox`, `push_subscriptions`, `notification_prefs` (informe 06 §6.1) — el outbox es el patrón de fan-out desacoplado; `notifications` sigue siendo la tabla in-app de lectura |
| **Idempotencia** | — | `idempotency_keys` (informe 06 §7.2), tabla transversal usada por cualquier mutación con efecto de pago o notificación |

### 4.4 Corrección de arquitectura: UUID v7, no UUID v4 (resolución de choque)

El informe 01 declara en su decisión D2 "tipo de `tenant_id`: `uuid`" y usa `gen_random_uuid()` (v4, aleatorio) en todo su DDL de ejemplo. El informe 06 (D2 de su propio TL;DR) exige **UUID v7** explícitamente para que el `id` sirva como segundo componente del cursor de keyset pagination (`ORDER BY created_at DESC, id DESC` funciona con cualquier UUID como desempate, pero `ORDER BY rank_score DESC, id DESC` — el patrón de ranking del informe 06 — se beneficia de que `id` sea monotónico en el tiempo para evitar comportamientos sutiles al mezclar recencia y desempate).

**Decisión de este plan (CANON):** todas las PK del esquema usan **UUID v7**, generado con la extensión `pg_uuidv7` (o equivalente disponible en Postgres 17/Supabase) o generación en la capa de aplicación si la extensión no está disponible en el proyecto Supabase elegido. Esto no rompe ninguna policy RLS ni ningún patrón de índice descrito en el informe 01 — es un cambio de función default en la columna `id`, no de tipo. Se documenta como la primera tarea de la Épica 1 (§11).

### 4.5 Orden de construcción (heredado del informe 01 §11, validado como canon)

1. Fundaciones: `tenants`, `tenant_domains`, `tenant_config`, `tenant_modules`, `platform_admins`, `plans_catalog` + Custom Access Token Hook + funciones helper.
2. Contrato RLS: plantilla + generador + suite de tests de aislamiento en CI.
3. Usuarios/Trust: `profiles`, `trust_scores`, `trust_events`, `trust_weights`, `follows`.
4. Social base: `posts`, `post_likes`, `comments` + keyset + feed endpoint.
5. Verticales: `properties`, `businesses`, `professionals`, `events`/`event_rsvps`.
6. Comunidad: `groups`, `group_members`, `qa_questions`, `qa_answers`, `qa_votes`, `stories`, `story_views`.
7. Monetización: planes/suscripciones/pagos + Stripe Connect (`connected_accounts`, `transfers`, `creator_jobs`, `creator_applications`, `stores`, `products`, `boosts`, `ad_campaigns`).
8. Moderación + Notificaciones + Broadcast Global.
9. Endurecimiento: Storage policies por tenant, Realtime por canal, `get_advisors`, partición donde aplique.

---

## 5. Seguridad multi-tenant

> Esta es la sección más importante del documento después del plan de ejecución. **El Riesgo #1 del proyecto es una fuga de datos cross-tenant**, y se combate con defensa en profundidad, nunca con una sola policy.

### 5.1 El mecanismo central: JWT claim desde `app_metadata`, nunca `user_metadata`

**CANON (resuelve el Choque #2/#7 de esta consolidación):** el `tenant_id` que gobierna el acceso a datos proviene **siempre** del JWT emitido por **Supabase Auth**, estampado por un **Custom Access Token Hook** que lee `profiles.tenant_id` y `platform_admins` en cada emisión/refresh de token, y lo escribe en `raw_app_meta_data` (`app_metadata`). **`user_metadata` nunca se usa para autorización** — es editable por el propio usuario vía `supabase.auth.updateUser()` y forjaría su tenant.

Esto **descarta explícitamente** dos patrones que aparecieron en informes secundarios: (a) el `NextAuth.js` con callback de sesión propuesto en el informe 07 §6.4 — la plataforma usa **Supabase Auth nativo**, no una capa adicional de NextAuth; (b) el `current_setting('app.current_tenant')` seteado "por el pooler en cada request" que el informe 02 §7 sugiere como mecanismo principal — ese mecanismo queda **relegado a uso secundario** (jobs server-side y Edge Functions sin sesión de usuario, tal como lo define el informe 01 §3.1), porque no hay forma natural de hacer `SET LOCAL` por request cuando el cliente habla directo con PostgREST vía supabase-js.

```sql
-- Funciones helper que leen el claim (informe 01 §3.3) — corazón del sistema de autorización
create or replace function public.auth_tenant_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_platform_admin')::boolean, false);
$$;
```

**Gotcha operativo a documentar en el flujo de admin:** los claims no se actualizan hasta el siguiente refresh de token (hasta 1h de default). Cambiar el rol o tenant de un usuario exige forzar re-login o esperar expiración — esto debe ser visible en el panel de admin ("el cambio de rol surte efecto cuando el usuario renueve su sesión").

### 5.2 RLS `FORCE` + policy reusable + el truco de performance `(select fn())`

Plantilla aplicada a **toda** tabla de negocio (detalle completo en informe 01 §5.1):

```sql
alter table public.<TABLE> enable row level security;
alter table public.<TABLE> force  row level security;   -- imprescindible: ni el owner bypasea

create policy "<TABLE>_select_tenant" on public.<TABLE> for select to authenticated
using ( tenant_id = (select public.auth_tenant_id()) or (select public.is_platform_admin()) );

create policy "<TABLE>_insert_tenant" on public.<TABLE> for insert to authenticated
with check ( tenant_id = (select public.auth_tenant_id()) );

create policy "<TABLE>_update_tenant" on public.<TABLE> for update to authenticated
using ( tenant_id = (select public.auth_tenant_id()) ) with check ( tenant_id = (select public.auth_tenant_id()) );

create policy "<TABLE>_delete_tenant" on public.<TABLE> for delete to authenticated
using ( tenant_id = (select public.auth_tenant_id()) );
```

El envoltorio `(select public.auth_tenant_id())` no es estilo — es funcional: dispara un **initPlan** evaluado **una vez por query**, no una vez por fila. Sin él, una tabla de 100K filas pasa de 5ms a 5s (el "init-plan trap", `auth_rls_initplan` en el Supabase Advisor). Es una regla sin excepción del proyecto.

### 5.3 Anti-fuga en FKs: relaciones padre-hijo tenant-aware

Riesgo sutil documentado en informe 01 §5.5: un `comment.post_id` que apunte a un post de **otro tenant**. Mitigación de dos niveles: (1) `tenant_id` denormalizado en toda tabla hija (ya es regla §4.1), y (2) trigger `assert_same_tenant()` o FK compuesta `unique(id, tenant_id)` + `foreign key (post_id, tenant_id) references posts(id, tenant_id)` en las relaciones más sensibles (comments, applications, RSVPs).

### 5.4 Bypass seguro del Super Admin — el patrón que NO abre un agujero

Geovanny necesita ver y administrar **todos** los tenants sin que eso signifique desactivar RLS.

**Qué NO hacer (informe 01 §6.1):**
- ❌ `service_role` desde el navegador o expuesta al cliente — bypasea RLS completo; un leak es pérdida total de aislamiento.
- ❌ Basar el bypass en `tenant_id` especial o en `user_metadata`.

**Qué SÍ hacer:**
1. Tabla `platform_admins(user_id)`, escrita solo server-side.
2. El Custom Access Token Hook estampa `is_platform_admin: true` en el JWT de esos usuarios.
3. Cada policy de SELECT incluye `or (select public.is_platform_admin())` — RLS sigue **activo**, solo se amplía para ese claim.
4. **Escritura administrativa cross-tenant** (suspender un negocio en cualquier dominio) va por **RPC `security definer` auditada**, nunca por policies abiertas de INSERT/UPDATE con el claim admin en el `WITH CHECK`:

```sql
create or replace function public.admin_suspend_business(p_business_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_platform_admin()) then raise exception 'not authorized'; end if;
  update public.businesses set status = 'suspended', updated_at = now() where id = p_business_id;
  insert into public.admin_audit_log(actor_user_id, action, target_table, target_id, meta)
  values (auth.uid(), 'suspend_business', 'businesses', p_business_id, jsonb_build_object('reason', p_reason));
end; $$;
```

### 5.5 Aislamiento fuera de Postgres: Storage y Realtime

El aislamiento **no termina en la base de datos** (informe 01 §9):

- **Storage (R2 y Supabase Storage):** paths con prefijo `tenant_id/...`; acceso mediado por **URLs firmadas generadas por el backend** tras validar `tenant_id` vía RLS. Nunca buckets públicos sin firma para contenido sensible.
- **Realtime:** canales nombrados por tenant (`tenant:{id}:feed:{feed_type}`, `tenant:{id}:user:{user_id}`), nunca un canal global filtrado del lado del cliente. Patrón **Broadcast from Database** (informe 06 D3): un trigger `AFTER INSERT` llama a `realtime.send()` con payload liviano al canal privado; RLS sobre `realtime.messages` valida pertenencia.
- **Edge Functions con `service_role`** (webhooks Stripe, moderación IA): derivan `tenant_id` de fuente confiable (metadata Stripe, fila de DB) — **jamás** de un body de cliente. Toda función administrativa re-valida `is_platform_admin()`.

### 5.6 Automatización y auditoría continua (evitar que un olvido = una fuga)

Con ~35 tablas, olvidar RLS en una es una fuga real. Mitigación obligatoria en CI:

1. **Generador** que recorre `information_schema`, detecta tablas con `tenant_id` sin policies, y aplica la plantilla (idempotente).
2. **Test de auditoría en CI** que falla el build si existe una tabla con `tenant_id` sin RLS `FORCE` + policies completas.
3. **`get_advisors`** de Supabase en el pipeline — alerta `rls_disabled_in_public` y `auth_rls_initplan`.
4. **Suite de tests de aislamiento** (informe 01 §5.6): SELECT cross-tenant devuelve 0 filas; INSERT con `tenant_id` ajeno rechazado; UPDATE que intente "mudar" una fila a otro tenant rechazado; Super Admin sí ve todo; moderador de A no modera B.

**Skills a invocar durante la ejecución:** `supabase-audit-rls`, `multi-tenant-safety-checker`, `security-auditor`. Ninguna tabla de datos se mergea sin sus tests de aislamiento en verde — esto es un gate de CI, no una sugerencia.

---

## 6. Mapa de módulos y épicas (grafo de dependencias)

Antes del detalle tarea-por-tarea (sección 11), este es el mapa de alto nivel de qué bloquea a qué, para que cualquier lector entienda el orden de construcción sin leer las 100+ tareas.

```
ÉPICA 0: Fundaciones de plataforma
   (tenants, RLS base, Auth Hook, Next.js scaffold, CI/CD)
        │
        ├──────────────┬──────────────┬──────────────┐
        ▼              ▼              ▼              ▼
ÉPICA 1:          ÉPICA 2:        ÉPICA 3:       ÉPICA 4:
Usuarios y        White-label     Storage y      Observabilidad
Trust Score       multi-dominio   Media base     base (Sentry)
        │              │              │
        └──────┬───────┴──────┬───────┘
               ▼              ▼
        ÉPICA 5:          ÉPICA 6:
        Social Base       PWA (manifest,
        (posts, feed      SW, push, install)
        principal)
               │
     ┌─────────┼─────────┬─────────────┬──────────────┐
     ▼         ▼         ▼             ▼              ▼
ÉPICA 7:   ÉPICA 8:  ÉPICA 9:     ÉPICA 10:      ÉPICA 11:
Verticales Comunidad Moderación   Notificaciones Realtime
(Propiedades,(Grupos, IA (3 niveles)transversales  avanzado
Negocios,  Q&A,      texto/img/video               (broadcast
Eventos,   Stories)                                 from DB)
Profesion.)
     │         │         │             │
     └─────────┴─────────┴─────┬───────┘
                                ▼
                          ÉPICA 12:
                          Stripe Connect
                          (cuentas, webhooks,
                          idempotencia)
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
          ÉPICA 13:       ÉPICA 14:       ÉPICA 15:
          Membresías/     Boost/          Creator
          Suscripciones   Publicidad      Marketplace
          (Stripe Billing)                (escrow)
                                                │
                                          ÉPICA 16:
                                          Marketplace
                                          de Tiendas
                                                │
     ┌──────────────────────────────────────────┤
     ▼                                          ▼
ÉPICA 17:                                 ÉPICA 18:
Paneles de Admin                          Broadcast Global
(Global, Domain, Moderador)               (modelo pull)
     │                                          │
     └──────────────────┬───────────────────────┘
                         ▼
                   ÉPICA 19:
                   Endurecimiento final
                   (auditoría RLS completa,
                   performance, partición,
                   generación de branding IA)
                         │
                         ▼
                   ÉPICA 20:
                   Lanzamiento del primer
                   tenant productivo
```

**Reglas de lectura del grafo:**
- Una épica hija **no empieza** hasta que sus padres directos tengan su criterio de "hecho" cumplido (sección 11 detalla el criterio exacto).
- Las épicas 1–4 son **paralelizables entre sí** una vez cerrada la Épica 0 (no dependen unas de otras).
- Las épicas 7–11 son **paralelizables entre sí** una vez cerradas 5 y 6 — cada una toca tablas/módulos distintos y puede asignarse a agentes distintos trabajando en simultáneo con boundaries de archivo claros.
- La Épica 12 (Stripe Connect) es un **cuello de botella real**: 13, 14, 15 no pueden empezar sin ella porque todas dependen de `connected_accounts` y del webhook idempotente.
- La Épica 18 (Broadcast Global) depende de que 17 (paneles admin, específicamente el Global) exista como superficie desde donde publicarlo, y de que 0 (tabla `broadcasts`) esté cerrada — pero no depende de 12–16 (monetización).

---

## 7. Monetización

> Fuente completa de diseño: informe `04-monetizacion-stripe-connect.md`. Esta sección resume las decisiones firmes y su integración con el modelo de datos del §4.

### 7.1 Los 4 flujos de ingreso y su mecanismo Stripe

| Flujo | Mecanismo Stripe | Comisión plataforma | Hold/Escrow |
|---|---|---|---|
| **Membresías/Suscripciones** (Propiedad Plus/Premium, Inmobiliaria Starter/Pro/Premium, Profesional, Publicidad mensual) | Stripe Billing puro, sin Connect (venta directa de la plataforma) | 100% plataforma | N/A |
| **Boost geolocalizado** | Checkout Session one-time con `price_data` inline (precio dinámico por ciudades/tier, evita explosión de catálogo de Prices) | 100% plataforma | N/A |
| **Creator Marketplace** | Destination charge con **transferencia diferida** (Opción B, ver §7.2) | 20% (`application_fee_amount`) | **Sí — 72h de ventana de revisión por defecto** |
| **Marketplace de Tiendas** | Destination charge simple, sin `application_fee_amount`, transfer inmediato + mensualidad vía Stripe Billing separada | 0% en la venta; mensualidad fija por tienda activa | No |

**Decisión firme sobre tipo de cuenta Connect:** **Express** (o su equivalente en Accounts v2 con roles `merchant`+`recipient`) para todo perfil que recibe dinero (creadores, vendedores). Delega KYC/AML a Stripe, la plataforma controla branding del onboarding y payout schedule — el balance correcto de control vs. fricción para un vendedor informal de la diáspora.

**`on_behalf_of` no se usa en ningún flujo** — Geovanny/el tenant es siempre el merchant of record visible ante el comprador (control de marca, simplicidad de disputas).

### 7.2 Creator Marketplace — el escrow que Stripe no tiene (decisión ya tomada, con nota de confirmación)

Stripe **no** tiene un producto de escrow — se construye con las piezas primitivas de la API. **Decisión firme de este plan (marcada como "a confirmar por Geovanny" por su impacto en cómo se comunica el producto, ver §14): Opción B — captura inmediata en el balance de la plataforma + `transfer` diferido**, no manual capture (la autorización de tarjeta expira a los 7 días, riesgo real para trabajos creativos que tardan más) ni delayed payout a nivel de cuenta conectada (el creador ya "ve" el saldo en su Dashboard Express antes de tiempo, generando tickets de soporte, y revertir un transfer ya ejecutado es más enredado que no haberlo ejecutado).

Flujo de estados (detalle completo en informe 04 §3.3): `pagado_pendiente_entrega` → `entregado_en_revision` (ventana de 72h configurable por tenant) → `completado_pagado` (transfer 80% al creador + 20% queda en balance plataforma) **o** `en_disputa` → `resuelto_reembolso` / `resuelto_pagado` (mediado por moderador/admin del tenant).

**Regla dura de disputes:** refunds siempre salen del balance de la plataforma; si ya se ejecutó el transfer antes de un refund, se requiere `transfer reversal` explícito (Stripe no lo hace automático). El dispute fee de $15 (no reembolsable) lo absorbe la plataforma, nunca se pasa al connected account.

### 7.3 Marketplace de Tiendas — deliberadamente simple

No copia la complejidad del Creator Marketplace: no hay "entrega" que verificar, no hay hold. El dinero del comprador va casi al instante al vendedor (sujeto al payout schedule estándar de su cuenta Express). El ingreso de la plataforma es 100% la mensualidad fija (Stripe Billing), independiente del volumen de ventas de la tienda.

### 7.4 Multi-tenant + pagos: una sola cuenta Stripe de plataforma

**Decisión firme:** **no** se crea una cuenta Stripe separada por tenant. Stripe Connect ya asume una plataforma → muchos connected accounts; el "tenant" es una segmentación lógica de la propia base de datos, no una entidad financiera distinta ante Stripe. Un solo endpoint de webhook Connect recibe eventos de la cuenta de plataforma y de todas las connected accounts. **Regla dura:** todo objeto Stripe relevante a reporting lleva `tenant_id` en `metadata` (Account, Customer, PaymentIntent, Subscription, Transfer, Checkout Session) — pero la fuente de verdad del reporting de revenue por dominio es **la base de datos propia**, nunca queries en vivo contra la API de Stripe filtrando por metadata.

### 7.5 Webhooks: la sección de mayor riesgo de bugs de producción

Reglas no negociables (informe 04 §7.3), porque están directamente citadas en post-mortems reales de la industria:

1. Verificación de firma siempre vía SDK oficial, nunca parseo manual.
2. **Body crudo preservado** — desactivar cualquier middleware de JSON parsing en la ruta del webhook; en Next.js App Router, leer `request.text()`, no `request.json()`, antes de `constructEvent`.
3. **Idempotencia por `event.id`** en la **misma transacción** que el efecto de negocio (tabla `stripe_events_processed`, sin `tenant_id` — es infraestructura interna).
4. Responder `2xx` rápido (<200ms) — encolar el trabajo pesado, nunca bloquear la respuesta HTTP en operaciones costosas.
5. **Nunca confiar solo en el payload** para decisiones críticas de dinero (ej. liberar un transfer) — re-consultar el estado vía API como doble verificación.

### 7.6 Modelo de datos de pagos (reconciliado bajo el canon del informe 01)

La tabla `payments` del informe 01 (§7.7) se toma como base canónica y se **enriquece** con las columnas del informe 04 (§8) para no perder expresividad:

```sql
-- payments: fusión de 01 (kind, platform_fee_cents, ref_table/ref_id) + 04 (flow, connected_account_id, application_fee_amount)
-- columnas finales: id, tenant_id, kind/flow (unificar en una sola columna 'flow'), amount_cents, currency,
--   application_fee_amount (=platform_fee_cents, unificar nombre), stripe_payment_intent, stripe_transfer_id,
--   connected_account_id, buyer_user_id, status, ref_table, ref_id, metadata jsonb, created_at, updated_at

-- Tablas nuevas incorporadas desde el informe 04 (no existían en el 01):
create table connected_accounts (
  id uuid primary key default gen_random_uuid(), -- v7
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references profiles(id),
  stripe_account_id text not null unique,
  role text not null check (role in ('creator','store_owner')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table transfers (
  id uuid primary key default gen_random_uuid(), -- v7
  tenant_id uuid not null references tenants(id),
  payment_id uuid not null references payments(id),
  stripe_transfer_id text unique,
  connected_account_id uuid not null references connected_accounts(id),
  amount integer not null,
  status text not null default 'pending', -- pending | completed | reversed
  created_at timestamptz not null default now()
);

create table boosts (
  id uuid primary key default gen_random_uuid(), -- v7
  tenant_id uuid not null references tenants(id),
  payment_id uuid not null references payments(id),
  listing_id uuid not null,
  boost_tier text not null,
  cities_scope jsonb not null default '[]',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true
);
```

**RLS:** todas estas tablas siguen la plantilla estándar de §5.2 — filtro por `tenant_id` para Domain Admin, `is_platform_admin()` para Super Admin. Correr `multi-tenant-safety-checker` específicamente sobre estas tablas antes de producción: una fuga aquí es una fuga de datos financieros entre dominios competidores (ej. colombianos.com viendo revenue de dominicanos.com), no "un bug de UI".

### 7.7 Compliance: Stripe Tax y 1099

Activar **Stripe Tax** automático para las ventas directas de plataforma (membresías, Boost, Publicidad, Eventos). Para el Creator Marketplace, dado que **la plataforma controla el pricing** (fija el 20%, decide cuándo libera el transfer), **es la plataforma —no Stripe— quien es responsable de emitir 1099-NEC** al creador si se le pagó ≥$600/año (umbral confirmado). Evaluar activar **1099 tax reporting** como producto de Connect en vez de construir la generación manualmente. Fuera de EE.UU. (creadores en dominios europeos), 1099 no aplica — queda como investigación pendiente por país si la red se expande allí.

---

## 8. IA de moderación + media pipeline

> Fuente completa de diseño: informe `05-ia-moderacion-media.md`. Pipeline provider-agnostic (principio §2.4).

### 8.1 Los 3 niveles de moderación (recordatorio de reglas del cliente)

| Score | Nivel | Acción | Visibilidad |
|---|---|---|---|
| 0–30 | Tier 1 — Auto-aprobar | Publica de inmediato | Visible al instante |
| 31–70 | Tier 2 — Monitorear | Publica pero entra a watchlist con re-scoring | Visible, con posible down-ranking |
| 71–100 | Tier 3 — Revisión manual | Retiene hasta que el Moderador decida | Oculto hasta aprobación |

El `risk_score` es una **fusión ponderada**, no un solo número de un proveedor: `w_ai=0.70` (máximo entre señales de texto/imagen/video) + `w_user=0.20` (inverso del Trust Score normalizado) + `w_hist=0.10` (reincidencia 30 días) + `hard_penalties` (saltos directos a Tier 3: CSAM, violencia gráfica confirmada, hash conocido). Ponderar con Trust Score reduce la carga del Moderador ~40–60% en la práctica (un usuario Premium con historial limpio no cae a cola manual por una foto borde; una cuenta nueva con la misma foto sí).

### 8.2 Moderación de texto en español latino (decisión crítica ya tomada)

**Primera línea: OpenAI Moderation (`omni-moderation-latest`)** — gratis, 13 categorías, español mejorado +42% en eval multilingüe. **Segunda opinión solo en zona gris (score 0.3–0.7): Gemini 2.5 Flash**, elegido sobre Claude Haiku por costo (3.3x más barato para clasificación de alto volumen donde el input domina). **Perspective API descartada explícitamente** — se discontinúa el 31-dic-2026 sin ruta de migración; construir sobre una API con fecha de muerte anunciada es deuda técnica garantizada desde el día 1.

Categorías críticas con manejo legal separado: `sexual/minors` (CSAM) → bloqueo inmediato + preservación de evidencia + **reporte obligatorio a NCMEC** (18 U.S.C. §2258A, no opcional) — nunca pasa por un Moderador humano común, va a un flujo restringido de compliance.

### 8.3 Moderación de imagen y video

**Imagen: Google Vision SafeSearch** (ya confirmado por el cliente) — corriendo **junto con Label Detection**, SafeSearch sale gratis (el bundle lo incluye), se paga solo Label ($1.50/1000 tier 1). Copyright vía perceptual hashing propio, no Vision (no lo detecta). CSAM vía PhotoDNA/NCMEC hashing, separado de Vision.

**Video: descomposición en frames** (1 cada 2-3s) → cada frame a Vision SafeSearch. Para video corto (≤15s, gratis): 5-8 frames, ~$0.008-0.012/video, despreciable. Para video largo (premium): + transcripción de audio → OpenAI Moderation sobre el texto. Migrar a AWS Rekognition Video nativo ($0.10/min) o Hive si el volumen de video justifica la simplicidad operativa de no gestionar sampling de frames — decisión diferida, la interfaz `VideoModerator` lo permite sin reescribir el orquestador.

### 8.4 Flujo asíncrono (arquitectura)

**Principio:** la subida del usuario **nunca bloquea** esperando a la IA. Contenido entra en `pending_moderation`, se encola vía **Supabase Queues (pgmq)**, un worker (**Edge Function** disparada por cron cada 2-5s o Database Webhook) resuelve el estado. El feed muestra optimistamente al autor su propio contenido, no a terceros hasta pasar Tier 1/2.

**Presupuesto de latencia (SLA interno):** texto/imagen decididos en <5s p95; video decidido dentro de los 3 min de terminar el transcode p95.

### 8.5 Trust Score dinámico (0-100) — motor consolidado

> Reconciliación: el informe 05 define la **fórmula de negocio** (pesos, componentes, decay); el informe 06 define el **motor técnico** (event-sourced, `trust_weights` versionada). Se combinan sin choque real — son complementarios.

`trust_score = clamp(0,100, BASE(40) + Σ(pesos de trust_events con sus topes))`. Fuente de verdad: tabla append-only `trust_events` (auditable) + proyección materializada `trust_scores`. **Asimetría de diseño (anti-abuso):** el score sube lento (actividad sostenida) y baja rápido (una violación grave) — encarece construir cuentas "confiables" falsas. **Decay temporal:** las penalizaciones decaen exponencialmente (half-life ~90 días), permitiendo rehabilitación.

**Badges:** Nuevo (0-30) · Verificado (31-60, requiere email+SMS) · Confiable (61-85, + foto verificada) · Premium (86-100 **o** suscripción de pago — doble vía, pero pagar no exime de moderación).

**Anti-abuso (informe 05 §6.3):** voto ponderado por Trust Score (reacciones y reportes pesan según quién los emite — neutraliza granjas de bots en ambas direcciones), análisis de grafo periódico para spam rings, device+IP fingerprinting (con consentimiento GDPR en tenants europeos), rate limits escalonados por badge.

### 8.6 Storage y video: la decisión híbrida

**Storage de imágenes/media pública: Cloudflare R2.** El factor decisivo es el egress: una red social sirve muchísimas lecturas de imágenes por scroll de feed; R2 cobra **$0 de egress** contra $0.09/GB de Supabase Storage tras el tier gratuito. **Supabase Storage se reserva para archivos privados atados a auth** (documentos de verificación KYC-lite, assets con RLS estricto no servidos masivamente) — aprovecha su integración nativa con Supabase Auth.

**Video: Cloudflare Stream para el grueso** (precio por minuto, predecible, sin penalización regional a Sudamérica — Bunny cobra $0.045/GB de egress a esa región, 4.5x más que Europa/NA). **Bunny Stream reservado exclusivamente para el tier premium con DRM** (MediaCage), donde Cloudflare no tiene equivalente. Arquitectura desacoplada vía interfaz `VideoProvider`.

### 8.7 Generación de branding por tenant con IA

Al crear un dominio nuevo, se auto-genera un kit de branding (logo, banner hero, ilustraciones de onboarding, favicon, OG image, patrón de fondo) vía **nano banana (Gemini image)**, con un "style prompt" maestro por marca para consistencia visual. **Revisión humana del Admin es obligatoria antes de publicar** — la IA propone, el Admin dispone (evita logos con artefactos o insensibilidad cultural, reputacionalmente crítico para una app de diáspora). Meshy (3D) diferido a una eventual fase de gamificación, no prioritario para el producto core.

---

## 9. Paneles de administración + Broadcast Global

### 9.1 Los 3 paneles (arquitectura común, scopes distintos)

Una sola app Next.js, tres superficies con distinto scope de rol, todas protegidas por RLS + verificación de rol en Server Actions:

| Panel | Ruta | Rol requerido | Scope | Features clave |
|---|---|---|---|---|
| **Global Admin** | `admin.comunidadlatina.com` (o `/_admin`) | `is_platform_admin()` | Todos los tenants | CRUD tenants (crear dominio en minutos), revenue consolidado, Broadcast Global, settings de plataforma, auditoría cross-tenant |
| **Domain Admin** | `{tenant}/admin` | `role = 'domain_admin'` (scoped a su `tenant_id`) | Un tenant | Toggle de módulos on/off, aprobación de negocios/propiedades, branding (colores/logo/fuente), stats locales |
| **Moderador** | `{tenant}/admin/moderate` | `role = 'moderator'` (scoped a su `tenant_id`) | Un tenant | Cola de moderación Tier 3, acciones aprobar/rechazar/suspender, ban list |

**Regla de aislamiento:** el Domain Admin y el Moderador **nunca** ven datos de otro tenant — esto lo garantiza la misma plantilla de RLS de §5.2 (no hay "modo especial" para admins de tenant, solo el Super Admin cruza fronteras, y solo vía el claim `is_platform_admin`).

### 9.2 Flujo "crear tenant en minutos" (end-to-end)

1. Geovanny completa el form en el Global Admin: dominio, nombre, país, idioma, moneda, colores.
2. Server Action `createTenant()`: (a) INSERT en `tenants` + `tenant_config` (Postgres), (b) `addTenantDomain(domain)` → Vercel REST API `POST /v10/projects/{id}/domains`, (c) PATCH del Edge Config `domains[domain] = tenantId` (para que el middleware resuelva sin redeploy).
3. Panel muestra las instrucciones DNS que devolvió Vercel (A record para apex, CNAME para subdominio).
4. Background poll de `GET domains/{d}/config` hasta `misconfigured === false` (**no confiar en el `verified: true` inicial**, que puede ser un falso positivo documentado) → `tenant.status = 'live'`.
5. Vercel emite SSL automáticamente. Tenant online, cero deploy de código.

**Límite a documentar como dependencia comercial:** Hobby = 50 dominios/proyecto; producción con ambición de decenas de tenants requiere **Vercel Pro/Enterprise** (ver §3.2 y §12).

### 9.3 Broadcast Global — modelo PULL (no el flag simple, resuelve Choque explícito del brief)

**CANON:** se usa el modelo del informe 01 §6.3 — tablas `broadcasts` (global) + `broadcast_targets(broadcast_id, tenant_id)` + `broadcast_receipts(broadcast_id, user_id, seen_at)` bajo demanda. **Se descarta explícitamente** el flag simple `is_global_broadcast boolean` en `posts` propuesto por el informe 07 §8.2/8.4 — esa era la versión de complejidad mínima para un MVP; para el producto completo, el modelo pull es superior porque:

1. No escribe una fila por post afectado en cada tenant al publicar — evita contención de millones de reads sobre la misma fila que el propio informe 07 identifica como desventaja de su Opción A ("si hay 1M usuarios, todos hitean la misma row").
2. Separa el **mensaje** (`broadcasts`, sin `tenant_id`) de su **targeting** (`broadcast_targets`) y de su **telemetría de lectura** (`broadcast_receipts`), permitiendo Broadcast dirigido a un subconjunto de tenants (no solo "todos"), algo que el flag simple no soporta sin lógica adicional.
3. Es coherente con el principio de arquitectura §2.5 (fan-out on read, nunca fan-out on write masivo).

```sql
-- RLS: un usuario ve un broadcast si es platform_admin o si su tenant está en los targets
create policy "broadcasts_read" on public.broadcasts for select to authenticated
using (
  (select public.is_platform_admin())
  or exists (select 1 from public.broadcast_targets bt
             where bt.broadcast_id = broadcasts.id and bt.tenant_id = (select public.auth_tenant_id()))
);
```

**Flujo de publicación:** Geovanny crea el broadcast (`kind: emergency|alert|announcement`, `scope: all_tenants|targeted`) desde el Global Admin → si `scope=all_tenants`, `broadcast_targets` se puebla con todos los tenants activos (una sola inserción batch, no fan-out de contenido) → el feed de cada usuario **une** su `tenant_id` con `broadcast_targets` en lectura → `broadcast_receipts` registra vistas bajo demanda cuando el usuario efectivamente lo ve, no al publicar. Web Push complementa vía VAPID, iterando tenants activos y enviando a cada subscription con el ícono del tenant correspondiente en el payload.

---

## 10. Roadmap del producto completo por fases/épicas

> **Descartado explícitamente el timeline de "10 semanas"** del informe 03 — era el ritmo de un MVP recortado. Este roadmap mide **hitos verificables por épica completada**, no semanas-hombre, porque la ejecución la realiza un enjambre de agentes orquestados cuya velocidad no se planifica en semanas humanas.

### Fase 1 — Fundaciones (bloqueante para todo lo demás)

**Hito verificable:** un usuario puede registrarse en un tenant de prueba, su JWT lleva el claim `tenant_id` correcto, y una query cross-tenant desde otro usuario devuelve 0 filas (test de aislamiento en verde en CI).

Contiene: Épica 0 (fundaciones de plataforma) + Épica 1 (usuarios/Trust) + Épica 2 (white-label/multi-dominio) + Épica 3 (storage/media base) + Épica 4 (observabilidad).

### Fase 2 — Producto social completo

**Hito verificable:** los 5 feeds funcionan con keyset pagination, ranking por boost/plan, moderación de IA en los 3 niveles operativa end-to-end (un post tóxico real cae en Tier 3 y aparece en la cola del Moderador), Stories expiran automáticamente, Grupos+Q&A funcionan con votos anti-doble-voto, notificaciones llegan por los 3 canales (in-app/push/email).

Contiene: Épica 5 (social base) + Épica 6 (PWA) + Épicas 7-11 (verticales, comunidad, moderación, notificaciones, realtime avanzado).

### Fase 3 — Monetización completa

**Hito verificable:** un negocio puede contratar a un creador, pagar $200, el creador entrega, el negocio confirma, Stripe transfiere $160 al creador y $40 quedan en el balance de plataforma — con webhook idempotente verificado (reenviar el mismo evento no duplica el transfer). Una tienda puede pagar su mensualidad y vender un producto con el 100% yendo al vendedor. Un usuario puede suscribirse a un plan Premium con upgrade/downgrade prorrateado correcto.

Contiene: Épica 12 (Stripe Connect base) + Épicas 13-16 (los 4 flujos de monetización).

### Fase 4 — Administración y lanzamiento

**Hito verificable:** Geovanny crea un tenant nuevo desde el Global Admin y el dominio está live (SSL emitido, DNS resuelto) en menos de 30 minutos sin ningún deploy de código. Un Broadcast Global de prueba llega a usuarios de 2+ tenants simultáneamente. El primer tenant productivo real (el que Geovanny elija lanzar primero) pasa la auditoría de seguridad completa (`security-auditor` + `supabase-audit-rls` en verde) antes de recibir tráfico real.

Contiene: Épica 17 (paneles admin) + Épica 18 (Broadcast Global) + Épica 19 (endurecimiento final) + Épica 20 (lanzamiento).

### Backlog explícito (fuera del roadmap core, no planificado en épicas)

- Apps nativas iOS/Android (Flutter) — Fase 2+ post-validación de PWA.
- Modelo "vender el motor a terceros" como SaaS de $2-5k/mes — oportunidad futura, no objetivo de este plan.
- Revenue-share con Domain Admins — solo si Geovanny lo decide (§14); si se activa, se implementa como otro connected account más, nunca como pago manual fuera de Stripe.
- Migración de un tenant a proyecto Supabase dedicado (silo) — solo si se cumple un disparador de escala (~1M usuarios activos, residencia de datos legal, o SLA contractual premium — criterios exactos en informe 01 §1.3).
- Partición nativa de Postgres (`PARTITION BY LIST/HASH (tenant_id)`) en `posts`/`notifications`/`moderation_queue` — solo cuando el volumen lo justifique (cientos de millones de filas), no desde el día 1.
- Migración de video a AWS Rekognition Video o Hive — solo si el volumen de video justifica la simplicidad operativa sobre el sampling de frames actual.

---

## 11. PLAN DE EJECUCIÓN PARA EL ENJAMBRE (Fase 3)

> **Esta es la sección más importante del documento para quien ejecuta.** Cada tarea lleva objetivo, archivos/áreas afectadas, agente sugerido, dependencias explícitas (qué debe estar "hecho" antes), y criterio de "hecho" verificable. Las épicas están ordenadas topológicamente — una épica no debería comenzar antes que sus dependencias declaradas estén cerradas.

### ÉPICA 0 — Fundaciones de plataforma

**Objetivo de la épica:** repo funcionando, CI/CD verde, esquema base de tenancy con RLS y Auth Hook operativos.
**Dependencias:** ninguna (punto de partida).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 0.1 | Scaffold Next.js 15+TS+Tailwind, repo single-app (no monorepo) | raíz del repo, `package.json`, `tailwind.config.ts` | `frontend-developer` | — | `npm run build` verde; estructura de carpetas de informe 02 §6.1 creada (`app/_sites/[tenant]`, `app/_admin`, `lib/tenant`, etc.) |
| 0.2 | CI base: lint, type-check, test unitario en GitHub Actions | `.github/workflows/ci.yml` | `deployment-engineer` | 0.1 | PR de prueba dispara el workflow y falla si hay error de lint/tipo |
| 0.3 | Proyecto Supabase creado, extensiones habilitadas (`pg_cron`, `pg_net`, `pgmq`, generación UUID v7) | Supabase project settings | `database-architect` | — | `list_extensions` confirma las 4 activas; función de generación UUID v7 probada con un `SELECT` |
| 0.4 | DDL de tablas globales: `tenants`, `tenant_domains`, `tenant_config`, `tenant_modules`, `platform_admins`, `plans_catalog`, `admin_audit_log` | `supabase/migrations/0001_*.sql` | `supabase-migrations` (skill) + `database-architect` | 0.3 | Migración aplica limpio en local y en un branch Supabase; tablas visibles en `list_tables` |
| 0.5 | Custom Access Token Hook (`tenant_id`, `user_role`, `is_platform_admin` estampados en JWT desde `app_metadata`) | `supabase/migrations/`, Dashboard Auth Hooks config | `database-architect` + `security-auditor` (revisión) | 0.4 | Un usuario de prueba se loguea y `auth.jwt()` devuelve los 3 claims correctos; cambiar su rol y verificar que el JWT viejo NO cambia hasta refresh (test explícito de este gotcha) |
| 0.6 | Funciones helper `auth_tenant_id()`, `auth_role()`, `is_platform_admin()` (`stable`, `security definer set search_path=''`) | `supabase/migrations/` | `database-architect` | 0.5 | Cada función retorna el valor esperado en un test SQL directo con un JWT mockeado |
| 0.7 | Plantilla de policy RLS reusable + generador automático (recorre `information_schema`, aplica a tablas con `tenant_id` sin policies) | `supabase/migrations/`, script de generación | `database-architect` + `supabase-audit-rls` (skill) | 0.6 | Correr el generador sobre una tabla de prueba y verificar que crea las 4 policies (select/insert/update/delete) correctas |
| 0.8 | Suite de tests de aislamiento en CI (SELECT/INSERT/UPDATE/DELETE cross-tenant, Super Admin bypass, regresión de inyección) | `.github/workflows/`, carpeta de tests | `multi-tenant-safety-checker` (skill) + `security-auditor` | 0.7 | CI falla si se crea una tabla con `tenant_id` sin RLS `FORCE`+policies; los 6+ casos del informe 01 §5.6 están cubiertos y en verde |
| 0.9 | Middleware de resolución hostname→tenant (rewrite a `/_sites/[tenant]`, Edge Config mock local) | `middleware.ts` (o `proxy.ts` si Next 16) | `frontend-developer` | 0.1, 0.4 | Request a un hostname mapeado en Edge Config local resuelve al tenant correcto; hostname no reconocido cae en `/_unknown-domain` |
| 0.10 | Vercel project creado + Edge Config provisionado | Vercel dashboard/API | `deployment-engineer` | — | `EDGE_CONFIG_ID` disponible; un PATCH de prueba al mapa de dominios se refleja en <1s desde el middleware |

### ÉPICA 1 — Usuarios y Trust Score

**Objetivo:** perfiles de usuario, seguimiento, y el motor de Trust Score operativo (aunque sin señales de todos los módulos sociales todavía — esas se conectan en épicas posteriores).
**Dependencias:** Épica 0 completa.

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 1.1 | DDL `profiles`, `follows` (+RLS vía plantilla 0.7) | `supabase/migrations/` | `database-architect` | 0.7 | Tablas creadas, RLS activo, test de aislamiento pasa |
| 1.2 | DDL `trust_scores`, `trust_events`, `trust_weights` (event-sourced, ver §4.3/§8.5) | `supabase/migrations/` | `database-architect` | 1.1 | Insertar un `trust_event` recalcula `trust_scores.score` vía trigger; `trust_weights` es editable sin deploy |
| 1.3 | Motor de cálculo de Trust Score (fórmula con BASE=40, pesos, decay temporal half-life 90 días) | Edge Function o función SQL | `backend-architect` | 1.2 | Test unitario reproduce la tabla de pesos del informe 05 §6.1/informe 06 §3.2; decay verificado con fecha simulada |
| 1.4 | Badges (Nuevo/Verificado/Confiable/Premium) + exposición API | `app/api/users/[id]/trust/route.ts` | `backend-architect` | 1.3 | `GET /api/users/:id/trust` devuelve score+band+badges según informe 06 §3.4 |
| 1.5 | Verificación SMS (Twilio) para badge Verificado | `lib/twilio/`, Server Action | `backend-architect` | 1.4 | Un número de prueba recibe OTP, verificación exitosa dispara `trust_event` `verify_phone` (+15) |
| 1.6 | Flujo de registro/login con Supabase Auth (email+password, sociales opcional) | `app/_sites/[tenant]/(auth)/` | `frontend-developer` | 0.5, 1.1 | Un usuario se registra, queda con `tenant_id` correcto en `profiles`, y su JWT lo refleja |

### ÉPICA 2 — White-label y multi-dominio

**Objetivo:** theming dinámico por CSS variables, PWA manifest por tenant, custom domains vía Vercel API.
**Dependencias:** Épica 0 completa (específicamente 0.4, 0.9, 0.10).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 2.1 | `getTenant()` cacheado (`unstable_cache` + tag `tenant:{id}`) | `lib/tenant/get-tenant.ts` | `frontend-developer` | 0.9 | Cambiar branding en DB + `revalidateTag` refleja el cambio sin rebuild |
| 2.2 | Layout con inyección de CSS vars (colores en triplete RGB) + Tailwind mapeado | `app/_sites/[tenant]/layout.tsx`, `tailwind.config.ts` | `frontend-developer` + `ui-designer` | 2.1 | Dos tenants de prueba con colores distintos renderizan con su paleta sin FOUC |
| 2.3 | Catálogo curado de fuentes (`next/font`, 4-6 opciones precargadas) | `app/_sites/[tenant]/fonts.ts` | `frontend-developer` | 2.2 | Selector de fuente en admin aplica sin CLS perceptible |
| 2.4 | Favicon dinámico desde Storage vía `generateMetadata` | layout del tenant | `frontend-developer` | 2.2 | Dos tenants muestran favicons distintos |
| 2.5 | `lib/vercel/add-domain.ts` + flujo `createTenant()` (Postgres→Vercel API→Edge Config PATCH) | `lib/vercel/`, Server Action | `backend-architect` | 0.4, 0.10 | Agregar un dominio de prueba vía API devuelve las instrucciones DNS; polling de `misconfigured` funciona |
| 2.6 | `generateMetadata` (SEO por dominio), `sitemap.xml`/`robots.txt` dinámicos | `app/_sites/[tenant]/layout.tsx`, route handlers | `frontend-developer` | 2.1 | Cada tenant tiene su propio canonical, OG image, sitemap |
| 2.7 | i18n sin routing (`next-intl` modo sin prefijo) + `formatMoney` por moneda de tenant | `lib/i18n/`, `messages/{es,en}.json` | `frontend-developer` | 2.1 | Tenant en inglés y tenant en español muestran UI correcta sin `/es/`/`/en/` en la URL |

### ÉPICA 3 — Storage y media base

**Objetivo:** R2 y Supabase Storage configurados con aislamiento por tenant; pipeline de subida de imágenes funcionando (sin moderación todavía, eso es Épica 9).
**Dependencias:** Épica 0 completa.

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 3.1 | Bucket R2 provisionado + estructura de paths `{tenant_id}/{content_type}/{id}.{ext}` | Cloudflare dashboard/API, `lib/storage/r2.ts` | `cloud-architect` | 0.4 | Subir un archivo de prueba y confirmar egress $0 en la factura simulada |
| 3.2 | URLs firmadas generadas por backend (valida `tenant_id` antes de firmar) | `lib/storage/sign-url.ts` | `backend-architect` | 3.1, 0.6 | Un usuario de tenant A no puede obtener una URL firmada válida para un objeto de tenant B |
| 3.3 | Supabase Storage para archivos privados (bucket separado, RLS de Storage) | Supabase Storage policies | `database-architect` | 0.4 | Policy de Storage valida `tenant_id` del claim contra el primer segmento del path |
| 3.4 | Transformación de imágenes on-the-fly (resize/webp) vía Cloudflare Images/Workers | `lib/storage/transform.ts` | `frontend-developer` | 3.1 | Un mismo asset sirve 3 tamaños distintos según viewport sin duplicar storage |

### ÉPICA 4 — Observabilidad base

**Objetivo:** Sentry y logging operativos desde el día 1 (no al final).
**Dependencias:** Épica 0.1 (scaffold existe).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 4.1 | Sentry configurado (server+client), tag `tenant_id` en cada evento | `sentry.server.config.ts`, `sentry.client.config.ts` | `observability-engineer` | 0.1 | Un error forzado en un tenant de prueba aparece en Sentry filtrable por `tenant_id` |
| 4.2 | Logging estructurado en Edge Functions (JSON con `tenant_id`, `event`, `timestamp`) | `edge-functions/`, convención de logging | `observability-engineer` | 0.1 | Logs de una Edge Function de prueba son parseables/filtrables |
| 4.3 | Dashboard de SLOs básico (uptime, latencia p99, error rate) | Sentry/Vercel Analytics config | `observability-engineer` | 4.1 | Umbrales del informe 07 §5.4 configurados como alertas |

### ÉPICA 5 — Social base (posts, Feed Principal)

**Objetivo:** el primer feed end-to-end: crear post, verlo en el feed con keyset pagination, dar like, comentar.
**Dependencias:** Épicas 0, 1, 3 completas.

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 5.1 | DDL `posts` (con `boost_tier`, `boost_expires_at`, `author_plan_tier`, `rank_score`, `engagement_count` — ver §4.3), `post_likes`, `comments` | `supabase/migrations/` | `database-architect` | 1.1, 0.7 | RLS activo, índice `idx_posts_feed_rank` creado, test de aislamiento pasa |
| 5.2 | Función/trigger de cálculo de `rank_score` (bandas + frescura + engagement, ver §2.2 informe 06) | `supabase/migrations/`, trigger SQL | `database-architect` | 5.1 | Insertar posts con distinto `boost_tier` y verificar orden correcto (Max > Plus > Básico > Premium > Gratis) |
| 5.3 | `pg_cron` job de recalculo de `rank_score` cada 5 min (degrada boosts vencidos) | `supabase/migrations/` (cron.schedule) | `database-architect` | 5.2 | Un boost con `boost_expires_at` pasado cae de banda tras el cron |
| 5.4 | Endpoint `GET /api/feeds/:feedType` con keyset pagination | `app/api/feeds/[feedType]/route.ts` | `backend-architect` | 5.1 | Paginar 100+ posts de prueba no degrada latencia con la profundidad (verificar con `EXPLAIN ANALYZE`) |
| 5.5 | `POST /api/feeds/:feedType/posts` (crear, valida `Idempotency-Key`) | `app/api/feeds/[feedType]/posts/route.ts` | `backend-architect` | 5.4, 0.6 | Reenviar la misma `Idempotency-Key` no crea un post duplicado |
| 5.6 | `POST /api/posts/:id/react` (like idempotente), `PATCH`/`DELETE` (soft-delete) | rutas de posts | `backend-architect` | 5.5 | Doble click en like no duplica; `deleted_at` se setea, la fila no desaparece físicamente |
| 5.7 | UI del Feed Principal (componentes de post, infinite scroll con cursor) | `app/_sites/[tenant]/(app)/feed/` | `frontend-developer` + `ui-designer` | 5.4 | Scroll de prueba con 200+ posts sembrados carga fluido |
| 5.8 | Realtime: trigger `broadcast_new_post` + pill "N nuevas publicaciones" en cliente | trigger SQL + componente React | `backend-architect` + `frontend-developer` | 5.1, 0.4 | Crear un post desde otra sesión muestra la pill sin refrescar |

### ÉPICA 6 — PWA

**Objetivo:** instalable, con manifest por tenant, offline básico, push.
**Dependencias:** Épica 2 completa (branding disponible), Épica 0.9.

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 6.1 | Route Handler `app/manifest.webmanifest/route.ts` (dinámico, `force-dynamic`, auto-resuelve host) | ruta indicada | `frontend-developer` | 2.1 | Dos tenants distintos, dos manifests distintos (nombre/ícono/color propios) |
| 6.2 | Service Worker con Serwist (precache + runtime caching) | `public/sw.js` o config Serwist | `frontend-developer` | 6.1 | Lighthouse PWA audit en verde; app abre offline con shell cacheado |
| 6.3 | Headers de seguridad para SW (`next.config.js`) | `next.config.js` | `frontend-developer` | 6.2 | Headers verificados con curl/devtools |
| 6.4 | `InstallPrompt` component (maneja iOS sin `beforeinstallprompt`) | `components/` | `frontend-developer` | 6.1 | Prompt correcto en Android/desktop vs instrucciones manuales en iOS |
| 6.5 | Web Push: VAPID keys globales + `push_subscriptions` (RLS por tenant) + Server Action de envío | `lib/push/`, `supabase/migrations/` | `backend-architect` | 6.2, 0.7 | Suscribirse y recibir una push de prueba en un dispositivo real/emulado |
| 6.6 | Background Sync para escritura offline (crear post sin conexión) | Service Worker | `frontend-developer` | 6.2, 5.5 | Crear post en modo avión, reconectar, el post se publica |

### ÉPICA 7 — Verticales (Propiedades, Negocios, Eventos, Profesionales)

**Objetivo:** los 4 feeds dedicados operativos, cada uno con su plan/monetización enganchada más adelante en Épica 13.
**Dependencias:** Épica 5 completa (patrón de feed/ranking/keyset ya probado).
**Nota de paralelismo:** las 4 subtareas por vertical son independientes entre sí — pueden asignarse a 4 agentes en paralelo con boundary de archivo por carpeta de vertical.

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 7.1 | DDL `properties` (+ricos campos de m2/precio/operación) con columnas de ranking | `supabase/migrations/` | `database-architect` | 5.2 | RLS + test de aislamiento + índice `(tenant_id, status, created_at desc)` |
| 7.2 | DDL `businesses` (+horarios, rating) con columnas de ranking | `supabase/migrations/` | `database-architect` | 5.2 | Ídem |
| 7.3 | DDL `professionals` (+profesión, matrícula, portfolio) con columnas de ranking | `supabase/migrations/` | `database-architect` | 5.2 | Ídem |
| 7.4 | DDL `events` + `event_rsvps` con columnas de ranking | `supabase/migrations/` | `database-architect` | 5.2 | Ídem + constraint único de RSVP por usuario/evento |
| 7.5 | Endpoints CRUD + feed keyset para cada vertical (reusa patrón de 5.4/5.5) | `app/api/feeds/{propiedades,negocios,profesionales,eventos}/` | `backend-architect` | 7.1-7.4 | Cada vertical pagina correctamente y respeta módulo on/off del tenant |
| 7.6 | UI de cada feed vertical + página de detalle público (ISR/PPR) | `app/_sites/[tenant]/(app)/{propiedades,...}/`, `(public)/{propiedades,...}/[id]/` | `frontend-developer` + `ui-designer` | 7.5 | Página pública de una propiedad es indexable (SEO) y cacheable |
| 7.7 | RSVP de eventos (`POST /api/events/:id/rsvp`) | ruta de eventos | `backend-architect` | 7.4 | RSVP idempotente, contador denormalizado correcto |

### ÉPICA 8 — Comunidad (Grupos, Q&A, Stories)

**Objetivo:** grupos con membership/roles, Q&A con votos anti-abuso, Stories con TTL real.
**Dependencias:** Épica 5 completa, Épica 1 completa (Trust Score para pesos de voto).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 8.1 | DDL `groups`, `group_members` (roles member/moderator/owner) | `supabase/migrations/` | `database-architect` | 5.1 | RLS: contenido de grupo privado invisible a no-miembros |
| 8.2 | DDL `qa_questions`, `qa_answers`, `qa_votes` (constraint único anti-doble-voto) | `supabase/migrations/` | `database-architect` | 8.1 | Intento de doble voto del mismo usuario rechazado por constraint |
| 8.3 | Flujos de membership (join abierto/request/invite) + aprobación de moderador | `app/api/groups/` | `backend-architect` | 8.1 | Grupo `request` requiere aprobación explícita antes de ver contenido |
| 8.4 | Lógica de "mejor respuesta" + trust event compensatorio si se revierte | `app/api/qa/questions/:id/best-answer` | `backend-architect` | 8.2, 1.3 | Marcar mejor respuesta dispara `+3` trust; cambiar de mejor respuesta revierte el trust del anterior |
| 8.5 | DDL `stories`, `story_views` con **partición diaria** + `pg_cron` de `DROP PARTITION` | `supabase/migrations/` | `database-architect` | 5.1 | Simular fecha futura y verificar que la partición vieja se dropea (no DELETE masivo) |
| 8.6 | UI de Stories (anillos, viewer, privacidad public/followers/close_friends) | `app/_sites/[tenant]/(app)/historias/` | `frontend-developer` | 8.5 | Historia de `close_friends` invisible a un usuario fuera de la lista |
| 8.7 | UI de Grupos + Q&A | `app/_sites/[tenant]/(app)/grupos/` | `frontend-developer` + `ui-designer` | 8.3, 8.4 | Flujo completo de crear pregunta→responder→votar→marcar mejor visible en UI |

### ÉPICA 9 — Moderación IA (3 niveles)

**Objetivo:** pipeline de moderación de texto/imagen/video operativo end-to-end, con Trust Score influyendo el score final.
**Dependencias:** Épica 5 (hay contenido que moderar), Épica 1 (Trust Score existe), Épica 3 (media sube a Storage).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 9.1 | DDL `moderation_queue` (enriquecida, ver §4.3), `content_reports` | `supabase/migrations/` | `database-architect` | 5.1, 1.2 | RLS: moderador solo ve cola de su tenant |
| 9.2 | Interfaces desacopladas `TextModerator`, `ImageModerator`, `VideoModerator`, `VideoProvider`, `StorageProvider` | `lib/moderation/interfaces.ts` | `ai-engineer` | — | Un adaptador mock implementa cada interfaz y pasa tests de contrato |
| 9.3 | Adaptador OpenAI Moderation (texto, primera línea) | `lib/moderation/providers/openai.ts` | `ai-engineer` | 9.2 | Texto de prueba tóxico devuelve categorías+scores esperados |
| 9.4 | Adaptador Gemini 2.5 Flash (segunda opinión, solo zona gris) | `lib/moderation/providers/gemini.ts` | `ai-engineer` | 9.3 | Solo se invoca cuando OpenAI devuelve score 0.3-0.7; verificado con contador de llamadas |
| 9.5 | Adaptador Google Vision (SafeSearch+Label bundle) | `lib/moderation/providers/vision.ts` | `ai-engineer` | 9.2 | Imagen de prueba NSFW devuelve likelihood mapeado a score 0-1 correcto |
| 9.6 | Pipeline de video (extracción de frames + Vision por frame + audio→texto opcional) | `lib/moderation/video-pipeline.ts` | `ai-engineer` | 9.5, Épica 3 | Video de prueba de 15s procesa en <60s con 5-8 frames analizados |
| 9.7 | Fórmula de fusión `risk_score` (pesos w_ai/w_user/w_hist + hard_penalties) | `lib/moderation/scoring.ts` | `ai-engineer` | 9.3, 9.5, 1.3 | Test reproduce los ejemplos numéricos del informe 05 §1.2 |
| 9.8 | Worker de moderación (Edge Function, pgmq, cron 2-5s) | `edge-functions/moderation-worker.ts` | `ai-engineer` + `backend-architect` | 9.7, 0.3 | Un post nuevo pasa de `pending` a `approved`/`monitor`/`in_review` en <5s p95 (texto/imagen) |
| 9.9 | Flujo CSAM separado (hash PhotoDNA/NCMEC, reporte legal obligatorio, bypass del Moderador común) | `lib/moderation/csam-flow.ts` | `ai-engineer` + `security-auditor` | 9.5 | Contenido con hash conocido nunca llega a la cola de un Moderador regular; se registra en flujo de compliance |
| 9.10 | Dashboard del Moderador (cola Tier 3, acciones aprobar/rechazar/suspender) | `app/_sites/[tenant]/admin/moderate/` | `frontend-developer` | 9.1, 9.8 | Moderador de tenant A no puede ver ni actuar sobre cola de tenant B |
| 9.11 | Cache por hash de imagen (dedup, evita re-analizar duplicados) | `lib/moderation/hash-cache.ts` | `ai-engineer` | 9.5 | Subir la misma imagen 2 veces solo invoca Vision una vez |

### ÉPICA 10 — Notificaciones transversales

**Objetivo:** outbox + fan-out worker con los 3 canales (in-app, push, email), idempotente.
**Dependencias:** Épica 6 (push subscriptions existen), Épica 5/7/8 (hay eventos que disparan notificaciones).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 10.1 | DDL `notification_outbox`, `notifications`, `notification_prefs` | `supabase/migrations/` | `database-architect` | 0.7 | RLS: usuario solo ve sus propias notificaciones |
| 10.2 | Worker `notify-dispatcher` (Edge Function, cron o pg_net) | `edge-functions/notify-dispatcher.ts` | `backend-architect` | 10.1, 6.5 | Evento de prueba (nuevo seguidor) genera fila in-app + intenta push + respeta preferencia de email |
| 10.3 | Idempotencia por `dedupe_key` + dead-letter tras 5 intentos | worker de 10.2 | `backend-architect` | 10.2 | Reintentar el mismo evento no duplica la notificación; falla tras 5 intentos marca `status='failed'` |
| 10.4 | Integración Resend (email transaccional + digest diario) | `lib/notifications/email.ts` | `backend-architect` | 10.2 | Email de prueba llega con remitente/branding del tenant correcto |
| 10.5 | Realtime in-app (broadcast a canal `tenant:{t}:user:{u}`) | trigger SQL | `backend-architect` | 10.1, 0.4 | Badge de notificaciones sube en vivo sin refrescar |
| 10.6 | UI de notificaciones + preferencias | `app/_sites/[tenant]/(app)/notificaciones/` | `frontend-developer` | 10.1 | Usuario puede mutear un tipo de notificación y deja de recibirla |

### ÉPICA 11 — Realtime avanzado

**Objetivo:** consolidar el patrón Broadcast from Database en todos los módulos que lo necesitan (ya parcialmente cubierto en Épicas 5, 8, 10 — esta épica es la auditoría/consolidación transversal).
**Dependencias:** Épicas 5, 8, 10 completas.

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 11.1 | Auditoría de que todo canal Realtime está nombrado por tenant (`tenant:{id}:...`), ninguno global | revisión de todos los triggers `realtime.send` | `security-auditor` | 5.8, 8.6, 10.5 | Grep de canales confirma 100% con prefijo `tenant:` |
| 11.2 | RLS sobre `realtime.messages` (función helper `auth_belongs_to_tenant`) | `supabase/migrations/` | `database-architect` | 11.1 | Usuario de tenant A no puede suscribirse a canal de tenant B (test explícito) |
| 11.3 | Documentar camino de escala (Fase 2: tabla pública sin RLS re-streameada) como opción diferida, no implementarla ahora | `docs/` (nota técnica, no código) | `architect-review` | 11.2 | Nota escrita y referenciada; no bloquea el lanzamiento |

### ÉPICA 12 — Stripe Connect (base, cuello de botella real)

**Objetivo:** cuentas conectadas, webhook idempotente, infraestructura de pagos lista para que 13-16 se construyan encima.
**Dependencias:** Épica 1 completa (perfiles existen para asociar cuentas).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 12.1 | Confirmar con backend lead: Express v1 vs Accounts v2 (decisión de bajo riesgo pero debe fijarse antes de codear, ver informe 04 §11.2) | — (decisión, no código) | `payment-integration` | — | Decisión documentada en este repo antes de 12.2 |
| 12.2 | DDL `connected_accounts`, `transfers`, `boosts` + fusión de `payments` (ver §7.6) | `supabase/migrations/` | `database-architect` | 12.1 | RLS activo, test de aislamiento pasa, `multi-tenant-safety-checker` corrido específicamente sobre estas tablas |
| 12.3 | Onboarding Express: `stripe.accounts.create()` + Account Link + `return_url`/`refresh_url` | `lib/stripe/onboarding.ts`, Server Action | `payment-integration` | 12.2 | Cuenta de prueba completa KYC en modo test y `charges_enabled`/`payouts_enabled` se reflejan en `connected_accounts` |
| 12.4 | Endpoint único de webhook (`/api/webhooks/stripe`) con verificación de firma + body crudo + idempotencia transaccional | `app/api/webhooks/stripe/route.ts`, `stripe_events_processed` | `payment-integration` + `security-auditor` | 12.2 | Reenviar el mismo `event.id` no duplica ningún efecto de negocio (test explícito con evento real de Stripe CLI) |
| 12.5 | Despacho de eventos clave (`account.updated`, `payment_intent.succeeded`, `charge.dispute.created`, etc. — tabla completa en informe 04 §7.3) | handler de 12.4 | `payment-integration` | 12.4 | Cada evento de la tabla del informe 04 tiene un handler probado con Stripe CLI `trigger` |
| 12.6 | Chequeo de arranque: falla el build si detecta `sk_test_` en entorno marcado como producción | script de CI/build | `security-auditor` | — | Build de prueba con key de test en env "production" falla explícitamente |

### ÉPICA 13 — Membresías/Suscripciones (Stripe Billing)

**Dependencias:** Épica 12 completa, Épica 7 completa (verticales existen para asociar planes).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 13.1 | Catálogo de Products/Prices por tenant+plan (`interval_count:3` para trimestral) | `lib/stripe/catalog.ts`, script de seed | `payment-integration` | 12.1 | Un plan "Propiedad Premium" de colombianos.com tiene su propio Price distinto al de mexicanos.com |
| 13.2 | Checkout Session de suscripción + activación vía webhook `invoice.paid`/`checkout.session.completed` | `app/api/subscriptions/`, handler de webhook | `payment-integration` | 13.1, 12.5 | Suscribirse activa el plan en `subscriptions` y el `author_plan_tier` denormalizado en la tabla vertical correspondiente |
| 13.3 | Upgrade/downgrade con política asimétrica (upgrade inmediato con prorrateo, downgrade a fin de ciclo) | `app/api/subscriptions/:id/change-plan` | `payment-integration` | 13.2 | Test reproduce el ejemplo de prorrateo del informe 04 §5.2 |
| 13.4 | Dunning (Smart Retries + gracia + downgrade automático a Free) | handler de `invoice.payment_failed` | `payment-integration` | 13.2 | Simular fallo de cobro repetido degrada el tier tras agotar reintentos, no antes |
| 13.5 | UI de gestión de suscripción (ver plan actual, cambiar, cancelar) | `app/_sites/[tenant]/(app)/cuenta/suscripcion/` | `frontend-developer` | 13.3 | Usuario ve su plan y puede cambiarlo desde la UI |

### ÉPICA 14 — Boost / Publicidad

**Dependencias:** Épica 12 completa, Épica 5 completa (Feed Principal para inyección de ads).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 14.1 | DDL `ad_placements` (o reuso de `ad_campaigns` del informe 01, ver nota de reconciliación §4.3) | `supabase/migrations/` | `database-architect` | 12.2 | RLS activo |
| 14.2 | Checkout Session de Boost con `price_data` inline (precio dinámico por ciudades/tier) | `app/api/boost/`, Server Action | `payment-integration` | 14.1 | Combinaciones de tier×ciudades no explotan el catálogo de Stripe (verificado sin crear Prices fijos) |
| 14.3 | Job `pg_cron` que desactiva boosts vencidos (`ends_at < now()`, no depende de webhook) | `supabase/migrations/` (cron) | `database-architect` | 14.1 | Boost simulado con `ends_at` pasado se desactiva sin intervención de Stripe |
| 14.4 | Server-side slotting de ads en Feed Principal (cada N posts, config por tenant) | `app/api/feeds/principal/route.ts` | `backend-architect` | 14.1, 5.4 | Ads NUNCA aparecen en Propiedades/Negocios/Eventos/Profesionales (verificado explícitamente, esos endpoints ni llaman al selector) |
| 14.5 | Registro de impresión/click con `Idempotency-Key` + descuento de `spent_cents` | `app/api/ads/:id/impression`, `/click` | `backend-architect` | 14.4 | Doble registro de la misma impresión no descuenta doble presupuesto |
| 14.6 | Publicidad mensual recurrente (Subscription, mismo patrón que Épica 13) | reuso de 13.2 | `payment-integration` | 13.2 | Igual criterio que 13.2, aplicado a `ad_monthly` |

### ÉPICA 15 — Creator Marketplace (escrow)

**Dependencias:** Épica 12 completa, Épica 1 completa (Trust Score influye límites de contrato).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 15.1 | DDL `creator_jobs`, `creator_applications` (ya definidas en informe 01 §7.6) | `supabase/migrations/` | `database-architect` | 12.2 | RLS activo, test de aislamiento pasa |
| 15.2 | Flujo de publicación de job → aplicación de creador → aceptación | `app/api/creator-marketplace/` | `backend-architect` | 15.1 | Negocio publica, creador aplica, negocio acepta — estado transiciona correctamente |
| 15.3 | PaymentIntent con captura inmediata SIN `transfer_data` (Opción B, ver §7.2) — dinero queda en balance de plataforma | `lib/stripe/creator-escrow.ts` | `payment-integration` | 15.2, 12.4 | Pago de $200 capturado, 0 transfers ejecutados, balance de plataforma refleja el monto completo |
| 15.4 | Estado "entregado" + ventana de revisión configurable (72h default) + auto-aprobación si no hay reclamo | `app/api/creator-marketplace/:id/deliver` + cron | `backend-architect` | 15.3 | Marcar entregado inicia countdown; pasado el plazo sin disputa, transiciona a auto-aprobado |
| 15.5 | Ejecución de `transfer` 80/20 al aprobar (manual o auto) | `lib/stripe/creator-escrow.ts` | `payment-integration` | 15.4 | Transfer de $160 al creador ejecutado, $40 queda en balance de plataforma, registrado en tabla `transfers` |
| 15.6 | Flujo de disputa interna (negocio vs creador, mediado por admin del tenant) — distinto del dispute de Stripe | `app/_sites/[tenant]/admin/disputes/` | `backend-architect` + `frontend-developer` | 15.4 | Admin puede resolver a favor de negocio (refund) o creador (transfer parcial/total) |
| 15.7 | Manejo de `transfer reversal` si hay chargeback tardío tras transfer ya ejecutado | `lib/stripe/creator-escrow.ts` | `payment-integration` | 15.5 | Simular chargeback post-transfer ejecuta reversal antes/junto al refund |
| 15.8 | Política de suspensión tras N disputas/chargebacks de un creador | `lib/stripe/risk-policy.ts` | `payment-integration` + `security-auditor` | 15.6 | Creador con >2 chargebacks queda temporalmente suspendido del marketplace |

### ÉPICA 16 — Marketplace de Tiendas

**Dependencias:** Épica 12 completa. (No depende de Épica 15 — son flujos deliberadamente independientes, ver §7.3.)

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 16.1 | DDL `stores`, `products` (ya definidas en informe 01 §7.6) | `supabase/migrations/` | `database-architect` | 12.2 | RLS activo |
| 16.2 | Mensualidad de tienda vía Stripe Billing (reuso de patrón Épica 13) | reuso de 13.1/13.2 | `payment-integration` | 13.2 | Tienda activa solo con mensualidad al día |
| 16.3 | Checkout de compra: destination charge simple, sin `application_fee_amount`, transfer inmediato | `app/api/stores/:id/checkout` | `payment-integration` | 16.1, 12.3 | Comprador paga, 100% llega al connected account del vendedor (menos fee estándar de Stripe) |
| 16.4 | UI de tienda (catálogo, checkout) + panel de gestión del vendedor | `app/_sites/[tenant]/(app)/marketplace/`, `(public)/tiendas/[slug]/` | `frontend-developer` + `ui-designer` | 16.3 | Vendedor gestiona productos, comprador completa una compra de prueba en modo test |

### ÉPICA 17 — Paneles de administración (Global, Domain, Moderador)

**Dependencias:** Épica 0 completa (roles/RLS existen); consolida UIs cuyos endpoints ya se construyeron en épicas anteriores (9.10 para Moderador).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 17.1 | Middleware de routing de admin por rol (`is_platform_admin` → Global, `domain_admin` → Domain, `moderator` → ya cubierto en 9.10) | `middleware.ts`, guards de layout | `backend-architect` | 0.6 | Usuario sin rol admin no puede acceder a ninguna ruta `/admin/*` |
| 17.2 | Global Admin: CRUD de tenants (reuso de flujo 2.5) | `app/_admin/tenants/` | `frontend-developer` | 2.5, 17.1 | Geovanny crea/suspende/activa un tenant desde la UI |
| 17.3 | Global Admin: revenue consolidado (agregado desde tabla `payments`, nunca en vivo desde Stripe API) | `app/_admin/revenue/` | `frontend-developer` + `data-engineer` | Épica 12-16 | Dashboard muestra revenue total y por tenant, coherente con los pagos de prueba ejecutados |
| 17.4 | Domain Admin: toggle de módulos on/off | `app/_sites/[tenant]/admin/modulos/` | `frontend-developer` | 0.4 (tenant_modules existe) | Togglear un módulo lo oculta de nav/rutas del tenant en <1 request (revalidación por tag) |
| 17.5 | Domain Admin: editor de branding (colores/logo/fuente) + `revalidateTag` | `app/_sites/[tenant]/admin/branding/` | `frontend-developer` | 2.2 | Cambiar un color en el editor se refleja en el sitio público sin rebuild |
| 17.6 | Domain Admin: aprobaciones (negocios/propiedades pendientes) + stats locales | `app/_sites/[tenant]/admin/aprobaciones/` | `frontend-developer` | Épica 7 | Un negocio en `moderation_status=pending` aparece en la cola del Domain Admin de su tenant únicamente |
| 17.7 | Auditoría cross-tenant (Global Admin ve `admin_audit_log` completo) | `app/_admin/auditoria/` | `frontend-developer` | 0.4 | Acción administrativa de prueba (ej. suspender negocio) aparece en el log con actor/timestamp/razón |

### ÉPICA 18 — Broadcast Global (modelo pull)

**Dependencias:** Épica 0.4 (tabla `broadcasts` existe), Épica 17.2 (Global Admin existe como superficie de publicación), Épica 6.5 (push existe para complementar).

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 18.1 | DDL `broadcasts`, `broadcast_targets`, `broadcast_receipts` (si no se creó ya en 0.4) | `supabase/migrations/` | `database-architect` | 0.4 | RLS de `broadcasts_read` según §9.3, test explícito: usuario de tenant no-target no ve el broadcast |
| 18.2 | UI de publicación en Global Admin (`kind`, `scope: all_tenants\|targeted`) | `app/_admin/broadcast/` | `frontend-developer` | 18.1, 17.2 | Geovanny publica un broadcast de prueba dirigido a 2 de N tenants |
| 18.3 | Población batch de `broadcast_targets` al publicar (una inserción, no fan-out de contenido) | Server Action de publicación | `backend-architect` | 18.1 | Publicar a `all_tenants` con 20 tenants de prueba no genera más que 20 filas en `broadcast_targets`, nunca una fila por usuario |
| 18.4 | Unión en lectura del feed de cada usuario con `broadcast_targets` | endpoint de feed / notificaciones | `backend-architect` | 18.3, 5.4 | Usuario de un tenant target ve el broadcast en su feed/notificaciones sin necesidad de un job de fan-out |
| 18.5 | `broadcast_receipts` bajo demanda (se registra al ver, no al publicar) | endpoint de "marcar visto" | `backend-architect` | 18.4 | Ver un broadcast registra un receipt; no ver uno no genera fila |
| 18.6 | Web Push del broadcast (itera tenants activos, ícono por tenant en payload) | `lib/push/broadcast.ts` | `backend-architect` | 18.3, 6.5 | Push de prueba llega con branding correcto a usuarios de 2+ tenants distintos |

### ÉPICA 19 — Endurecimiento final

**Objetivo:** el gate de seguridad y performance antes de que cualquier tenant reciba tráfico real.
**Dependencias:** todas las épicas de datos/lógica (0-18) completas.

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 19.1 | Auditoría RLS completa sobre las ~35+ tablas finales (`get_advisors`, generador de policies re-ejecutado) | todo el esquema | `supabase-audit-rls` (skill) + `security-auditor` | 0-18 | Cero alertas `rls_disabled_in_public` o `auth_rls_initplan` en el Advisor |
| 19.2 | Auditoría multi-tenant end-to-end (todos los módulos, no solo los early) | toda la app | `multi-tenant-safety-checker` (skill) | 19.1 | Suite completa de tests de aislamiento (informe 01 §5.6) en verde para las ~35+ tablas |
| 19.3 | Revisión de seguridad general (secrets, CORS, headers, CSP, XSS) | toda la app | `security-auditor` | 19.2 | Checklist OWASP relevante al stack revisado sin hallazgos críticos abiertos |
| 19.4 | Performance: `EXPLAIN ANALYZE` de los 5 feeds bajo carga simulada de 100K+ posts/tenant | queries de feed | `database-optimizer` | 19.1 | Ningún query de feed hace sequential scan; keyset se mantiene O(1) a profundidad |
| 19.5 | Partición nativa donde ya se justifique por volumen sembrado en pruebas de carga (no especulativo) | `posts`/`notifications`/`moderation_queue` si aplica | `database-architect` | 19.4 | Solo se ejecuta si 19.4 detecta degradación real; de lo contrario se documenta como diferido |
| 19.6 | Generación de kit de branding IA para el primer tenant real (nano banana) + revisión humana | pipeline de branding | `ai-engineer` + Geovanny (revisión) | 2.2 | Kit completo generado, revisado y aprobado por Geovanny para el tenant de lanzamiento |
| 19.7 | Runbook de disaster recovery + backup manual pre-lanzamiento | `docs/DISASTER_RECOVERY.md`, PITR de Supabase confirmado | `devops-troubleshooter` | 0.3 | Restore de prueba desde backup ejecutado exitosamente en un proyecto Supabase de staging |

### ÉPICA 20 — Lanzamiento del primer tenant productivo

**Dependencias:** Épica 19 completa.

| # | Tarea | Archivos/áreas | Agente sugerido | Dependencias | Criterio de "hecho" |
|---|---|---|---|---|---|
| 20.1 | Crear el tenant real elegido por Geovanny vía flujo de 2.5/17.2 | producción | `deployment-engineer` | 19.* | Dominio real (ej. colombianos.com) resuelve, SSL emitido, tenant `status='live'` |
| 20.2 | Verificación de Stripe en modo live (cuenta real, webhook apuntando a producción) | config de Stripe | `payment-integration` | 12.6, 20.1 | Un pago real de prueba de bajo monto se procesa correctamente end-to-end |
| 20.3 | Monitoreo activo las primeras 48h (Sentry, SLOs, cola de moderación) | observabilidad | `observability-engineer` + `incident-responder` | 20.1 | Ningún error crítico sin triage en las primeras 48h |

---

## 12. Entorno y prerequisitos

### 12.1 MCPs a autorizar antes de la ejecución

| MCP | Para qué se usa en este proyecto |
|---|---|
| **Supabase MCP** | Migraciones, `list_tables`, `get_advisors`, `execute_sql`, `deploy_edge_function`, generación de tipos TypeScript |
| **Vercel MCP** | Gestión de dominios, deployments, env vars, Edge Config |

> Nota operativa: en el momento de escribir este plan, ambos MCPs (`supabase`, `vercel`) requieren autorización interactiva que no se puede completar en una sesión no-interactiva. El enjambre que ejecute este plan debe verificar al inicio que ambos estén autorizados (`claude mcp` o `/mcp`), o usar la CLI de Supabase/Vercel como alternativa equivalente donde el MCP no esté disponible.

### 12.2 Cuentas/servicios a crear antes de la Épica 0

| Servicio | Qué se necesita | Bloquea |
|---|---|---|
| **Supabase** | Proyecto creado, plan Pro como mínimo (para PITR de 24h+ y límites de compute razonables) | Épica 0.3 en adelante |
| **Vercel** | Cuenta con plan **Pro o Enterprise** (Hobby limita a 50 dominios — insuficiente para la ambición de decenas de tenants) | Épica 0.10, Épica 2.5 |
| **GitHub** | Repo creado, Actions habilitado | Épica 0.1, 0.2 |
| **Stripe** | Cuenta de plataforma en modo test primero; activar Connect | Épica 12 |
| **Cloudflare** | Cuenta con R2 y Stream habilitados | Épica 3, Épica 8.5 (media de stories), Épica 9.6 (video) |
| **OpenAI** | API key para Moderation API (gratis, pero requiere cuenta) | Épica 9.3 |
| **Google Cloud** | Proyecto con Vision API habilitada (billing activo, aunque el tier 1 es gratis) | Épica 9.5 |
| **Google AI (Gemini)** | API key para Gemini 2.5 Flash | Épica 9.4 |
| **Twilio** | Cuenta con al menos un número verificador de SMS | Épica 1.5 |
| **Resend** | Cuenta + dominio verificado para envío | Épica 10.4 |
| **Sentry** | Proyecto creado | Épica 4.1 |

### 12.3 Variables de entorno mínimas (consolidado de informes 02 y 07)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # solo server, jamás en el bundle del cliente

# Vercel
VERCEL_API_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
EDGE_CONFIG=
EDGE_CONFIG_ID=

# PWA / Push
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# Stripe
STRIPE_SECRET_KEY=                  # sk_test_ en dev, sk_live_ solo en prod — nunca mezclados
STRIPE_WEBHOOK_SECRET=

# Storage / Media
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_STREAM_API_TOKEN=
BUNNY_STREAM_API_KEY=                # solo si/cuando se activa el tier premium DRM

# IA / Moderación
OPENAI_API_KEY=
GOOGLE_CLOUD_VISION_CREDENTIALS=     # service account JSON o equivalente
GEMINI_API_KEY=

# Notificaciones
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
RESEND_API_KEY=

# Observabilidad
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
NEXT_PUBLIC_SENTRY_ENVIRONMENT=
```

---

## 13. Riesgos y mitigaciones

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | **Fuga cross-tenant** por tabla sin RLS o policy mal escrita | Media | **Crítico** | RLS `FORCE` obligatorio + generador automático + test de CI que falla si falta + `get_advisors` en pipeline (§5.6). Este es el **Riesgo #1 del proyecto entero** |
| R2 | Límite de 50 dominios de Vercel Hobby alcanzado sin plan Pro/Enterprise contratado a tiempo | Media | Alto (bloquea lanzar nuevos tenants) | Contratar Vercel Pro/Enterprise **antes** de la Épica 2.5; cuantificar costo real con Vercel Sales antes del roadmap de dominios (§3.2, §12.2) |
| R3 | Escrow del Creator Marketplace mal entendido por el negocio (Geovanny cree que "Stripe lo maneja" automáticamente) | Media | Alto | Este plan es explícito en que Stripe NO tiene escrow nativo; Opción B está documentada y marcada como "a confirmar" en §14 — no se codea sin esa confirmación |
| R4 | Moderación de CSAM mal manejada (expuesta a Moderador común, sin reporte legal) | Baja | **Crítico legal** | Flujo separado obligatorio (Épica 9.9), hashing PhotoDNA/NCMEC, reporte a NCMEC no opcional (18 U.S.C. §2258A) |
| R5 | Costo de video se dispara sin control | Media | Alto | Video corto gratis con límite de 15s; video largo es premium (quien lo consume ayuda a pagarlo); Cloudflare Stream da presupuesto predecible por minuto (§3.2, §8.6) |
| R6 | Dependencia de un influencer/creador de alto perfil que abandona o genera una disputa mediática | Baja | Medio-Alto | El Creator Marketplace no depende de ningún creador específico para operar; política de suspensión tras N disputas (Épica 15.8) protege reputación de la plataforma independiente de cualquier individuo |
| R7 | Deadline de lanzamiento de marca (octubre, según contexto de negocio) no se cumple por alcance de "producto completo" | Media | Alto | El roadmap por épicas (§10) permite identificar qué fase es mínima-viable-de-producto-completo vs. qué puede diferirse al backlog (§10, sección de backlog explícito) sin tocar el core; escalar con Geovanny si octubre exige recortar alcance de una fase específica |
| R8 | Degradación por init-plan trap (RLS evaluado por-fila en vez de por-query) | Alta si se descuida | Alto | `(select fn())` en toda policy sin excepción; Advisor `auth_rls_initplan` en CI (§5.2) |
| R9 | Perspective API u otro proveedor de IA se discontinúa a mitad de proyecto | Baja (ya conocido para Perspective, mitigado) | Medio | Interfaces provider-agnostic (`TextModerator`, etc.) — swap de proveedor es un adaptador, no una reescritura (§2.4, §8.2) |
| R10 | Colapso de cola de webhooks de Stripe en picos de tráfico | Media | Alto | Responder 2xx rápido, encolar trabajo pesado async, idempotencia en la misma transacción (§7.5) |
| R11 | Chargeback repetido de un creador/vendedor de mala fe | Media | Medio | Política de suspensión tras N disputas, dispute fee ($15) absorbido por plataforma, nunca pasado al connected account (§7.2) |
| R12 | "Noisy neighbor": un tenant gigante degrada a los chicos en shared schema | Baja al inicio | Alto (a largo plazo) | Camino de escala documentado: índices → partición nativa → read replicas → silo del tenant (informe 01 §1.3, §8.4) — no se implementa preventivamente, se activa por disparador real |
| R13 | Broadcast Global mal implementado genera contención (si se revierte al flag simple del informe 07 por error de un agente que no leyó este plan) | Baja (mitigada por este documento) | Medio | Este plan es explícito y con ejemplo de código de que el modelo es PULL (§9.3) — cualquier agente que implemente Broadcast debe leer esta sección antes de tocar esas tablas |

---

## 14. Decisiones PENDIENTES de Geovanny

Estas son las únicas incógnitas legítimas de este plan — dependen del dueño del negocio, no de una decisión técnica que el arquitecto pueda tomar por él. **Ninguna épica de la sección 11 debería considerarse bloqueada indefinidamente por estas decisiones** (todas tienen un default razonable documentado abajo que permite seguir avanzando), pero deben confirmarse antes de los hitos indicados.

| # | Decisión | Default de este plan si no hay respuesta a tiempo | Debe confirmarse antes de |
|---|---|---|---|
| 1 | **Escrow hold del Creator Marketplace:** ¿Opción B (captura inmediata + transfer diferido) es aceptable como "tu pago está protegido hasta que confirmes la entrega", o Geovanny prefiere comunicarlo distinto al mercado? | Opción B (ya documentada en §7.2 como la técnicamente correcta) | Épica 15.3 |
| 2 | **Ventana de revisión exacta del Creator Marketplace:** ¿72h fijas, o configurable por tenant/Domain Admin? | 72h fija, global | Épica 15.4 |
| 3 | **Precio de la mensualidad de Tiendas** (no especificado en ningún informe) | — sin default posible, es un número de negocio puro | Épica 16.2 |
| 4 | **Precio de Videos Premium** (mencionado como pendiente en el informe 04 §11.4) | — sin default; una vez definido, encaja como Membresía (Stripe Billing) o Boost (one-time) según si es suscripción o compra puntual | Épica 6/9 (donde se defina el tier premium de video con Bunny DRM) |
| 5 | **¿El modelo "vender el sistema a socios/terceros" entra al roadmap en algún momento, o queda 100% en backlog indefinido?** | Backlog indefinido, no planificado en ninguna épica de este documento (canon del brief) | No bloquea ninguna épica — es una decisión de producto a futuro, revisar en revisión de roadmap post-lanzamiento |
| 6 | **Revenue-share con Domain Admins:** ¿los administradores de cada dominio reciben una porción del revenue de su tenant como incentivo? | No — modelo 100% centralizado con Geovanny como único beneficiario económico (default del informe 04 §9.4) | Antes de reclutar el primer Domain Admin no-Geovanny con expectativa de compensación |
| 7 | **Express v1 vs Accounts v2 de Stripe** (bajo riesgo, pero debe fijarse antes de codear) | Express v1 (más tutoriales/soporte de comunidad disponible hoy; ambas rutas llegan al mismo resultado funcional) | Épica 12.1 |
| 8 | **Alcance de Stripe Tax y 1099 para dominios fuera de EE.UU.** (validar con asesor legal/fiscal) | No implementar automatización fiscal fuera de EE.UU. hasta tener asesoría específica por país | Antes de lanzar el primer tenant europeo (Épica 20 de ese tenant específico) |
| 9 | **¿Cuál es el primer tenant real a lanzar?** (necesario para Épica 19.6 y 20.1) | — sin default, decisión de negocio pura | Épica 19.6 |
| 10 | **Plan de Vercel exacto (Pro vs Enterprise) según el número real de dominios previstos en los primeros 12 meses** | Pro como piso mínimo; escalar a Enterprise si se acerca al límite práctico documentado por Vercel Sales | Antes de Épica 2.5 (primer dominio real agregado vía API) |

---

## 15. Referencias a los 7 informes

Este plan consolida y reconcilia, sin repetir íntegramente, los siguientes documentos ubicados en `docs/investigacion/`:

1. **`01-arquitectura-multitenant-datos.md`** — Fuente de verdad del modelo de datos (~35 tablas), estrategia RLS, JWT claims, orden de construcción. Referenciado extensamente en §1.3, §4, §5, §9.3.
2. **`02-app-whitelabel-multidominio.md`** — Capa Next.js: middleware host→tenant, Edge Config, theming CSS vars, manifest PWA dinámico, Vercel Domains API, feature flags. Referenciado en §2.3, §9.2, Épicas 2 y 6.
3. **`03-benchmark-sngine-competidores.md`** — Benchmark de producto y gaps de mercado. Referenciado en §1.2 (para descartar explícitamente su sugerencia de pricing SaaS a terceros y su timeline de 10 semanas) y como contexto de diferenciación competitiva en §1.
4. **`04-monetizacion-stripe-connect.md`** — Stripe Connect, escrow, split 80/20, membresías, tablas de pagos. Referenciado extensamente en §7, Épicas 12-16, §14.
5. **`05-ia-moderacion-media.md`** — Moderación 3 niveles, OpenAI/Gemini/Vision, video/storage, Trust Score, costos. Referenciado en §3.2, §8, Épica 9.
6. **`06-modulos-sociales-core.md`** — Feeds, ranking, realtime, stories, grupos/Q&A, notificaciones, 8 puntos de conciliación con el modelo de datos (resueltos en §4.3-§4.4 de este plan). Referenciado en §2.2, §2.5, §4.4, §8.5, Épicas 5, 8, 10, 11.
7. **`07-infra-devops-admin.md`** — Repo, CI/CD, provisioning de dominios, 3 paneles admin, observabilidad. Referenciado en §9.1 (con corrección explícita del modelo de Broadcast Global en §9.3) y Épicas 0, 4, 17.

---

*Fin del Plan Maestro. Este documento es el norte único del proyecto Comunidad Latina. Cualquier decisión de arquitectura futura que lo contradiga debe documentarse como una enmienda explícita a este archivo, no como una desviación silenciosa en el código.*
