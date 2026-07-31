-- =============================================================================
-- 0049_fix_video_declaration_cutoff.sql — Comunidad Latina
--
-- ARREGLA UN DEFECTO DE 0046, encontrado probándolo en vivo y no leyéndolo.
--
-- `posts_video_declaration` (0046) exige que todo video NUEVO declare
-- `video_type` y `duration_seconds`, y deja pasar los viejos con una cláusula
-- de abuelo por fecha. La fecha elegida fue el corte del DÍA SIGUIENTE
-- ('2026-07-31 00:00:00+00') — y la migración corrió el 2026-07-30 a las 21:32
-- UTC. O sea: durante las últimas horas del 30 la constraint quedó DORMIDA,
-- porque cualquier post nuevo nace con created_at < el corte y cae en la
-- excepción. Verificado: un INSERT con media de video, sin video_type ni
-- duration_seconds, entró sin error.
--
-- Por qué importa aunque se "arreglara sola" a medianoche: los agentes de app
-- construyen el composer AHORA. Con la constraint dormida escribirían el
-- formulario sin mandar la duración, no verían ningún error, y la publicación de
-- videos empezaría a fallar sola al día siguiente. Una garantía que se activa
-- por reloj es peor que no tenerla.
--
-- FIX: el corte deja de ser una fecha redonda inventada y pasa a ser el
-- INSTANTE EXACTO del último video que ya existía cuando corrió 0046
-- (max(created_at) sobre los posts con media de video = 2026-07-30
-- 20:30:00.471645 UTC, medido contra esta misma base, con precisión de
-- MICROSEGUNDOS: la primera versión de este archivo usó los milisegundos que
-- imprime el driver de Node y la constraint rebotó contra esa misma fila —
-- timestamptz guarda microsegundos y truncarlos deja la última fila afuera).
-- Cubre exactamente las 7 filas viejas —ni una más— y está en el pasado, así
-- que la regla rige desde este segundo.
--
-- Forward-only: 0046 no se toca. Se reemplaza la constraint.
-- =============================================================================

alter table public.posts drop constraint posts_video_declaration;

alter table public.posts
  add constraint posts_video_declaration check (
    not app.media_has_video(media)
    -- Las 7 publicaciones con video anteriores a 0046. Nadie puede meterse en
    -- este conjunto: created_at está congelada para authenticated desde 0046
    -- (app.protect_post_counters) y su default es now().
    or created_at <= timestamptz '2026-07-30 20:30:00.471645+00'
    or (video_type is not null and duration_seconds is not null)
  );

comment on constraint posts_video_declaration on public.posts is
  'Todo post con media de video creado después de 0046 declara qué es (video_type) y cuánto dura (duration_seconds). Los 7 videos anteriores quedan exentos por el corte de created_at — su duración genuinamente no se conoce e inventarla sería peor que no tenerla. RESIDUO CONOCIDO Y ACOTADO: esas 7 filas viejas pueden seguir siendo elegibles para el reel con duración NULL, y un post viejo al que se le AGREGUE un video después también cae en la exención (un CHECK no puede mirar si `media` cambió). Por eso la app tiene que tratar duration_seconds NULL en un video como "desconocida" y re-medirla, no como "corta".';
