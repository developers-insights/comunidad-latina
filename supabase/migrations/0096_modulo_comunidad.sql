-- =============================================================================
-- 0096_modulo_comunidad.sql — Comunidad Latina
--
-- El módulo "Comunidad": la sección de información y ayuda mutua. Son DOS cosas
-- distintas bajo un mismo techo, y por eso son dos modelos distintos:
--
--   1. RECURSOS E INFORMACIÓN — curado por el equipo/los admins de la comunidad.
--      · Las GUÍAS ya existen (`public.guides`, 0007) y NO se tocan: el pedido
--        del cliente fue textual — «lo que ustedes tienen en Guía saldría aquí
--        en el módulo de Comunidad». Se REUSAN tal cual, misma tabla, mismo
--        contenido, misma RLS; lo que cambia es dónde se leen.
--      · Lo que NO existía es el DIRECTORIO de ayuda: clínicas para gente sin
--        seguro, bancos de comida, consulados. Una guía es un artículo
--        (`body_md`); una clínica es una ficha con teléfono, dirección, horario
--        y requisitos. Meter fichas dentro de `guides.body_md` sería guardar
--        datos estructurados como prosa: no se podría agrupar por tema, ni
--        filtrar, ni revisar la vigencia de un teléfono. De ahí
--        `public.community_resources`.
--
--   2. PERDIDO Y ENCONTRADO — lo publica la gente. Es un `listings` con
--      `kind = 'lost_found'`, NO una tabla propia. Mismo criterio que escribió
--      la 0024 para el Marketplace («un producto es un listing: reusa
--      moderación, fotos, RLS, boosts, FTS»): acá se reusan fotos (bucket
--      listing-photos con su path {tenant}/{listing}/…), la cola de moderación
--      (`subject_kind = 'listing'`), los reportes, la RLS multi-tenant ya
--      probada, `area_label` (que es LO que se busca: «por área donde él crea
--      que perdió algo») y el índice FTS de `listings.search`.
--
-- ── LA REGLA DE CONTENIDO QUE MANDA SOBRE EL MODELO ──────────────────────────
-- Esta sección le da información sensible (migración, salud, comida) a gente
-- vulnerable. La plataforma INFORMA, jamás ASESORA — mismo criterio §11 que ya
-- gobierna `guides` (CHECK `guides_published_need_sources`) y
-- `verification_checks`.
--
-- Por eso en `community_resources` la procedencia NO es opcional ni "obligatoria
-- al publicar": es NOT NULL desde el insert. `source_name`, `source_url` y
-- `source_checked_at` son columnas requeridas, y la url tiene que ser http(s)
-- real. Un recurso sin fuente no se puede ni guardar como borrador. La UI puede
-- olvidarse de mostrar la fuente y sería un bug; el modelo NO puede olvidarse de
-- tenerla.
--
-- Y no hay ninguna columna donde escribir "qué hacer legalmente": `description`
-- es la descripción del SERVICIO que presta un tercero (a quién atiende, qué
-- ofrece, qué hace falta llevar), no instrucciones nuestras. Lo que dice qué
-- hacer ante migración vive en la guía, y la guía ya no se publica sin citar la
-- fuente oficial.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ───────────────────────────────
--   · No toca `public.global_search` (0052). Esa función enumera los kinds uno
--     por uno, así que `lost_found` queda FUERA del buscador global hasta que
--     alguien decida lo contrario. Es la decisión conservadora: un caso de
--     perdido y encontrado resuelto no debería aparecer meses después en una
--     búsqueda de "llaves". Si se quiere, es una línea en una migración futura.
--   · No agrega `lost_found` a ningún feed ni a los listados de los otros
--     módulos: todos filtran por `kind` explícito (verificado en queries.ts de
--     empleos, marketplace, propiedades, negocios y profesionales).
--   · No crea bucket de storage nuevo: las fotos van a `listing-photos`, que ya
--     tiene sus 4 policies por path {tenant_id}/{listing_id}/… (0012) y ya está
--     auditado por `npm run check:rls`.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. listings.kind += 'lost_found'
--
-- El do-block busca la constraint por su DEFINICIÓN y no por su nombre porque
-- ya cambió de nombre una vez (0004 la creó anónima, 0024 la rebautizó
-- `listings_kind_check`). Copiado de 0024 a propósito: el que corra esto sobre
-- una base con historia distinta no debería tener que averiguar cómo se llama.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.listings'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.listings drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.listings
  add constraint listings_kind_check
  check (kind in (
    'property', 'business', 'professional', 'event', 'job',
    'product', 'creator_gig', 'lost_found'
  ));

