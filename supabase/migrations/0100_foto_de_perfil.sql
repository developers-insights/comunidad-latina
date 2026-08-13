-- =============================================================================
-- 0100_foto_de_perfil.sql — Comunidad Latina
--
-- Feature: la persona ahora puede subir y cambiar su FOTO DE PERFIL (antes
-- sólo se podía la portada; `avatar_url` se fijaba una única vez al entrar
-- por Google/Apple y quedaba de sólo lectura — ver `src/lib/auth/
-- provision.ts` y `src/app/(app)/perfil/actions.ts`).
--
-- NO SE CREA BUCKET NUEVO NI POLICIES NUEVAS. El bucket `avatars` (0012) ya
-- es —literalmente, por su propio comentario de cabecera— para esto:
--   avatars: {tenant_id}/{user_id}/avatar.webp
-- y sus cuatro policies (avatars_select/_insert/_update/_delete, 0012 y
-- 0056) ya restringen cada escritura al prefijo `{tenant_id}/{user_id}/` del
-- JWT — exactamente lo que impide que alguien pise el avatar de otra
-- persona. La portada (0062) ya reusa este mismo bucket con nombres
-- `cover-*`; el avatar sube con nombres `avatar-*`, mismo prefijo, misma
-- policy. Crear un bucket aparte habría exigido sumarlo a la lista fija de
-- `scripts/rls-enumerator.mjs` (`STORAGE_BUCKETS`) sin ninguna ganancia real
-- — 0062 ya tomó esta misma decisión para la portada, por el mismo motivo.
--
-- LO QUE SÍ HACÍA FALTA: `avatars` es el ÚNICO de los buckets de imagen del
-- repo sin `file_size_limit` ni `allowed_mime_types` — comparar con
-- `music-tracks` (0090), que sí los trae desde que se creó. Hasta ahora el
-- tope de 5 MB y los tres tipos aceptados (jpg/png/webp) sólo se chequeaban
-- en el CLIENTE (`cover-upload-field.tsx`, y ahora `avatar-upload-field.tsx`)
-- — cualquiera que hablara directo con la API de Storage con un JWT válido
-- podía subir un archivo de cualquier tipo o tamaño a su propia carpeta. Esto
-- lo cierra en el SERVIDOR, a nivel Storage, para las dos fotos (portada y
-- avatar) porque comparten bucket: subida rechazada ANTES de tocar disco si
-- no matchea, sin que la app tenga que confiar en su propio chequeo de
-- cliente.
--
-- ADITIVO Y REVERSIBLE, no toca filas de `storage.objects` (los límites sólo
-- aplican a subidas NUEVAS, nunca a lo ya guardado). Deshacerlo:
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null
--   where id = 'avatars';
-- =============================================================================

update storage.buckets
set
  file_size_limit = 5242880, -- 5 MB — el mismo tope que ya declara el cliente.
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'avatars';
