-- =============================================================================
-- 0090_musica_en_publicaciones.sql — Comunidad Latina
--
-- MÚSICA EN PUBLICACIONES (fotos y video corto).
--
-- DECISIÓN DE ARQUITECTURA — la música NO se mezcla dentro del archivo.
-- Se guarda como PISTA ASOCIADA y el navegador la reproduce sincronizada sobre
-- el carrusel/el video, que es lo que hacen las apps sociales en su feed.
-- El porqué, contra ESTE repo:
--
--  1. La mitad de la feature es música sobre FOTOS. Ahí no hay archivo de video
--     donde mezclar nada: mezclar obligaría a fabricar un video a partir de las
--     fotos. Una publicación de 4 fotos dejaría de ser 4 fotos.
--  2. El video sube DIRECTO del navegador al bucket con XHR y barra de progreso
--     real (`uploadVideoWithProgress` en post-composer.tsx). Meter ffmpeg.wasm
--     antes de esa subida son ~25 MB de wasm y un re-encode en el teléfono, en
--     una app cuyo feed vive en gama media.
--  3. La pista se puede cambiar o sacar DESPUÉS con un UPDATE. Con la música
--     pegada, cambiarla es volver a subir el video: se rompe el `post_views`,
--     el path del storage y lo que la cola de moderación ya revisó.
--  4. Si una licencia se cae, `music_tracks.is_active = false` apaga la pista en
--     TODAS las publicaciones a la vez. Con el audio pegado al mp4 habría que
--     re-encodear cada video publicado. Eso no es una molestia: es el riesgo
--     legal que decide la arquitectura.
--  5. El archivo original queda intacto, que es justo lo que la moderación vio.
--
-- Mezclar de verdad (ffmpeg) queda documentado como PASO 2 y en el SERVIDOR,
-- para "descargar / compartir con la música pegada" — un trabajo aparte, no el
-- camino de publicar.
--
-- Bloque §4 (storage): sigue el precedente de 0056, que ya hace DDL sobre
-- storage.objects dentro de la transacción de la migración. Si en este proyecto
-- el rol de migraciones no pudiera tocar storage.objects, ese bloque se corre a
-- mano desde el SQL Editor del Dashboard (precedente: 0025) y el resto del
-- release no se bloquea.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Catálogo de pistas
-- ---------------------------------------------------------------------------
-- `tenant_id` es NULLABLE a propósito, y es la única tabla del esquema donde lo
-- es. NULL = pista del catálogo GLOBAL de la plataforma, que todas las
-- comunidades ven; con valor = pista propia de una comunidad, invisible para
-- las demás. Ponerlo NOT NULL obligaría a duplicar el catálogo entero por cada
-- tenant nuevo (y a re-licenciarlo N veces). La policy de abajo es la que
-- garantiza que una pista de un tenant NO se filtre a otro.
--
-- `is_active` NACE EN FALSE: ninguna pista se puede elegir hasta que una
-- persona la encienda a mano después de verificar su licencia. Es el
-- interruptor legal de la feature, no una bandera de conveniencia.
create table public.music_tracks (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid references public.tenants(id),
  title                text not null check (length(btrim(title)) between 1 and 120),
  artist               text not null check (length(btrim(artist)) between 1 and 120),
  -- Segundos del archivo COMPLETO. Manda el recorte: sin esto no se puede
  -- validar que el offset elegido caiga dentro de la canción.
  duration_seconds     int not null check (duration_seconds between 5 and 900),
  -- Path dentro del bucket `music-tracks`. `global/…` o `{tenant_id}/…`.
  storage_path         text not null unique check (length(btrim(storage_path)) > 0),
  -- Qué permite hacer la licencia. 'pending' existe para poder CARGAR la ficha
  -- antes de conseguir el archivo; una fila 'pending' jamás puede activarse
  -- (ver el check `music_tracks_licencia_verificada`).
  license_kind         text not null default 'pending'
                       check (license_kind in ('pending', 'cc0', 'public_domain', 'cc_by', 'cc_by_sa', 'licensed')),
  -- De dónde salió (la página del track en la biblioteca de origen).
  source_url           text,
  -- El texto de la licencia (deed de Creative Commons, contrato, etc.).
  license_url          text,
  -- ¿La licencia OBLIGA a nombrar al autor donde suena? CC BY / CC BY-SA sí.
  attribution_required boolean not null default true,
  -- La línea EXACTA que la licencia pide mostrar. Si la licencia exige
  -- atribución, esto no puede estar vacío (ver check de abajo).
  attribution_text     text,
  category             text not null default 'general'
                       check (category in ('general', 'alegre', 'tranquila', 'urbana', 'tropical', 'romantica')),
  sort_order           int not null default 100,
  is_active            boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Una pista ACTIVA tiene que tener licencia resuelta. Con esto, encender una
  -- fila sin haber cargado la licencia es un error de la base, no un descuido
  -- que se descubre en producción.
  constraint music_tracks_licencia_verificada check (
    not is_active or license_kind <> 'pending'
  ),
  -- Texto en blanco es peor que ausente: se ve como si hubiera atribución.
  constraint music_tracks_atribucion_no_vacia check (
    attribution_text is null or length(btrim(attribution_text)) > 0
  ),
  -- Si la licencia exige nombrar al autor, una pista ACTIVA tiene que traer el
  -- texto: es lo que MusicBadge está obligado a pintar en cada publicación.
  constraint music_tracks_atribucion_obligatoria check (
    not (is_active and attribution_required) or attribution_text is not null
  )
);

