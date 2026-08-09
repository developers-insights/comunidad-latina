-- =============================================================================
-- 0060_dominios_desde_la_base.sql — Comunidad Latina
--
-- El contrato exige "agregar otro dominio sin reconstruir el código". Hoy no se
-- cumple: `src/lib/tenant/resolve.ts:105` tiene un mapa `DOMAIN_TENANTS`
-- hardcodeado, así que sumar un dominio son un commit, un review y un deploy.
-- `tenant_domains` ya existía y ya la usa `get_tenant_by_domain`, pero le
-- faltaba lo que convierte una tabla en un panel: ESTADO por dominio.
--
-- Qué agrega esta migración:
--   1. `status` por dominio (active | suspended | archived) — el "activar,
--      suspender o archivar" del pliego, por DOMINIO y no por tenant. Son ejes
--      distintos: un tenant vivo puede tener un alias viejo archivado.
--   2. Normalización obligatoria del host en un trigger, no en la app. El host
--      llega del header `Host`, o sea de un tercero: si la normalización vive
--      en TypeScript, alcanza con un `Host: DOMINICANOS.COM.` para esquivarla.
--   3. Un solo primario por tenant, garantizado por índice parcial único (antes
--      nada impedía dos `is_primary` en el mismo tenant, y el `order by
--      is_primary desc limit 1` de `get_tenant_by_domain` habría elegido uno
--      al azar).
--   4. `public.resolve_tenant_domain(text)` — el RPC de lookup que pide el
--      pliego, pensado para correr en CADA request del middleware.
--
-- DECISIÓN: `resolve_tenant_domain` es SECURITY **INVOKER**, no definer.
-- Puede serlo porque `tenant_domains_select` es `using (true)` para anon y
-- `tenants_select` deja ver los activos: el anónimo ya tiene permiso de leer
-- exactamente lo que la función devuelve. Elegir invoker cuando alcanza es
-- gratis y evita sumar un `anon_security_definer_function_executable` más a la
-- lista. `get_tenant_by_domain` (0002) sigue siendo definer y se deja como
-- está, sólo se le enseña a respetar el `status` nuevo.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Estado y metadatos por dominio
-- ---------------------------------------------------------------------------
alter table public.tenant_domains
  add column if not exists status     text not null default 'active',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists notes      text;

alter table public.tenant_domains
  drop constraint if exists tenant_domains_status_check;
alter table public.tenant_domains
  add constraint tenant_domains_status_check
  check (status in ('active', 'suspended', 'archived'));

comment on table public.tenant_domains is
  'Hostnames de cada tenant y FUENTE DE VERDAD de la resolución Host→tenant (el mapa hardcodeado de la app queda obsoleto desde 0060). Lectura pública: el middleware resuelve el host ANTES de que exista sesión. Escritura solo global_admin.';
comment on column public.tenant_domains.status is
  'Ciclo de vida del DOMINIO, independiente del de su tenant (§ "activar, suspender o archivar un dominio"). active = resuelve; suspended = deja de resolver pero se conserva la fila y la intención de volver a prenderlo; archived = retirado (dominio vencido, migración de marca). Sólo `active` devuelve tenant: suspended y archived se comportan como dominio desconocido, para que la app no tenga que aprender tres caminos distintos.';
comment on column public.tenant_domains.is_primary is
  'El canónico del tenant: el que se usa para armar URLs absolutas y para redirigir los alias. Máximo UNO por tenant (tenant_domains_primary_uniq). Los demás son alias y resuelven igual.';
comment on column public.tenant_domains.domain is
  'Host normalizado: minúsculas, sin espacios, sin punto final y SIN puerto. Lo garantiza el trigger app.normalize_tenant_domain(), no la app: este valor se compara contra el header `Host`, que lo controla el cliente, y una normalización que vive sólo en TypeScript se esquiva mandando otro casing.';
comment on column public.tenant_domains.notes is
  'Nota operativa del admin (por qué se suspendió, a quién se le compró el dominio). No la lee ningún camino de producto.';

-- ---------------------------------------------------------------------------
-- 2. Normalización en la base (no en la app)
-- ---------------------------------------------------------------------------
create or replace function app.normalize_tenant_domain()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.domain := lower(btrim(coalesce(new.domain, '')));
  new.domain := regexp_replace(new.domain, ':[0-9]+$', '');  -- sin puerto
  new.domain := regexp_replace(new.domain, '\.$', '');        -- sin punto final (FQDN absoluto)

  if new.domain = '' then
    raise exception 'TENANT_DOMAIN_VACIO: el dominio no puede quedar vacío después de normalizar';
  end if;

  return new;
end;
$$;

comment on function app.normalize_tenant_domain() is
  'Normaliza el host antes de guardarlo (minúsculas, sin espacios, sin puerto, sin punto final). Vive en la base a propósito: el valor se compara contra el header Host, que lo elige el cliente; si la normalización viviera sólo en la app, "DOMINICANOS.COM." sería un host distinto y no resolvería.';

drop trigger if exists tenant_domains_normalize on public.tenant_domains;
create trigger tenant_domains_normalize
before insert or update of domain on public.tenant_domains
for each row execute function app.normalize_tenant_domain();

drop trigger if exists tenant_domains_set_updated_at on public.tenant_domains;
create trigger tenant_domains_set_updated_at
before update on public.tenant_domains
for each row execute function extensions.moddatetime(updated_at);

