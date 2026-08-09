-- =============================================================================
-- 0063_privacidad_del_perfil.sql — Comunidad Latina
--
-- Controles de privacidad del perfil: qué bloque ve quién, con tres niveles
-- (publico / seguidores / privado) y defaults conservadores.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ ESTO NO ES COSMÉTICO
-- -----------------------------------------------------------------------------
-- El modo de falla obvio de "controles de privacidad" es implementarlos como un
-- `if` en el componente: el dato viaja igual al cliente y basta abrir la
-- pestaña de red — o pegarle directo a PostgREST — para leerlo. Acá no puede
-- pasar, y no por disciplina sino por construcción:
--
--   1. Los campos privados NO viven en `profiles` (público, `using(true)`).
--      Viven en `profiles_private`, cuya RLS es solo-dueño desde 0003. O sea
--      que el estado por defecto de la base es "nadie los ve", incluido staff
--      y global_admin. No hay nada que apagar: ya están apagados.
--   2. La ÚNICA puerta que los revela es `public.profile_card()`, que es
--      SECURITY DEFINER y aplica la matriz de privacidad antes de devolver
--      nada. Si el usuario puso "privado", la columna vuelve NULL desde el
--      servidor: no llega al cliente para que la UI la esconda.
--   3. `profile_privacy` sólo la lee su dueño. Ni siquiera es consultable qué
--      configuró otra persona.
--
-- O sea: cerrado por RLS, abierto sólo por una función que sabe de permisos.
-- Si mañana alguien borra el `if` de la UI, no se filtra nada.
--
-- -----------------------------------------------------------------------------
-- LA AUSENCIA DE FILA SIGNIFICA "DEFAULTS"
-- -----------------------------------------------------------------------------
-- Mismo criterio que notification_prefs (0045): no se siembra una fila por cada
-- registro. Sin fila, rigen los defaults de app.profile_privacy_defaults(), que
-- son los conservadores. Así nadie queda expuesto por una fila que no se creó.
--
-- -----------------------------------------------------------------------------
-- LA FECHA DE NACIMIENTO NUNCA SALE COMPLETA
-- -----------------------------------------------------------------------------
-- Ni con el bloque en "publico". `profile_card` devuelve `age` en años. La DOB
-- exacta la ve únicamente el dueño. Un cumpleaños completo + nombre + ciudad es
-- el kit de suplantación de identidad; la edad sola no lo es.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. profile_privacy
-- ---------------------------------------------------------------------------
create table if not exists public.profile_privacy (
  profile_id          uuid primary key references public.profiles(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id),

  show_last_name      text not null default 'privado',
  show_birthdate      text not null default 'privado',
  show_location       text not null default 'seguidores',
  show_languages      text not null default 'publico',
  show_country_origin text not null default 'publico',
  show_bio            text not null default 'publico',
  show_followers      text not null default 'seguidores',
  show_posts          text not null default 'publico',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint profile_privacy_niveles check (
    show_last_name      in ('publico','seguidores','privado') and
    show_birthdate      in ('publico','seguidores','privado') and
    show_location       in ('publico','seguidores','privado') and
    show_languages      in ('publico','seguidores','privado') and
    show_country_origin in ('publico','seguidores','privado') and
    show_bio            in ('publico','seguidores','privado') and
    show_followers      in ('publico','seguidores','privado') and
    show_posts          in ('publico','seguidores','privado')
  )
);

comment on table public.profile_privacy is
  'Qué bloque del perfil ve quién, en tres niveles: publico (cualquiera, con o sin cuenta), seguidores (sólo quien te sigue) y privado (sólo vos). LA AUSENCIA DE FILA SIGNIFICA LOS DEFAULTS de app.profile_privacy_defaults() — no se siembra una fila por registro, igual que notification_prefs (0045), para que nadie quede expuesto por una fila que no se llegó a crear. La fila sólo la ve su dueño: qué configuró otra persona no es consultable.';
comment on column public.profile_privacy.show_last_name is
  'Default `privado`. El apellido es lo que convierte un perfil en una persona identificable fuera de la plataforma; que se muestre tiene que ser una decisión, no un descuido.';