comment on table public.music_tracks is
  'Catálogo de música para publicaciones. tenant_id NULL = pista global de la plataforma. is_active nace false: se enciende a mano recién cuando la licencia está verificada.';
comment on column public.music_tracks.attribution_text is
  'Línea exacta que la licencia obliga a mostrar junto a la publicación (MusicBadge). Obligatoria si attribution_required y la pista está activa.';
comment on column public.music_tracks.tenant_id is
  'NULL = catálogo global visible por todas las comunidades. Con valor = pista privada de esa comunidad (la policy de select impide que se vea desde otra).';

-- El picker lista por categoría y orden, y SIEMPRE filtra is_active.
create index music_tracks_catalogo_idx
  on public.music_tracks (is_active, category, sort_order, title);
-- La policy de select arranca por tenant_id: sin este índice la evalúa fila a fila.
create index music_tracks_tenant_idx on public.music_tracks (tenant_id);

create trigger music_tracks_set_updated_at
before update on public.music_tracks
for each row execute function extensions.moddatetime(updated_at);

alter table public.music_tracks enable row level security;
alter table public.music_tracks force row level security;

-- LECTURA: sólo pistas activas, y sólo las del catálogo global o las de MI
-- comunidad. `anon` incluido a propósito: la ATRIBUCIÓN al artista tiene que
-- verse en una publicación pública, y quien la mira sin cuenta también la ve.
-- Para anon `app.current_tenant_id()` es NULL, así que le quedan las globales.
create policy music_tracks_select on public.music_tracks
for select to anon, authenticated
using (
  (
    is_active
    and (tenant_id is null or tenant_id = (select app.current_tenant_id()))
  )
  or (select app.is_global_admin())
);

-- ESCRITURA: sólo global_admin. No es celo de más — cargar una pista es asumir
-- una licencia por toda la plataforma, y un domain_admin administra SU
-- comunidad, no el riesgo legal de todas. El camino real es el panel/servicio.
create policy music_tracks_insert on public.music_tracks
for insert to authenticated
with check ((select app.is_global_admin()));

create policy music_tracks_update on public.music_tracks
for update to authenticated
using ((select app.is_global_admin()))
with check ((select app.is_global_admin()));

create policy music_tracks_delete on public.music_tracks
for delete to authenticated
using ((select app.is_global_admin()));

