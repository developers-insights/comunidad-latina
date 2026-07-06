# 06 — Módulos Sociales Core: Arquitectura, Flujos y Contratos de API

> **Proyecto:** Comunidad Latina / NYLabel — Red social white-label multi-tenant (PWA)
> **Stack:** Next.js + TypeScript · Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) · Vercel · Stripe Connect
> **Rol de este documento:** Arquitecto de módulos sociales. Define LÓGICA, FLUJOS y CONTRATOS de API. **No** es dueño del modelo de datos maestro (tenant_id + RLS lo posee el agente del modelo de datos). Cada tabla/campo que necesitamos se marca como **[REQUIERE DEL MODELO MAESTRO]** para conciliación.
> **Objetivo:** PRODUCTO COMPLETO (no MVP).
> **Fecha:** 2026-07-06

---

## 0. Resumen de decisiones arquitectónicas (TL;DR técnico)

| # | Decisión | Elección | Razón |
|---|----------|----------|-------|
| D1 | Fan-out de feed | **Fan-out on read** (pull) + cache de ranking | Multi-tenant con miles de feeds; fan-out on write explota en storage. RLS ya filtra por tenant. |
| D2 | Paginación | **Keyset (cursor) sobre `rank_score DESC, id DESC`** con `id` = UUID v7 | O(1) a cualquier profundidad; UUID v7 es monotónico → cursor estable. |
| D3 | Realtime | **Broadcast from Database** (`realtime.send` en triggers) en canales privados por tenant/feed | Patrón 2026 recomendado; escala a decenas de miles de conexiones; una escritura → un fan-out. No usar Postgres Changes a escala. |
| D4 | Prioridad de aparición | **Boost tier + plan tier + recencia** en `rank_score` calculado (columna generada/materializada) | Una sola columna ordenable resuelve Boost Max > Plus > Básico > Premium > Gratis. |
| D5 | Ads en Feed Principal | **Inyección server-side por slots** (cada N posts orgánicos) desde tabla `ad_placements` separada | Solo el Feed Principal mezcla ads; los otros 4 nunca los consultan. |
| D6 | Trust Score | **Event-sourced**: tabla append-only `trust_events` + `trust_score` materializado. Recalculo por trigger/cron. | Auditable, anti-abuso, reversible. Coordina con agente de IA anti-abuso. |
| D7 | Historias 24h | **Partición diaria por rango de tiempo + DROP PARTITION** vía pg_cron | DROP de partición es O(1) e instantáneo vs DELETE masivo. TTL real. |
| D8 | Notificaciones | **Outbox + fan-out worker (Edge Function)** → in-app (tabla) + push (Web Push) + email (Resend/queue). Realtime para in-app. | Desacopla el disparador de la entrega; retries idempotentes. |
| D9 | Q&A votos | Tabla `qa_votes` con constraint único (user, answer) + contador materializado | Previene doble voto; contador rápido para orden. |
| D10 | Idempotencia | `Idempotency-Key` header → tabla `idempotency_keys` en toda mutación con efecto de pago/notificación | Stripe Connect + push no toleran duplicados. |

---

## 1. Principios transversales multi-tenant

Todos los módulos asumen estas invariantes (propiedad del modelo maestro, aquí se enumeran como contrato):

1. **`tenant_id uuid NOT NULL`** en toda tabla de dominio. RLS: `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid`.
   El `tenant_id` se resuelve por dominio (middleware Next.js mapea host → tenant) y se inyecta como **claim del JWT** en el login (custom access token hook de Supabase Auth). **[REQUIERE DEL MODELO MAESTRO]** — confirmar que el claim `tenant_id` viaja en el JWT; de lo contrario las policies deben leer de una tabla `tenant_domains`.
2. **Toda PK es UUID v7** (`id uuid DEFAULT ...`) — ordenable por tiempo, sirve como cursor de keyset y evita hotspots de índice. **[REQUIERE DEL MODELO MAESTRO]** — estandarizar generación UUID v7 (extensión `pg_uuidv7` o generación en app).
3. **Realtime scoping:** canal privado por tenant. Nombre de canal: `tenant:{tenant_id}:feed:{feed_type}` y `tenant:{tenant_id}:user:{user_id}`. RLS sobre `realtime.messages` valida pertenencia. Nunca un canal global.
4. **Índices siempre `(tenant_id, <cols de orden>)`** — el tenant es el primer discriminante de cardinalidad.
5. **Soft-delete** (`deleted_at timestamptz`) en contenido social para moderación/apelaciones; hard-delete solo por cron de retención.

> Nota de performance multi-tenant: con RLS activo, cada query lleva el filtro `tenant_id` implícito. Para feeds de altísimo tráfico se evalúa (Fase 2) la técnica Supabase de **tabla "public" sin RLS re-streameada por Broadcast** para evitar el costo de evaluar RLS en cada evento realtime (ver §7). No se adopta en Fase 1 por complejidad.

---

## 2. Los 5 Feeds

### 2.1 Modelo conceptual y separación

Cada feed es un **tipo de contenido distinto**, no solo un filtro. Decisión: **una tabla base `posts` con `feed_type` enum + tablas satélite por vertical** para atributos específicos (patrón "table inheritance ligero" / STI + extensión).

