-- =============================================================================
-- 0128_fondos_de_texto.sql — Comunidad Latina
--
-- «Que sean de colores más llamativos, más bonitos, o que la gente los pueda
-- cambiar.» (Cliente, 2026-09-03, 1:07:33–1:08:57, punto 15 del feedback,
-- mostrando en el teléfono un texto traído de Instagram.)
--
-- Hasta hoy el fondo de una publicación de texto (`kind='text'`) salía de un
-- hash del id del post: tres variantes fijas en `text-banner.tsx`, sorteadas,
-- sin que nadie pudiera elegir. Esta migración agrega la columna donde queda
-- guardada la elección de quien publica.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ SE GUARDA UN ID Y NO EL COLOR
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La columna guarda un identificador del catálogo cerrado que vive en
-- `src/lib/feed/text-backgrounds.ts` — 'amanecer', 'caribe', 'fiesta'… — y
-- NUNCA el CSS del degradado. Los dos motivos, en orden de importancia:
--
--  1. SEGURIDAD. El valor viaja del navegador al servidor y vuelve a pintarse
--     dentro de un `style` en la tarjeta de cada persona que abre el feed.
--     Guardar CSS sería dejar que el cliente escriba en el `style` de todos;
--     guardar un id significa que lo peor que puede pasar con una fila
--     manipulada es que el fondo no exista, y eso ya cae al sorteo.
--  2. PODER CAMBIAR DE OPINIÓN. Ajustar un degradado —subirle contraste,
--     cambiarle el ángulo— es editar una línea del catálogo y que se repinten
--     todas las publicaciones que lo eligieron. Con el CSS congelado en cada
--     fila, ese ajuste sería un backfill.
--
-- El CHECK repite la lista del catálogo a mano. Es duplicación DELIBERADA y
-- conviene que quede escrito: agregar un fondo son DOS cambios, la entrada en
-- el catálogo y esta lista. La alternativa —una tabla `text_backgrounds` con
-- FK— sería ocho filas sin metadatos, sin fecha y sin autor, que nadie consulta
-- por separado, más un JOIN en cada publicación de texto del feed. El día que
-- un fondo necesite ser configurable por tenant, o que un admin pueda crear
-- uno, deja de ser un catálogo y ahí sí es una tabla: queda dicho para que ese
-- día no se discuta.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ ES NULLABLE Y POR QUÉ ESO NO ES UN AGUJERO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- NULL significa «modo Automático»: el fondo se sortea por el id del post,
-- exactamente como se venía haciendo. Por eso las publicaciones que ya existen
-- no necesitan backfill — su NULL YA es la respuesta correcta y se siguen
-- viendo igual que ayer. Un default tampoco tendría sentido: elegir uno fijo
-- pintaría de un solo color todo el feed.
--
-- El pozo del sorteo son los tres fondos que existían antes ('amanecer',
-- 'noche', 'plaza') y está congelado en el código con su propio test. Sumar un
-- fondo al catálogo NO lo suma al sorteo: correría el módulo del hash y
-- repintaría de golpe cada texto ya publicado.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ EL SEGUNDO CHECK (SÓLO LOS TEXTOS TIENEN FONDO)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- En una publicación con foto o video no hay ningún campo de color que pintar,
-- y una pregunta tiene su propio banner (`question-banner.tsx`) con sus propias
-- variantes. Un fondo guardado en esas filas sería un dato que no se muestra en
-- ningún lado: la clase de valor que seis meses después alguien lee como si
-- significara algo. `createPostAction` ya lo ignora cuando el kind no es texto;
-- este CHECK es la misma regla en el único lugar donde sigue valiendo aunque
-- mañana alguien escriba en `posts` por fuera de esa action.
--
-- Es el mismo criterio —y el mismo par de reglas, una en la app y otra en la
-- base— que ya usa `posts_poll_only_on_question` (0041) para la encuesta.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE NO HACE FALTA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- · SIN ÍNDICE: ninguna consulta filtra ni ordena por el fondo. Se lee con la
--   fila del post que ya se busca por id o por keyset. Un índice sin consumidor
--   es peso muerto en cada INSERT.
-- · SIN POLICY NUEVA: es una columna más de `posts`, que ya tiene sus cuatro
--   policies (y el enumerador `scripts/rls-enumerator.mjs` exige exactamente
--   cuatro por tabla: una quinta rompe el gate, con razón). Quién puede escribir
--   una publicación no cambia porque la publicación tenga un color.
-- · SIN GRANT NUEVO: los grants de este repo son a nivel de TABLA (0114) y no
--   por columna, así que una columna nueva queda cubierta sola. Vale la pena
--   dejarlo escrito porque en esta base ya pasó lo contrario y costó caro: sin
--   grant, la policy ni se evalúa y la app se ve entera vacía, sin un error.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) La columna
-- ---------------------------------------------------------------------------

alter table public.posts
  add column if not exists text_background text;

comment on column public.posts.text_background is
  'Fondo elegido de una publicación de texto (0128). Id del catálogo cerrado de src/lib/feed/text-backgrounds.ts, NUNCA CSS. NULL = modo Automático: el fondo se sortea por el id del post, que es lo que hacían todas las publicaciones anteriores a esta migración.';

-- ---------------------------------------------------------------------------
-- 2) El catálogo cerrado
-- ---------------------------------------------------------------------------

-- Esta lista y la de `TEXT_BACKGROUND_IDS` en el catálogo son la MISMA lista.
-- Si divergen: un id nuevo sólo acá se guarda y no lo pinta nadie (la tarjeta
-- cae al sorteo); un id nuevo sólo allá rebota con un 23514 al publicar.
alter table public.posts
  drop constraint if exists posts_text_background_catalog;

alter table public.posts
  add constraint posts_text_background_catalog check (
    text_background is null
    or text_background in (
      'amanecer',
      'noche',
      'plaza',
      'caribe',
      'tierra',
      'selva',
      'fiesta',
      'cafe'
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Sólo los textos tienen fondo
-- ---------------------------------------------------------------------------

alter table public.posts
  drop constraint if exists posts_text_background_only_on_text;

alter table public.posts
  add constraint posts_text_background_only_on_text check (
    text_background is null or kind = 'text'
  );

commit;
