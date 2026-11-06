-- 0185 · El padrón de personas deja de poder bajarse: la parte que no rompe nada.
--
-- HALLAZGO (caughtcode 05/11): `profiles_select` deja pasar a `anon` sin filtro y
-- `anon` tiene grant sobre 10 columnas. Con la anon key, que está en el bundle:
--     GET /rest/v1/profiles?select=id,display_name,area_label,bio
-- baja a todas las personas de todas las comunidades.
--
-- `trust_scores` se cierra junto: tiene una fila por persona, así que sus
-- `profile_id` son el padrón por otro lado, y con esas ids la RPC de abajo
-- devolvería los nombres.
--
-- ORDEN, QUE ES LO QUE EVITA ROMPER LAS PÁGINAS PÚBLICAS:
--   1. Esta migración: sólo agrega.
--   2. Deploy del sitio leyendo por `perfiles_publicos` / `puntajes_publicos`.
--   3. 0186: recién ahí se le saca `anon` a las tablas.

drop function if exists public.perfiles_publicos(uuid[]);

create function public.perfiles_publicos(p_ids uuid[])
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  area_label text,
  identity_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Sólo por id y con tope: quien no conoce el id de alguien no lo puede pedir.
  -- Con sesión vale la misma regla que profiles_select. Sin sesión se ve sólo
  -- gente que el sitio ya muestra: los ids salen de avisos y publicaciones.
  -- Sólo lo que muestra la firma de un aviso. Bio y país salen de `profile_card`,
  -- que respeta la privacidad que eligió cada persona.
  select p.id, p.display_name, p.avatar_url, p.area_label, p.identity_verified
    from public.profiles p
   where p.id = any (p_ids[1:200])
     and (
       auth.uid() is null
       or p.id = auth.uid()
       or p.tenant_id = app.current_tenant_id()
       or app.is_global_admin()
     );
$$;

