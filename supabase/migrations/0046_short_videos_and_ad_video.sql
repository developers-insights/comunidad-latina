-- =============================================================================
-- 0046_short_videos_and_ad_video.sql — Comunidad Latina
-- VIDEOS CORTOS vs. VIDEO PUBLICITARIO (feedback consolidado 2026-07-30 §4).
--
-- Dos objetos que hasta hoy eran el mismo "post con un .mp4 adentro":
--   * short_video       — ≤ 90 s, orgánico, ES el scroll de Videos Cortos;
--   * advertising_video — ≤ 10 min, atado a una campaña paga, y NUNCA en el
--                         scroll: se reproduce dentro del anuncio y vuelve al
--                         anuncio.
--
-- POR QUÉ LA REGLA VIVE ACÁ Y NO EN LA APP. El feed de reels filtra por
-- `eligible_for_short_feed`. Si esa columna miente, miente la superficie
-- entera: un video de 10 minutos pagado se cuela en el scroll infinito. Un tope
-- que sólo vive en el formulario no es un tope — el mismo criterio que el §3 del
-- contrato aplica a las fotos ("el tope de la publicación gratuita es la
-- diferencia que se cobra").
--
-- POR QUÉ NO SE TOCA `listings`. El video del anuncio NO estrena columnas en
-- listings: un video publicitario es un `post` con `entity_listing_id` apuntando
-- al aviso (mecanismo de 0023) más su campaña. Ponerle un video a `listings`
-- crearía un SEGUNDO lugar donde vive un video, con su propio juego de reglas
-- de duración y su propia forma de mentir — y `listings.photos` es text[] sin
-- columna de tipo, así que ni siquiera habría dónde declarar la duración. Un
-- solo modelo de video, un solo juego de CHECKs, un solo lugar del que lee el
-- reel.
--
-- LO QUE LA BASE **NO** PUEDE GARANTIZAR (contrato para la app): la base no
-- abre el archivo. `duration_seconds` es un valor DECLARADO. La base garantiza
-- que los números declarados son coherentes entre sí (y que nada elegible dice
-- durar más de 90 s); que el número declarado corresponda al archivo real lo
-- tiene que validar la app, en el navegador (metadata antes de subir) Y en el
-- servidor, como pide la spec.
-- =============================================================================


-- =============================================================================
-- 1 · Las columnas
-- =============================================================================

alter table public.posts
  add column video_type text
    check (video_type is null or video_type in ('short_video', 'advertising_video')),
  add column duration_seconds int
    check (duration_seconds is null or duration_seconds between 1 and 36000),
  add column is_paid_ad boolean not null default false,
  add column eligible_for_short_feed boolean not null default true,
  add column video_category text
    check (video_category is null or video_category in (
      'comida', 'musica', 'eventos', 'propiedades', 'negocios',
      'humor', 'deportes', 'comunidad', 'otros'
    ));

comment on column public.posts.video_type is
  'NULL = la publicación no es un video (texto, foto, pregunta). ''short_video'' = video orgánico de ≤ 90 s, el que alimenta Videos Cortos. ''advertising_video'' = video de una campaña paga, ≤ 10 min, fuera del scroll. Después del INSERT sólo lo mueve service_role (app.protect_post_counters): pasar a ''advertising_video'' es una transición de estado PAGO, misma doctrina que boosts.status.';
comment on column public.posts.duration_seconds is
  'Duración DECLARADA del video, en segundos. NULL = desconocida (videos anteriores a esta migración). La base garantiza coherencia entre los números; que el número sea el del archivo lo valida la app en el navegador y en el servidor.';
comment on column public.posts.is_paid_ad is
  'true = esta publicación es publicidad paga y se marca "Patrocinado" (FTC honesto, mismo principio que boosts "Destacado"). No lo escribe el cliente: el INSERT lo exige en false (posts_insert) y el UPDATE lo bloquea para authenticated (app.protect_post_counters).';
comment on column public.posts.eligible_for_short_feed is
  'VETO, no afirmación. false = esta publicación NUNCA entra al scroll de Videos Cortos. true (el default) NO la mete: el reel exige además video_type = ''short_video''. Se modela como veto para que el default de una publicación de texto —que nunca va a ser un reel— no tenga que ser mantenido por nadie. Blindada contra escritura directa igual que is_paid_ad.';
comment on column public.posts.video_category is
  'Catálogo CERRADO de Videos Cortos (pedido de la call 1:20 — el menú de categorías al entrar, antes reproducía de una): comida, musica, eventos, propiedades, negocios, humor, deportes, comunidad, otros. Nullable. Es la ÚNICA de las columnas de video que el autor puede seguir editando después de publicar: re-categorizar el propio video es legítimo, cambiarse la duración o declararse pago no.';


-- =============================================================================
-- 2 · Backfill — antes de los CHECKs, para que los CHECKs se validen contra
--     datos ya coherentes
--
-- Todo video que ya existe es un Videos Cortos elegible; su duración queda en
-- NULL porque genuinamente no se sabe (nadie la midió al subirlo) y INVENTARLA
-- sería peor que no tenerla: el reel filtraría por un número falso.
-- =============================================================================
update public.posts
   set video_type = 'short_video'
 where app.media_has_video(media);

comment on table public.posts is
  'Feed social (post | question | text). published = contenido público. Counters denormalizados mantenidos por triggers (no confiar en el cliente). Desde 0046 un post puede ser además un VIDEO: video_type distingue el corto orgánico (≤90 s, va al scroll de Videos Cortos) del video publicitario (≤10 min, atado a campaña, nunca en el scroll).';


-- =============================================================================
-- 3 · Las reglas, como CHECKs de tabla
--
-- Se escriben como constraints separadas y con nombre a propósito: cuando una
-- falla, el error dice CUÁL regla se violó y la app puede traducirla a copy §4
-- sin adivinar.
-- =============================================================================

-- (a) Un corto dura 90 segundos. Tolera NULL: los videos viejos no tienen
--     duración conocida y esta migración no los rompe.
alter table public.posts
  add constraint posts_short_video_duration check (
    video_type is distinct from 'short_video'
    or duration_seconds is null
    or duration_seconds <= 90
  );

-- (b) Un video publicitario dura hasta 10 minutos, ES publicidad paga, y está
--     FUERA del scroll. Las tres cosas juntas o ninguna.
alter table public.posts
  add constraint posts_advertising_video_rules check (
    video_type is distinct from 'advertising_video'
    or (
      (duration_seconds is null or duration_seconds <= 600)
      and is_paid_ad = true
      and eligible_for_short_feed = false
    )
  );

-- (c) LA REGLA QUE SOSTIENE LA SUPERFICIE, y por eso NO cuelga de video_type:
--     nada que se declare elegible puede decir durar más de 90 s. Sin esta
--     constraint el agujero era trivial — dejás video_type en NULL, declarás
--     600 segundos, y el reel te lo come igual.
alter table public.posts
  add constraint posts_short_feed_duration check (
    eligible_for_short_feed = false
    or duration_seconds is null
    or duration_seconds <= 90
  );

-- (d) Publicidad y scroll orgánico no se mezclan, sea cual sea el video_type.
alter table public.posts
  add constraint posts_paid_ad_not_in_short_feed check (
    is_paid_ad = false or eligible_for_short_feed = false
  );

-- (e) Todo video NUEVO declara qué es y cuánto dura.
--     La cláusula de abuelo es `created_at`, no un `not valid`: un NOT VALID
--     igual se evalúa al ACTUALIZAR una fila vieja, así que editarle el texto a
--     un video de la semana pasada habría empezado a fallar. Con el corte por
--     fecha, lo viejo se puede seguir editando y lo nuevo nace completo.
--     `created_at` está congelada para authenticated (app.protect_post_counters,
--     abajo): sin eso, bastaba con backdatearse para saltear la regla.
alter table public.posts
  add constraint posts_video_declaration check (
    not app.media_has_video(media)
    or created_at < timestamptz '2026-07-31 00:00:00+00'
    or (video_type is not null and duration_seconds is not null)
  );

-- (f) Una categoría de Videos Cortos sin video no significa nada.
alter table public.posts
  add constraint posts_video_category_needs_video check (
    video_category is null or video_type is not null
  );


-- =============================================================================
-- 4 · "Un video sin campaña no puede declararse advertising_video"
--
-- Esto no entra en un CHECK: hay que mirar OTRA tabla. Va en trigger.
--
-- Y la regla tiene una forma concreta que conviene entender: en el INSERT es
-- IMPOSIBLE que exista la campaña, porque la campaña referencia al post. Así
-- que nacer 'advertising_video' se rechaza siempre; declararse publicitario es
-- una TRANSICIÓN posterior, y sólo vale si la campaña ya existe.
--
-- SIN bypass de service_role, a propósito (mismo criterio que
-- app.post_poll_votes_validate en 0041): esto no es autorización, es la
-- integridad de la palabra "Patrocinado". Un seed o una RPC con service_role
-- que marque un video como publicitario sin campaña deja a la plataforma
-- diciendo que algo es publicidad paga cuando nadie pagó nada.
--
-- 0048 la RE-CREA para aceptar también `campaigns` (que todavía no existe en
-- este punto de la secuencia). `post_promotions` sigue valiendo: es el
-- mecanismo de promoción de posts que ya está en producción desde 0023.
-- =============================================================================
create or replace function app.posts_validate_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.video_type is distinct from 'advertising_video' then
    return new; -- el 99,9% de los posts: nada que validar
  end if;

  if tg_op = 'INSERT' then
    raise exception 'AD_VIDEO_NEEDS_CAMPAIGN: un video publicitario se marca DESPUÉS de crear su campaña, nunca al publicarlo';
  end if;

  if not exists (
    select 1 from public.post_promotions pp
     where pp.post_id = new.id
       and pp.tenant_id = new.tenant_id
  ) then
    raise exception 'AD_VIDEO_NEEDS_CAMPAIGN: no hay campaña para esta publicación — no se puede declarar publicitaria';
  end if;

  return new;
end;
$$;

comment on function app.posts_validate_video() is
  'Un post sólo puede ser video_type=''advertising_video'' si tiene una campaña (post_promotions; 0048 suma campaigns). Nacer publicitario se rechaza siempre: la campaña referencia al post, así que en el INSERT no puede existir todavía. Sin bypass de service_role — es la integridad del chip "Patrocinado", no autorización.';

create trigger posts_validate_video
before insert or update on public.posts
for each row execute function app.posts_validate_video();


-- =============================================================================
-- 5 · Blindaje de las columnas de video
--
-- Re-creación COMPLETA de la guarda de counters de posts (base: 0041) sumando
-- las columnas pagas/de elegibilidad y `created_at`.
--
--   * is_paid_ad / eligible_for_short_feed / video_type / duration_seconds —
--     una policy autoriza FILAS, no COLUMNAS, y posts_update deja al autor
--     editar su post. Sin esto, cualquiera se declara "Patrocinado" o se corrige
--     la duración después de publicar un video de 10 minutos.
--   * created_at — dejó de ser auditoría el momento en que la cláusula de abuelo
--     de posts_video_declaration colgó de ella. Es la misma doctrina que 0042
--     aplicó a listings.created_by: una columna de la que cuelga una regla de
--     seguridad deja de ser un dato y pasa a ser un ancla.
--
-- `video_category` queda AFUERA: re-categorizar tu propio video es legítimo.
-- =============================================================================
create or replace function app.protect_post_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno de counters (trigger sobre trigger)
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.like_count is distinct from old.like_count
     or new.comment_count is distinct from old.comment_count
     or new.view_count is distinct from old.view_count
     or new.poll_yes_count is distinct from old.poll_yes_count
     or new.poll_no_count is distinct from old.poll_no_count then
    raise exception 'PROTECTED_COLUMNS: like_count/comment_count/view_count/poll_yes_count/poll_no_count solo se actualizan por triggers';
  end if;
  if new.poll_kind is distinct from old.poll_kind
     and (old.poll_yes_count > 0 or old.poll_no_count > 0) then
    raise exception 'PROTECTED_TRANSITION: no se puede cambiar ni quitar la encuesta de una pregunta que ya tiene votos';
  end if;
  if new.video_type is distinct from old.video_type
     or new.duration_seconds is distinct from old.duration_seconds
     or new.is_paid_ad is distinct from old.is_paid_ad
     or new.eligible_for_short_feed is distinct from old.eligible_for_short_feed then
    raise exception 'PROTECTED_COLUMNS: video_type/duration_seconds/is_paid_ad/eligible_for_short_feed se fijan al publicar; pasar a publicitario es una transición de campaña (server-side)';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'PROTECTED_COLUMNS: created_at no se puede modificar';
  end if;
  return new;
end;
$$;

comment on function app.protect_post_counters() is
  'Bloquea manipulación directa de counters de posts (like_count, comment_count, view_count, poll_yes_count, poll_no_count), congela poll_kind una vez que la encuesta tiene votos, y desde 0046 congela también las columnas de video (video_type, duration_seconds, is_paid_ad, eligible_for_short_feed) y created_at — de created_at cuelga la cláusula de abuelo de posts_video_declaration.';

-- ---------------------------------------------------------------------------
-- Re-creación de posts_insert (base: 0041) — un post no puede NACER publicitario
--
-- La guarda de arriba es BEFORE UPDATE, así que sin esto se insertaba con
-- is_paid_ad = true por PostgREST y quedaba "Patrocinado" gratis. Mismo espíritu
-- que like_count = 0 (0007), view_count = 0 (0038) y poll_*_count = 0 (0041).
-- El rechazo de video_type='advertising_video' lo hace además el trigger; acá
-- va también porque la policy es la barrera que el enumerador audita.
-- Todo lo demás queda igual.
-- ---------------------------------------------------------------------------
drop policy posts_insert on public.posts;
create policy posts_insert on public.posts
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status in ('published', 'pending_review')
  and like_count = 0
  and comment_count = 0
  and view_count = 0
  and poll_yes_count = 0
  and poll_no_count = 0
  and is_paid_ad = false
  and video_type is distinct from 'advertising_video'
  and (
    entity_listing_id is null
    or exists (
      select 1 from public.listings l
      where l.id = posts.entity_listing_id
        and l.tenant_id = posts.tenant_id
        and l.created_by = (select auth.uid())
        and l.status = 'published'
    )
  )
);