comment on column public.profile_privacy.show_birthdate is
  'Default `privado`. Y aun en `publico` lo que sale es la EDAD en años, nunca el día exacto: eso lo garantiza profile_card(), no la configuración.';
comment on column public.profile_privacy.show_location is
  'Cubre country_residence + city. Default `seguidores` y no `publico`: dónde vivís es el dato que más se usa para acosar, y la comunidad se organiza por país de ORIGEN (público), no por dónde estás hoy.';
comment on column public.profile_privacy.show_country_origin is
  'Default `publico` porque hoy ya lo es (profiles.country_origin está en el grant a anon desde 0058) y es el eje mismo de la comunidad. Se incluye igual para que el usuario pueda cerrarlo.';
comment on column public.profile_privacy.show_bio is
  'Default `publico`: hoy ya lo es. ATENCIÓN — bio y country_origin viven en `profiles` y siguen siendo legibles por lectura directa de la tabla; para que estos dos niveles apliquen de verdad, la app tiene que dejar de leer profiles directo y pasar por profile_card(). Los campos NUEVOS (apellido, DOB, ubicación, idiomas) no tienen ese hueco: viven en profiles_private y ahí no hay lectura directa posible.';
comment on column public.profile_privacy.show_followers is
  'Si tu lista de seguidores/seguidos es consultable. Default `seguidores`: el grafo social completo de una persona es material de targeting, no un adorno del perfil.';

create index if not exists profile_privacy_tenant_idx
  on public.profile_privacy (tenant_id);

drop trigger if exists profile_privacy_set_updated_at on public.profile_privacy;
create trigger profile_privacy_set_updated_at
before update on public.profile_privacy
for each row execute function extensions.moddatetime(updated_at);

alter table public.profile_privacy enable row level security;
alter table public.profile_privacy force row level security;