-- ---------------------------------------------------------------------------
-- 2. Publicación ↔ pista
-- ---------------------------------------------------------------------------
-- TABLA APARTE y no columnas en `posts`. Tres razones concretas:
--
--  a. `POST_COLUMNS` (feed/queries.ts) es el select más caliente de la app y lo
--     usan cuatro superficies. Tres columnas más, nulas en la enorme mayoría de
--     las filas, se pagan en cada scroll del feed. Acá la fila EXISTE sólo
--     cuando hay música.
--  b. La FK a `music_tracks` con `on delete restrict` protege el catálogo: una
--     pista en uso no se puede borrar de un tirón y dejar publicaciones
--     apuntando al vacío. Esa garantía vive donde vive la relación.
--  c. Asociar música NO necesita permiso de UPDATE sobre `posts`. Con columnas,
--     `music-actions.ts` tendría que pasar por `posts_update` — la misma puerta
--     por la que se edita el cuerpo y el estado de un post. Acá la puerta es
--     propia y dice exactamente lo que permite.
--
-- La PK es `post_id`: UNA pista por publicación. Dos canciones sonando sobre la
-- misma card no es una feature, es un bug.
create table public.post_music (
  post_id       uuid primary key references public.posts(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id),
  track_id      uuid not null references public.music_tracks(id) on delete restrict,
  -- Desde qué segundo de la canción arranca el recorte (§3). El largo del
  -- recorte lo fija la app (src/lib/media/audio-track.ts) y es el mismo para
  -- todas: guardarlo por fila abriría publicaciones con recortes de 4 minutos.
  start_seconds int not null default 0 check (start_seconds >= 0 and start_seconds <= 900),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.post_music is
  'Pista asociada a una publicación (una por post). El audio NO está mezclado en el archivo: el cliente lo reproduce sincronizado sobre el carrusel/el video.';
comment on column public.post_music.start_seconds is
  'Offset del recorte dentro de la canción. Que el recorte entre en la duración de la pista lo valida el servidor (music-actions.ts), no un check: acá no se ve music_tracks.duration_seconds.';

create index post_music_track_idx on public.post_music (track_id);
create index post_music_tenant_idx on public.post_music (tenant_id);

create trigger post_music_set_updated_at
before update on public.post_music
for each row execute function extensions.moddatetime(updated_at);

alter table public.post_music enable row level security;
alter table public.post_music force row level security;

-- LECTURA: exactamente la de la publicación. El `exists` contra `posts` se
-- evalúa con los permisos de quien pregunta, así que hereda `posts_select` tal
-- cual — incluido el contenido published que se ve entre tenants por SEO. Es a
-- propósito: si mañana cambia la visibilidad de los posts, esto la sigue sin
-- que nadie se acuerde de venir a tocarlo. Un `using (true)` acá dejaría
-- enumerar qué publicaciones tienen música de comunidades ajenas.
create policy post_music_select on public.post_music
for select to anon, authenticated
using (
  exists (select 1 from public.posts p where p.id = post_music.post_id)
);

-- ESCRITURA: sólo el AUTOR de la publicación, en su comunidad, sobre un post
-- que no esté removido, y sólo con una pista que él pueda ver activa. Las tres
-- condiciones se re-validan en `music-actions.ts` antes de llegar acá; esto es
-- la última línea, no la única.
create policy post_music_insert on public.post_music
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.posts p
    where p.id = post_id
      and p.author_id = (select auth.uid())
      and p.tenant_id = (select app.current_tenant_id())
      and p.status <> 'removed'
  )
  and exists (
    select 1 from public.music_tracks t
    where t.id = track_id
      and t.is_active
      and (t.tenant_id is null or t.tenant_id = (select app.current_tenant_id()))
  )
);

-- Cambiar de pista o correr el recorte: mismas condiciones. `tenant_id` no se
-- puede mover a otra comunidad porque el WITH CHECK lo vuelve a atar al actual.
create policy post_music_update on public.post_music
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.posts p
    where p.id = post_music.post_id
      and p.author_id = (select auth.uid())
      and p.status <> 'removed'
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.music_tracks t
    where t.id = track_id
      and t.is_active
      and (t.tenant_id is null or t.tenant_id = (select app.current_tenant_id()))
  )
);

