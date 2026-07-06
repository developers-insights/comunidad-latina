# 01 — Arquitectura Multi-Tenant y Modelo de Datos Maestro

**Proyecto:** Comunidad Latina / NYLabel — Red social white-label multi-tenant (PWA)
**Autor:** Arquitecto de Datos
**Fecha:** 2026-07-06
**Estado:** DECISIONES TOMADAS — insumo del PLAN MAESTRO
**Stack:** Next.js + TypeScript · Supabase (Postgres 15/17 + RLS + Auth + Storage + Realtime + Edge Functions) · Vercel · Stripe Connect

> Este documento es la **fuente de verdad transversal** del esquema. Otro agente implementa la lógica de los módulos sociales; aquí se define el esquema base, la estrategia de aislamiento y las reglas que TODAS las tablas deben respetar. Cualquier tabla nueva se valida contra la sección **§4 Contrato de tablas** y **§5 RLS**.

---

## 0. Resumen ejecutivo de decisiones

| # | Decisión | Elección |
|---|----------|----------|
| D1 | Estrategia de tenancy | **Shared schema + `tenant_id` + RLS** (una sola base, un solo esquema `public`) |
| D2 | Tipo de `tenant_id` | `uuid` (no `bigint`), NOT NULL en toda tabla de negocio |
| D3 | Contexto de tenant en sesión | **JWT claim `tenant_id` + `user_role`** vía Custom Access Token Hook, leído con `auth.jwt()`. `current_setting` solo para jobs server-side |
| D4 | Fuente del claim | `auth.users.raw_app_meta_data` (**app_metadata**, NO user_metadata — user_metadata es forjable por el usuario) |
| D5 | Aislamiento | RLS `FORCE` en todas las tablas + policy reusable `tenant_id = auth.tenant_id()` |
| D6 | Bypass Super Admin | Claim `is_platform_admin` en JWT + rama explícita en cada policy. NUNCA usar `service_role` desde el navegador |
| D7 | Resolución hostname→tenant | Middleware Next.js resuelve `host` → `tenant_id` contra tabla `tenants` (cacheada en Edge). Nunca confiar en header de cliente |
| D8 | Performance RLS | `(select auth.tenant_id())` envuelto en subquery (evita init-plan trap) + índice compuesto con `tenant_id` como primera columna |
| D9 | Paginación de feeds | **Keyset / cursor** `(created_at, id)` descendente, jamás OFFSET |
| D10 | Cuándo migrar a otra tenancy | Solo si un tenant supera ~1M usuarios activos o exige residencia de datos: mover ESE tenant a proyecto Supabase dedicado (silo), manteniendo shared schema para el resto |

---

## 1. Estrategia Multi-Tenant: comparación y decisión

### 1.1 Las tres opciones

| Criterio | **Shared schema (RLS por `tenant_id`)** ✅ | Schema-per-tenant | Database-per-tenant |
|---|---|---|---|
| Aislamiento | Lógico (RLS). Fuerte si RLS bien hecho | Fuerte (namespace) | Máximo (físico) |
| Nº de tenants soportado | Millones de filas/tenant, cientos+ de tenants sin problema | Se degrada > ~few hundred (catálogo `pg_catalog` explota, planner lento) | Caro por tenant (pool, backup, monitoring por DB) |
| Migraciones DDL | **1 sola** `ALTER TABLE` para todos | O(N): `ALTER` × N schemas → deploys de 30 min a horas | O(N) × N bases |
| Connection pooling | Compatible con PgBouncer transaction mode | **Rompe** transaction mode (search_path es per-connection) → session mode → tope de conexiones temprano | Un pool por base |
| Broadcast Global cross-tenant | Trivial (una query cross-tenant) | Complejo (loop por schema) | Muy complejo (fan-out por base) |
| Costo operativo | **Mínimo** | Medio-alto | Alto |
| Fit con Supabase | Nativo (RLS + Auth + un solo proyecto) | Antipatrón en Supabase (Auth vive en `auth`, un search_path por conexión) | 1 proyecto Supabase por tenant = costo × N |
| Riesgo principal | **Fuga cross-tenant si RLS falla** (mitigable) | Escala/ops | Costo/ops |

### 1.2 Decisión: **Shared schema + `tenant_id` + RLS** (D1)

**Justificación para ESTE producto:**

1. **El producto exige Broadcast Global cross-tenant** (alertas de personas desaparecidas, emergencias). Con shared schema es una sola inserción que se materializa a N tenants; con schema/DB-per-tenant sería un fan-out costoso y frágil — el feature estrella del Super Admin sería el más difícil de construir.
2. **8 dominios al lanzamiento, con ambición de decenas.** Schema-per-tenant colapsa antes de llegar ahí y las migraciones (producto COMPLETO, no MVP, con ~30 tablas) serían un infierno O(N).
3. **Supabase es un solo proyecto Postgres.** DB-per-tenant significaría 1 proyecto Supabase por dominio → costo, Auth fragmentado, y el "motor único / plataforma madre" del brief se rompe. Auth de Supabase vive en el schema `auth` y comparte un search_path por conexión: schema-per-tenant pelea con eso.
4. **El costo por tenant en shared schema es marginal**: agregar `dominicanos.com` = insertar una fila en `tenants` + una config. Cero infraestructura nueva. Esto habilita el modelo de negocio de "lanzar dominios sin código".
5. La propia guía del producto ya asume `WHERE tenant_id = X` automático vía RLS — la decisión está alineada con la visión.

**El costo de esta decisión es que el aislamiento es lógico, no físico.** Por eso §5 (RLS) y §6 (Super Admin) son las secciones más críticas del proyecto: **una fuga cross-tenant es el riesgo #1** y se combate con defensa en profundidad, no con una sola policy.

### 1.3 Criterios de migración a otra estrategia (D10) — "escape hatch"

Diseñamos el esquema para que un tenant pueda **extraerse** sin reescritura. Migrar cuando se cumpla **cualquiera**:

