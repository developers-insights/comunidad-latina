-- =============================================================================
-- 0182_busqueda_publica_y_antiguedad_real.sql — Comunidad Latina
--
-- Dos arreglos del QA, en un solo archivo para reservar un solo número.
--
-- ─── 1 · B01: LA BÚSQUEDA GENERAL NO DEVOLVÍA NADA A LOS VISITANTES ──────────
--
-- `global_search` sacaba la comunidad de `app.current_tenant_id()`, o sea del
-- JWT. Un visitante no tiene JWT de usuario, así que siempre daba NULL y la RPC
-- volvía vacía sin mirar ninguna tabla. Lo confirma la base con la anon key:
--     rpc/global_search {"q":"Bizcocho"}                 → 200 []
--     listings?title=ilike.*Bizcocho*                    → 200 [1 fila publicada]
-- Es decir: el aviso se ve en el sitio pero el buscador no lo encuentra.
--
-- QUÉ CAMBIA
--   · Nuevo parámetro `p_tenant`, que SÓLO cuenta sin sesión. Con sesión se ignora,
--     y el comportamiento es idéntico al de antes.
--   · Avisos y publicaciones siguen por SECURITY INVOKER: la RLS de `anon` ya los
--     deja leer y el filtro de `status = 'published'` no se toca. `p_tenant` no abre
--     nada: sin sesión, los avisos y publicaciones de cualquier comunidad ya eran
--     públicos (`listings_select`, `posts_select`), que es lo que hace que las
--     páginas de detalle funcionen para Google. Lo que sí se agrega para visitantes
--     es `p.hidden_at is null`: lo que el autor ocultó no sale en una búsqueda
--     pública. Con sesión esa rama no cambia.
--   · PERSONAS NO SALE DE `global_search` SIN SESIÓN. La lista de personas de una
--     comunidad es un padrón (§5.4). Con la anon key, que es pública, cualquiera
--     podría barrerlo llamando a la RPC directo con "aaa", "aab"…, y ningún rate
--     limit de la app lo frenaría porque ni pasa por la app.
--
-- PERSONAS PARA VISITANTES
--   `public.buscar_personas_visitante` sólo la ejecuta `service_role`. La llama
--   `/buscar/api` con el admin client, con la comunidad que resolvió el servidor
--   desde el dominio y detrás de un rate limit por IP más bajo que el general: el
--   visitante nunca elige la comunidad ni llega a la función directo. Devuelve lo
--   que el perfil público ya muestra (id, display_name, area_label, avatar_url),
--   mínimo 3 letras, máximo 5 resultados, sólo cuentas activas. El patrón LIKE se
--   arma adentro, así que quien la llama no puede mandar un `%` suelto.
--
-- ─── 2 · F05: "HACE 8 MESES" CON ALTA EN JULIO ───────────────────────────────
--
-- `trust_scores.signals.months_in_community` lo escribió el seed una vez y nadie
-- lo volvió a tocar: `app.recalc_user_score` (0037) usa `created_at` para el
-- puntaje, pero sólo escribe `factors`. La hoja de Trust Score leía ese número
-- congelado.
--
-- `app.sincronizar_antiguedad()` lo recalcula desde `profiles.created_at`, que
-- pasa a ser la única fuente: corre una vez acá y después todas las noches. Las
-- pantallas de perfil ya lo calculan directo de la fecha
-- (`mesesEnLaComunidad`, lib/trust/signals.ts); esto arregla las otras, que
-- leen el jsonb. Los perfiles del seed van a mostrar su antigüedad REAL en vez
-- de la inventada: es lo que se pidió, pero el número de esas cuentas baja.
--
-- ORDEN DE DESPLIEGUE: conviene esta migración antes que el código, pero el orden
-- inverso ya no rompe. Sin ella, `/buscar/api` recibe PGRST202 y un visitante ve la
-- pantalla vacía de hoy en vez de un error.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · global_search con comunidad explícita para visitantes
--
-- DROP y no `create or replace`: agregar un parámetro crea una SOBRECARGA, y dos
-- firmas compatibles hacen que PostgREST conteste PGRST203. Las llamadas de dos
-- argumentos siguen funcionando por el DEFAULT.
-- ---------------------------------------------------------------------------
drop function public.global_search(text, int);

create function public.global_search(
  q               text,
  limit_per_type  int default 5,
  p_tenant        uuid default null
)
returns table (
  result_type text,
  id          uuid,
  title       text,
  subtitle    text,
  image_url   text,
  href        text,
  rank        real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
             au.display_name                            as subtitle,
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
        join public.profiles au on au.id = p.author_id
       where p.tenant_id = v_tenant
         and p.status = 'published'
         -- Lo que el autor ocultó (0097) no se le muestra a un visitante.
         and (v_uid is not null or p.hidden_at is null)
         and p.search @@ v_ts
         and (v_uid is null or not app.pair_blocked(v_uid, p.author_id))
    ) v
   where v.rn <= v_limit;

  return;