```
posts (base, común a todos)
  ├── feed_type ∈ {principal, propiedades, negocios, eventos, profesionales}
  ├── post_properties   (1:1 opcional) — precio, ambientes, m2, ubicación, operación (venta/alquiler)
  ├── post_business     (1:1 opcional) — horarios, categoría, whatsapp, rating_avg, reviews_count
  ├── post_event        (1:1 opcional) — fecha_inicio, fecha_fin, lugar, geo, rsvp_count, capacidad
  └── post_professional (1:1 opcional) — profesión, matrícula, portfolio_urls, disponibilidad
```

**[REQUIERE DEL MODELO MAESTRO]** — Tabla `posts` con estos campos mínimos:

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid v7 PK | cursor |
| `tenant_id` | uuid | RLS |
| `author_id` | uuid FK users | |
| `feed_type` | enum | discrimina feed |
| `body` | text | contenido |
| `media` | jsonb[] | refs a Storage (paths, no URLs) |
| `created_at` | timestamptz | |
| `boost_tier` | smallint | 0=none,1=básico,2=plus,3=max (denormalizado del boost activo) |
| `boost_expires_at` | timestamptz null | ventana de vigencia del boost |
| `author_plan_tier` | smallint | 0=gratis,1=premium (denormalizado; se refresca por trigger al cambiar plan) |
| `rank_score` | double precision | **calculado** (ver 2.3) — columna materializada/refrescada |
| `engagement_count` | int | likes+comments+shares, denormalizado |
| `status` | enum | active/hidden/removed |
| `deleted_at` | timestamptz null | soft delete |

Cada feed vertical **solo lee `feed_type = X`**. El **Feed Principal es el único** que además inyecta `ad_placements` (§2.5).

### 2.2 Algoritmo de ranking / orden

Orden híbrido: **cronológico con boost y prioridad por plan**. La prioridad exigida es:

```
Boost Max (3) > Boost Plus (2) > Boost Básico (1) > Premium (plan, sin boost) > Gratis
```

Se resuelve con un `rank_score` de **bandas discretas + decaimiento temporal dentro de la banda**, de modo que un boost superior SIEMPRE aparece sobre uno inferior, pero dentro de cada banda manda la recencia/engagement.

```
rank_score =
    (priority_band * 1e12)                       -- banda dominante (separación garantizada)
  + (freshness_component)                         -- recencia dentro de banda
  + (engagement_component)                        -- desempate por interacción

priority_band =
    CASE
      WHEN boost activo:  3 + boost_tier          -- 4=básico,5=plus,6=max  → boosts arriba de todo
      WHEN author_plan_tier = 1 (premium): 2      -- premium sin boost
      ELSE 1                                        -- gratis
    END
-- (boost_expires_at debe ser > now(); si venció, cae a banda por plan)

freshness_component = EXTRACT(EPOCH FROM created_at) / 1e6     -- monotónico creciente, sub-banda
engagement_component = ln(1 + engagement_count) * 3600         -- ~1h de "empuje" por orden de magnitud
```

**Por qué bandas con multiplicador grande (1e12):** garantiza que ninguna cantidad de recencia/engagement de una banda inferior supere a una superior. Boost Max nunca es desplazado por un post gratis viral. Esto implementa literalmente `Max > Plus > Básico > Premium > Gratis`.

**Materialización del score (decisión D4):**
- `rank_score` NO se calcula en cada `ORDER BY` (mataría el índice). Se **persiste** en la columna.
- Se recalcula cuando cambian sus inputs:
  - Trigger `AFTER INSERT/UPDATE OF boost_tier, boost_expires_at, author_plan_tier, engagement_count`.
  - **pg_cron cada 5 min**: `UPDATE posts SET rank_score = f(...) WHERE boost_expires_at <= now() AND priority_band_stale` — para degradar boosts vencidos y aplicar decaimiento del componente de frescura sin depender de escrituras.
- Índice que habilita keyset:
  ```sql
  CREATE INDEX idx_posts_feed_rank
    ON posts (tenant_id, feed_type, rank_score DESC, id DESC)
    WHERE deleted_at IS NULL AND status = 'active';
  ```

> Trade-off: score materializado puede estar hasta 5 min desactualizado en su decaimiento temporal. Aceptable para un feed social (no es trading). Alternativa considerada y descartada: score calculado on-the-fly con `ORDER BY expr` → rompe keyset y obliga a full-scan+sort por página.

### 2.3 Paginación keyset (cursor) — decisión D2

Offset paginación se descarta (O(n) a profundidad, y con feeds infinitos el usuario baja mucho). Keyset sobre `(rank_score, id)`:

```sql
-- Página 1
SELECT ... FROM posts
WHERE tenant_id = $tenant AND feed_type = $feed
  AND deleted_at IS NULL AND status = 'active'
ORDER BY rank_score DESC, id DESC
LIMIT 20;

-- Página N (cursor = último (rank_score, id) devuelto)
SELECT ... FROM posts
WHERE tenant_id = $tenant AND feed_type = $feed
  AND deleted_at IS NULL AND status = 'active'
  AND (rank_score, id) < ($cursor_score, $cursor_id)   -- tupla comparada, usa el índice
ORDER BY rank_score DESC, id DESC
LIMIT 20;
```

**Cursor opaco:** `base64({ s: rank_score, i: id })`. El cliente lo trata como token ciego.

> Advertencia de consistencia: como `rank_score` cambia (boosts nuevos, decaimiento), un ítem puede "moverse" entre páginas ya vistas. Es el comportamiento aceptado de todo feed vivo (Twitter/IG igual). Para RSVP de Eventos y listados de Propiedades donde la estabilidad importa más, se ofrece un **orden secundario "cronológico puro"** (`created_at DESC, id DESC`) seleccionable por el cliente, que es 100% estable con keyset.