| Disparador | Acción | Por qué |
|---|---|---|
| Un tenant supera **~1M usuarios activos** o su tabla `posts` supera ~500M filas y las policies RLS degradan pese a índices/partición | Mover ESE tenant a un **proyecto Supabase dedicado** (patrón *silo*), export/import por `tenant_id`. El resto sigue en shared (patrón *pool*). Arquitectura híbrida pool+silo. | El shared schema aguanta muchísimo, pero el tenant gigante empieza a competir por I/O con los chicos ("noisy neighbor"). |
| Requisito legal de **residencia de datos** (p.ej. dominio europeo bajo GDPR estricto que exige datos en la UE) | Silo regional: proyecto Supabase en región UE para ese/esos tenants | Cumplimiento no se resuelve con RLS. |
| **SLA/aislamiento contractual** premium para un cliente white-label que compre licencia | Silo dedicado | Aislamiento físico como feature vendible. |

Como el `tenant_id` está en todas las tablas y todo el acceso pasa por RLS, la extracción es un `COPY ... WHERE tenant_id = $silo` + repunte de config. **No** partimos con database-per-tenant "por si acaso" (over-engineering que mata la velocidad de lanzamiento y Broadcast Global).

**Antes de saltar de estrategia, escalar dentro de shared schema** (más barato, en este orden): índices compuestos → **partición nativa de Postgres por `tenant_id`** (LIST/HASH) en tablas calientes (`posts`, `notifications`, `moderation_queue`) → read replicas de Supabase → tablas de agregación/caché. Solo si eso no alcanza, silo.

---

## 2. Resolución de Tenant (hostname → tenant_id)

### 2.1 Flujo

```
Request a colombianos.com
      │
      ▼
[Vercel Edge / Next.js middleware.ts]
  1. Lee host = req.headers.host  (NUNCA un header custom del cliente)
  2. Normaliza (quita www., puerto, lowercase)
  3. Busca en cache Edge (o tabla `tenants`) host → tenant_id + estado
  4. Si no existe o suspendido → 404 / página "dominio no disponible"
  5. Inyecta tenant_id resuelto en el contexto del request (header interno reescrito
     server-side, o en el Server Component context). El cliente NO lo elige.
      │
      ▼
[Supabase Auth] En login, el Custom Access Token Hook estampa tenant_id
  del usuario en el JWT (app_metadata). El tenant del DATO manda vía RLS,
  no el host — el host solo decide branding y a qué tenant intenta loguear.
```

**Regla de oro:** el `tenant_id` que gobierna el acceso a datos **siempre** proviene del **JWT** (firmado por Supabase), no del hostname ni de un header manipulable. El hostname solo selecciona **branding/config** y el tenant contra el que se autentica. Un usuario de `colombianos.com` con un JWT de tenant Colombia **no puede** leer datos de México aunque falsee el `Host`, porque RLS filtra por el claim del token.

### 2.2 Tabla `tenants` y `tenant_config`

`tenants` = identidad y routing (una fila por dominio). `tenant_config` = branding y módulos on/off (separada para poder cachearla agresivamente y versionarla sin tocar la fila de routing). Ver DDL en §7.

**Caching:** `tenants` cambia rarísimo → cache en Edge/Vercel con revalidación (p.ej. 60 s) o KV. Evita un round-trip a Postgres por cada request. Invalidar cuando el Super Admin crea/edita un dominio (webhook → purge).

**Dominios y subdominios:** soportar apex (`colombianos.com`), `www.`, y un fallback `*.comunidadlatina.app` para preview/staging. Tabla `tenant_domains` (1:N) permite múltiples hostnames por tenant (alias, dominio viejo + nuevo) sin duplicar el tenant.

---

## 3. Contexto de sesión: JWT claims vs current_setting

### 3.1 Decisión (D3, D4): **JWT claims** como mecanismo principal

Dos formas de pasar el tenant a las policies:

| Mecanismo | Uso | Veredicto |
|---|---|---|
| **`auth.jwt() ->> 'tenant_id'`** (claim en el token) | Requests de usuarios vía PostgREST/supabase-js | ✅ **Principal.** El claim viaja firmado; no hay que setear nada por request; funciona con connection pooling sin estado por-conexión. |
| **`current_setting('app.tenant_id')`** + `SET LOCAL` | Jobs server-side, Edge Functions con service role que deben "actuar como" un tenant, scripts de migración de datos | ✅ **Secundario/controlado.** Útil cuando NO hay JWT de usuario. Requiere `SET LOCAL` dentro de transacción. |

**Por qué el claim y no `current_setting` como default:** con supabase-js el cliente habla directo con PostgREST; no hay un lugar natural para `SET LOCAL app.tenant_id` por request sin envolver todo en RPC. El JWT ya llega en cada request y Supabase lo expone a las policies. `current_setting` brilla en el patrón Prisma/servidor propio (como el del skill), pero aquí el patrón nativo Supabase es el claim.

### 3.2 Custom Access Token Hook — estampar `tenant_id`, `user_role`, `is_platform_admin`

La fuente de verdad de la membresía es la tabla `profiles` (`tenant_id`, `role`) + `platform_admins`. El hook copia esos valores al JWT en cada emisión/refresh de token.

```sql
-- ============================================================
-- CUSTOM ACCESS TOKEN HOOK
-- Estampa tenant_id, user_role e is_platform_admin en el JWT.
-- Se registra en: Dashboard → Auth → Hooks → Custom Access Token
-- ============================================================
create or replace function auth_hooks.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims        jsonb;
  v_tenant_id   uuid;
  v_role        text;
  v_is_admin    boolean;
begin
  -- Membresía del usuario (tenant + rol dentro del tenant)
  select p.tenant_id, p.role
    into v_tenant_id, v_role
    from public.profiles p
   where p.id = (event->>'user_id')::uuid;

  -- ¿Es Global Super Admin de la plataforma? (cross-tenant)
  select exists(
      select 1 from public.platform_admins pa
       where pa.user_id = (event->>'user_id')::uuid
  ) into v_is_admin;

  claims := event->'claims';

  if v_tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id));
  end if;
  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(v_role, 'user')));
  claims := jsonb_set(claims, '{is_platform_admin}', to_jsonb(coalesce(v_is_admin, false)));

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- Permisos: solo el rol de Auth ejecuta el hook; nadie más.
grant usage  on schema auth_hooks to supabase_auth_admin;
grant execute on function auth_hooks.custom_access_token_hook to supabase_auth_admin;
revoke execute on function auth_hooks.custom_access_token_hook from authenticated, anon, public;

-- El hook necesita leer estas tablas como supabase_auth_admin:
grant usage on schema public to supabase_auth_admin;
grant select on public.profiles, public.platform_admins to supabase_auth_admin;
-- (Crear policies que permitan a supabase_auth_admin leer, o usar security definer.)
```