-- =============================================================================
-- 6 · Índices del scroll de Videos Cortos
--
-- Hasta hoy el reel traía posts por fecha y descartaba en la app los que no
-- tenían video (ver el comentario de src/app/(app)/videos/queries.ts: "posts.media
-- es text[] sin columna de tipo"). Con `video_type` eso pasa a ser un predicado
-- real, y estos dos índices parciales cubren los dos recorridos que existen:
--
--   (a) "Para ti"  → todo el reel por fecha;
--   (b) una categoría del menú de entrada → filtrada, también por fecha.
--
-- Son dos y no uno porque con `video_category` en el medio el índice no puede
-- entregar el orden por fecha del recorrido (a). Ambos son parciales sobre un
-- subconjunto chico (sólo cortos publicados y elegibles), así que pesan poco.
-- El recorrido por VERTICAL (scope=propiedades|negocios|…) es otra cosa: sale
-- de entity_listing_id y lo sigue sirviendo posts_entity_idx (0023).
-- =============================================================================
create index posts_short_feed_idx
  on public.posts (tenant_id, created_at desc, id desc)
  where status = 'published' and eligible_for_short_feed and video_type = 'short_video';

create index posts_short_feed_category_idx
  on public.posts (tenant_id, video_category, created_at desc, id desc)
  where status = 'published' and eligible_for_short_feed and video_type = 'short_video';


-- =============================================================================
-- 7 · El video publicitario deja de linkear al reel
--
-- Re-creación de app.video_post_href (0044). Un resultado de búsqueda de tipo
-- 'videos' que sea publicitario tiene que abrir SU PUBLICACIÓN, no el scroll:
-- los videos publicitarios sí aparecen en búsqueda (marcados "Patrocinado", §4
-- del contrato), pero mandarlos a /videos?start=… sería un link a un lugar
-- donde ese video, por definición, no está.
--
-- Ocho líneas en vez de duplicar global_search() entera — que es exactamente
-- para lo que 0044 la separó.
-- =============================================================================
create or replace function app.video_post_href(p_post_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when exists (
             select 1 from public.posts p
              where p.id = p_post_id
                and p.video_type = 'short_video'
                and p.eligible_for_short_feed
           )
           then '/videos?start=' || p_post_id::text
           else '/feed/' || p_post_id::text
         end;
$$;

comment on function app.video_post_href(uuid) is
  'Destino de un resultado de búsqueda de tipo ''videos''. Corto elegible → el reel (/videos?start=id). Cualquier otro video (publicitario, o excluido del scroll) → su publicación (/feed/id), donde se reproduce en su contexto. Usada por public.global_search (0044); separada de la RPC justamente para poder cambiar el ruteo sin duplicarla.';