### 2.4 Realtime en feeds (nuevos posts) — decisión D3

**Broadcast from Database** (patrón 2026, no Postgres Changes):

1. Trigger `AFTER INSERT ON posts` llama a `realtime.send(...)` publicando un payload **liviano** (solo `id`, `feed_type`, `author_id`, `preview`, `rank_score`) al canal `tenant:{tenant_id}:feed:{feed_type}`.
2. El cliente suscrito al feed recibe un evento `new_post` → muestra pill "N nuevas publicaciones" (no inyecta automáticamente para no romper el scroll).
3. Al tocar la pill, el cliente hace un fetch keyset "hacia arriba" (`(rank_score,id) > cursor_top`).

```sql
-- Trigger de broadcast (esqueleto; realtime.send captura excepciones internamente)
CREATE OR REPLACE FUNCTION broadcast_new_post() RETURNS trigger AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id, 'feed_type', NEW.feed_type,
      'author_id', NEW.author_id, 'preview', left(NEW.body, 140),
      'boost_tier', NEW.boost_tier
    ),
    'new_post',                                   -- event
    'tenant:' || NEW.tenant_id || ':feed:' || NEW.feed_type,  -- topic
    true                                          -- private
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Por qué liviano:** Broadcast permite elegir columnas; no enviamos el post completo. Evita filtrar datos sensibles y reduce ancho de banda. El detalle se hidrata por REST/keyset.

**RLS de Realtime:** policy sobre `realtime.messages` que permite `SELECT` en el topic solo si el `user` pertenece al `tenant_id` embebido en el nombre del canal (join a membership/tenant). **[REQUIERE DEL MODELO MAESTRO]** — función helper `auth_belongs_to_tenant(tenant_id)`.

### 2.5 Feed Principal: integración de ads (decisión D5)

Solo el Feed Principal mezcla contenido con **publicidad paga**. Los otros 4 feeds nunca consultan ads.

- Tabla separada **`ad_placements`** **[REQUIERE DEL MODELO MAESTRO / o propia de este módulo]**:
  `id, tenant_id, advertiser_id, creative (jsonb), target (jsonb: geo/intereses), bid_tier, budget_cents, spent_cents, starts_at, ends_at, status, priority`.
- **Estrategia de inyección: server-side slotting.** El endpoint del Feed Principal:
  1. Trae `N` posts orgánicos rankeados (keyset).
  2. Selecciona `ceil(N / slot_every)` ads elegibles (activos, presupuesto disponible, match de target) ordenados por `bid_tier`/`priority`.
  3. Intercala un ad cada `slot_every` posts (config por tenant, default 5), respetando que **el primer slot no sea posición 0** (UX).
  4. Devuelve una **lista tipada heterogénea** (`type: 'post' | 'ad'`).
- **Registro de impresión/click:** el cliente hace `POST /ads/{id}/impression` (batch, con dedupe por `Idempotency-Key`) → incrementa `spent_cents` según modelo (CPM/CPC). Un ad se retira automáticamente cuando `spent_cents >= budget_cents` (trigger o check en selección).

```
GET /api/feeds/principal
Respuesta (extracto):
{
  "items": [
    { "type": "post", "post": { ...postCard } },
    { "type": "post", "post": { ... } },
    { "type": "ad",   "ad":   { "id":"...", "creative":{...}, "advertiser":{...} } },
    ...
  ],
  "next_cursor": "eyJzIjo...",
  "ad_slot_every": 5
}
```

> Trade-off: slotting server-side (no cliente) garantiza que la lógica de facturación/targeting no sea manipulable y que Propiedades/Negocios/Eventos/Profesionales queden 100% libres de ads por diseño (nunca llaman al selector). Alternativa descartada: un solo endpoint parametrizado que "opcionalmente" trae ads → riesgo de fuga de ads a feeds equivocados.

### 2.6 Contrato de API — Feeds

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/feeds/:feedType?cursor=&limit=&sort=rank\|recent` | Lista paginada por keyset. `feedType` valida contra enum. |
| `POST` | `/api/feeds/:feedType/posts` | Crear post (valida atributos de vertical según `feedType`). Header `Idempotency-Key`. |
| `PATCH` | `/api/posts/:id` | Editar (autor o moderador). |
| `DELETE` | `/api/posts/:id` | Soft-delete (autor/moderador). |
| `POST` | `/api/posts/:id/react` | Like/reacción (idempotente por user+post). |
| `POST` | `/api/ads/:id/impression` | Registro batch de impresión (solo Principal). |
| `POST` | `/api/ads/:id/click` | Registro de click. |

**Request `POST /api/feeds/eventos/posts` (ejemplo vertical):**
```json
{
  "body": "Festival Latino en Queens",
  "media": ["tenant/abc/posts/uuid/cover.webp"],
  "event": {
    "starts_at": "2026-08-15T22:00:00Z",
    "ends_at": "2026-08-16T04:00:00Z",
    "place": "Flushing Meadows",
    "geo": { "lat": 40.74, "lng": -73.84 },
    "capacity": 500
  }
}
```

**Response (201):**
```json
{
  "id": "018f...",
  "feed_type": "eventos",
  "rank_score": 2000001720000000,
  "created_at": "2026-07-06T14:00:00Z",
  "status": "active"
}
```