> **Gotcha crítico:** los claims **no** se actualizan hasta el siguiente refresh de token. Si el Super Admin cambia el `role` de un usuario o lo mueve de tenant, hay que **forzar refresh/re-login** o el JWT viejo seguirá vigente hasta expirar (default 1 h). Documentar en el flujo de admin: "cambios de rol/tenant surten efecto al renovar sesión".

### 3.3 Funciones helper estables (leídas por las policies)

Envolver el acceso al claim en funciones **`stable`** y **`security definer set search_path = ''`**. Esto (a) centraliza la lógica, (b) permite el truco de performance `(select ...)`, (c) evita repetir parsing de JWT.

```sql
-- tenant_id del usuario actual (desde el JWT)
create or replace function public.auth_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

-- rol dentro del tenant: 'user' | 'moderator' | 'domain_admin'
create or replace function public.auth_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'user_role', 'user');
$$;

-- ¿Global Super Admin? (bypass cross-tenant)
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'is_platform_admin')::boolean, false);
$$;
```

> **Seguridad del claim (D4):** estas funciones leen de `auth.jwt()`, que refleja **app_metadata** (estampado por el hook server-side). **Nunca** basar RLS en `user_metadata`: el usuario puede editarlo vía `supabase.auth.updateUser()` y forjaría su `tenant_id`/rol. app_metadata solo se escribe con privilegios de servidor. Esta es la línea que separa "seguro" de "cualquiera lee cualquier tenant".

---

## 4. Contrato de tablas (reglas que TODAS deben cumplir)

Todo agente que cree una tabla de negocio DEBE cumplir:

1. **Columna `tenant_id uuid NOT NULL`** con FK a `tenants(id)` — salvo las excepciones globales listadas abajo.
2. **`id`**: `uuid default gen_random_uuid()` como PK (evita enumeración; global-safe para futura extracción de tenant). Para tablas de altísimo volumen append-only (`posts`), evaluar `bigint` identity + índice, pero el default del proyecto es `uuid`.
3. **`created_at timestamptz not null default now()`**, `updated_at timestamptz` (trigger de actualización).
4. **RLS habilitado y `FORCE`** (§5).
5. **Índice compuesto con `tenant_id` primero** en todo patrón de acceso (`(tenant_id, created_at desc)` para feeds).
6. **FKs "tenant-aware":** las relaciones dentro de un tenant deben garantizar que padre e hijo comparten `tenant_id`. Con `uuid` random el riesgo de mezclar es bajo, pero para tablas sensibles usar FK compuesta `(tenant_id, parent_id)` o un trigger de validación (ver §5.5).
7. **`WITH CHECK`** en toda policy de INSERT/UPDATE para impedir escribir en otro tenant.

**Tablas SIN `tenant_id` (globales, viven fuera del aislamiento por tenant):**

- `tenants`, `tenant_config`, `tenant_domains`, `tenant_modules` — configuración del tenant en sí.
- `platform_admins` — Super Admins (cross-tenant por definición).
- `broadcasts` — mensajes globales del Super Admin (se **fan-out** a tenants vía `broadcast_targets` o se leen con policy especial).
- `plans_catalog` — catálogo maestro de planes/precios (referenciado por todos; los precios efectivos por tenant pueden overridearse en `tenant_config`).
- `moderation_taxonomy`, `professional_categories`, `property_types` — catálogos de referencia (pueden ser globales con override por tenant).

---

## 5. Diseño de RLS (el corazón del aislamiento)

### 5.1 Patrón reusable — la policy que se repite en cada tabla

```sql
-- Plantilla para CUALQUIER tabla de negocio con tenant_id.
-- Reemplazar <TABLE> por el nombre real.

alter table public.<TABLE> enable row level security;
alter table public.<TABLE> force  row level security;   -- ⚠️ imprescindible: owners/jobs no bypassean

-- SELECT: solo filas de mi tenant, O soy Super Admin
create policy "<TABLE>_select_tenant"
on public.<TABLE> for select to authenticated
using (
  tenant_id = (select public.auth_tenant_id())
  or (select public.is_platform_admin())
);

-- INSERT: solo puedo crear filas EN mi tenant (WITH CHECK obligatorio)
create policy "<TABLE>_insert_tenant"
on public.<TABLE> for insert to authenticated
with check (
  tenant_id = (select public.auth_tenant_id())
);

-- UPDATE: solo filas de mi tenant, y no puedo "mudarlas" a otro
create policy "<TABLE>_update_tenant"
on public.<TABLE> for update to authenticated
using      ( tenant_id = (select public.auth_tenant_id()) )
with check ( tenant_id = (select public.auth_tenant_id()) );

-- DELETE: solo filas de mi tenant
create policy "<TABLE>_delete_tenant"
on public.<TABLE> for delete to authenticated
using ( tenant_id = (select public.auth_tenant_id()) );
```

**Notas de diseño:**

- **`(select public.auth_tenant_id())`** — el `select` envolvente dispara un **initPlan** que Postgres evalúa **una vez por query** en vez de **una vez por fila**. En una tabla de 100K filas es la diferencia entre 5 ms y 5 s (init-plan trap, `auth_rls_initplan` en el Advisor). **Sin excepción.**
- **Super Admin en el `using` de SELECT** pero **NO** en el `with check` de INSERT (§6): un Super Admin no crea contenido "como usuario" de un tenant; administra. Si necesita escribir, lo hace por RPC controlada.
- Roles más finos (moderador, domain_admin) se agregan como policies **adicionales** por operación (§5.3), no reescribiendo esta base.

### 5.2 Automatizar la aplicación (evitar olvidos = evitar fugas)

Con ~30 tablas, olvidar RLS en UNA es una fuga. Mitigación:

- **Función generadora** que recorre `information_schema` y aplica la plantilla a toda tabla con columna `tenant_id` que no tenga policies (idempotente).
- **Test de auditoría en CI** (ver §5.6 y skill `supabase-audit-rls`): falla el build si existe una tabla con `tenant_id` sin RLS `FORCE` + policies.
- **`get_advisors`** (Supabase) en el pipeline: alerta `rls_disabled_in_public` y `auth_rls_initplan`.

