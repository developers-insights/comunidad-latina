-- =============================================================================
-- 0132_posters_de_video.sql — Comunidad Latina
--
-- «Cuando uno está scrolleando salen en blanco y se cargan después de un rato.»
-- (Cliente, 2026-09-03, 1:07:00, mirando Videos Cortos en el teléfono.)
-- «Este video es de 1:29 y me tiraron que es de 100 y el máximo es 60.»
-- (Mismo cliente, 21:20, publicando un video grabado con el celular.)
--
-- Los dos síntomas tienen la misma causa de fondo: el .mp4 se sirve CRUDO desde
-- el bucket. Sin transcodificar no hay HLS, no hay miniatura generada y no queda
-- más remedio que esperar a que el navegador baje la cabecera del archivo antes
-- de pintar el primer píxel — ese rectángulo en blanco ES el <video> esperando
-- metadata. Y como el archivo viaja entero, el tope de peso tiene que ser
-- generoso o un video de 90 s de un iPhone no entra.
--
-- El arreglo de fondo es Mux (0116: transcodifica, entrega HLS y genera
-- thumbnails), que está en el código y APAGADO por falta de credenciales. Esta
-- migración es el parche que hace usable el camino del bucket mientras tanto:
--
--   1. Una columna para el POSTER que el navegador captura al subir: el primer
--      cuadro del video, ya como .jpg en el mismo bucket, para que el <video>
--      tenga qué mostrar desde el primer frame en vez de un rectángulo vacío.
--   2. El tope del bucket subido a 250 MB, para que quepa el video real que el
--      cliente no pudo publicar (101 MB) con margen para uno de 200.
--
-- ⚠️ LOS DOS SON PARCHES, y conviene que quede escrito acá: un video crudo de
-- 200 MB en el reel carga PEOR que uno de 60, no mejor. El poster tapa la
-- espera; no la acorta. Cuando entren las credenciales de Mux, la ruta de Mux
-- deja de necesitar esta columna (trae su propia miniatura, muxThumbnailUrl) y
-- el tope del bucket deja de tener quién lo use.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ UNA COLUMNA EN posts Y NO UNA ENTRADA MÁS EN posts.media
-- ═══════════════════════════════════════════════════════════════════════════
--
-- posts.media es el array de DIAPOSITIVAS de la publicación: lo que el carrusel
-- pinta, lo que el visor pasa de costado y lo que cuentan los puntitos. Un .jpg
-- metido ahí sería, para toda esa cadena, una FOTO más de la publicación — el
-- kind se infiere por extensión (mediaKindOf), así que un post con un video
-- pasaría a mostrar dos diapositivas y a decir "1 de 2".
--
-- El poster no es contenido: es cómo se pinta el video mientras carga. Por eso
-- va en su propia columna, del mismo modo que media_filters (0104) guarda una
-- decisión de presentación por archivo sin ensuciar el array de medios.
--
-- UNA SOLA COLUMNA, no un objeto indexado por ruta como media_filters: el
-- composer acepta UN video por publicación ("Por ahora va un video por
-- publicación"), así que un mapa sería una estructura para un caso que hoy no
-- existe. Si algún día entran varios videos por post, esto se convierte en jsonb
-- con el mismo criterio que 0104 — y la lectura ya está centralizada en un solo
-- lugar (toPostCardModel), que es lo que hace barato ese cambio.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ NO HAY POLICY DE STORAGE NUEVA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Las cuatro policies de post-media (0025) autorizan por PREFIJO de ruta
-- —{tenant_id}/{user_id}/…— y nunca por extensión ni por tipo de archivo. El
-- poster se sube al MISMO prefijo que su video, así que post_media_insert ya lo
-- cubre tal como está y post_media_select (público) ya lo deja leer. Agregar una
-- policy acá sería una segunda regla diciendo lo mismo: dos lugares donde mañana
-- hay que acordarse de cambiar lo mismo.
--
-- image/jpeg tampoco hace falta habilitarlo en allowed_mime_types: las fotos de
-- los posts ya se suben como jpg/png/webp por este mismo bucket (PHOTO_TYPES en
-- feed/actions.ts), así que el tipo ya está permitido.
--
-- Los GRANTS tampoco: los de este repo son a nivel de TABLA (ver 0114) y no por
-- columna, así que una columna nueva queda cubierta sola. Vale la pena dejarlo
-- escrito porque en esta base ya pasó lo contrario y costó caro — sin grant, la
-- policy ni se evalúa y la app se ve entera vacía, sin un solo error.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) El poster del video
-- ---------------------------------------------------------------------------

alter table public.posts
  add column if not exists video_poster_path text;

comment on column public.posts.video_poster_path is
  'Ruta en post-media del fotograma que el navegador capturó al subir (0132). Se usa como poster del <video> mientras el archivo carga. NULL = la publicación no trae video, o lo trae de antes de esta migración, o el navegador no pudo decodificarlo: en los tres casos la superficie cae a su respaldo, nunca a un rectángulo en blanco.';

-- La MISMA forma de ruta que el servidor ya exige para el video (isOwnVideoPath
-- en feed/actions.ts): tenant / usuario / archivo, tres segmentos y nada más.
-- Acá se re-escribe en SQL y no es redundancia inútil — es la última línea antes
-- de que un valor quede guardado para siempre, y la única que sigue valiendo si
-- algún día alguien escribe en la tabla por fuera de esa action.
--
-- El `..` va aparte a propósito: el charset del nombre de archivo tiene que
-- permitir el punto (lo necesita la extensión), así que prohibir el traversal no
-- se puede hacer dentro de la misma clase de caracteres. Es el mismo par de
-- chequeos que corre la action.
alter table public.posts
  drop constraint if exists posts_video_poster_path_shape;

alter table public.posts
  add constraint posts_video_poster_path_shape check (
    video_poster_path is null
    or (
      video_poster_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+\.jpg$'
      and position('..' in video_poster_path) = 0
    )
  );

-- ---------------------------------------------------------------------------
-- 2) El tope de peso del bucket
-- ---------------------------------------------------------------------------

-- 250 MB. El tope que ve la persona son 200 MB (MAX_VIDEO_BYTES) y el del bucket
-- va POR ENCIMA a propósito: es un respaldo, no la regla. Si los dos dijeran lo
-- mismo, un archivo de 200 MB + 1 byte lo rechazaría Storage con un error HTTP
-- crudo en vez del mensaje que el composer sabe escribir ("Este video pesa
-- 201 MB y el máximo son 200 MB"). Es el mismo margen que había entre los 60 y
-- los 80 de antes, sólo que a escala.
--
-- file_size_limit se configuró siempre desde el Dashboard y nunca desde una
-- migración (0025 crea el bucket sin fijarlo), así que este UPDATE es el primero
-- que lo escribe desde el repo. Va con where por id y sin insert: si el bucket
-- no existiera, crearlo acá sería peor que fallar — 0025 es quien lo crea y
-- quien define sus policies.
--
-- Igual que 0025, esta parte puede necesitar correrse a mano desde el SQL Editor
-- si el rol de migraciones no puede tocar el esquema storage en este proyecto.
update storage.buckets
set file_size_limit = 250 * 1024 * 1024
where id = 'post-media';