end;
$$;

comment on function public.global_search(text, int, uuid) is
  'Búsqueda global agrupada por tipo, una sola ida. INSENSIBLE A LOS ACENTOS desde 0052. La comunidad sale del JWT; SIN SESIÓN (0182) sale de p_tenant, y con sesión p_tenant se ignora. SECURITY INVOKER: la RLS de cada tabla decide qué ve cada quien. Sin sesión NO devuelve personas (es un padrón, y esta RPC está abierta a la anon key): van por buscar_personas_visitante. Tampoco publicaciones ocultas por su autor. Devuelve VACÍO —no error— si q tiene menos de 2 caracteres o si no hay comunidad. q se recorta a 80 caracteres y limit_per_type se clampa a [1,20]. `rank` ordena DENTRO del grupo. `image_url` sale crudo (ruta de Storage o URL absoluta): lo resuelve la app.';

revoke execute on function public.global_search(text, int, uuid) from public;
grant execute on function public.global_search(text, int, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · Personas para visitantes: sólo service_role
--
-- Vive en `public` porque el admin client llega por PostgREST, y `app` no está
-- expuesto. SECURITY INVOKER porque quien la ejecuta ya es service_role: no hace
-- falta elevar nada. Mismas columnas y mismo orden que `global_search`, para que
-- `/buscar/api` junte las filas sin traducir.
--
-- `app.unaccent_immutable(p.display_name)` queda TAL CUAL: es la expresión de
-- profiles_display_name_unaccent_trgm_idx.
-- ---------------------------------------------------------------------------
create function public.buscar_personas_visitante(
  p_tenant uuid,
  q        text
)
returns table (
  result_type text,
  id          uuid,
  title       text,
  subtitle    text,
  image_url   text,
  href        text,
  rank        real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q    text := left(btrim(coalesce(q, '')), 80);
  v_qu   text;
  v_like text;
begin
  if p_tenant is null or char_length(v_q) < 3 then
    return;
  end if;

  v_qu   := app.unaccent_immutable(v_q);
  v_like := '%' || replace(replace(replace(v_qu, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select 'personas'::text,
         p.id,
         p.display_name,
         p.area_label,
         p.avatar_url,
         '/perfil/' || p.id::text,
         extensions.similarity(app.unaccent_immutable(p.display_name), v_qu)::real
    from public.profiles p
   where p.tenant_id = p_tenant
     and p.account_status = 'active'
     and app.unaccent_immutable(p.display_name) ilike v_like escape '\'
   order by extensions.similarity(app.unaccent_immutable(p.display_name), v_qu) desc,
            p.display_name
   limit 5;
end;
$$;

comment on function public.buscar_personas_visitante(uuid, text) is
  'Rama "personas" del buscador para quien no tiene sesión. EXECUTE sólo para service_role: la llama /buscar/api con la comunidad del dominio y detrás de un rate limit por IP. Abierta a la anon key sería un padrón de la comunidad (§5.4). Tope fijo: 3 letras mínimo, 5 resultados, cuentas activas; el patrón LIKE se arma adentro.';

revoke execute on function public.buscar_personas_visitante(uuid, text) from public, anon, authenticated;
grant execute on function public.buscar_personas_visitante(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3 · Antigüedad real en trust_scores.signals
-- ---------------------------------------------------------------------------
create function app.sincronizar_antiguedad()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  with calculado as (
    select ts.profile_id,
           to_jsonb((extract(year from edad) * 12 + extract(month from edad))::int) as meses
      from public.trust_scores ts
      join public.profiles p on p.id = ts.profile_id
     cross join lateral age(now(), p.created_at) as edad
  )
  update public.trust_scores ts
     set signals = jsonb_set(ts.signals, '{months_in_community}', c.meses)
    from calculado c
   where c.profile_id = ts.profile_id
     and ts.signals -> 'months_in_community' is distinct from c.meses;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

comment on function app.sincronizar_antiguedad() is
  'Reescribe trust_scores.signals.months_in_community desde profiles.created_at (meses calendario completos, la misma regla que mesesEnLaComunidad en lib/trust/signals.ts). Toca sólo las filas que cambian. La corre pg_cron todas las noches. Antes de 0182 ese número era el del seed y no se movía nunca.';

revoke execute on function app.sincronizar_antiguedad() from public, anon, authenticated;

select app.sincronizar_antiguedad();

select cron.schedule(
  'sincronizar-antiguedad',
  '30 4 * * *',
  $$select app.sincronizar_antiguedad()$$
);

-- Sin esto PostgREST sigue con la firma vieja en caché hasta el próximo reinicio.
notify pgrst, 'reload schema';

commit;
