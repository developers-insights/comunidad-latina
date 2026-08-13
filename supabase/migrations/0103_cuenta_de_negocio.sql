-- =============================================================================
-- 0103_cuenta_de_negocio.sql — Comunidad Latina
--
-- DOS PERFILES EN LA MISMA CUENTA. El pedido del cliente fue textual: «agregar
-- el botón de hacerte creador en la sección de ajustes», «lo mismo para crear
-- una cuenta de negocio», «serían como tener 2 perfiles en la misma cuenta,
-- dependiendo la cuenta que quieras usar». La referencia es el cambiador de
-- cuentas de Instagram: una sola sesión, dos identidades, y en todo momento la
-- persona sabe con cuál está actuando.
--
-- ── POR QUÉ NO HAY TABLA NUEVA DE "PERFIL DE NEGOCIO" ────────────────────────
-- Porque ya existe y se llama `business_accounts` (0008). Su comentario lo dice:
-- es «el ancla estable de identidad+billing» del negocio, con `listing_id`
-- NULLABLE — o sea que una cuenta de negocio puede existir sin ficha publicada
-- en el directorio. Ya tiene nombre, categoría, dueño, plan y suscripción.
--
-- Y sobre todo: la 0031 ya resolvió el problema difícil, que es QUIÉN PUEDE
-- ACTUAR EN NOMBRE DE UN NEGOCIO. `business_members` + `app.business_role()`
-- son multi-admin con cinco roles y el `owner_id` espejado como fila
-- `propietario`, «una sola fuente de permisos». Crear una segunda tabla de
-- identidad de negocio significaría escribir por segunda vez esa autorización
-- —y el día que las dos se separen, la que manda va a ser la equivocada—.
--
-- Lo que esta migración agrega es lo ÚNICO que faltaba: dónde se guarda con qué
-- identidad está actuando la persona ahora mismo, y cómo se lee esa lista sin
-- filtrar datos de facturación.
--
-- ── 1. `active_identities` — CON QUÉ IDENTIDAD ESTOY ACTUANDO ────────────────
-- LA AUSENCIA DE FILA SIGNIFICA "ESTOY COMO YO MISMO" (doctrina de
-- notification_prefs 0045, profile_privacy 0063 y creator_eligibility_config
-- 0064): nadie nace con una fila y volver al perfil personal es un DELETE, no
-- un estado especial. Actuar como negocio es la excepción explícita.
--
-- Es tabla aparte y NO una columna de `profiles` por dos razones, las dos
-- serias:
--   · `profiles` es PÚBLICA por diseño (SEO). Con qué identidad está actuando
--     alguien en este momento no tiene por qué ser consultable por terceros:
--     lo que sí es público es el POST firmado por el negocio, no el estado del
--     interruptor. Acá la fila la ve SOLO su dueño — sin rama de staff ni de
--     global_admin, mismo criterio que saves (0038) y post_poll_votes (0041).
--   · La autorización vive en el WITH CHECK, y sobre `profiles` habría que
--     colgarla de un trigger. El `with check` de esta tabla exige
--     `app.business_role(...) is not null`: NO EXISTE forma de dejar escrita
--     una identidad activa de un negocio del que no sos miembro activo, ni
--     llamando a PostgREST a mano con el JWT en la mano. La app no es la
--     frontera; la policy sí.
--
-- Que la RLS lo impida no alcanza para el caso INVERSO —que a alguien le
-- revoquen la membresía DESPUÉS de haber elegido esa identidad—: esa fila
-- queda apuntando a un negocio que ya no se puede usar. Por eso el servidor
-- vuelve a validar en cada lectura contra `identidades_disponibles()` y, si el
-- negocio ya no está en la lista, cae al perfil personal (ver
-- src/lib/perfil-activo/identidad.ts). Dos candados, no uno.
--
-- ── 2. `identidades_disponibles()` — LA LISTA, SIN DATOS DE FACTURACIÓN ──────
-- `business_accounts_select` (0008) solo deja leer al DUEÑO. Un administrador
-- invitado por la 0031 ve su fila de `business_members` pero NO el negocio, así
-- que sin esto el cambiador solo funcionaría para dueños y la multi-admin
-- quedaría de adorno.
--
-- La salida obvia sería ampliar esa policy a los miembros. No se hace: la fila
-- de `business_accounts` lleva `stripe_customer_id` y `stripe_subscription_id`,
-- y ampliar el SELECT le daría los identificadores de facturación a un rol
-- 'analista'. La RLS filtra FILAS, no columnas. Entonces la lista sale por una
-- función `security definer` que devuelve exactamente las columnas de
-- IDENTIDAD (nombre, categoría, ficha pública, rol) y ninguna de plata —
-- mismo criterio de minimización que boosts (0018) aplicó a los suyos.
--
-- ── 3. UNA CUENTA DE NEGOCIO POR PERSONA Y POR COMUNIDAD ─────────────────────
-- El índice único `business_accounts_one_per_owner` no es una restricción de
-- producto inventada acá: es lo que el código YA asumía. `iniciarSuscripcion`
-- (src/app/(app)/negocios/presencia/actions.ts) busca la cuenta del dueño con
-- `.maybeSingle()`, que revienta con dos filas — o sea que la segunda cuenta de
-- negocio de una persona rompía el checkout de Presencia Verificada. Con el
-- índice, eso es imposible por construcción y el alta puede ser idempotente.
--
-- No limita el cambiador a dos identidades: se puede ADMINISTRAR cualquier
-- cantidad de negocios ajenos vía `business_members`. Lo que no se puede es
-- fabricar cuentas propias en serie, que es el vector de spam.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ───────────────────────────────
--   · No toca `posts` ni sus policies. Publicar como negocio YA tiene camino en
--     el modelo: `posts.entity_listing_id` (0023) con la policy que exige que
--     el listing sea propio y esté publicado, y el feed ya lo lee para pintar
--     la autoría de entidad. Falta la UI que lo mande, y esa vive en
--     src/components/feed/**, que en este momento lo está escribiendo otro
--     equipo. Agregar acá una columna paralela sería inventar un segundo modelo
--     de autoría para el mismo hecho.
--   · No agrega foto ni biografía al negocio. El cambiador muestra la inicial
--     del nombre (`<Avatar name=…>`), que es lo que la app ya hace cuando un
--     perfil no tiene foto. Una columna `avatar_url` que ningún formulario
--     escribe es exactamente la letra muerta que ya tenemos en
--     `business_verifications` (0031, cero referencias en la app).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Una cuenta de negocio por persona y por comunidad
-- ---------------------------------------------------------------------------
create unique index if not exists business_accounts_one_per_owner
  on public.business_accounts (tenant_id, owner_id);

comment on index public.business_accounts_one_per_owner is
  'Una cuenta de negocio por persona y por comunidad. No es una decisión nueva: negocios/presencia/actions.ts ya leía la cuenta del dueño con maybeSingle(), que falla con dos filas. Ser miembro de negocios AJENOS (business_members) no tiene tope.';

-- ---------------------------------------------------------------------------
-- 2. Helper: ¿de qué comunidad es este negocio?
--    `app.business_role()` (0031) contesta el rol pero no el tenant, y el
--    WITH CHECK de abajo necesita las dos cosas. security definer para que el
--    chequeo no dependa de que quien escribe pueda LEER business_accounts
--    (un administrador invitado no puede: ver el encabezado).
-- ---------------------------------------------------------------------------
create or replace function app.business_tenant(p_business uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ba.tenant_id from public.business_accounts ba where ba.id = p_business;
$$;

comment on function app.business_tenant(uuid) is
  'Comunidad a la que pertenece un negocio, o null si no existe. security definer: usable en policies sin exigir SELECT sobre business_accounts.';

revoke all on function app.business_tenant(uuid) from public;
grant execute on function app.business_tenant(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. active_identities — con qué identidad está actuando cada persona
-- ---------------------------------------------------------------------------
create table public.active_identities (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  business_id uuid not null references public.business_accounts(id) on delete cascade,
  updated_at  timestamptz not null default now()
);

comment on table public.active_identities is
  'Con qué identidad está actuando una persona AHORA. LA AUSENCIA DE FILA SIGNIFICA "como vos mismo": volver al perfil personal es borrar la fila, no un estado más. La fila la ve SOLO su dueño (sin rama de staff ni global_admin, criterio de saves 0038): lo público es la publicación firmada por el negocio, no el estado del interruptor. El WITH CHECK exige membresía ACTIVA, así que es imposible dejar escrita una identidad de un negocio ajeno ni llamando a la API a mano.';

comment on column public.active_identities.business_id is
  'Negocio con el que se está actuando. Si la membresía se revoca después, la fila queda huérfana a propósito: el servidor revalida en cada lectura contra identidades_disponibles() y cae al perfil personal.';

create index active_identities_business_idx on public.active_identities (business_id);
create index active_identities_tenant_idx on public.active_identities (tenant_id);

create trigger active_identities_set_updated_at
before update on public.active_identities
for each row execute function extensions.moddatetime(updated_at);

alter table public.active_identities enable row level security;
alter table public.active_identities force row level security;

create policy active_identities_select on public.active_identities
for select to authenticated
using (profile_id = (select auth.uid()));

create policy active_identities_insert on public.active_identities
for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
  and app.business_tenant(business_id) = tenant_id
  and app.business_role(business_id, (select auth.uid())) is not null
);

create policy active_identities_update on public.active_identities
for update to authenticated
using (profile_id = (select auth.uid()))
with check (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
  and app.business_tenant(business_id) = tenant_id
  and app.business_role(business_id, (select auth.uid())) is not null
);

create policy active_identities_delete on public.active_identities
for delete to authenticated
using (profile_id = (select auth.uid()));

-- GRANT explícito: en esta base los default privileges del schema `public` no
-- incluyen a `anon` ni garantizan nada para tablas nuevas (ver el encabezado de
-- 0085). Sin esto, Postgres ni llega a evaluar las policies de arriba.
-- `anon` NO recibe nada: sin sesión no hay identidad que elegir.
grant select, insert, update, delete on public.active_identities to authenticated;

-- ---------------------------------------------------------------------------
-- 4. identidades_disponibles() — con qué puede actuar quien pregunta
-- ---------------------------------------------------------------------------
create or replace function public.identidades_disponibles()
returns table (
  business_id    uuid,
  nombre         text,
  categoria      text,
  listing_id     uuid,
  rol            text,
  es_propietario boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ba.id,
    ba.name,
    ba.category,
    ba.listing_id,
    bm.role,
    ba.owner_id = (select auth.uid())
  from public.business_members bm
  join public.business_accounts ba on ba.id = bm.business_id
  where bm.profile_id = (select auth.uid())
    and bm.status = 'active'
    and ba.tenant_id = (select app.current_tenant_id())
  order by (ba.owner_id = (select auth.uid())) desc, ba.name;
$$;

comment on function public.identidades_disponibles() is
  'Negocios con los que quien pregunta puede actuar (membresía ACTIVA en su propia comunidad), con el rol que tiene en cada uno. Devuelve SOLO columnas de identidad: stripe_customer_id y stripe_subscription_id no salen de acá — por eso existe esta función en vez de ampliar business_accounts_select a los miembros (la RLS filtra filas, no columnas). Sin sesión devuelve vacío.';

-- `revoke ... from public` NO alcanza para sacarle EXECUTE a `anon`: ese grant
-- no viene de PUBLIC sino de los default privileges del schema (el mismo motivo
-- por el que `global_search` y `record_cta_click` aparecen en el linter de
-- Supabase como ejecutables por anon). Va explícito. Sin sesión la función
-- devuelve vacío igual —`auth.uid()` es null—, pero una función `security
-- definer` colgada del API público sin necesidad es superficie regalada.
revoke all on function public.identidades_disponibles() from public;
revoke execute on function public.identidades_disponibles() from anon;
grant execute on function public.identidades_disponibles() to authenticated;

commit;