---

## 3. Trust Score (decisión D6)

Sistema **permanente 0–100** desde el día 1. Sube por actividad legítima, baja por reportes. Badges: **Nuevo / Verificado / Confiable / Premium**. Barra de color en perfil.

> **Coordinación:** el agente de IA anti-abuso profundiza detección de fraude/bots. Aquí definimos el **motor de scoring, las reglas base, la exposición y los contratos**. El anti-abuso enchufa como una fuente más de `trust_events` (eventos negativos con peso) y puede vetar cambios de badge.

### 3.1 Modelo: event-sourced

**[REQUIERE DEL MODELO MAESTRO]** — dos tablas:

`trust_events` (append-only, auditable):
```
id uuid v7, tenant_id, user_id, event_type text, weight int (±),
source text ('system'|'moderation'|'ai_antiabuse'|'community'),
ref_id uuid null (post/report/etc), created_at, metadata jsonb
```

`trust_scores` (proyección materializada, 1 por user):
```
user_id PK, tenant_id, score int CHECK (0..100), band text,
badge text, updated_at, components jsonb (desglose para transparencia)
```

### 3.2 Reglas de cálculo (tabla de pesos, versionada)

| Acción / evento | `event_type` | Peso | Fuente | Tope/decay |
|---|---|---|---|---|
| Verificar email | `verify_email` | +5 | system | una vez |
| Verificar teléfono/KYC ligero | `verify_phone` | +15 | system | una vez → habilita badge Verificado |
| Antigüedad (por cada 30 días activo) | `tenure` | +2 | cron | tope +20 |
| Post que no recibe reportes en 7d | `clean_post` | +1 | cron | tope diario +3 |
| Recibir reacción/valoración positiva | `positive_signal` | +0.5 | system | tope diario +5 |
| Respuesta marcada como "mejor" (Q&A) | `best_answer` | +3 | system | — |
| Transacción/negocio completado sin disputa | `clean_deal` | +5 | system | — |
| Reporte **confirmado** por moderador | `report_upheld` | −15 | moderation | — |
| Detección anti-abuso (spam/bot) | `ai_flag` | −10 a −40 | ai_antiabuse | según severidad |
| Contenido removido por política | `content_removed` | −8 | moderation | — |
| Ban temporal | `temp_ban` | −25 | moderation | — |
| Inactividad prolongada (>90d) | `decay_inactive` | −5 | cron | piso 0 |

**Cálculo:** `score = clamp(BASE + Σ(weights con sus topes), 0, 100)`. `BASE = 40` (arranca en zona "Nuevo" media, ni alto ni cero — evita castigar al recién llegado y evita regalar confianza).

**Recalculo:**
- Trigger `AFTER INSERT ON trust_events` → recalcula incrementalmente `trust_scores.score` (aplicando topes desde una vista de agregación por `event_type`/día).
- **pg_cron diario**: aplica `tenure`, `clean_post`, `decay_inactive` (eventos generados por lote), luego recalcula bandas/badges.

### 3.3 Bandas, badges y barra de color

| Score | Banda | Badge por defecto | Barra (color) |
|-------|-------|-------------------|---------------|
| 0–24 | Riesgo | (sin badge / "Nuevo" si cuenta < 14d) | Rojo |
| 25–49 | Nuevo | **Nuevo** | Naranja |
| 50–74 | Establecido | **Confiable** (si además `verify_phone`) | Amarillo/Verde claro |
| 75–100 | Alto | **Confiable** | Verde |
| — | (cruza planes) | **Premium** (badge de plan, ortogonal, se muestra junto al de trust) | Acento premium |
| — | `verify_phone` = true | **Verificado** (badge modificador, se apila) | ícono check |

> Los badges **Premium** y **Verificado** son **ortogonales** al score (uno viene del plan de pago, otro de KYC). Un usuario Premium con score bajo muestra "Premium" + barra roja: transparencia total. Esto es anti-abuso por diseño (pagar no lava un mal historial).

### 3.4 Exposición (API)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/users/:id/trust` | Score público resumido: `{ score, band, badges[], color }`. Componentes detallados solo para el dueño o moderador. |
| `POST` | `/api/trust/events` | **Interno** (service-role / Edge Function). Ingesta de evento. Usado por moderación y anti-abuso. Idempotente por `(source, ref_id, event_type)`. |
| `GET` | `/api/me/trust/breakdown` | Desglose transparente para el propio usuario (qué sube/baja su score). |

**Response `GET /api/users/:id/trust`:**
```json
{
  "user_id": "018f...",
  "score": 68,
  "band": "establecido",
  "color": "#7CB342",
  "badges": [
    { "type": "confiable", "label": "Confiable" },
    { "type": "verificado", "label": "Verificado" },
    { "type": "premium", "label": "Premium" }
  ]
}
```

> Regla de seguridad: el score se **calcula server-side siempre**; el cliente nunca lo escribe. `trust_scores` tiene RLS de solo lectura (resumen público) y escritura únicamente vía `service_role` desde Edge Functions. Los pesos viven en una tabla `trust_weights` versionada para poder ajustarlos sin deploy.

---

## 4. Historias / Status efímeras 24h (decisión D7)

Tipo WhatsApp/IG: caducan a las 24h. Requisitos: storage, expiración automática, vistas, privacidad.

### 4.1 Storage

