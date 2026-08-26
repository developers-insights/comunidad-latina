-- =============================================================================
-- 0114_video_por_mux.sql — Comunidad Latina
--
-- El camino de video por Mux: cinco columnas en `posts`, un estado `draft` para
-- que la publicación pueda existir mientras el video todavía se está subiendo,
-- y una bandeja de eventos de webhook propia con reclamo atómico.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ PROBLEMA RESUELVE, PORQUE NO ES "OTRO PROVEEDOR MÁS"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hoy el composer sube el video DIRECTO al bucket `post-media` y el navegador
-- lo reproduce tal cual llegó. Eso obliga a dos límites que no son caprichos:
-- 60 MB y sólo mp4/webm/quicktime. No son límites de almacenamiento — son los
-- únicos formatos que un navegador sabe decodificar. Un `.avi`, un `.mkv` o un
-- `.mov` grabado en HEVC entrarían al bucket sin queja y darían una publicación
-- con un `<video>` en negro. O sea: subida exitosa, publicación rota.
--
-- Mux transcodifica CUALQUIER entrada y entrega HLS adaptativo. El precio de
-- eso es que el video deja de estar listo en el momento en que termina la
-- subida: hay una ventana de procesamiento que dura de segundos a minutos y que
-- termina con un webhook. Toda esta migración existe para modelar esa ventana
-- sin mentirle a nadie mientras dura.
--
-- ── ESTO NO REEMPLAZA AL BUCKET ─────────────────────────────────────────────
-- Sin claves de Mux configuradas la app sigue funcionando EXACTAMENTE como hoy:
-- el composer sube al bucket con sus límites de siempre y estas columnas quedan
-- todas en NULL. El camino de Mux se ENCIENDE cuando está configurado; no es un
-- reemplazo y no hay ningún comportamiento nuevo que dependa de que falte una
-- credencial. (`isMuxConfigured` en `src/lib/config/services.ts`; el porqué de
-- esa forma —y de por qué "sin configurar" nunca puede significar "hacé algo
-- distinto y peor"— está en el docblock de `isPagosDemoPermitido`, al lado.)
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ LAS COLUMNAS VAN EN `posts` Y NO EN UNA TABLA SATÉLITE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `posts` YA es donde vive el video: `video_type`, `duration_seconds`,
-- `eligible_for_short_feed`, `video_category` (0046) y `media_filters` (0104)
-- están todas ahí. Una tabla `post_mux_assets` aparte obligaría a un JOIN en
-- `app.feed_page` (0113) y en el scroll de Videos Cortos, que son las dos
-- consultas más calientes del producto, a cambio de cinco columnas nullable que
-- un post de texto ni mira. El JOIN costaría más que las columnas.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `status = 'draft'`: LA PUBLICACIÓN EXISTE ANTES QUE EL VIDEO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El flujo de Direct Upload necesita un identificador NUESTRO antes de que
-- exista un solo byte en Mux: se crea la subida, se le pasa el id del post como
-- `passthrough`, y recién entonces el navegador empieza a mandar el archivo. La
-- fila del post tiene que existir primero.
--
-- Se agrega `'draft'` al CHECK de `posts.status` en vez de inventar una tabla de
-- borradores porque `listings` ya resolvió exactamente esto igual (empleos,
-- marketplace, gigs de creadores: nacen `draft` y una segunda action los
-- publica). Repetir el patrón que el equipo ya conoce vale más que uno nuevo.
--
-- ── LO IMPORTANTE: LAS POLICIES YA ESTABAN BIEN Y NO HAY QUE TOCARLAS ───────
-- Vale la pena decirlo explícito porque parece un olvido y no lo es:
--
--   · `posts_select` (0091) — la rama de autor es `tenant_id = current_tenant_id
--     and author_id = auth.uid()`, SIN filtrar por status. El borrador lo ve su
--     autor (y staff), nadie más. El feed no lo ve porque `app.feed_page` filtra
--     `status = 'published'` explícito, y la rama pública de la policy también.
--   · `posts_insert` (0046) — exige `status in ('published','pending_review')`.
--     O sea que un cliente NO puede crear un borrador aunque quiera: el único
--     que puede es el servidor con service_role, que es lo que hace la ruta de
--     subida. No es un efecto lateral, es la propiedad que queremos.
--   · `posts_update` (0110) — el USING deja al autor editar mientras el post no
--     esté `removed` (un borrador no lo está) y el WITH CHECK exige que el
--     resultado quede en `published` o `pending_review`. Traducido: el autor
--     puede sacar su borrador a la luz, y NO puede meter de vuelta en borrador
--     algo ya publicado. Es exactamente la transición que hace falta, en una
--     sola dirección, y ya estaba escrita.
--
-- Ninguna de las tres cambia acá. La única regla nueva es el CHECK de la
-- columna.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BLINDAJE: UNA POLICY AUTORIZA FILAS, NO COLUMNAS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `posts_update` deja al autor editar su propio post. Sin blindaje eso alcanza
-- para PATCHear por PostgREST `mux_playback_id` con el playback id de CUALQUIER
-- otro video público de Mux —del mundo, no de la app— y quedarse con la autoría
-- de contenido ajeno; o poner `mux_status = 'ready'` a mano y dejar un
-- reproductor apuntando a la nada. Es el mismo agujero que 0046 cerró para
-- `is_paid_ad` ("cualquiera se declara Patrocinado") y se cierra igual: las
-- cinco columnas se congelan para `authenticated` dentro de
-- `app.protect_post_counters()`. Las escribe el servidor o no las escribe nadie.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LA BANDEJA DE EVENTOS: MISMA FORMA QUE `payment_events`, TABLA DISTINTA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `payment_events` (0008 + 0111) tiene la forma correcta y probada, pero es de
-- PLATA: su retención está atada a la PII de billing de Stripe, su índice de
-- pendientes es el que se mira en una conciliación de cobros, y su auditoría
-- responde preguntas de facturación. Meter eventos de transcodificación ahí
-- ensucia las tres cosas para siempre. Se copia la forma, no la tabla.
--
-- Lo que se copia, y por qué cada pieza:
--
--   · `(provider, event_id)` UNIQUE — es el punto de serialización. Ante dos
--     entregas simultáneas del mismo evento exactamente una gana el INSERT y la
--     otra recibe 23505.
--   · `claimed_at` con RECLAMO ATÓMICO — la pieza que 0111 agregó y la razón por
--     la que leer `processed` NO alcanza: `processed = false` es también el
--     estado MIENTRAS la ganadora está trabajando, así que la rama pensada para
--     "el intento anterior murió" se disparaba igual con el anterior vivo, y las
--     dos procesaban. El reclamo se resuelve en un solo UPDATE condicional:
--     se lo lleva quien encuentre `claimed_at` nulo o vencido.
--   · La VENTANA DE 5 MINUTOS del reclamo — un reclamo sin vencimiento cambia un
--     duplicado por un evento que nadie va a procesar nunca. Cinco minutos es
--     holgado contra el techo de 300 s de una función de Vercel: si el proceso
--     que lo tomó siguiera vivo, ya se pasó del tiempo que la plataforma le da.
--
-- Lo que NO se copia: el payload de Mux no tiene PII (ids de asset, duraciones,
-- resoluciones), así que no hereda la purga a 90 días de `payment_events`, que
-- existe por los `billing_details` de Stripe. Igual conviene podarla algún día
-- por volumen; cuando toque, el índice de `received_at` ya está.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Las cinco columnas de Mux en `posts`
-- ---------------------------------------------------------------------------

alter table public.posts
  add column if not exists mux_upload_id        text,
  add column if not exists mux_asset_id         text,
  add column if not exists mux_playback_id      text,
  add column if not exists mux_status           text,
  add column if not exists mux_duration_seconds numeric(10, 3);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_mux_status_check'
  ) then
    alter table public.posts
      add constraint posts_mux_status_check
      check (
        mux_status is null
        or mux_status in ('uploading', 'processing', 'ready', 'errored')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'posts_mux_duration_check'
  ) then
    alter table public.posts
      add constraint posts_mux_duration_check
      check (mux_duration_seconds is null or mux_duration_seconds > 0);
  end if;