-- Sólo el dueño. Sin rama de staff ni de global_admin: mismo criterio que
-- saves (0038), post_poll_votes (0041) y user_blocks (0020).
create policy profile_privacy_select on public.profile_privacy
for select to authenticated
using (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

create policy profile_privacy_insert on public.profile_privacy
for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

create policy profile_privacy_update on public.profile_privacy
for update to authenticated
using (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
)
with check (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

-- Borrar la fila = volver a los defaults conservadores. Es seguro permitirlo
-- porque el default es MÁS cerrado, no más abierto.
create policy profile_privacy_delete on public.profile_privacy
for delete to authenticated
using (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

-- ---------------------------------------------------------------------------
-- 2. Los defaults y la regla de visibilidad, en un solo lugar
-- ---------------------------------------------------------------------------
create or replace function app.profile_privacy_defaults()
returns public.profile_privacy
language sql
immutable
set search_path = ''
as $$
  -- Los dos timestamps van con un valor fijo y no con now(): la función es
  -- IMMUTABLE y nadie los mira (esta fila no existe en la tabla, es el
  -- sustituto en memoria de "el usuario nunca configuró nada").
  select row(
    null::uuid, null::uuid,
    'privado', 'privado', 'seguidores', 'publico',
    'publico', 'publico', 'seguidores', 'publico',
    '-infinity'::timestamptz, '-infinity'::timestamptz
  )::public.profile_privacy;
$$;

comment on function app.profile_privacy_defaults() is
  'Los valores que rigen cuando el usuario nunca tocó sus controles. Conservadores por diseño: apellido y fecha de nacimiento privados, ubicación y seguidores sólo para seguidores. Existe como función y no como DEFAULT de columna porque la ausencia de fila también tiene que resolverse con estos mismos valores.';

create or replace function app.privacy_allows(
  p_nivel       text,
  p_is_owner    boolean,
  p_is_follower boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_is_owner then true          -- siempre te ves entero a vos mismo
    when p_nivel = 'publico'    then true
    when p_nivel = 'seguidores' then coalesce(p_is_follower, false)
    else false                          -- 'privado' y cualquier valor raro
  end;
$$;

comment on function app.privacy_allows(text, boolean, boolean) is
  'Traduce un nivel de privacidad + la relación del que mira en un sí/no. El `else false` es deliberado: un valor inesperado en la columna cierra el dato en vez de abrirlo (fail closed).';

-- ---------------------------------------------------------------------------
-- 3. profile_card — la única puerta a los datos privados del perfil
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque tiene que leer profiles_private, que por RLS no ve
-- nadie más que el dueño. Es exactamente el patrón que hace que la privacidad
-- sea real: el dato está cerrado por RLS y esta función es la única que lo
-- abre, sólo hasta donde la configuración del dueño lo permite.
create or replace function public.profile_card(p_profile_id uuid)
returns table (
  id                 uuid,
  display_name       text,
  username           text,
  avatar_url         text,
  cover_url          text,
  identity_verified  boolean,
  created_at         timestamptz,
  bio                text,
  country_origin     text,
  area_label         text,
  last_name          text,
  age                int,
  birthdate          date,
  country_residence  text,
  city               text,
  languages          text[],
  can_see_followers  boolean,
  can_see_posts      boolean,
  viewer_is_owner    boolean,
  viewer_is_follower boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p        record;
  v_priv     public.profile_privacy;
  v_viewer   uuid := auth.uid();
  v_owner    boolean;
  v_follower boolean;
begin
  select p.id, p.tenant_id, p.display_name, p.username, p.avatar_url, p.cover_url,
         p.identity_verified, p.created_at, p.bio, p.country_origin, p.area_label,
         p.account_status
    into v_p
    from public.profiles p
   where p.id = p_profile_id;

  if not found or v_p.account_status = 'banned' then
    return;  -- perfil inexistente o dado de baja: sin ficha
  end if;

  v_owner := (v_viewer is not null and v_viewer = v_p.id);

  v_follower := v_owner or exists (
    select 1 from public.follows f
     where f.follower_id = v_viewer
       and f.target_kind = 'profile'
       and f.target_id   = v_p.id
  );

  select * into v_priv from public.profile_privacy where profile_id = v_p.id;
  if not found then
    v_priv := app.profile_privacy_defaults();
  end if;

  return query
  select
    v_p.id,
    v_p.display_name,
    v_p.username,
    v_p.avatar_url,
    v_p.cover_url,
    v_p.identity_verified,
    v_p.created_at,

    case when app.privacy_allows(v_priv.show_bio, v_owner, v_follower)
         then v_p.bio end,
    case when app.privacy_allows(v_priv.show_country_origin, v_owner, v_follower)
         then v_p.country_origin end,
    v_p.area_label,

    case when app.privacy_allows(v_priv.show_last_name, v_owner, v_follower)
         then pp.last_name end,
    -- Edad en años, nunca el día. Ni siquiera con el bloque en 'publico'.
    case when app.privacy_allows(v_priv.show_birthdate, v_owner, v_follower)
              and pp.birthdate is not null
         then extract(year from age(pp.birthdate))::int end,
    -- La fecha exacta, SOLO para el dueño.
    case when v_owner then pp.birthdate end,

    case when app.privacy_allows(v_priv.show_location, v_owner, v_follower)
         then pp.country_residence end,
    case when app.privacy_allows(v_priv.show_location, v_owner, v_follower)
         then pp.city end,
    case when app.privacy_allows(v_priv.show_languages, v_owner, v_follower)
         then coalesce(pp.languages, '{}'::text[])
         else '{}'::text[] end,

    app.privacy_allows(v_priv.show_followers, v_owner, v_follower),
    app.privacy_allows(v_priv.show_posts, v_owner, v_follower),
    v_owner,
    v_follower
  from (select 1) dummy
  left join public.profiles_private pp on pp.profile_id = v_p.id;
end;
$$;

comment on function public.profile_card(uuid) is
  'La ficha de perfil TAL COMO LA PUEDE VER quien llama. Es la única puerta a profiles_private: los campos que la configuración del dueño no permite vuelven NULL desde el servidor, así que ni siquiera viajan al cliente. La fecha de nacimiento nunca sale completa salvo al propio dueño — el resto recibe la edad en años. SECURITY DEFINER a propósito: el dato está cerrado por RLS y esta función es la única llave, con la matriz de privacidad aplicada adentro.';

revoke execute on function public.profile_card(uuid) from public;
grant execute on function public.profile_card(uuid) to anon, authenticated, service_role;

commit;