### 5.3 Policies por rol (moderador / domain_admin) — se suman a la base

```sql
-- Domain Admin: puede moderar TODO su tenant (no solo lo suyo).
-- La base ya lo cubre para SELECT/UPDATE dentro del tenant, pero para
-- operaciones administrativas (p.ej. borrar cualquier post del tenant)
-- se agrega policy explícita por rol:

create policy "posts_admin_manage_tenant"
on public.posts for all to authenticated
using (
  tenant_id = (select public.auth_tenant_id())
  and (select public.auth_role()) in ('domain_admin','moderator')
)
with check (
  tenant_id = (select public.auth_tenant_id())
);
```

> Postgres combina policies múltiples de la misma tabla/acción con **OR**. Así, la policy base ("mis filas") y la de admin ("cualquier fila del tenant si soy admin") coexisten sin pisarse.

### 5.4 Bypass seguro del Super Admin — ver §6 (sección dedicada por criticidad).

### 5.5 Anti-fuga: FK tenant-aware y validación de relaciones

Riesgo sutil: un `comment.post_id` que apunte a un `post` de OTRO tenant. Aunque RLS filtra por `tenant_id` del comment, si el `post_id` cruza tenants hay inconsistencia lógica. Mitigaciones:

1. **Denormalizar `tenant_id` en las hijas** (ya es regla §4) y validar por trigger que coincide con el padre:

```sql
create or replace function public.assert_same_tenant()
returns trigger language plpgsql as $$
declare parent_tenant uuid;
begin
  execute format('select tenant_id from public.%I where id = $1', tg_argv[0])
    into parent_tenant using new.post_id;   -- ajustar columna FK por tabla
  if parent_tenant is null or parent_tenant <> new.tenant_id then
    raise exception 'cross-tenant FK violation on %', tg_table_name;
  end if;
  return new;
end;
$$;
-- trigger before insert/update en tablas hijas sensibles (comments, applications, rsvps...)
```

2. **FK compuesta** donde el volumen lo permita: `unique (id, tenant_id)` en el padre + `foreign key (post_id, tenant_id) references posts(id, tenant_id)`. Garantía a nivel motor, sin trigger.

### 5.6 Suite de tests de aislamiento (obligatoria, corre en CI)

Cubrir, por cada tabla sensible (patrón del skill `multi-tenant-safety-checker` y `supabase-audit-rls`):

- SELECT desde tenant A **no** ve filas de tenant B.
- INSERT con `tenant_id` de B estando logueado en A → rechazado por `WITH CHECK`.
- UPDATE/DELETE cross-tenant → 0 filas afectadas.
- Intento de "mudar" fila de A a B (UPDATE `tenant_id`) → rechazado.
- `anon` no lee nada que no sea explícitamente público.
- Super Admin SÍ ve cross-tenant; moderador de A **no** modera B.
- Regresión: inyección tipo `' OR 1=1 --` en filtros no bypassa (parametrización).

---

## 6. Bypass del Global Super Admin — patrón seguro (RIESGO ALTO)

El Super Admin (Geovanny) debe ver y administrar **todos** los tenants y publicar Broadcast Global. Hay que darle poder cross-tenant **sin** abrir un agujero.

### 6.1 Qué NO hacer

- ❌ **No** usar `service_role` (que bypassa RLS) desde el navegador ni exponer su key al cliente. La `service_role` key en el frontend = fin del aislamiento para cualquiera que la extraiga. Solo vive en Edge Functions/servidor.
- ❌ **No** poner al Super Admin en un `tenant_id` especial y filtrar por eso — es frágil.
- ❌ **No** basar el bypass en `user_metadata`.

### 6.2 Qué SÍ hacer — claim `is_platform_admin` + rama explícita en policies

1. **Registro de admins:** tabla `platform_admins(user_id)`. Solo se escribe server-side (o por otro platform admin vía RPC audit-logueada).
2. **El hook** (§3.2) estampa `is_platform_admin: true` en el JWT de esos usuarios.
3. **Cada policy de SELECT** incluye `or (select public.is_platform_admin())` (ya en la plantilla §5.1). Resultado: el Super Admin, con RLS **activo**, ve todos los tenants — el aislamiento sigue *encendido*, solo que su claim lo autoriza a cruzar. No desactivamos RLS; lo *ampliamos* para un rol.
4. **Escritura administrativa cross-tenant** (p.ej. suspender un negocio en cualquier dominio): vía **RPC `security definer`** específicas y **audit-logueadas**, no vía policies abiertas de INSERT/UPDATE con `is_platform_admin` en el `WITH CHECK`. Así el poder de escritura del admin pasa por funciones nombradas y registrables, no por una compuerta genérica.

```sql
-- Ejemplo: acción administrativa cross-tenant, auditada.
create or replace function public.admin_suspend_business(p_business_id uuid, p_reason text)
returns void
language plpgsql
security definer               -- corre con privilegios elevados
set search_path = ''
as $$
begin
  if not (select public.is_platform_admin()) then
    raise exception 'not authorized';
  end if;

  update public.businesses
     set status = 'suspended', updated_at = now()
   where id = p_business_id;

  insert into public.admin_audit_log(actor_user_id, action, target_table, target_id, meta)
  values (auth.uid(), 'suspend_business', 'businesses', p_business_id, jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function public.admin_suspend_business from anon, public;
grant  execute on function public.admin_suspend_business to authenticated;  -- el guard interno filtra
```

### 6.3 Broadcast Global — modelo de datos y entrega

El Super Admin publica **una vez** y llega a N tenants. Dos patrones; elegimos **híbrido**:

- `broadcasts` (global, sin `tenant_id`): el mensaje maestro (título, cuerpo, tipo: `emergency|alert|announcement`, scope: `all_tenants` o lista).
- `broadcast_targets(broadcast_id, tenant_id)`: a qué tenants aplica (si scope = all, se puebla con todos; si es dirigido, subconjunto).
- **Lectura:** una `broadcast_reads`/feed item por usuario **no** se materializa masivamente al publicar (evita escribir millones de filas). En su lugar, el feed de cada usuario **une** su `tenant_id` con `broadcast_targets` en lectura, y `broadcast_receipts(broadcast_id, user_id, seen_at)` registra vistas bajo demanda.
- **RLS de `broadcasts`:** SELECT permitido si `is_platform_admin()` **o** existe target para el `tenant_id` del lector:

```sql
create policy "broadcasts_read"
on public.broadcasts for select to authenticated
using (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.broadcast_targets bt
     where bt.broadcast_id = broadcasts.id
       and bt.tenant_id = (select public.auth_tenant_id())
  )
);
```

Esto mantiene el aislamiento: un usuario solo ve broadcasts dirigidos a **su** tenant, y el Super Admin ve todos.

---

## 7. Modelo de Datos Maestro (DDL de alto nivel)

> Convenciones: todo `id uuid default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz`. `tid` = `tenant_id uuid not null references tenants(id)`. Salvo aclaración, **toda** tabla lleva `tid` + RLS `FORCE` + índice `(tenant_id, created_at desc)`. Se listan columnas clave, relaciones y si lleva tenant_id.

### 7.1 Núcleo multi-tenant (GLOBAL, sin tenant_id)

```sql
-- IDENTIDAD Y ROUTING DEL DOMINIO
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,               -- 'colombianos', 'mexicanos'
  country_code  text not null,                       -- 'CO','MX','DO','VE'...
  name          text not null,                       -- "Colombianos en USA"
  status        text not null default 'active',      -- active|suspended|provisioning
  created_at    timestamptz not null default now()
);

-- HOSTNAMES (1:N) → resolución host→tenant
create table tenant_domains (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  hostname    text unique not null,                  -- 'colombianos.com','www.colombianos.com'
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on tenant_domains (hostname);

-- BRANDING + SEO + LOCALE (1:1 con tenant, cacheable)
create table tenant_config (
  tenant_id     uuid primary key references tenants(id) on delete cascade,
  logo_url      text,
  color_primary text,  color_secondary text,
  currency      text not null default 'USD',         -- ISO 4217
  language      text not null default 'es',
  seo_title     text, seo_description text, seo_og_image text,
  categories    jsonb,                               -- categorías propias del dominio
  price_overrides jsonb,                             -- overrides sobre plans_catalog
  updated_at    timestamptz not null default now()
);

-- MÓDULOS ON/OFF por dominio (el Domain Admin prende/apaga)
create table tenant_modules (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  module_key  text not null,   -- 'properties','businesses','professionals','events',
                               -- 'groups','stories','creator_marketplace','stores',
                               -- 'ads','qa'
  enabled     boolean not null default true,
  config      jsonb,
  primary key (tenant_id, module_key)
);

-- GLOBAL SUPER ADMINS (cross-tenant)
create table platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- CATÁLOGO MAESTRO DE PLANES (global; precios base, override por tenant_config)
create table plans_catalog (
  id          uuid primary key default gen_random_uuid(),
  module_key  text not null,           -- a qué módulo aplica
  code        text not null,           -- 'prop_plus','prop_premium','broker_pro'...
  name        text not null,
  price_cents integer not null,
  period_days integer,                 -- 90 = 3 meses; null = por-evento
  limits      jsonb,                   -- {photos:30, videos:2, listings:150, priority:true}
  unique (module_key, code)
);

-- AUDITORÍA DE ACCIONES ADMIN (cross-tenant, append-only)
create table admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  action        text not null,
  target_table  text, target_id uuid, tenant_id uuid,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
```

### 7.2 Usuarios, Trust Score, follows

```sql
-- PERFIL (1:1 con auth.users) — fuente de verdad de tenant+rol del usuario
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid not null references tenants(id),      -- ← tenant del usuario
  username      text not null,
  display_name  text, avatar_url text, bio text, phone text,
  role          text not null default 'user',              -- user|moderator|domain_admin
  is_verified   boolean not null default false,
  premium_until timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, username)                             -- username único POR tenant
);
create index on profiles (tenant_id, username);

-- TRUST SCORE 0–100 (1:1 con profile) + badges derivadas
create table trust_scores (
  user_id      uuid primary key references profiles(id) on delete cascade,
  tenant_id    uuid not null references tenants(id),
  score        smallint not null default 0 check (score between 0 and 100),
  badge        text not null default 'nuevo',    -- nuevo|verificado|confiable|premium
  updated_at   timestamptz not null default now()
);
-- Eventos que mueven el score (append-only, auditable)
create table trust_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  user_id      uuid not null references profiles(id),
  delta        smallint not null,               -- +/- puntos
  reason       text not null,                    -- 'post_approved','reported','verified_email'
  created_at   timestamptz not null default now()
);
create index on trust_events (tenant_id, user_id, created_at desc);

-- SEGUIMIENTO (intra-tenant)
create table follows (
  tenant_id    uuid not null references tenants(id),
  follower_id  uuid not null references profiles(id) on delete cascade,
  followee_id  uuid not null references profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id)
);
create index on follows (tenant_id, followee_id);   -- "quién me sigue"
```

### 7.3 Posts y los 5 feeds

Diseño: **una tabla `posts` polimórfica ligera** para el contenido social base (Feed Principal, stories, texto/imagen/video) + **tablas especializadas** para entidades ricas (properties, businesses, professionals, events) que aparecen en sus feeds dedicados. El "feed" no es una tabla física por feed; es una **vista/consulta filtrada** por `feed_type` / por tabla especializada.

```sql
-- POSTS (Feed Principal y contenido social general)
create table posts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  author_id    uuid not null references profiles(id),
  feed_type    text not null default 'principal',  -- principal (único con ads)
  body         text,
  media        jsonb,                               -- [{type:'image'|'video', url, ...}]
  visibility   text not null default 'public',      -- public|followers|group
  group_id     uuid references groups(id),          -- si es post de grupo
  moderation_status text not null default 'pending',-- pending|approved|rejected
  like_count   integer not null default 0,
  comment_count integer not null default 0,
  created_at   timestamptz not null default now()
);
-- Índice CLAVE para keyset del feed:
create index idx_posts_feed on posts (tenant_id, feed_type, created_at desc, id desc)
  where moderation_status = 'approved';

create table post_likes (
  tenant_id  uuid not null references tenants(id),
  post_id    uuid not null references posts(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table comments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  post_id    uuid not null references posts(id) on delete cascade,
  author_id  uuid not null references profiles(id),
  body       text not null,
  parent_id  uuid references comments(id),          -- hilos
  created_at timestamptz not null default now()
);
create index on comments (tenant_id, post_id, created_at);
```