-- Formato: se valida DESPUÉS del trigger de normalización, así que sólo puede
-- fallar por caracteres que no son de un hostname. `localhost` entra (dev).
alter table public.tenant_domains
  drop constraint if exists tenant_domains_domain_format;
alter table public.tenant_domains
  add constraint tenant_domains_domain_format
  check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$');

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------
-- Un solo primario por tenant. Antes nada lo impedía y `get_tenant_by_domain`
-- resolvía el empate con `order by is_primary desc limit 1`, o sea al azar.
create unique index if not exists tenant_domains_primary_uniq
  on public.tenant_domains (tenant_id)
  where is_primary;

-- El listado del panel por tenant, y el join que arma el canónico.
create index if not exists tenant_domains_tenant_status_idx
  on public.tenant_domains (tenant_id, status);

-- El lookup del middleware pega por `domain` (unique ya existente,
-- tenant_domains_domain_key) pero filtra por status: índice parcial para que
-- el camino caliente sea index-only sobre las filas que sí resuelven.
create index if not exists tenant_domains_active_idx
  on public.tenant_domains (domain)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 4. El RPC de lookup — se llama en CADA request del middleware
-- ---------------------------------------------------------------------------
-- Devuelve una fila o ninguna. "Ninguna" cubre los tres casos que a la app le
-- dan lo mismo: dominio no registrado, dominio suspendido/archivado, tenant
-- pausado. Que sean indistinguibles es deliberado — un atacante no aprende si
-- un dominio existe pero está apagado.
create or replace function public.resolve_tenant_domain(p_host text)
returns table (
  tenant_id       uuid,
  tenant_slug     text,
  tenant_name     text,
  matched_domain  text,
  is_primary      boolean,
  primary_domain  text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with host as (
    select regexp_replace(
             regexp_replace(lower(btrim(coalesce(p_host, ''))), ':[0-9]+$', ''),
             '\.$', ''
           ) as h
  ),
  candidato as (
    -- Se prueba el host tal cual y su versión sin `www.`: registrar el apex
    -- alcanza para que `www.` resuelva, sin obligar al admin a cargar dos filas.
    select d.tenant_id, d.domain, d.is_primary
      from public.tenant_domains d, host
     where d.status = 'active'
       and (d.domain = host.h or d.domain = regexp_replace(host.h, '^www\.', ''))
       and host.h <> ''
     order by (d.domain = host.h) desc, d.is_primary desc
     limit 1
  )
  select t.id,
         t.slug,
         t.name,
         c.domain,
         c.is_primary,
         (select p.domain
            from public.tenant_domains p
           where p.tenant_id = t.id and p.is_primary and p.status = 'active'
           limit 1)
    from candidato c
    join public.tenants t on t.id = c.tenant_id
   where t.status = 'active';
$$;

comment on function public.resolve_tenant_domain(text) is
  'Lookup Host→tenant para el middleware, una llamada por request. Devuelve 0 o 1 fila; devolver 0 tapa por igual "dominio inexistente", "dominio suspendido/archivado" y "tenant pausado" — indistinguibles a propósito, para no confirmarle a nadie qué dominios tenemos apagados. `primary_domain` viene para que la app pueda redirigir un alias a su canónico sin una segunda consulta. SECURITY INVOKER: anon ya puede leer estas dos tablas por RLS, no hace falta elevar privilegios.';

revoke execute on function public.resolve_tenant_domain(text) from public;
grant execute on function public.resolve_tenant_domain(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. `get_tenant_by_domain` aprende el estado del dominio
-- ---------------------------------------------------------------------------
-- El middleware actual la llama; si no respetara `status`, suspender un dominio
-- desde el panel no tendría ningún efecto y el control sería decorativo.
create or replace function public.get_tenant_by_domain(p_domain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'app'
as $$
declare
  v_domain text;
  v_result jsonb;
begin
  v_domain := lower(btrim(coalesce(p_domain, '')));
  v_domain := regexp_replace(v_domain, ':[0-9]+$', '');  -- sin puerto
  v_domain := regexp_replace(v_domain, '\.$', '');        -- sin punto final
  if v_domain = '' then
    return null;
  end if;

  select jsonb_build_object(
           'id',            t.id,
           'slug',          t.slug,
           'name',          t.name,
           'brand_hex',     t.brand_hex,
           'logo_url',      t.logo_url,
           'locale',        t.locale,
           'currency',      t.currency,
           'country_focus', t.country_focus,
           'city_seed',     t.city_seed,
           'modules',       t.modules,
           'theme',         t.theme,
           'domain',        d.domain,
           'is_primary',    d.is_primary
         )
    into v_result
    from public.tenant_domains d
    join public.tenants t on t.id = d.tenant_id
   where t.status = 'active'
     and d.status = 'active'   -- ← 0060: suspender/archivar ahora SÍ apaga el dominio
     and (
       d.domain = v_domain
       or d.domain = regexp_replace(v_domain, '^www\.', '')
     )
   order by (d.domain = v_domain) desc, d.is_primary desc
   limit 1;

  return v_result; -- null = dominio no registrado, apagado, o tenant pausado
end;
$$;

comment on function public.get_tenant_by_domain(text) is
  'Resolución Host→tenant con el branding completo (la que llama el middleware desde 0002). Desde 0060 exige `tenant_domains.status = ''active''`: sin eso, suspender un dominio en el panel no habría apagado nada. Para el lookup liviano (sólo slug + canónico) está resolve_tenant_domain(), que además es invoker.';

commit;