- Media en **Supabase Storage**, bucket `stories` con path `tenant/{tenant_id}/{user_id}/{story_id}.{ext}`.
- **[REQUIERE DEL MODELO MAESTRO]** — tabla `stories`:
  ```
  id uuid v7 PK, tenant_id, author_id, media_path, media_type (image|video),
  caption, created_at, expires_at (= created_at + 24h),
  privacy enum (public|followers|close_friends), close_friends_list uuid[] null
  ```
- **Regla de expiración de media:** política de lifecycle del bucket + limpieza por cron (ver 4.2). El registro se va con la partición; el objeto de Storage se borra en el mismo job (batch de `storage.delete`).

### 4.2 Expiración automática — DROP PARTITION (no DELETE masivo)

Decisión: **partición por rango diario** de `stories` (por `created_at::date`) + **pg_cron** que hace `DROP TABLE stories_YYYYMMDD` de la partición cuyo día ya superó las 24h + un día de gracia.

```sql
-- Job pg_cron cada hora: expira lógicamente + borra objetos + dropea particiones viejas
SELECT cron.schedule('expire-stories', '0 * * * *', $$
  -- 1) marcar expiradas (para que dejen de mostrarse ya, aunque la partición siga)
  UPDATE stories SET expires_at = expires_at WHERE expires_at <= now();  -- no-op lógico; filtro real en query
  -- 2) recolectar paths de objetos a borrar de particiones completamente vencidas
  --    (se hace en una función que llama a storage vía pg_net/edge o encola)
  PERFORM cleanup_expired_story_objects();
  -- 3) drop de particiones cuyo día entero ya venció (O(1))
  PERFORM drop_old_story_partitions();
$$);
```

**Por qué DROP PARTITION:** borrar millones de filas con `DELETE ... WHERE expires_at < now()` genera bloat, vacuum pesado y contención. `DROP` de una partición es instantáneo y libera espacio de inmediato. Es el patrón correcto para datos con TTL uniforme.

- **Consulta de historias vigentes:** `WHERE expires_at > now()` (respaldado por índice `(tenant_id, author_id, expires_at)`), independientemente de la partición física. La partición es una optimización de borrado, no cambia la query lógica.
- **Fallback / gracia:** si una partición no se dropeó a tiempo, el filtro `expires_at > now()` garantiza que nada vencido se muestre. Correctness no depende del cron; solo el espacio en disco.

### 4.3 Vistas (views) y privacidad

- **[REQUIERE DEL MODELO MAESTRO]** — tabla `story_views`:
  `story_id, viewer_id, tenant_id, viewed_at` — PK compuesta `(story_id, viewer_id)` (una vista por usuario). También particionable por día para caducar con la historia.
- **Privacidad:** filtro en el `GET`:
  - `public` → cualquiera del tenant.
  - `followers` → solo quienes siguen al autor **[REQUIERE DEL MODELO MAESTRO: tabla `follows`/`memberships`]**.
  - `close_friends` → `viewer_id = ANY(close_friends_list)`.
  - RLS refuerza: un usuario solo `SELECT`ea historias que su relación permite (policy con función `can_view_story(story, auth.uid())`).
- **Contador de vistas:** el autor ve `count(story_views)` y la lista de viewers (solo el autor). Se expone `viewed_by_me boolean` al resto.

### 4.4 Realtime de historias

- Broadcast `story_posted` al canal `tenant:{tenant_id}:stories` (o a followers) → los seguidores ven el "anillo" del autor iluminarse sin refrescar.
- Vista registrada → opcional broadcast `story_viewed` al canal privado del autor (`tenant:{t}:user:{author}`) para actualizar contador en vivo.

### 4.5 Contrato de API — Historias

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/stories` | Crear. Devuelve URL firmada de subida a Storage (o recibe media ya subida). Setea `expires_at`. |
| `GET` | `/api/stories/feed` | "Anillos": autores con historias vigentes que el usuario puede ver, agrupadas por autor. |
| `GET` | `/api/stories/:authorId` | Historias vigentes de un autor (ordenadas cronológicamente). Marca vista al abrir. |
| `POST` | `/api/stories/:id/view` | Registrar vista (idempotente). |
| `GET` | `/api/stories/:id/viewers` | Solo autor: lista de quién vio. |
| `DELETE` | `/api/stories/:id` | Autor borra antes de 24h. |

---

## 5. Grupos + Q&A (decisiones D9)

Grupos públicos/privados, membership con roles, moderador por grupo. Foros de preguntas con votos (upvote), marcar mejor respuesta, notificaciones de respuesta.

### 5.1 Modelo

**[REQUIERE DEL MODELO MAESTRO]** — tablas:

```
groups
  id uuid v7, tenant_id, owner_id, name, slug, description, avatar_path,
  visibility enum (public|private), join_policy enum (open|request|invite),
  members_count int, created_at

group_members
  group_id, user_id, tenant_id, role enum (member|moderator|owner),
  status enum (active|pending|banned), joined_at
  PK (group_id, user_id)

qa_questions
  id uuid v7, tenant_id, group_id null (puede ser global del tenant o dentro de grupo),
  author_id, title, body, tags text[], votes_count int, answers_count int,
  best_answer_id uuid null, status enum (open|answered|closed), created_at

qa_answers
  id uuid v7, tenant_id, question_id, author_id, body,
  votes_count int, is_best boolean, created_at

qa_votes
  target_type enum (question|answer), target_id, user_id, tenant_id, value smallint (+1),
  PK (target_type, target_id, user_id)   -- previene doble voto
