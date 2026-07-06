-- =============================================================================
-- 0001_foundations.sql — Comunidad Latina
-- Extensiones, schema `app`, helpers de tenancy (JWT app_metadata) y uuid_v7.
-- Contrato: PLAN_MAESTRO §5 (arquitectura/seguridad/minimización).
-- Tenancy: el claim vive en app_metadata.tenant_id (Supabase lo incluye en el
-- access token por default). NUNCA leer user_metadata (forjable por el usuario).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensiones (vector queda instalada para R3 / pgvector del moat de IA)
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto    with schema extensions;
create extension if not exists moddatetime with schema extensions;
create extension if not exists pg_trgm     with schema extensions;
create extension if not exists unaccent    with schema extensions;
create extension if not exists vector      with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pgmq;

-- ---------------------------------------------------------------------------
-- Schema `app` — funciones helper (las tablas de dominio viven en `public`)
-- ---------------------------------------------------------------------------
create schema if not exists app;

comment on schema app is
  'Funciones helper del motor multi-tenant (tenancy JWT, uuid v7, triggers de integridad). Sin tablas de dominio.';

grant usage on schema app to anon, authenticated, service_role;
alter default privileges in schema app grant execute on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- app.uuid_v7() — UUID v7 (timestamp ms + random) en SQL puro sobre
-- pgcrypto.gen_random_bytes. Default de TODA PK del proyecto: ordenable en el
-- tiempo (índices B-tree felices, keyset pagination friendly) y no enumerable.
-- ---------------------------------------------------------------------------
create or replace function app.uuid_v7()
returns uuid
language sql
volatile
parallel safe
set search_path = ''
as $$
  with ts as (
    -- 48 bits de timestamp en milisegundos (big-endian, últimos 6 bytes de int8)
    select substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3 for 6) as ms
  ),
  raw as (
    select overlay(extensions.gen_random_bytes(16) placing ts.ms from 1 for 6) as b
    from ts
  )
  select encode(
           set_byte(
             set_byte(raw.b, 6, (get_byte(raw.b, 6) & 15) | 112),  -- version = 0111 (7)
             8,
             (get_byte(raw.b, 8) & 63) | 128                        -- variant = 10xxxxxx
           ),
           'hex'
         )::uuid
  from raw;
$$;

comment on function app.uuid_v7() is
  'UUID v7 (RFC 9562): 48 bits de epoch-ms + bits aleatorios de pgcrypto. Default de toda PK del dominio.';

-- ---------------------------------------------------------------------------
-- Helpers de tenancy — leen SIEMPRE app_metadata del JWT (server-controlled).
-- En policies usarlas envueltas en subselect: (select app.current_tenant_id())
-- para initPlan caching (se evalúan 1 vez por query, no por fila).
-- ---------------------------------------------------------------------------
create or replace function app.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid;
$$;

comment on function app.current_tenant_id() is
  'tenant_id del usuario actual desde el JWT (app_metadata.tenant_id). NULL para anon o tokens sin claim.';

create or replace function app.current_user_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''), 'member');
$$;

comment on function app.current_user_role() is
  'Rol del usuario desde app_metadata.role: member | moderator | domain_admin | global_admin. Default member. El enforcement real de roles es SIEMPRE este claim, nunca la columna informativa profiles.role.';

create or replace function app.is_global_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_user_role() = 'global_admin';
$$;

comment on function app.is_global_admin() is
  'true si el JWT trae app_metadata.role = global_admin (Global Super Admin). Solo amplía SELECT; la escritura cross-tenant va por RPC/service_role auditados.';

create or replace function app.is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_user_role() in ('moderator', 'domain_admin', 'global_admin');
$$;

comment on function app.is_staff() is
  'true si el rol del JWT es moderator/domain_admin/global_admin. Usada dentro de policies SIEMPRE junto al filtro de tenant (staff de A no modera B).';

-- Cinturón y tiradores: garantizar EXECUTE aunque cambien default privileges.
grant execute on all functions in schema app to anon, authenticated, service_role;
