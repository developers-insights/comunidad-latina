-- =============================================================================
-- 0079_profile_card_no_cruza_comunidades.sql — Comunidad Latina
--
-- BLOQUEANTE. `public.profile_card()` (0063) entregaba datos de
-- `profiles_private` a cualquiera, sin importar de qué comunidad viniera.
--
-- QUÉ ESTABA MAL: la función es SECURITY DEFINER con EXECUTE para `anon`, o sea
-- alcanzable por REST sin cuenta, y su `select` de arranque era
-- `from public.profiles p where p.id = p_profile_id`, sin condición de tenant.
-- Como corre como DEFINER, el `left join public.profiles_private pp` NO pasa por
-- la RLS solo-dueño de esa tabla: la función era la llave y abría cualquier
-- puerta. Reproducido contra la base con un miembro de `dominicanos` leyendo un
-- perfil de `comunidadlatina`: devolvía APELLIDO, CIUDAD, PAÍS DE RESIDENCIA y
-- EDAD. El propio comment de `profiles_private` dice que esa tabla no la leen
-- "ni anon, ni otros miembros, ni staff, ni global_admin".
--
-- No se estaba filtrando nada TODAVÍA porque los defaults son privado/seguidores
-- y hoy no hay ni una fila en `profile_privacy` (0 de 17 perfiles): el agujero se
-- abría el día que alguien eligiera "público" desde la UI, y la expectativa de
-- esa persona es publicarse en SU comunidad, no en los otros dominios.
--
-- EL ARREGLO: se computa `v_same_tenant` y se exige para TODO campo que salga de
-- `profiles_private` (apellido, edad, país de residencia, ciudad, idiomas). Se
-- suma a la matriz de privacidad, no la reemplaza: hacen falta las dos. El
-- `v_owner or` de adelante no es redundante — garantiza que nadie pierda sus
-- PROPIOS datos si el tenant del token y el de su fila difieren (token viejo,
-- cuenta migrada). Misma promesa que el `when p_is_owner then true` de
-- app.privacy_allows().
--
-- LO QUE **NO** CAMBIA (deuda de SEO documentada y aceptada): bio,
-- country_origin, area_label, nombre, avatar, portada, verificación y alta NO se
-- gatean por tenant. Ya son legibles cross-tenant por lectura directa de
-- `public.profiles` (`profiles_select` es using(true) y 0058 le dejó a anon un
-- grant explícito sobre 8 columnas). Gatearlos acá no cerraría nada y rompería
-- el perfil público. Ídem can_see_followers / can_see_posts (0003:87, 0004:70,
-- 0056). Esa deuda queda exactamente donde estaba: ni se amplía ni se achica.
--
-- CAMBIO DE COMPORTAMIENTO QUE HAY QUE DECIR EN VOZ ALTA: `anon` no tiene tenant
-- (sin JWT, app.current_tenant_id() es NULL), así que los campos de
-- profiles_private NO salen nunca sin sesión. Eso ACHICA lo que prometía el
-- nivel 'publico' de la 0063 ("cualquiera, con o sin cuenta"): pasa a significar
-- "cualquier miembro de MI comunidad". Se elige a conciencia — el `Host` no
-- llega a la base, así que no hay forma de distinguir al anónimo parado en el
-- sitio de esta comunidad del que le pide a la API el perfil de otra, y pasar el
-- tenant por parámetro no resolvería nada porque lo elegiría el visitante.
-- Ante la duda, cerrado: apellido + ciudad + país + edad es material de
-- suplantación. El perfil público no se rompe: todo lo que lo renderiza sale de
-- `profiles`, no de `profiles_private`.
--
-- Sin rama de staff ni de global_admin, igual que antes: 0075/0076 dieron
-- alcance para ACTUAR cross-tenant, nunca para leer la PII de un miembro ajeno.
-- =============================================================================

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
  v_p           record;
  v_priv        public.profile_privacy;
  v_viewer      uuid := auth.uid();
  v_owner       boolean;
  v_follower    boolean;
  v_same_tenant boolean;
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

  -- LA GUARDA DE 0079. Sin ella esta función entregaba profiles_private de
  -- cualquier comunidad a cualquier comunidad. El `v_owner or` de adelante
  -- garantiza que nadie pierda sus propios datos por un desajuste de token.
  v_same_tenant := v_owner
    or (v_p.tenant_id is not null and v_p.tenant_id = app.current_tenant_id());

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

    -- bio / country_origin / area_label salen de `profiles`, que ya es legible
    -- cross-tenant por lectura directa. Gatearlos acá no cerraría nada y
    -- rompería el perfil público: quedan como estaban (ver cabecera).
    case when app.privacy_allows(v_priv.show_bio, v_owner, v_follower)
         then v_p.bio end,
    case when app.privacy_allows(v_priv.show_country_origin, v_owner, v_follower)
         then v_p.country_origin end,
    v_p.area_label,

    -- De acá para abajo, TODO sale de profiles_private: mismo tenant obligatorio.
    case when v_same_tenant
              and app.privacy_allows(v_priv.show_last_name, v_owner, v_follower)
         then pp.last_name end,
    -- Edad en años, nunca el día. Ni siquiera con el bloque en 'publico'.
    case when v_same_tenant
              and app.privacy_allows(v_priv.show_birthdate, v_owner, v_follower)
              and pp.birthdate is not null
         then extract(year from age(pp.birthdate))::int end,
    -- La fecha exacta, SOLO para el dueño (que siempre es mismo-tenant).
    case when v_owner then pp.birthdate end,

    case when v_same_tenant
              and app.privacy_allows(v_priv.show_location, v_owner, v_follower)
         then pp.country_residence end,
    case when v_same_tenant
              and app.privacy_allows(v_priv.show_location, v_owner, v_follower)
         then pp.city end,
    case when v_same_tenant
              and app.privacy_allows(v_priv.show_languages, v_owner, v_follower)
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
  'La ficha de perfil TAL COMO LA PUEDE VER quien llama. Es la única puerta a profiles_private y desde 0079 esa puerta NO CRUZA COMUNIDADES: apellido, edad, país de residencia, ciudad e idiomas exigen que el perfil sea del mismo tenant que el JWT de quien mira (o que sea el propio dueño), ADEMÁS de lo que permita la matriz de privacidad. Antes bastaba con conocer el uuid: un miembro de una comunidad leía la PII de otra, y anon también. Consecuencia buscada: sin sesión no hay tenant, así que para un visitante anónimo el nivel "publico" de esos cinco campos se comporta como "solo mi comunidad" — el perfil público no se rompe porque nombre, avatar, portada, bio, país de origen y zona salen de profiles, no de profiles_private. La fecha de nacimiento sigue saliendo completa SOLO para el dueño. Sin rama de staff ni de global_admin, igual que antes: 0075/0076 dieron alcance para actuar cross-tenant, nunca para leer la PII de un miembro ajeno.';

revoke execute on function public.profile_card(uuid) from public;
grant execute on function public.profile_card(uuid) to anon, authenticated, service_role;