```

### 5.2 Membership, roles y visibilidad (flujos)

- **Público + open:** join inmediato (`POST /groups/:id/join` → member activo).
- **Público + request / privado:** crea `group_members(status='pending')` → notifica a moderadores → aprobación (`POST /groups/:id/members/:uid/approve`).
- **Privado:** contenido (posts/preguntas del grupo) solo visible a miembros activos. RLS: `EXISTS (group_members activo del auth.uid())`.
- **Roles:** `owner` (todo), `moderator` (aprobar/expulsar/ocultar contenido, marcar mejor respuesta si delega el autor), `member` (participar). Cambios de rol solo por owner.
- **[REQUIERE DEL MODELO MAESTRO]** — función RLS `is_group_member(group_id, user_id, min_role)`.

### 5.3 Q&A: votos y mejor respuesta

- **Upvote:** `POST /qa/answers/:id/vote` → inserta en `qa_votes` (idempotente por PK). Trigger `AFTER INSERT/DELETE ON qa_votes` mantiene `votes_count` denormalizado (para ordenar respuestas por votos sin `count(*)`).
- **Orden de respuestas:** `is_best DESC, votes_count DESC, created_at ASC`. La mejor respuesta siempre arriba; luego más votadas; luego cronológico.
- **Marcar mejor respuesta:** solo el **autor de la pregunta** (o moderador del grupo) → `POST /qa/questions/:id/best-answer { answer_id }`. Setea `best_answer_id`, `qa_answers.is_best`, cambia `question.status='answered'`, dispara `+3` trust al autor de la respuesta y una notificación.
- **Anti-abuso:** no auto-voto (constraint `user_id != author_id` a nivel de check o policy); un cambio de mejor respuesta revierte el trust del anterior (evento compensatorio en `trust_events`).

### 5.4 Contrato de API — Grupos + Q&A

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/groups` | Crear grupo. Creador = owner. |
| `GET` | `/api/groups?visibility=&q=&cursor=` | Descubrir grupos (keyset). |
| `POST` | `/api/groups/:id/join` | Unirse o solicitar según `join_policy`. |
| `POST` | `/api/groups/:id/members/:uid/approve` | Moderador aprueba pendiente. |
| `PATCH` | `/api/groups/:id/members/:uid` | Cambiar rol / expulsar (owner/mod). |
| `POST` | `/api/groups/:id/questions` | Crear pregunta en grupo. |
| `GET` | `/api/qa/questions?group_id=&sort=votes\|recent&cursor=` | Listar preguntas (keyset). |
| `POST` | `/api/qa/questions/:id/answers` | Responder. Notifica al autor. |
| `POST` | `/api/qa/answers/:id/vote` | Upvote (idempotente). |
| `DELETE` | `/api/qa/answers/:id/vote` | Quitar voto. |
| `POST` | `/api/qa/questions/:id/best-answer` | Marcar mejor respuesta (autor/mod). |

**Realtime Q&A:** broadcast `new_answer` al canal `tenant:{t}:question:{question_id}` para que quien mira la pregunta vea respuestas entrar en vivo. Y notificación (§6) al autor de la pregunta.

---

## 6. Notificaciones transversales (decisión D8)

In-app + push + email. Eventos que las disparan, fan-out, y realtime.

### 6.1 Arquitectura: Outbox + Worker de fan-out

```
[Evento de dominio]                 (nuevo seguidor, respuesta, mención, aprobación de grupo,
   │                                 report resuelto, boost por vencer, mejor respuesta, RSVP...)
   ▼
INSERT notification_outbox  ──(trigger o llamada de la API)──►  realtime.send() opcional (in-app inmediato)
   │
   ▼  (pg_cron cada ~10s / o pg_net dispara Edge Function)
[Edge Function: notify-dispatcher]
   ├── crea filas en `notifications` (in-app, por destinatario)         → Realtime al canal del user
   ├── envía Web Push a devices suscritos (VAPID)                        → con backoff/retry
   └── encola email (Resend) según preferencias + digest                → idempotente por dedupe key
```

**[REQUIERE DEL MODELO MAESTRO]** — tablas:

```
notification_outbox
  id uuid v7, tenant_id, event_type, actor_id, target_user_id (o audience_query jsonb),
  payload jsonb, created_at, processed_at null, attempts int, dedupe_key text unique

notifications  (in-app, lo que ve el usuario)
  id uuid v7, tenant_id, user_id, type, title, body, link, actor_id,
  read_at null, created_at

push_subscriptions
  id, tenant_id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen

notification_prefs
  user_id, tenant_id, channel_inapp bool, channel_push bool, channel_email bool,
  per_type jsonb (mute por tipo), email_digest enum (instant|daily|off)
```

### 6.2 Eventos que disparan notificaciones

| Evento | Destinatario | Canales por defecto |
|--------|--------------|---------------------|
| Nueva respuesta a tu pregunta | autor pregunta | in-app + push |
| Tu respuesta marcada como mejor | autor respuesta | in-app + push + email |
| Nuevo seguidor | seguido | in-app |
| Mención `@usuario` | mencionado | in-app + push |
| Solicitud de ingreso a grupo | moderadores | in-app |
| Aprobado en grupo | solicitante | in-app + push |
| Reacción a tu post (agrupada) | autor post | in-app (digest) |
| Report resuelto sobre tu contenido | autor | in-app + email |
| Boost por vencer (24h) | dueño del post/anunciante | in-app + email |
| RSVP a tu evento | organizador | in-app |
| Nueva historia de alguien que sigues | seguidores | in-app (silencioso / anillo) |