comment on column public.listings.kind is
  'Verticales: property/business/professional/event/job + product (Marketplace: attrs.store_listing_id = negocio dueño) + creator_gig (Creator Marketplace: price_amount = presupuesto, attrs.category/deliverables/deadline) + lost_found (Comunidad — Perdido y encontrado, 0096: attrs.lf_type/lf_category/lf_happened_on/lf_resolved_at; price_amount SIEMPRE null, no se compra ni se vende nada acá).';

-- El listado por defecto es "de esta comunidad, publicados, lo más nuevo
-- arriba" y el filtro central es la ZONA. El índice parcial cubre el orden; la
-- zona se filtra con `area_label` (ilike) sobre un conjunto ya chico, y el
-- texto libre entra por `listings_search_idx` (FTS, 0004/0052), que ya indexa
-- title + description + area_label para TODOS los kinds.
create index listings_lost_found_idx
  on public.listings (tenant_id, published_at desc, id desc)
  where kind = 'lost_found' and status = 'published';

-- ---------------------------------------------------------------------------
-- 2. Marcar un caso como resuelto / devuelto
--
-- POR QUÉ HACE FALTA UNA FUNCIÓN Y NO ALCANZA UN UPDATE COMÚN.
-- `listings_update` (0004) le prohíbe al DUEÑO dejar un aviso en `published`
-- después de editarlo: el WITH CHECK exige `status in (draft, pending_review,
-- paused, removed)`. Es una regla buena y no se toca — es lo que impide el
-- bait-and-switch post-verificación. Pero significa que si el dueño marcara
-- "resuelto" con un UPDATE normal, el caso se DESPUBLICARÍA, y entonces nadie
-- podría ver que apareció: justamente la información más útil de la sección
-- («esto se devolvió, dejá de buscar / dejá de escribirle»).
--
-- Las dos salidas eran ésta o hacer el UPDATE con el service_role desde el
-- server (patrón `finalizeJob`). Se eligió la función porque marcar resuelto es
-- una acción cotidiana del usuario y no puede depender de que la key de
-- servicio esté configurada — si falta, con el otro camino el botón falla en
-- silencio y el caso viejo se queda ahí para siempre.
--
-- La función es SECURITY DEFINER (o sea, saltea la RLS), así que la propiedad
-- se chequea acá adentro y de forma completa: mismo usuario, mismo tenant,
-- mismo kind. No hay rama de staff: el pedido dice "sólo quien publicó", y la
-- moderación tiene su propio camino para bajar un aviso.
-- ---------------------------------------------------------------------------
create or replace function public.marcar_caso_resuelto(
  p_listing  uuid,
  p_resuelto boolean default true
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_filas  int;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás tu cuenta para marcar el caso.';
  end if;

  update public.listings
     set attrs = case
                   when p_resuelto then
                     jsonb_set(
                       coalesce(attrs, '{}'::jsonb),
                       '{lf_resolved_at}',
                       to_jsonb(now())
                     )
                   else
                     coalesce(attrs, '{}'::jsonb) - 'lf_resolved_at'
                 end
   where id         = p_listing
     and kind       = 'lost_found'
     and tenant_id  = v_tenant
     and created_by = v_uid;

  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$$;

comment on function public.marcar_caso_resuelto(uuid, boolean) is
  'Perdido y encontrado (0096): marca/desmarca un caso propio como resuelto escribiendo attrs.lf_resolved_at, SIN cambiar el status. Existe porque listings_update le prohíbe al dueño conservar status=published al editar (anti bait-and-switch, 0004) y un caso resuelto tiene que seguir siendo visible para que nadie siga buscando. security definer con el chequeo de dueño+tenant+kind adentro; sin rama de staff — sólo quien publicó.';

revoke all    on function public.marcar_caso_resuelto(uuid, boolean) from public, anon;
grant execute on function public.marcar_caso_resuelto(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. community_resources — el directorio de ayuda
--
-- tenant_id NULLABLE con el MISMO significado que en `guides` (0007):
-- null = recurso GLOBAL, visible en todas las comunidades. El Consulado de
-- México en Nueva York le sirve igual a "Comunidad Latina" y a "Dominicanos en
-- USA"; duplicar la ficha por comunidad sería garantizar que una quede vieja.
-- El enumerador de RLS exige la columna, no que sea NOT NULL.
-- ---------------------------------------------------------------------------
create table public.community_resources (
  id                uuid primary key default app.uuid_v7(),
  tenant_id         uuid references public.tenants(id),

  -- Agrupador de la pantalla. Cerrado a propósito: una lista libre de temas se
  -- convierte en veinte sinónimos ("salud", "clinicas", "médicos") y la sección
  -- deja de agruparse. Espeja RESOURCE_TOPICS en src/lib/comunidad/types.ts.
  topic             text not null check (topic in (
                      'migracion', 'salud', 'comida', 'consulados',
                      'legal', 'vivienda', 'educacion', 'emergencias'
                    )),

  name              text not null check (char_length(btrim(name)) between 2 and 140),
  -- Qué ofrece el TERCERO. No es un instructivo nuestro: ver la cabecera.
  description       text check (description is null or char_length(description) <= 600),

  -- ---- Contacto (todo opcional por separado, pero al menos UNO obligatorio:
  -- un recurso al que no se puede llegar no es un recurso).
  phone             text check (phone is null or char_length(btrim(phone)) between 5 and 40),
  website           text check (website is null or website ~* '^https?://'),
  address           text check (address is null or char_length(address) <= 240),
  area_label        text check (area_label is null or char_length(area_label) <= 80),
  hours_note        text check (hours_note is null or char_length(hours_note) <= 240),
  languages         text[] not null default '{}'::text[],
  -- "Gratis", "Escala móvil según ingresos", "$25 la consulta". Texto humano:
  -- el costo real de una clínica comunitaria no entra en un numeric.
  cost_note         text check (cost_note is null or char_length(cost_note) <= 160),
  -- "No piden seguro ni documentos". Lo que la gente necesita saber ANTES de
  -- viajar dos horas. Sigue siendo información del tercero, citada.
  requirements_note text check (requirements_note is null or char_length(requirements_note) <= 300),

  -- ---- Procedencia: NOT NULL, no negociable (ver cabecera).
  source_name       text not null check (char_length(btrim(source_name)) between 2 and 160),
  source_url        text not null check (source_url ~* '^https?://'),
  source_checked_at date not null,

  status            text not null default 'draft'
                      check (status in ('draft', 'published', 'removed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint community_resources_need_contact check (
    phone is not null or website is not null or address is not null
  )
);

comment on table public.community_resources is
  'Directorio de ayuda del módulo Comunidad (0096): clínicas para gente sin seguro, bancos de comida, consulados, oficinas de ayuda migratoria. Curado por admins, NUNCA por usuarios (la RLS de escritura sólo admite domain_admin/global_admin). tenant_id null = recurso global, igual que en guides. La plataforma sólo REPRODUCE lo que publica la fuente citada: no presta estos servicios ni los garantiza (§11, mismo criterio que verification_checks y guides).';
comment on column public.community_resources.description is
  'Qué ofrece el TERCERO y a quién atiende. No es un instructivo de la plataforma: acá no se escribe qué hacer legalmente ante nada — eso se enlaza a la fuente oficial.';
comment on column public.community_resources.source_name is
  'Quién publica esta información ("Consulado General de México en Nueva York", "NYC Health + Hospitals"). NOT NULL a propósito: sin autor identificado, la ficha parecería dicha por la plataforma.';
comment on column public.community_resources.source_url is
  'URL http(s) de la publicación original. NOT NULL: cada ficha se puede verificar en su origen de un toque. Es lo que convierte "información de la comunidad" en "información DE la fuente, traída por la comunidad".';
comment on column public.community_resources.source_checked_at is
  'Día en que alguien del equipo abrió esa URL y confirmó los datos. Se muestra SIEMPRE junto a la ficha: un teléfono de hace dos años sin fecha se lee como vigente.';
comment on column public.community_resources.cost_note is
  'Texto humano ("Gratis", "Escala según ingresos"). Deliberadamente no es numeric: el costo real de una clínica comunitaria no es un número.';

create index community_resources_public_idx
  on public.community_resources (topic, name)
  where status = 'published';
create index community_resources_tenant_idx
  on public.community_resources (tenant_id, status, topic);

create trigger community_resources_set_updated_at
before update on public.community_resources
for each row execute function extensions.moddatetime(updated_at);

alter table public.community_resources enable row level security;
alter table public.community_resources force row level security;

-- Las CUATRO policies canónicas, ni una más (gate `npm run check:rls`).
-- Forma calcada de `guides` (0007), que es la tabla hermana de ésta: contenido
-- curado, published es público, los borradores los ve quien cura.
create policy community_resources_select on public.community_resources
for select to anon, authenticated
using (
  status = 'published'
  or (
    tenant_id is not null
    and tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

-- Curaduría: un domain_admin carga recursos DE SU comunidad. Los globales
-- (tenant_id null) sólo entran por service_role — no matchean este check.
create policy community_resources_insert on public.community_resources
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy community_resources_update on public.community_resources
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy community_resources_delete on public.community_resources
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- GRANTS EXPLÍCITOS. La 0085 lo dejó escrito con sangre: los default privileges
-- de este schema (compartido con otro producto) no incluyen a `anon`, así que
-- una tabla nueva NACE sin acceso. Sin grant, Postgres ni llega a evaluar la
-- policy: la app se ve VACÍA y sin un solo error.
revoke all on table public.community_resources from anon, authenticated;
grant select                         on table public.community_resources to anon;
grant select, insert, update, delete on table public.community_resources to authenticated;
grant all                            on table public.community_resources to service_role;

commit;