end $$;

comment on column public.posts.mux_upload_id is
  'Id de la Direct Upload de Mux. Lo escribe el servidor con la respuesta de la API de Mux, JAMÁS el cliente. Es la CLAVE DE CORRELACIÓN del webhook: el evento llega desde afuera y este id es el único dato de la correlación que salió de nuestro propio servidor, así que es el que manda. UNIQUE parcial: dos publicaciones no pueden reclamar la misma subida.';

comment on column public.posts.mux_asset_id is
  'Id del Asset de Mux una vez creado a partir de la subida. Sirve para operar contra la API de Mux (borrar el asset cuando se borra la publicación, consultar estado). No se usa para reproducir: eso es el playback id.';

comment on column public.posts.mux_playback_id is
  'Playback id PÚBLICO. Con él se arman la URL de HLS (stream.mux.com/<id>.m3u8) y la miniatura (image.mux.com/<id>/thumbnail.jpg) sin firmar nada. La política es "public" a propósito: el contenido de la comunidad es público y un playback firmado obligaría a emitir un JWT por reproducción para proteger algo que no está protegido. Congelado contra escritura directa (app.protect_post_counters): sin eso, cualquiera PATCHea el playback id de un video ajeno y se queda con la autoría.';

comment on column public.posts.mux_status is
  'Dónde está el video en el camino de Mux: uploading (se creó la subida, el archivo está viajando) → processing (Mux ya tiene el archivo y lo está transcodificando) → ready (hay playback id, se puede reproducir) | errored. NULL = esta publicación no pasa por Mux (texto, foto, o video del camino viejo por bucket). Lo mueve el webhook con service_role; para authenticated está congelado.';