### 6.3 Fan-out

- **1:1** (respuesta, mención, seguidor): `target_user_id` directo.
- **1:pocos** (moderadores de grupo): expandir `audience_query` a los mods activos.
- **1:muchos** (nueva historia a followers, broadcast de anuncio del tenant): el worker pagina la audiencia y crea `notifications` en lote; para in-app en vivo usa **un solo broadcast** al canal de topic (ej. `tenant:{t}:stories`) en vez de N mensajes por usuario. Push/email se hace en lotes con rate-limit.
- **Idempotencia:** `dedupe_key = hash(event_type, target, ref_id)` con unique constraint. Reintentos del worker no duplican. `attempts` + backoff exponencial; a los 5 intentos → dead-letter (`notification_outbox.status='failed'`) para inspección.

### 6.4 Realtime in-app

- Cada usuario suscrito a `tenant:{tenant_id}:user:{user_id}`.
- Al crear una fila en `notifications`, trigger `realtime.send('notification', payload, 'tenant:..:user:..', private=true)` → badge/contador sube al instante.
- `GET /api/notifications?cursor=` (keyset por `created_at,id`), `POST /api/notifications/read` (marca leídas), `GET /api/notifications/unread-count`.

### 6.5 Push y Email

- **Web Push (PWA):** VAPID keys por app; `push_subscriptions` guarda endpoints. El dispatcher firma y envía; limpia suscripciones que devuelven 410 Gone.
- **Email:** Resend (u otro) vía Edge Function. Respeta `notification_prefs.email_digest`: `instant` (envía ya), `daily` (acumula en `notification_outbox` y un cron diario compone el digest), `off`.
- **Preferencias:** `GET/PATCH /api/notifications/prefs`. Mute por tipo y por canal.

### 6.6 Contrato de API — Notificaciones

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/notifications?cursor=&limit=` | Lista in-app (keyset). |
| `GET` | `/api/notifications/unread-count` | Contador. |
| `POST` | `/api/notifications/read` | Marca leídas (`ids[]` o `all`). |
| `GET/PATCH` | `/api/notifications/prefs` | Preferencias por canal/tipo. |
| `POST` | `/api/push/subscribe` | Registrar suscripción Web Push. |
| `DELETE` | `/api/push/subscribe` | Baja de dispositivo. |

---

## 7. APIs / Edge Functions clave, performance y escala multi-tenant

### 7.1 Qué va en Edge Function vs RPC vs REST directo

| Tipo de operación | Dónde | Por qué |
|---|---|---|
| Lectura de feed keyset | **PostgREST (REST)** con RPC `get_feed(feed_type, cursor)` o vista + filtros | Baja latencia, RLS aplica. |
| Inyección de ads en Principal | **Edge Function** `feed-principal` | Lógica de slotting/facturación no debe vivir en el cliente. |
| Ingesta trust event | **Edge Function** `trust-ingest` (service-role) | Escribe con privilegios; valida fuente. |
| Dispatcher de notificaciones | **Edge Function** `notify-dispatcher` (cron/pg_net) | Fan-out, push, email, retries. |
| Expiración de historias | **pg_cron** + función SQL + Edge para borrar objetos Storage | TTL/DROP PARTITION. |
| Recalculo de rank_score / trust batch | **pg_cron** | Decay temporal sin escrituras del usuario. |
| Broadcast de eventos realtime | **Triggers SQL** con `realtime.send` | Una escritura → un fan-out. |

### 7.2 Contratos: convenciones transversales

- **Auth:** todas las rutas requieren JWT de Supabase; `tenant_id` sale del claim, no del body (previene tenant spoofing).
- **Idempotencia:** header `Idempotency-Key` obligatorio en `POST` con efectos externos (crear post con media, ads impression, push subscribe, trust event). Tabla `idempotency_keys(key, tenant_id, response_hash, created_at)`.
- **Errores:** formato uniforme `{ error: { code, message, details? } }`, HTTP status correcto (400/401/403/404/409/422/429).
- **Rate limiting:** por `tenant_id + user_id` en el gateway (Vercel middleware / Edge) para creación de posts, votos, follows (anti-spam). Coordina con anti-abuso.
- **Paginación:** siempre keyset con `next_cursor` opaco; nunca offset en endpoints de lista social.

### 7.3 Índices críticos (resumen para el modelo maestro)

```sql
-- Feeds
CREATE INDEX idx_posts_feed_rank ON posts (tenant_id, feed_type, rank_score DESC, id DESC)
  WHERE deleted_at IS NULL AND status='active';