### 7.4 Módulos verticales (feeds dedicados)

```sql
-- PROPIEDADES (Feed Propiedades) — planes hasta $599/3m
create table properties (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  owner_id     uuid not null references profiles(id),
  type         text not null,          -- casa|departamento|rural|terreno|comercial
  title        text not null, description text,
  price_cents  bigint, currency text,
  city         text, country_code text, geo point,   -- filtros país/ciudad
  media        jsonb,                                 -- fotos/videos (límite según plan)
  plan_code    text,                                  -- plans_catalog.code (plus/premium/broker_*)
  plan_expires timestamptz,
  status       text not null default 'active',        -- active|paused|sold|suspended
  moderation_status text not null default 'pending',
  created_at   timestamptz not null default now()
);
create index on properties (tenant_id, status, created_at desc);
create index on properties (tenant_id, city, type);

-- NEGOCIOS LOCALES (Feed Negocios) — Plus/Premium
create table businesses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  owner_id     uuid not null references profiles(id),
  name         text not null, category text, description text,
  logo_url     text, media jsonb,
  hours        jsonb, whatsapp text, address text, geo point,
  plan_code    text, plan_expires timestamptz,
  rating_avg   numeric(2,1) default 0, rating_count integer default 0,
  status       text not null default 'active',
  moderation_status text not null default 'pending',
  created_at   timestamptz not null default now()
);
create index on businesses (tenant_id, category, created_at desc);

-- PROFESIONALES (Feed Profesionales) — Plus/Premium
create table professionals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  user_id      uuid not null references profiles(id),
  profession   text not null,          -- abogado|contador|medico|inmobiliario|ingeniero
  headline     text, portfolio jsonb, availability jsonb,
  plan_code    text, plan_expires timestamptz,
  rating_avg   numeric(2,1) default 0, rating_count integer default 0,
  moderation_status text not null default 'pending',
  created_at   timestamptz not null default now()
);
create index on professionals (tenant_id, profession, created_at desc);

-- EVENTOS (Feed Eventos) + RSVP — planes por evento
create table events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  organizer_id uuid not null references profiles(id),
  title        text not null, description text, cover_url text,
  starts_at    timestamptz not null, ends_at timestamptz,
  venue        text, geo point,
  plan_code    text,                    -- destacado|premium
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);
create index on events (tenant_id, starts_at);

create table event_rsvps (
  tenant_id  uuid not null references tenants(id),
  event_id   uuid not null references events(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  status     text not null,             -- attending|interested|cannot
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index on event_rsvps (tenant_id, event_id, status);
```

### 7.5 Grupos, Q&A, Stories

```sql
create table groups (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  owner_id     uuid not null references profiles(id),
  name         text not null, description text,
  visibility   text not null default 'public',   -- public|private
  created_at   timestamptz not null default now()
);
create table group_members (
  tenant_id  uuid not null references tenants(id),
  group_id   uuid not null references groups(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null default 'member',      -- member|moderator
  primary key (group_id, user_id)
);
create index on group_members (tenant_id, user_id);

-- Q&A con votación
create table questions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  author_id    uuid not null references profiles(id),
  group_id     uuid references groups(id),
  title        text not null, body text,
  vote_count   integer not null default 0,
  moderation_status text not null default 'pending',
  created_at   timestamptz not null default now()
);
create table answers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  question_id  uuid not null references questions(id) on delete cascade,
  author_id    uuid not null references profiles(id),
  body         text not null, vote_count integer not null default 0,
  created_at   timestamptz not null default now()
);
create index on answers (tenant_id, question_id, vote_count desc);

-- STORIES / STATUS efímeras (TTL)
create table stories (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  author_id    uuid not null references profiles(id),
  media_url    text not null, media_type text,     -- image|video
  is_premium   boolean not null default false,
  expires_at   timestamptz not null,               -- now()+24h (o más si premium)
  created_at   timestamptz not null default now()
);
create index on stories (tenant_id, expires_at);   -- barrido de expiradas + feed activo
```

### 7.6 Creator Marketplace y Tiendas (Stripe Connect)

```sql
-- CREATOR MARKETPLACE: negocio publica job → creators aplican → escrow 80/20
create table creator_jobs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  poster_id    uuid not null references profiles(id),   -- negocio que publica
  title        text not null, brief text,
  budget_cents bigint not null, currency text,
  status       text not null default 'open',            -- open|assigned|delivered|paid|cancelled
  created_at   timestamptz not null default now()
);
create index on creator_jobs (tenant_id, status, created_at desc);

create table creator_applications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  job_id       uuid not null references creator_jobs(id) on delete cascade,
  creator_id   uuid not null references profiles(id),
  pitch        text, quote_cents bigint,
  status       text not null default 'pending',         -- pending|accepted|rejected
  created_at   timestamptz not null default now(),
  unique (job_id, creator_id)
);
create index on creator_applications (tenant_id, job_id, status);

-- MARKETPLACE DE TIENDAS: mensualidad, sin comisión, Stripe Connect directo
create table stores (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  owner_id          uuid not null references profiles(id),
  name              text not null, description text, logo_url text,
  stripe_account_id text,                                -- cuenta Connect del vendedor
  subscription_status text not null default 'inactive',  -- active|past_due|inactive
  created_at        timestamptz not null default now()
);
create table products (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  store_id     uuid not null references stores(id) on delete cascade,
  name         text not null, description text,
  price_cents  bigint not null, currency text,
  media        jsonb, stock integer,
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);
create index on products (tenant_id, store_id, status);
```

### 7.7 Publicidad, Boost, Suscripciones, Pagos