comment on column public.posts.mux_duration_seconds is
  'Duración REAL medida por Mux, con decimales. Distinta de `duration_seconds` (0046), que es un entero declarado del lado de la app y del que cuelgan las reglas del scroll de Videos Cortos (≤ 90 s) y de la publicidad (≤ 10 min). Se guardan las dos a propósito: ésta es el hecho medido, aquélla la declaración sobre la que se aplican las reglas. El webhook NO pisa `duration_seconds` — cambiar la declaración después de publicar es justo lo que 0046 blindó.';

-- ---------------------------------------------------------------------------
-- 2 · `draft` como estado válido de una publicación
--
-- El CHECK original (0007) es inline, así que Postgres lo nombró solo. Se lo
-- busca por definición en vez de por nombre: si alguna vez se re-creó con otro
-- nombre, un `drop constraint if exists posts_status_check` sería un no-op
-- silencioso y el CHECK viejo —el que prohíbe 'draft'— seguiría vivo. Esa falla
-- no se vería acá: se vería en producción, como una subida de video que no
-- puede ni empezar.
-- ---------------------------------------------------------------------------

do $$
declare
  v_constraint text;
begin
  select con.conname
    into v_constraint
    from pg_constraint con
    join pg_class     rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'posts'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%status%'
     and pg_get_constraintdef(con.oid) like '%pending_review%'
     and pg_get_constraintdef(con.oid) not like '%draft%'
   limit 1;

  if v_constraint is not null then
    execute format('alter table public.posts drop constraint %I', v_constraint);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'posts_status_check'
  ) then
    alter table public.posts
      add constraint posts_status_check
      check (status in ('draft', 'published', 'removed', 'pending_review'));
  end if;
end $$;

comment on column public.posts.status is
  'draft = la publicación existe pero todavía no es de nadie más que de su autor: nace así SOLO por el camino de video de Mux (0114), donde la fila tiene que existir antes de que el archivo empiece a viajar. published = contenido público. pending_review = cola de moderación. removed = bajada. El cliente no puede crear un draft (posts_insert exige published|pending_review) ni volver a uno (el WITH CHECK de posts_update exige lo mismo): el borrador lo crea el servidor y sólo se sale de él hacia adelante.';