CREATE INDEX idx_posts_feed_recent ON posts (tenant_id, feed_type, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND status='active';         -- orden "reciente" estable

-- Stories
CREATE INDEX idx_stories_live ON stories (tenant_id, author_id, expires_at);   -- + particionado por día
CREATE INDEX idx_story_views_pk ON story_views (story_id, viewer_id);

-- Trust
CREATE INDEX idx_trust_events_user ON trust_events (tenant_id, user_id, created_at DESC);

-- Q&A
CREATE INDEX idx_answers_ranking ON qa_answers (question_id, is_best DESC, votes_count DESC, created_at);
CREATE UNIQUE INDEX uq_qa_votes ON qa_votes (target_type, target_id, user_id);

-- Notifications
CREATE INDEX idx_notifications_user ON notifications (tenant_id, user_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;                                  -- unread rápido
CREATE UNIQUE INDEX uq_outbox_dedupe ON notification_outbox (dedupe_key);
```

### 7.4 Escala y Realtime — camino de crecimiento

- **Fase 1 (hasta ~10k conexiones concurrentes/tenant-pool):** Broadcast from Database en canales privados con RLS. Payloads livianos. Suficiente según benchmarks de Supabase.
- **Fase 2 (alta concurrencia):** si el costo de evaluar RLS por evento realtime pesa, mover a **tabla "public" sin RLS re-streameada por Broadcast server-side** (patrón recomendado por Supabase para Postgres Changes at scale) o self-host del Realtime server. Decisión diferida; se documenta como opción.
- **Replay:** Broadcast desde DB permite replay de mensajes en canales privados (partición diaria, retención 72h–4d). Útil para "recuperar" notificaciones perdidas al reconectar (el cliente pide replay desde su último `created_at`). No sustituye a la tabla `notifications` (fuente de verdad durable).
- **Costo de fan-out:** el trigger de broadcast hace **un** envío por evento al topic; N clientes reciben sin N escrituras. Esto es lo que hace viable feeds/notifs en multi-tenant sin explotar.

### 7.5 Trade-offs globales (registro para el plan maestro)

| Decisión | Ganamos | Cedemos / Riesgo | Mitigación |
|---|---|---|---|
| Fan-out on read + score materializado | Storage acotado, feeds multi-tenant baratos | Score hasta 5 min desactualizado | Cron 5 min + triggers en cambios de boost |
| Keyset sobre rank_score | O(1) a profundidad | Ítems pueden saltar de página en feed vivo | Orden "reciente" estable opcional |
| Broadcast from DB | Escala fan-out, payload controlado | Setup mayor que Postgres Changes | Helpers SQL + plantillas de trigger |
| DROP PARTITION para stories | TTL real, sin bloat | Complejidad de particionado + cron | Filtro `expires_at>now()` garantiza correctness aunque falle el cron |
| Trust event-sourced | Auditable, reversible, anti-abuso | Más tablas y recálculo | Proyección materializada + índices |
| Outbox + worker notifs | Desacople, retries, idempotencia | Latencia extra (segundos) vs push directo | Broadcast in-app inmediato en paralelo al worker |

---

## 8. Checklist de conciliación con el modelo de datos maestro

Marcado **[REQUIERE DEL MODELO MAESTRO]** a lo largo del doc. Consolidado:

1. `tenant_id` como **claim en el JWT** (o tabla `tenant_domains` + helper).
2. **UUID v7** estándar para todas las PK (cursor + orden temporal).
3. Tablas: `posts` (+ satélites `post_properties/business/event/professional`), `ad_placements`, `stories`, `story_views`, `groups`, `group_members`, `qa_questions/answers/votes`, `trust_events`, `trust_scores`, `trust_weights`, `notification_outbox`, `notifications`, `push_subscriptions`, `notification_prefs`, `idempotency_keys`, `follows`/`memberships`.
4. Denormalizaciones que el modelo debe mantener por trigger: `posts.boost_tier`, `posts.author_plan_tier`, `posts.engagement_count`, `posts.rank_score`, `*_count` de votos/miembros/answers.
5. Funciones/policies RLS helper: `auth_belongs_to_tenant`, `is_group_member`, `can_view_story`, `auth.uid()` scoping en `realtime.messages`.
6. Extensiones a habilitar: `pg_cron`, `pg_net` (para que triggers/cron invoquen Edge Functions), `pg_uuidv7` (o generación en app), Realtime con Broadcast.
7. Particionado por rango de tiempo (diario) en `stories` y `story_views` (y opcionalmente `notifications` por mes).
8. Ventanas de vigencia de boost: fuente de verdad del `boost_expires_at` (probablemente en el módulo de pagos/Stripe Connect) que refresca `posts.boost_tier`/`priority_band`.

---

## 9. Fuentes verificadas

- [Realtime: Broadcast from Database — Supabase Blog](https://supabase.com/blog/realtime-broadcast-from-database)
- [Broadcast — Supabase Docs](https://supabase.com/docs/guides/realtime/broadcast)
- [Realtime Architecture — Supabase Docs](https://supabase.com/docs/guides/realtime/architecture)
- [Realtime Benchmarks — Supabase Docs](https://supabase.com/docs/guides/realtime/benchmarks)
- [Taking Supabase to Production in 2026 — FrontendTechLead](https://www.frontendtechlead.com/blog/supabase-production-architecture-2026)
- [Supabase Realtime in Production — AgileSoftLabs](https://www.agilesoftlabs.com/blog/2026/05/supabase-realtime-in-production-what)
- [PostgreSQL Keyset Pagination vs Offset — Stacksync](https://www.stacksync.com/blog/keyset-cursors-postgres-pagination-fast-accurate-scalable)
- [Keyset Cursors, Not Offsets — Sequin](https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/)
- [pg_cron — Supabase Docs](https://supabase.com/docs/guides/database/extensions/pg_cron)
- [Supabase Cron — Supabase Blog](https://supabase.com/blog/supabase-cron)
- [pg_net: Async Networking — Supabase Docs](https://supabase.com/docs/guides/database/extensions/pg_net)
- Guía del proyecto: https://geovanny-estudio.onrender.com/
