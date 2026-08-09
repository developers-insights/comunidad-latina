-- =============================================================================
-- 0064_umbrales_de_creador_por_tenant.sql — Comunidad Latina
--
-- El pliego es literal: "Los números deben ser configurables desde el panel, no
-- colocados permanentemente en el código". Hoy están hardcodeados adentro de
-- app.creator_activation_eligible() (0032): 18 años, score 50, 3 ítems de
-- portafolio. Cambiar cualquiera de esos tres es hoy una migración.
--
-- Esta migración mueve TODOS los umbrales a una tabla por tenant y reescribe la
-- función para que los lea de ahí. La firma de salida no cambia
-- —(eligible boolean, reasons text[])— así que nada de lo que ya la llama se
-- entera: `request_creator_activation` y `admin_resolve_creator_activation`
-- (0032) siguen funcionando igual.
--
-- CÓDIGOS DE `reasons`: los tres viejos tenían el número adentro ('edad_18',
-- 'user_score_50', 'portafolio_3'), que es justo lo que dejamos de tener fijo.
-- Se renombran a 'edad_minima', 'user_score' y 'portafolio'. Se verificó que
-- ningún archivo de `src/` los consume, así que el rename no rompe nada.
--
-- LA AUSENCIA DE FILA SIGNIFICA LOS DEFAULTS (criterio de notification_prefs
-- 0045 y profile_privacy 0063): un tenant nuevo no necesita que alguien se
-- acuerde de sembrarle la configuración para que el gate funcione.
--
-- Sobre los defaults elegidos: reproducen EXACTAMENTE la conducta de 0032 para
-- que esta migración no cambie quién es elegible hoy. Los umbrales que el
-- pliego suma y que 0032 no evaluaba (seguidores, videos, vistas, Stripe
-- Connect, términos de creador) entran en 0 / false — o sea desactivados —
-- porque prenderlos por decreto dejaría fuera de golpe a los 8 creadores que ya
-- existen. Prenderlos es ahora una fila editable desde el panel, que es
-- precisamente lo que pedía el contrato.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Términos de creador (uno de los requisitos del pliego)
-- ---------------------------------------------------------------------------
alter table public.creator_profiles
  add column if not exists creator_terms_accepted_at timestamptz,
  add column if not exists creator_terms_version     text;

comment on column public.creator_profiles.creator_terms_accepted_at is
  'Cuándo aceptó los términos ESPECÍFICOS de creador. Separado de profiles.terms_accepted_at (los términos generales de la plataforma) a propósito: son dos contratos distintos, se aceptan en momentos distintos y uno puede cambiar sin el otro.';
comment on column public.creator_profiles.creator_terms_version is
  'Versión aceptada. Sin esto, "aceptó los términos" no significa nada el día que los términos cambian.';