create or replace function public.puntajes_publicos(p_ids uuid[])
returns table (
  profile_id uuid,
  score integer,
  level text,
  signals jsonb,
  computed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.profile_id, t.score, t.level, t.signals, t.computed_at
    from public.trust_scores t
   where t.profile_id = any (p_ids[1:200])
     and (
       auth.uid() is null
       or t.profile_id = auth.uid()
       or t.tenant_id = app.current_tenant_id()
       or app.is_global_admin()
     );
$$;

revoke all on function public.perfiles_publicos(uuid[]) from public;
revoke all on function public.puntajes_publicos(uuid[]) from public;
grant execute on function public.perfiles_publicos(uuid[]) to anon, authenticated, service_role;
grant execute on function public.puntajes_publicos(uuid[]) to anon, authenticated, service_role;

-- `global_search` es SECURITY INVOKER y unía `profiles` para el nombre del autor
-- de cada publicación: sin esta función, los visitantes pierden esa rama en 0186.
create or replace function app.nombre_publico(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p where p.id = p_id;
$$;

revoke all on function app.nombre_publico(uuid) from public;
grant execute on function app.nombre_publico(uuid) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.global_search(q text, limit_per_type integer DEFAULT 5, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS TABLE(result_type text, id uuid, title text, subtitle text, image_url text, href text, rank real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := auth.uid();
  -- Con sesión manda el JWT y `p_tenant` se ignora: nadie cambia de comunidad
  -- por parámetro. Sin sesión no hay claim, y la comunidad la dice el servidor.
  v_tenant uuid := case when v_uid is null then p_tenant
                        else app.current_tenant_id() end;
  v_limit  int  := least(greatest(coalesce(limit_per_type, 5), 1), 20);
  v_q      text;
  v_qu     text;
  v_like   text;
  v_ts     tsquery;
begin
  v_q := btrim(coalesce(q, ''));
  if char_length(v_q) < 2 or v_tenant is null then
    return; -- vacío, sin escanear nada
  end if;
  v_q := left(v_q, 80);

  -- La consulta se lee de las DOS maneras y se unen con OR, igual que el
  -- documento. Con la tilde entra por la rama 'spanish'; sin la tilde, por la
  -- rama 'spanish_unaccent'. Cualquiera de las dos alcanza para encontrar un
  -- documento que guardó ambas.
  --
  -- Puede quedar VACÍA si `q` es toda stopwords ("de la"). No es un caso a
  -- esquivar: las ramas de FTS devuelven cero y la de personas (trigrama, sin
  -- stopwords) sigue funcionando. Es el comportamiento correcto.
  v_ts := websearch_to_tsquery('pg_catalog.spanish', v_q)
       || websearch_to_tsquery('public.spanish_unaccent', v_q);

  -- Para personas se compara SIN acentos de los dos lados. El patrón se arma
  -- DESPUÉS de sacar los acentos y ANTES de escapar los comodines, para que el
  -- escape siga cubriendo lo que tiene que cubrir: sin esto, buscar "100%"
  -- pasaría a matchear cualquier cosa.
  v_qu   := app.unaccent_immutable(v_q);
  v_like := '%' || replace(replace(replace(v_qu, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- -------------------------------------------------------------------------
  -- PERSONAS
  --
  -- El filtro de tenant lo pone la RPC, no la RLS: profiles_select es
  -- `using(true)` porque el perfil es contenido público (SEO). Acá buscamos
  -- DENTRO de la comunidad.
  -- No aparece quien tenga bloqueo con vos en cualquier dirección
  -- (app.pair_blocked): el buscador no puede ser la puerta de atrás que devuelve
  -- a alguien que bloqueaste al alcance de un clic.
  --
  -- app.unaccent_immutable(p.display_name) tiene que quedar TAL CUAL en el WHERE
  -- y en el ORDER BY: es la expresión indexada por
  -- profiles_display_name_unaccent_trgm_idx. Cualquier variante (un lower() de
  -- más, otro orden) devuelve lo mismo pero por seq scan.
  --
  -- SÓLO CON SESIÓN. Sin sesión esta rama no corre: este SELECT le daría 42501 a
  -- `anon` (no tiene grant sobre `profiles.tenant_id`, 0058), y aunque lo tuviera,
  -- una RPC abierta a la anon key arma el padrón. Los visitantes van por
  -- `public.buscar_personas_visitante`, que sólo ejecuta service_role.
  -- -------------------------------------------------------------------------
  if v_uid is not null then
    return query
    select 'personas'::text,
           p.id,
           p.display_name,
           p.area_label,
           p.avatar_url,
           '/perfil/' || p.id::text,
           extensions.similarity(app.unaccent_immutable(p.display_name), v_qu)::real
      from public.profiles p
     where p.tenant_id = v_tenant
       and p.account_status <> 'banned'
       and app.unaccent_immutable(p.display_name) ilike v_like escape '\'
       and not app.pair_blocked(v_uid, p.id)
     order by extensions.similarity(app.unaccent_immutable(p.display_name), v_qu) desc,
              p.display_name
     limit v_limit;
  end if;

  -- -------------------------------------------------------------------------
  -- AVISOS — los 6 verticales en UNA sola pasada
  --
  -- Un solo scan de listings_search_idx con row_number() por kind, en vez de 6
  -- queries idénticas con LIMIT cada una. El tope por tipo sale de la ventana.
  --
  -- `creator_gig` queda AFUERA a propósito: Colaboraciones no es uno de los
  -- grupos del buscador global (§1 del contrato) y el módulo abre recién en
  -- 3-4 meses (§6). El `kind in (...)` mantiene el CASE total: ningún kind
  -- nuevo puede colarse con href nulo.
  --
  -- status = 'published': la RLS le deja ver al dueño sus borradores, pero un
  -- borrador en el buscador global es ruido — un resultado tiene que ser un
  -- destino real.
  --
  -- href de 'business': /marketplace/tienda/{id} — la tienda ES un listing
  -- kind='business' y esa es su única página de detalle hoy (/negocios no tiene
  -- ruta [id]).
  -- -------------------------------------------------------------------------
  return query
  select v.result_type, v.id, v.title, v.subtitle, v.image_url, v.href, v.rank
    from (
      select case l.kind
               when 'property'     then 'propiedades'
               when 'business'     then 'negocios'
               when 'professional' then 'profesionales'
               when 'event'        then 'eventos'
               when 'job'          then 'empleos'
               when 'service'      then 'empleos'
               when 'product'      then 'marketplace'
             end                                        as result_type,
             l.id                                       as id,
             l.title                                    as title,
             l.area_label                               as subtitle,
             nullif(btrim(coalesce(l.photos[1], '')), '') as image_url,
             case l.kind
               when 'property'     then '/propiedades/'
               when 'business'     then '/marketplace/tienda/'
               when 'professional' then '/profesionales/'
               when 'event'        then '/eventos/'
               when 'job'          then '/empleos/'
               when 'service'      then '/empleos/'
               when 'product'      then '/marketplace/'
             end || l.id::text                          as href,
             ts_rank(l.search, v_ts)                    as rank,
             row_number() over (
               partition by (case when l.kind = 'service' then 'job' else l.kind end)
               order by ts_rank(l.search, v_ts) desc,
                        l.published_at desc nulls last,
                        l.id desc
             )                                          as rn
        from public.listings l
       where l.tenant_id = v_tenant
         and l.status = 'published'
         and l.kind in ('property', 'business', 'professional', 'event', 'job',
                        'service', 'product')
         and l.search @@ v_ts
         and not app.cuenta_baneada(l.created_by)
    ) v
   where v.rn <= v_limit;

  -- -------------------------------------------------------------------------
  -- VIDEOS y PUBLICACIONES — también en una sola pasada
  --
  -- Los dos grupos salen de `posts` y son MUTUAMENTE EXCLUYENTES: un post con
  -- video cae en 'videos', el resto en 'publicaciones'. Sin esa exclusión, el
  -- mismo post aparecería dos veces en la misma pantalla.
  --
  -- image_url de un video PUEDE SER LA RUTA DEL VIDEO (posts.media mezcla fotos
  -- y videos sin orden garantizado). La app ya sabe distinguirlo con
  -- mediaKindOf() y renderizar un <video> en vez de un <img>.
  -- -------------------------------------------------------------------------
  return query
  select v.result_type, v.id, v.title, v.subtitle, v.image_url, v.href, v.rank
    from (
      select case when app.media_has_video(p.media) then 'videos' else 'publicaciones' end
                                                        as result_type,
             p.id                                       as id,
             left(btrim(p.body), 80)                    as title,
             app.nombre_publico(p.author_id)            as subtitle,
             nullif(btrim(coalesce(p.media[1], '')), '') as image_url,
             case when app.media_has_video(p.media)
                  then app.video_post_href(p.id)
                  else '/feed/' || p.id::text
             end                                        as href,
             ts_rank(p.search, v_ts)                    as rank,
             row_number() over (
               partition by app.media_has_video(p.media)
               order by ts_rank(p.search, v_ts) desc, p.created_at desc, p.id desc
             )                                          as rn
        from public.posts p
       where p.tenant_id = v_tenant
         and p.status = 'published'
         -- Lo que el autor ocultó (0097) sólo lo sigue viendo él.
         and (p.hidden_at is null or p.author_id = v_uid)
         and p.search @@ v_ts
         and not app.cuenta_baneada(p.author_id)
         and (v_uid is null or not app.pair_blocked(v_uid, p.author_id))
    ) v
   where v.rn <= v_limit;

  return;
end;
$function$;

-- La vara pide texto sin emojis: el aviso legal de las guías ya se lee solo.
update public.guides
   set body_md = replace(body_md, '⚠️ ', '')
 where body_md like '%⚠️%';