-- ---------------------------------------------------------------------------
-- 2 bis · EL AGUJERO QUE ABRE `draft`, CERRADO EN EL MISMO ARCHIVO
--
-- ⚠️ Esto NO es una mejora oportunista. Es reparar, en el acto, algo que rompe
-- la sección anterior de esta misma migración.
--
-- Tres triggers vigilan quién puede publicar, y los tres son BEFORE **INSERT**:
--
--   · app.enforce_account_active  (0021) — cuenta suspendida o baneada no publica.
--   · app.enforce_social_active   (0033) — restricción social vigente no publica.
--   · app.posts_require_media     (0023) — feed visual: todo post nuevo lleva algo.
--
-- Los tres dejan pasar a `service_role` (`auth.uid()` nulo), y con razón: son
-- para seeds y crons. Pero el borrador de Mux lo crea justamente `service_role`
-- —no queda otra: `posts_insert` prohíbe nacer en `draft`— y el paso siguiente,
-- publicarlo, es un UPDATE. O sea que sin esto el camino de video se convertiría
-- en el ÚNICO por el que una cuenta suspendida puede publicar en el feed, y en
-- el único donde una publicación puede salir completamente vacía. Nadie lo vería
-- en una prueba manual: el que prueba no está suspendido.
--
-- El arreglo es angosto A PROPÓSITO. Se dispara SÓLO en la transición que esta
-- migración inventa —salir de `draft`— y en ninguna otra. Colgarles a los tres
-- guards un BEFORE UPDATE general sobre `posts` cambiaría el comportamiento de
-- toda edición del producto (una suspensión pasaría a impedir corregir un typo
-- en un post viejo), que es una decisión de producto que nadie tomó y que no le
-- toca a esta migración.
-- ---------------------------------------------------------------------------

create or replace function app.enforce_draft_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /**
   * Sólo el momento de SACAR EL BORRADOR A LA LUZ. Nada más.
   *
   * `removed` queda deliberadamente afuera: bajar algo nunca puede requerir
   * permiso de publicar, y si el chequeo de contenido corriera también ahí, un
   * borrador roto —uno que se quedó sin `mux_upload_id` porque la limpieza de la
   * ruta falló— sería imposible de retirar.
   */
  if old.status is distinct from 'draft'
     or new.status not in ('published', 'pending_review') then
    return new;
  end if;

  -- `auth.uid()` nulo = service_role / seed / cron: pasa, igual que los tres
  -- guards originales.
  if auth.uid() is not null then
    if not app.account_active(auth.uid()) then
      raise exception 'ACCOUNT_SUSPENDED: tu cuenta está suspendida y no puede publicar ni enviar mensajes por ahora.';
    end if;
    if app.has_restriction(auth.uid(), 'social') then
      raise exception 'RESTRICTED_SOCIAL: tu cuenta tiene una restricción social temporal.';
    end if;
  end if;

  /**
   * Espejo de app.posts_require_media para este camino. Un video de Mux NO deja
   * nada en `media` —el archivo vive en Mux, no en el bucket—, así que lo que
   * cuenta como "trae algo" es tener una subida de Mux enlazada. Y alcanza con
   * la SUBIDA, no con el video ya listo: publicar mientras todavía se procesa es
   * el punto entero del flujo asincrónico.
   */
  if new.kind is distinct from 'question'
     and coalesce(array_length(new.media, 1), 0) = 0
     and new.mux_upload_id is null then
    raise exception 'POST_REQUIRES_MEDIA: una publicación no puede salir de borrador vacía';
  end if;

  return new;
end;
$$;