-- ---------------------------------------------------------------------------
-- 2. La configuración por tenant
-- ---------------------------------------------------------------------------
create table if not exists public.creator_eligibility_config (
  tenant_id                    uuid primary key references public.tenants(id),

  min_age                      int     not null default 18   check (min_age between 13 and 99),
  require_profile_complete     boolean not null default false,
  require_phone_verified       boolean not null default true,
  require_email_verified       boolean not null default true,
  min_user_score               int     not null default 50   check (min_user_score between 0 and 100),
  require_identity_verified    boolean not null default true,
  require_stripe_connect       boolean not null default false,
  min_followers                int     not null default 0    check (min_followers >= 0),
  min_videos                   int     not null default 0    check (min_videos >= 0),
  min_views                    int     not null default 0    check (min_views >= 0),
  min_portfolio_items          int     not null default 3    check (min_portfolio_items >= 0),
  require_no_active_suspension boolean not null default true,
  require_creator_terms        boolean not null default false,

  updated_by                   uuid references public.profiles(id) on delete set null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

comment on table public.creator_eligibility_config is
  'Umbrales de elegibilidad de creador, POR TENANT y editables desde el panel — el pliego lo pide con todas las letras ("no colocados permanentemente en el código"). Una fila por comunidad; LA AUSENCIA DE FILA SIGNIFICA LOS DEFAULTS de app.creator_eligibility_config(), que reproducen la conducta de 0032. Los evalúa app.creator_activation_eligible().';
comment on column public.creator_eligibility_config.min_age is
  'Edad mínima en años. 18 por default (el valor del pliego). La edad se calcula contra profiles_private.birthdate y, si no hay, contra el legado user_phones.birthdate; profiles.age_confirmed_at sirve de respaldo cuando la persona confirmó ser mayor sin cargar la fecha.';
comment on column public.creator_eligibility_config.require_profile_complete is
  'Exige perfil completo (nombre, apellido, usuario, avatar, bio y país de origen). Default FALSE aunque el pliego lo liste: el apellido y el usuario recién existen desde 0062, así que prenderlo hoy volvería inelegibles de golpe a todos los creadores ya aprobados. Se prende desde el panel cuando la base de usuarios haya completado el dato.';
comment on column public.creator_eligibility_config.require_stripe_connect is
  'Exige Stripe Connect operativo (charges + payouts habilitados). Default FALSE porque Stripe está degradado en este entorno (§7 del contrato: sin credenciales, toda acción de pago abre "Próximamente"). Prenderlo sin Stripe configurado dejaría a todo el mundo fuera.';
comment on column public.creator_eligibility_config.min_videos is
  'Mínimo de videos publicados (posts con video_type, status published). 0 = sin exigencia.';
comment on column public.creator_eligibility_config.min_views is
  'Mínimo de vistas ACUMULADAS entre los posts publicados de la persona. Se lee del contador denormalizado posts.view_count, que mantienen triggers server-side: no es un número que el cliente pueda inflar.';
comment on column public.creator_eligibility_config.require_creator_terms is
  'Exige creator_profiles.creator_terms_accepted_at. Default FALSE hasta que exista la pantalla que los hace aceptar — si no, el requisito sería imposible de cumplir.';
comment on column public.creator_eligibility_config.updated_by is
  'Quién tocó los umbrales por última vez. Cambiar quién puede cobrar en la plataforma es una decisión que tiene que tener nombre.';

create index if not exists creator_eligibility_config_updated_by_idx
  on public.creator_eligibility_config (updated_by);

drop trigger if exists creator_eligibility_config_set_updated_at on public.creator_eligibility_config;
create trigger creator_eligibility_config_set_updated_at
before update on public.creator_eligibility_config
for each row execute function extensions.moddatetime(updated_at);

alter table public.creator_eligibility_config enable row level security;
alter table public.creator_eligibility_config force row level security;

-- Cualquier miembro del tenant puede leer los umbrales: es la lista de
-- requisitos que la UI le muestra al que quiere ser creador. No hay nada
-- sensible acá — son reglas, no datos de personas.
create policy creator_eligibility_config_select on public.creator_eligibility_config
for select to authenticated
using (tenant_id = (select app.current_tenant_id()));

-- Escribe SOLO el admin del dominio (o el global). Es el "panel" del pliego.
create policy creator_eligibility_config_insert on public.creator_eligibility_config
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy creator_eligibility_config_update on public.creator_eligibility_config
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- Borrar la fila volvería a los defaults en silencio. Se edita, no se borra.
create policy creator_eligibility_config_delete on public.creator_eligibility_config
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 3. Lectura con defaults
-- ---------------------------------------------------------------------------
create or replace function app.creator_eligibility_config(p_tenant uuid)
returns public.creator_eligibility_config
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.creator_eligibility_config;
begin
  select * into v_cfg from public.creator_eligibility_config where tenant_id = p_tenant;
  if found then
    return v_cfg;
  end if;

  -- Sin fila: los defaults, que reproducen la conducta de 0032.
  return row(
    p_tenant,
    18, false, true, true, 50, true, false, 0, 0, 0, 3, true, false,
    null::uuid, '-infinity'::timestamptz, '-infinity'::timestamptz
  )::public.creator_eligibility_config;
end;
$$;

comment on function app.creator_eligibility_config(uuid) is
  'Devuelve los umbrales del tenant, o los defaults si nunca se configuró. Existe para que "no hay fila" y "hay fila" no sean dos caminos distintos en el evaluador.';

revoke execute on function app.creator_eligibility_config(uuid) from public, anon;
grant execute on function app.creator_eligibility_config(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. El evaluador, ahora contra la configuración
-- ---------------------------------------------------------------------------
create or replace function app.creator_activation_eligible(
  p_profile uuid,
  out eligible boolean,
  out reasons  text[]
)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile   record;
  v_cfg       public.creator_eligibility_config;
  v_dob       date;
  v_age_ok    boolean;
  v_score     int;
  v_count     int;
  v_views     bigint;
  v_reasons   text[] := '{}';
begin
  select p.tenant_id, p.identity_verified,
         coalesce(p.phone_verified, false) as phone_verified,
         coalesce(p.email_verified, false) as email_verified,
         p.account_status, p.age_confirmed_at,
         p.display_name, p.username, p.avatar_url, p.bio, p.country_origin
    into v_profile
    from public.profiles p
   where p.id = p_profile;

  if not found then
    eligible := false;
    reasons  := array['perfil_inexistente'];
    return;
  end if;

  v_cfg := app.creator_eligibility_config(v_profile.tenant_id);

  -- Edad. profiles_private.birthdate (0062) manda; user_phones.birthdate es el
  -- legado de 0030 y se sigue aceptando para no invalidar a quien ya la cargó.
  select pp.birthdate into v_dob
    from public.profiles_private pp where pp.profile_id = p_profile;
  if v_dob is null then
    select up.birthdate into v_dob
      from public.user_phones up where up.profile_id = p_profile;
  end if;

  v_age_ok := (v_dob is not null
               and v_dob <= (current_date - make_interval(years => v_cfg.min_age)))
              or v_profile.age_confirmed_at is not null;
  if not v_age_ok then
    v_reasons := v_reasons || 'edad_minima'::text;
  end if;

  -- Perfil completo
  if v_cfg.require_profile_complete then
    if v_profile.display_name is null or v_profile.username is null
       or v_profile.avatar_url is null or v_profile.bio is null
       or v_profile.country_origin is null
       or not exists (
         select 1 from public.profiles_private pp
          where pp.profile_id = p_profile and pp.last_name is not null
       ) then
      v_reasons := v_reasons || 'perfil_incompleto'::text;
    end if;
  end if;

  if v_cfg.require_phone_verified    and not v_profile.phone_verified    then
    v_reasons := v_reasons || 'telefono'::text;
  end if;
  if v_cfg.require_email_verified    and not v_profile.email_verified    then
    v_reasons := v_reasons || 'correo'::text;
  end if;
  if v_cfg.require_identity_verified and not v_profile.identity_verified then
    v_reasons := v_reasons || 'identidad'::text;
  end if;

  select ts.score into v_score from public.trust_scores ts where ts.profile_id = p_profile;
  if coalesce(v_score, 0) < v_cfg.min_user_score then
    v_reasons := v_reasons || 'user_score'::text;
  end if;

  -- Suspensiones / restricciones vigentes
  if v_cfg.require_no_active_suspension then
    if v_profile.account_status <> 'active' then
      v_reasons := v_reasons || 'cuenta_activa'::text;
    elsif exists (
      select 1 from public.account_restrictions ar
       where ar.profile_id = p_profile
         and ar.scope in ('marketplace', 'total')
         and ar.lifted_at is null
         and (ar.expires_at is null or ar.expires_at > now())
    ) then
      v_reasons := v_reasons || 'restriccion_marketplace'::text;
    end if;
  end if;

  -- Stripe Connect operativo
  if v_cfg.require_stripe_connect then
    if not exists (
      select 1 from public.connected_accounts ca
       where ca.owner_type = 'creator'
         and ca.owner_ref  = p_profile
         and ca.charges_enabled
         and ca.payouts_enabled
    ) then
      v_reasons := v_reasons || 'stripe_connect'::text;
    end if;
  end if;

  if v_cfg.min_portfolio_items > 0 then
    select count(*) into v_count
      from public.creator_portfolio_items where creator_id = p_profile;
    if v_count < v_cfg.min_portfolio_items then
      v_reasons := v_reasons || 'portafolio'::text;
    end if;
  end if;

  if v_cfg.min_followers > 0 then
    select count(*) into v_count
      from public.follows f
     where f.target_kind = 'profile' and f.target_id = p_profile;
    if v_count < v_cfg.min_followers then
      v_reasons := v_reasons || 'seguidores'::text;
    end if;
  end if;

  if v_cfg.min_videos > 0 then
    select count(*) into v_count
      from public.posts po
     where po.author_id = p_profile
       and po.video_type is not null
       and po.status = 'published';
    if v_count < v_cfg.min_videos then
      v_reasons := v_reasons || 'videos'::text;
    end if;
  end if;

  if v_cfg.min_views > 0 then
    select coalesce(sum(po.view_count), 0) into v_views
      from public.posts po
     where po.author_id = p_profile and po.status = 'published';
    if v_views < v_cfg.min_views then
      v_reasons := v_reasons || 'vistas'::text;
    end if;
  end if;

  if v_cfg.require_creator_terms then
    if not exists (
      select 1 from public.creator_profiles cp
       where cp.profile_id = p_profile
         and cp.creator_terms_accepted_at is not null
    ) then
      v_reasons := v_reasons || 'terminos_creador'::text;
    end if;
  end if;

  eligible := (array_length(v_reasons, 1) is null);
  reasons  := v_reasons;
end;
$$;

comment on function app.creator_activation_eligible(uuid) is
  'Gate de activación de creador evaluado contra creator_eligibility_config del tenant (0064) — ya NO contra números escritos en el código, que es lo que exige el pliego. Misma firma de salida que en 0032, (eligible, reasons[]), para no romper request_creator_activation ni admin_resolve_creator_activation. Códigos de reasons: edad_minima, perfil_incompleto, telefono, correo, identidad, user_score, cuenta_activa, restriccion_marketplace, stripe_connect, portafolio, seguidores, videos, vistas, terminos_creador.';

commit;