-- Sacar la música: el autor, o la moderación de la comunidad. Espeja
-- `posts_delete` — si alguien puede borrar la publicación entera, puede sacarle
-- la canción (y hace falta: una pista con la licencia caída se saca aunque el
-- autor no esté).
create policy post_music_delete on public.post_music
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    exists (
      select 1 from public.posts p
      where p.id = post_music.post_id and p.author_id = (select auth.uid())
    )
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- ---------------------------------------------------------------------------
-- 3. Nadie escribe el catálogo desde el navegador
-- ---------------------------------------------------------------------------
-- Las policies ya lo cierran, pero PostgREST igual publica los endpoints de
-- escritura. Sacarle el privilegio a `anon` deja la superficie del tamaño real
-- de lo que la feature necesita: leer.
revoke insert, update, delete on public.music_tracks from anon;
revoke insert, update, delete on public.post_music from anon;

-- ---------------------------------------------------------------------------
-- 4. Storage: bucket `music-tracks`
-- ---------------------------------------------------------------------------
-- PÚBLICO como `post-media` (0025): el audio del catálogo no es un secreto —es
-- música licenciada para sonar en publicaciones que ve cualquiera— y la app
-- arma las URLs contra `/storage/v1/object/public/…`, endpoint que no consulta
-- RLS. Lo que sí se cierra es LISTAR el bucket, siguiendo la 0056.
--
-- Convención de paths, espejo de la nulabilidad de `music_tracks.tenant_id`:
--   global/{archivo}          → catálogo de la plataforma
--   {tenant_id}/{archivo}     → pista propia de una comunidad
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'music-tracks',
  'music-tracks',
  true,
  8388608, -- 8 MB: un recorte de 30 s en mp3/aac decente entra holgado.
  array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Enumerar el bucket: sólo la carpeta global y la de MI comunidad. Reproducir
-- no pasa por acá (el endpoint público no consulta RLS); esto cubre `.list()`
-- y las lecturas por API.
drop policy if exists music_tracks_objects_select on storage.objects;
create policy music_tracks_objects_select on storage.objects
for select to authenticated
using (
  bucket_id = 'music-tracks'
  and (
    (storage.foldername(name))[1] = 'global'
    or (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  )
);

-- Subir/reemplazar/borrar música: NADIE desde el navegador salvo global_admin.
-- El camino previsto es el Dashboard o un script con service role. Se escriben
-- las tres policies en vez de dejarlas ausentes para que el permiso quede dicho
-- y no haya que deducirlo de un silencio.
drop policy if exists music_tracks_objects_insert on storage.objects;
create policy music_tracks_objects_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'music-tracks' and (select app.is_global_admin()));

drop policy if exists music_tracks_objects_update on storage.objects;
create policy music_tracks_objects_update on storage.objects
for update to authenticated
using (bucket_id = 'music-tracks' and (select app.is_global_admin()))
with check (bucket_id = 'music-tracks' and (select app.is_global_admin()));

drop policy if exists music_tracks_objects_delete on storage.objects;
create policy music_tracks_objects_delete on storage.objects
for delete to authenticated
using (bucket_id = 'music-tracks' and (select app.is_global_admin()));

-- ---------------------------------------------------------------------------
-- 5. El catálogo queda VACÍO
-- ---------------------------------------------------------------------------
-- A propósito y sin filas de ejemplo. Una fila con `storage_path` apuntando a
-- un archivo que no existe rompe el reproductor; una con licencia sin verificar
-- es el problema legal que esta migración vino a hacer imposible.
--
-- Para encender la feature hace falta, POR PISTA:
--   1. El archivo de audio, subido a `music-tracks/global/…`.
--   2. `license_kind` real (cc0 / public_domain / cc_by / cc_by_sa / licensed).
--   3. `source_url` y `license_url` — de dónde salió y qué permite.
--   4. `attribution_text` si la licencia obliga a nombrar al autor.
--   5. Recién ahí, `is_active = true`.
-- Con datos de prueba en local: `node scripts/seed-music.mjs` (se niega a correr
-- contra producción).

commit;