comment on function app.enforce_draft_publish() is
  'BEFORE UPDATE en posts, SÓLO en la transición draft → cualquier otra cosa. Repone las tres guardas que los triggers BEFORE INSERT de 0021, 0033 y 0023 no pueden aplicar en este camino: el borrador de video lo crea service_role (posts_insert prohíbe nacer draft) y publicarlo es un UPDATE, así que sin esto el camino de Mux sería el único por el que una cuenta suspendida publica en el feed. Angosto a propósito: no toca ninguna otra edición.';

drop trigger if exists posts_enforce_draft_publish on public.posts;
create trigger posts_enforce_draft_publish
before update on public.posts
for each row execute function app.enforce_draft_publish();

-- ---------------------------------------------------------------------------
-- 3 · Índices de correlación
--
-- El UNIQUE parcial es una regla de seguridad además de una de integridad: el
-- webhook busca la publicación POR `mux_upload_id`, y si dos filas pudieran
-- tener el mismo, un evento tocaría una publicación que no es la suya.
-- ---------------------------------------------------------------------------

create unique index if not exists posts_mux_upload_id_key
  on public.posts (mux_upload_id)
  where mux_upload_id is not null;

create index if not exists posts_mux_asset_id_idx
  on public.posts (mux_asset_id)
  where mux_asset_id is not null;

-- El barrido de "subidas que quedaron colgadas": nunca llegó el webhook, el
-- borrador quedó a medio camino. Sin este índice esa consulta barre `posts`
-- entera, que es la tabla más grande del producto.
create index if not exists posts_mux_pendientes_idx
  on public.posts (created_at)
  where mux_status in ('uploading', 'processing');

-- ---------------------------------------------------------------------------
-- 4 · Blindaje de las columnas de Mux
--
-- Re-creación COMPLETA de la guarda de posts (base: 0046) sumando las cinco
-- columnas nuevas. Se reescribe entera y no se parchea porque `create or
-- replace function` reemplaza el cuerpo completo: una versión parcial borraría
-- las guardas de counters, encuesta, video y created_at.
-- ---------------------------------------------------------------------------

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
  -- 0114 · las cinco de Mux. El playback id es el que más duele: una policy
  -- autoriza FILAS, y posts_update deja al autor editar la suya — sin esto,
  -- PATCHear el playback id de un video ajeno es quedarse con su autoría.
  if new.mux_upload_id is distinct from old.mux_upload_id
     or new.mux_asset_id is distinct from old.mux_asset_id
     or new.mux_playback_id is distinct from old.mux_playback_id
     or new.mux_status is distinct from old.mux_status
     or new.mux_duration_seconds is distinct from old.mux_duration_seconds then
    raise exception 'PROTECTED_COLUMNS: las columnas mux_* las escribe el webhook de Mux (server-side); el cliente no las toca';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'PROTECTED_COLUMNS: created_at no se puede modificar';
  end if;
  return new;
end;
$$;

comment on function app.protect_post_counters() is
  'Bloquea manipulación directa de counters de posts (like_count, comment_count, view_count, poll_yes_count, poll_no_count), congela poll_kind una vez que la encuesta tiene votos, congela desde 0046 las columnas de video (video_type, duration_seconds, is_paid_ad, eligible_for_short_feed) y created_at, y desde 0114 las cinco columnas de Mux (mux_upload_id, mux_asset_id, mux_playback_id, mux_status, mux_duration_seconds) — las escribe el webhook con service_role o no las escribe nadie.';

-- ---------------------------------------------------------------------------
-- 5 · Bandeja de eventos del webhook de Mux
-- ---------------------------------------------------------------------------

create table if not exists public.mux_webhook_events (
  id          uuid primary key default app.uuid_v7(),
  provider    text        not null default 'mux',
  event_id    text        not null,
  event_type  text        not null,
  payload     jsonb       not null,
  tenant_id   uuid        references public.tenants(id),
  processed   boolean     not null default false,
  claimed_at  timestamptz,
  error       text,
  received_at timestamptz not null default now(),
  constraint mux_webhook_events_provider_event_key unique (provider, event_id)
);