```sql
-- CAMPAÑAS DE ADS / BOOST GEOLOCALIZADO (solo Feed Principal lleva ads)
create table ad_campaigns (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  advertiser_id uuid not null references profiles(id),
  kind         text not null,          -- boost_basic|boost_plus|boost_max|monthly
  target_post_id uuid references posts(id),
  cities       text[],                 -- targeting geográfico
  budget_cents bigint not null, spent_cents bigint default 0,
  starts_at    timestamptz, ends_at timestamptz,
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);
create index on ad_campaigns (tenant_id, status, ends_at);

-- SUSCRIPCIONES (membresías de módulos) — vincula profile↔plan↔Stripe
create table subscriptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  user_id      uuid not null references profiles(id),
  module_key   text not null,          -- properties|businesses|professionals|stores...
  plan_code    text not null,          -- plans_catalog.code
  stripe_subscription_id text,
  status       text not null,          -- active|past_due|canceled|trialing
  current_period_end timestamptz,
  created_at   timestamptz not null default now()
);
create index on subscriptions (tenant_id, user_id, status);

-- PAGOS / TRANSACCIONES (fuente contable; refleja webhooks de Stripe)
create table payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  user_id      uuid references profiles(id),
  kind         text not null,          -- subscription|boost|store_fee|creator_escrow
  amount_cents bigint not null, currency text,
  platform_fee_cents bigint,           -- 20% en creator marketplace
  stripe_payment_intent text, stripe_transfer_id text,
  status       text not null,          -- succeeded|pending|failed|refunded
  ref_table    text, ref_id uuid,      -- polimórfico: a qué entidad paga
  created_at   timestamptz not null default now()
);
create index on payments (tenant_id, kind, created_at desc);
```

> **Nota Stripe:** los webhooks llegan a una **Edge Function** que valida firma y escribe en `payments`/`subscriptions` con `service_role` (server-side, RLS bypass legítimo y aislado). El `tenant_id` se deriva del metadata del objeto Stripe (se estampa al crear el PaymentIntent/Subscription), nunca de un input de cliente.

### 7.8 Moderación (IA 3 niveles) y Notificaciones

```sql
-- COLA DE MODERACIÓN (IA puntúa; moderador resuelve)
create table moderation_queue (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  content_table text not null,          -- posts|comments|properties|...
  content_id    uuid not null,
  author_id     uuid references profiles(id),
  ai_score      smallint,               -- 0–100 (Google Vision / NLP)
  ai_labels     jsonb,                  -- {nudity, violence, spam, hate...}
  tier          text not null,          -- auto_approve(0-30)|monitor(31-70)|manual(71-100)
  status        text not null default 'pending',  -- pending|approved|rejected
  resolved_by   uuid references profiles(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on moderation_queue (tenant_id, status, tier, created_at);

-- NOTIFICACIONES (in-app / push) — alto volumen: candidata a partición
create table notifications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  user_id      uuid not null references profiles(id),
  type         text not null,          -- like|comment|follow|rsvp|broadcast|payment
  payload      jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on notifications (tenant_id, user_id, created_at desc)
  where read_at is null;                -- índice parcial: no leídas primero

-- BROADCASTS GLOBALES (§6.3) — GLOBAL, sin tenant_id
create table broadcasts (
  id           uuid primary key default gen_random_uuid(),
  author_admin uuid not null references auth.users(id),
  kind         text not null,          -- emergency|alert|announcement
  title        text not null, body text,
  scope        text not null default 'all_tenants',  -- all_tenants|targeted
  created_at   timestamptz not null default now()
);
create table broadcast_targets (
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  primary key (broadcast_id, tenant_id)
);
create table broadcast_receipts (
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  seen_at      timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);
```

### 7.9 Mapa de tenant_id (referencia rápida)

| Tabla | ¿tenant_id? | Notas |
|---|---|---|
| tenants, tenant_domains, tenant_config, tenant_modules | ❌ | Config del tenant (la fila ES el tenant) |
| platform_admins, plans_catalog, admin_audit_log | ❌ | Global |
| broadcasts, broadcast_targets, broadcast_receipts | ❌ (targets referencia tenant) | Cross-tenant por diseño |
| profiles, trust_scores, trust_events, follows | ✅ | Usuario pertenece a un tenant |
| posts, post_likes, comments | ✅ | |
| properties, businesses, professionals, events, event_rsvps | ✅ | Feeds dedicados |
| groups, group_members, questions, answers, stories | ✅ | |
| creator_jobs, creator_applications, stores, products | ✅ | |
| ad_campaigns, subscriptions, payments | ✅ | |
| moderation_queue, notifications | ✅ | Candidatas a partición por volumen |

---

## 8. Índices críticos y performance de feeds

### 8.1 Regla general

- **`tenant_id` SIEMPRE primera columna** del índice compuesto. Toda query lleva `tenant_id = ...` (por RLS), así que el índice debe empezar por él o no se usa eficientemente.
- **Índice que matchea el ORDER BY del keyset**: `(tenant_id, feed_type, created_at desc, id desc)`.
- **Índices parciales** para estados calientes: `where moderation_status='approved'`, `where read_at is null`. Reducen tamaño e I/O.
- Ejecutar **`get_advisors` (Performance)** en CI: cazar `auth_rls_initplan` (policies sin `(select ...)`) y `unindexed_foreign_keys`.

### 8.2 Paginación de feeds: **KEYSET, no OFFSET** (D9)

OFFSET recorre y descarta N filas: O(n), se degrada en scroll profundo. Keyset usa el índice directamente: rendimiento **constante** sin importar la profundidad.

```sql
-- Página 1 (feed principal aprobado, más nuevos primero)
select id, author_id, body, media, created_at
from posts
where tenant_id = (select public.auth_tenant_id())
  and feed_type = 'principal'
  and moderation_status = 'approved'
order by created_at desc, id desc
limit 20;

-- Página siguiente: pasar el cursor (created_at, id) de la última fila vista
select id, author_id, body, media, created_at
from posts
where tenant_id = (select public.auth_tenant_id())
  and feed_type = 'principal'
  and moderation_status = 'approved'
  and (created_at, id) < ($last_created_at, $last_id)   -- comparación de tupla
order by created_at desc, id desc
limit 20;
```

El **`id` en el cursor** desempata timestamps iguales (dos posts en el mismo instante) — sin él se saltan o duplican filas. El índice `idx_posts_feed` sirve exactamente a este `ORDER BY`.

### 8.3 Contadores y agregados

