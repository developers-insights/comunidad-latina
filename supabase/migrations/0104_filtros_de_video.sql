-- =============================================================================
-- 0104_filtros_de_video.sql — Comunidad Latina
--
-- El compositor ya ofrece 16 filtros sobre las FOTOS. En una foto el filtro se
-- HORNEA: `bake-photo.ts` lo quema en los píxeles con canvas y el archivo que
-- se sube ya es la foto filtrada. La base no se entera de nada, y está bien.
--
-- En un video ese camino no existe.
--
-- ── POR QUÉ EL VIDEO NO SE HORNEA ────────────────────────────────────────────
-- Hornear un video pide dibujar cuadro por cuadro en un canvas y re-codificar
-- con MediaRecorder, que corre EN TIEMPO REAL: 90 s de video son 90 s de espera
-- con el teléfono caliente y la pantalla trabada. Y rompe dos cosas que ya
-- funcionan:
--
--   · LA SUBIDA DIRECTA. El video viaja del navegador al bucket antes de que se
--     toque "Publicar" (las server actions tienen techo de body). Hornear
--     obligaría a subir DOS veces, o a subir después —perdiendo la barra de
--     progreso que hoy acompaña la espera.
--   · CONTENT INTEGRITY. La huella perceptual y el SHA-256 se calculan sobre el
--     archivo real del bucket. Un re-encode cambia cada byte y cada cuadro: la
--     misma persona subiendo el mismo video con dos filtros distintos generaría
--     dos obras "originales" sin parecido entre sí, y el libro de procedencia
--     dejaría de servir para lo único que existe.
--
-- ── ENTONCES SE GUARDA LA DECISIÓN, NO EL RESULTADO ──────────────────────────
-- El filtro pasa a ser un METADATO DE PRESENTACIÓN: se guarda qué preset se
-- eligió y con cuánta intensidad, y el reproductor lo aplica con `filter` de
-- CSS al pintar. Es gratis (lo hace la GPU), es exactamente lo que se vio en la
-- vista previa del compositor, y el archivo subido sigue siendo el original —
-- que es justamente lo que Content Integrity necesita que sea.
--
-- Efecto lateral deseado: el filtro es REVERSIBLE. Una foto horneada mal queda
-- mal para siempre; un video se puede reencuadrar cambiando una fila.
--
-- ── FORMA DE LA COLUMNA: OBJETO POR RUTA, NO ARREGLO POR POSICIÓN ────────────
-- `media_filters` es un objeto jsonb cuya CLAVE es la ruta del archivo dentro
-- de `posts.media` y cuyo valor es `{"id": "...", "intensity": 0.6}`.
--
-- Podría haber sido un arreglo paralelo a `media`, y sería más corto. No lo es
-- porque `media` cambia: desde la 0097 se puede quitar UNA foto de una
-- publicación ya publicada, y desde el compositor el orden lo elige la persona.
-- Un arreglo por posición se desalinea en silencio la primera vez que alguien
-- borra el medio de más arriba, y el resultado sería un video con el filtro de
-- otro. Con la ruta como clave, quitar un medio deja a lo sumo una clave
-- huérfana que nadie vuelve a leer.
--
-- ── LO QUE NUNCA VA A ESTAR ACÁ ──────────────────────────────────────────────
-- CSS. En la columna sólo entra un identificador del catálogo y un número; el
-- string de `filter` lo arma el servidor leyendo `src/lib/media/photo-filters.ts`
-- (`resolvePhotoFilterCss`). Guardar CSS que venga del navegador sería dejar que
-- un cliente modificado escriba en el `style` de todo el que abra la
-- publicación. El CHECK de abajo pone el piso —tiene que ser un objeto— y la
-- validación real, contra el catálogo, vive en `createPostAction`.
--
-- Sin índice: nunca se filtra ni se ordena por esta columna, sólo se lee junto
-- con la fila que ya se estaba leyendo. Un índice acá encarecería cada escritura
-- a cambio de nada.
-- =============================================================================

alter table public.posts
  add column if not exists media_filters jsonb not null default '{}'::jsonb;

comment on column public.posts.media_filters is
  'Filtro de presentación por archivo de posts.media, como {"<ruta>": {"id": "<preset>", "intensity": 0..1}}. Sólo para medios que NO se hornean (video): la foto lleva el filtro quemado en los píxeles. Nunca guarda CSS — el id se valida contra el catálogo de src/lib/media/photo-filters.ts en createPostAction y el string de filter lo arma el servidor. Clave por RUTA y no por posición para que quitar un medio (0097) no le corra el filtro al de al lado.';

-- Objeto, nunca un arreglo ni un escalar: el resto del código lo lee con
-- `media_filters[path]` y un `[1,2]` haría que esa lectura devolviera basura en
-- vez de fallar. El CHECK es el piso; el catálogo lo valida la app.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.posts'::regclass
      and conname = 'posts_media_filters_is_object'
  ) then
    alter table public.posts
      add constraint posts_media_filters_is_object
      check (jsonb_typeof(media_filters) = 'object');
  end if;
end
$$;