comment on table public.mux_webhook_events is
  'Inbox de eventos del webhook de Mux (transcodificación de video). Copia la FORMA de payment_events (0008 + 0111) y NO la tabla: aquélla es de plata, con retención atada a la PII de billing de Stripe y una auditoría que responde preguntas de facturación — mezclar eventos de video ahí ensucia las dos cosas. (provider, event_id) UNIQUE = punto de serialización; claimed_at = reclamo atómico. tenant_id se deriva de la publicación que el evento tocó, del lado del SERVIDOR, nunca del payload. Sólo service_role la toca: las cuatro policies están en false y no hay grant para anon/authenticated.';

comment on column public.mux_webhook_events.claimed_at is
  'Cuándo un proceso se adjudicó este evento. NULL = libre. El webhook lo reclama con un UPDATE condicional (claimed_at nulo o más viejo que 5 minutos) y sólo procesa si ese UPDATE devolvió fila. Sin esto, dos entregas simultáneas del mismo event_id ven las dos processed=false —que es también el estado MIENTRAS la primera trabaja— y procesan las dos. La ventana de 5 min existe para que un proceso que murió a mitad no deje el evento reclamado para siempre; es holgada contra el techo de 300 s de una función de Vercel. Mismo razonamiento y mismos números que 0111.';

comment on column public.mux_webhook_events.tenant_id is
  'Comunidad de la publicación que el evento tocó, resuelta LEYENDO esa publicación del lado del servidor. El payload de Mux viene de afuera y su `passthrough` es un eco de lo que nosotros mandamos: no es fuente de autoridad para nada, y menos para el tenant. NULL = el evento no correlacionó con ninguna publicación (subida abandonada, evento de otro entorno de Mux).';

create index if not exists mux_webhook_events_pending_idx
  on public.mux_webhook_events (received_at)
  where processed = false;

create index if not exists mux_webhook_events_reclamados_idx
  on public.mux_webhook_events (claimed_at)
  where processed = false and claimed_at is not null;

create index if not exists mux_webhook_events_tenant_idx
  on public.mux_webhook_events (tenant_id, received_at desc);

alter table public.mux_webhook_events enable row level security;
alter table public.mux_webhook_events force  row level security;

-- Las cuatro canónicas, todas en false. No es pereza: no hay ni una fila acá
-- que un miembro tenga por qué leer, y el gate de `npm run check:rls` exige
-- exactamente cuatro policies con estos nombres — una tabla "sin policies"
-- fallaría el gate, y una policy de más es una fuga.
create policy mux_webhook_events_select on public.mux_webhook_events
for select to authenticated
using (false);

create policy mux_webhook_events_insert on public.mux_webhook_events
for insert to authenticated
with check (false);

create policy mux_webhook_events_update on public.mux_webhook_events
for update to authenticated
using (false)
with check (false);

create policy mux_webhook_events_delete on public.mux_webhook_events
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- GRANTS EXPLÍCITOS
--
-- La 0085 lo dejó escrito con sangre: sin GRANT, Postgres ni llega a evaluar la
-- policy y la app queda vacía SIN UN SOLO ERROR. Toda tabla nueva termina con su
-- grant explícito, y ésta también — sólo que el suyo es más corto a propósito.
--
-- ⚠️ ESTA TABLA SE APARTA DEL PATRÓN DE LA 0102 (`grant select to anon; grant
-- select,insert,update,delete to authenticated`) Y ES DELIBERADO, no un olvido
-- del tipo que la 0085 fue a arreglar. Acá no hay nada que un miembro tenga que
-- leer ni escribir: es una bandeja de servicio. Las cuatro policies en false ya
-- lo cierran; la ausencia de grant es la segunda cerradura, en el escalón de
-- abajo. Si algún día una pantalla de admin necesita ver estos eventos, el
-- camino es una vista o una función `security definer` con su grant acotado —
-- no abrir la tabla.
-- ---------------------------------------------------------------------------

grant all on table public.mux_webhook_events to service_role;

commit;