- `like_count`/`comment_count` **denormalizados** en `posts` (actualizados por trigger o RPC) para no contar en cada lectura del feed. Consistencia eventual aceptable en un contador social.
- `rating_avg`/`rating_count` idem en businesses/professionals.

### 8.4 Escala futura dentro de shared schema (antes del silo)

- **Partición nativa** `PARTITION BY LIST (tenant_id)` o `HASH (tenant_id)` en `posts`, `notifications`, `moderation_queue` cuando una supere cientos de millones de filas. Mantiene el planner ágil y permite `DETACH` de un tenant para extraerlo.
- **Read replicas** de Supabase para feeds de solo-lectura y analytics.
- **Realtime**: suscribir por `tenant_id` + `feed_type`; nunca abrir un canal global que filtre cross-tenant en el cliente.

---

## 9. Storage, Realtime y Edge (aislamiento fuera de Postgres)

El aislamiento **no termina en la base**. Vectores de fuga fuera de Postgres:

- **Supabase Storage:** prefijo de path por tenant `tenant_id/...` y **policies de Storage** que validan el `tenant_id` del claim contra el primer segmento del path. Un usuario no lista/lee objetos de otro tenant.
- **Realtime:** RLS aplica a Realtime en Postgres changes, pero los **broadcast/presence channels** deben nombrarse por tenant (`tenant:{id}:feed`) y autorizarse server-side.
- **Edge Functions:** las que usan `service_role` (webhooks Stripe, moderación IA, hook batch) deben derivar `tenant_id` de fuente confiable (metadata Stripe, fila de DB), **jamás** de body de cliente. Toda función admin re-valida `is_platform_admin()`.
- **service_role key:** solo en variables de entorno server (Vercel/Edge). Nunca en el bundle del cliente. Un leak = pérdida total de aislamiento.

---

## 10. Riesgos y mitigaciones

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | **Fuga cross-tenant** por tabla sin RLS o policy mal escrita | Media | **Crítico** | RLS `FORCE` obligatorio + generador automático + test CI que falla si falta + `get_advisors` en pipeline (§5.2/§5.6) |
| R2 | RLS basado en `user_metadata` (forjable) | Media | **Crítico** | Solo `app_metadata` vía hook; funciones helper leen `auth.jwt()` (§3) |
| R3 | `service_role` expuesta al cliente | Baja | **Crítico** | Key solo server-side; lint/secret-scan en CI; §9 |
| R4 | Degradación por init-plan trap (RLS por-fila) | Alta si se descuida | Alto | `(select fn())` en toda policy; Advisor `auth_rls_initplan` (§5.1/§8.1) |
| R5 | Scroll profundo lento (OFFSET) | Alta | Medio | Keyset pagination en todos los feeds (§8.2) |
| R6 | FK cruzando tenants (comment→post de otro tenant) | Baja | Medio | `tenant_id` denormalizado + trigger `assert_same_tenant` o FK compuesta (§5.5) |
| R7 | Claim de rol/tenant desactualizado tras cambio admin | Media | Medio | Forzar refresh/re-login; documentar en flujo admin (§3.2) |
| R8 | "Noisy neighbor": tenant gigante degrada a los chicos | Baja (al inicio) | Alto | Partición por tenant → read replicas → silo del tenant (§1.3/§8.4) |
| R9 | Broadcast Global escribe millones de filas al publicar | Media | Medio | Modelo pull: `broadcast_targets` + receipts bajo demanda, no fan-out masivo (§6.3) |
| R10 | Migraciones DDL rompen tenants en producción | Media | Alto | Shared schema = 1 migración; usar skill `supabase-migrations` (forward-only, idempotente, CI) |

---

## 11. Handoff al PLAN MAESTRO — orden de construcción sugerido

1. **Fundaciones (bloqueante):** `tenants`, `tenant_domains`, `tenant_config`, `tenant_modules`, `platform_admins`, `plans_catalog` + middleware de resolución host→tenant + **Custom Access Token Hook** + funciones helper (`auth_tenant_id`, `auth_role`, `is_platform_admin`).
2. **Contrato RLS:** plantilla de policies + generador + suite de tests de aislamiento en CI. **Ninguna tabla de datos se mergea sin sus tests verdes.**
3. **Usuarios/Trust:** `profiles`, `trust_scores`, `trust_events`, `follows`.
4. **Social base:** `posts`, `post_likes`, `comments` + índice keyset + endpoint de feed paginado.
5. **Verticales:** properties, businesses, professionals, events/rsvp (feeds dedicados).
6. **Comunidad:** groups, group_members, questions, answers, stories.
7. **Monetización:** plans/subscriptions/payments + Stripe Connect (jobs, applications, stores, products, ad_campaigns) — Edge Functions de webhooks.
8. **Moderación + Notificaciones + Broadcast Global.**
9. **Endurecimiento:** Storage policies por tenant, Realtime por canal de tenant, `get_advisors`, partición donde aplique.

**Agentes recomendados por bloque:** `supabase-migrations` (DDL/migraciones), `supabase-audit-rls` + `multi-tenant-safety-checker` (tests de fuga), `backend-architect` (endpoints/feed), `payment-integration` (Stripe Connect), `security-auditor` (revisión final de aislamiento).

---

## Fuentes

- [Custom Claims & RBAC — Supabase Docs](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac)
- [Row Level Security — Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [RLS Performance and Best Practices — Supabase Docs](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
- [Performance & Security Advisors (auth_rls_initplan) — Supabase Docs](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0003_auth_rls_initplan)
- [Approaches to tenancy in Postgres — PlanetScale](https://planetscale.com/blog/approaches-to-tenancy-in-postgres)
- [Multi-Tenant Data Isolation with PostgreSQL RLS — AWS Database Blog](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [Supabase RLS: Common Mistakes, the (select auth.uid()) Trap & CVE-2025-48757](https://vibeappscanner.com/supabase-row-level-security)
- [76 RLS policies rewritten: the auth.uid() init-plan trap — DEV](https://dev.to/arvavit/76-rls-policies-rewritten-in-one-migration-the-authuid-init-plan-trap-in-supabase-4hg)
- [Keyset Cursors, Not Offsets, for Postgres Pagination — Sequin](https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/)
- [Supabase RLS Best Practices: Production Patterns for Multi-Tenant Apps — Makerkit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
