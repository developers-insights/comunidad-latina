-- =============================================================================
-- 0114_grants_de_musica.sql — Comunidad Latina
--
-- LA MÚSICA NO SE VEÍA SIN SESIÓN. Medido contra producción, con el catálogo ya
-- cargado y las policies de la 0090 intactas:
--
--     set local role anon;
--     select … from public.music_tracks;
--     → ERROR 42501: permission denied for table music_tracks
--
-- No es la RLS: es el escalón de ABAJO. `music_tracks` y `post_music` nacieron
-- en la 0090, o sea DESPUÉS de la 0085, y esa migración lo dejó dicho en su
-- cierre — los default privileges de `public` en esta base compartida no
-- incluyen a `anon`, así que TODA tabla nueva nuestra nace sin acceso para
-- quien mira sin cuenta y hay que darle el grant a mano.
--
-- POR QUÉ IMPORTA, y por qué esto no es un detalle de higiene:
--
--  · La policy `music_tracks_select` de la 0090 dice `to anon, authenticated` a
--    propósito, y su comentario explica el motivo: «la ATRIBUCIÓN al artista
--    tiene que verse en una publicación pública, y quien la mira sin cuenta
--    también la ve». Sin el grant esa policy NUNCA se evalúa: la intención
--    quedaba escrita y sin efecto.
--  · Una publicación con música abierta desde un link compartido (el caso
--    normal: llega por WhatsApp, se abre sin sesión) mostraba la foto sin la
--    insignia y sin sonar. El fallo es SILENCIOSO —el código captura el 42501 y
--    sigue con `null`—, así que se lee como "esta publicación no tiene música".
--
-- QUÉ HACE: le da SELECT a `anon` sobre las dos tablas de la 0090. Nada más.
--
-- LO QUE NO HACE, a propósito: no le devuelve INSERT/UPDATE/DELETE a `anon`.
-- La 0090 los revoca explícitamente y ese revoke sigue siendo la decisión
-- correcta — el catálogo lo escribe un global_admin y la relación post↔pista la
-- escribe el autor con sesión. Acá se repara la LECTURA, que es lo único que le
-- falta a quien mira.
-- =============================================================================

begin;

-- El catálogo: título, artista y —cuando la licencia lo exige— la línea de
-- atribución. Es lo que MusicBadge está obligado a pintar sobre la foto.
grant select on public.music_tracks to anon;

-- La relación publicación ↔ pista. Sin esto no hay forma de saber QUÉ canción
-- suena en la publicación que se está mirando. Su policy `post_music_select`
-- hereda la visibilidad del post (`exists (select 1 from posts …)`), así que
-- este grant no abre nada que el post no abriera ya.
grant select on public.post_music to anon;

commit;
