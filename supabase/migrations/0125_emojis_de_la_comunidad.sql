-- =============================================================================
-- 0125_emojis_de_la_comunidad.sql — Comunidad Latina
--
-- EMOJIS PROPIOS DE LA COMUNIDAD. Pedido del cliente (2026-08-31): dos packs de
-- 30 dibujos con identidad latina —KLK, CHÉVERE, BACÁN, QUÉ LO QUÉ, PARRANDA,
-- CAFECITO, EMPANADA…— para usar en TRES superficies: reacciones a una
-- publicación, el editor de fotos y los comentarios.
--
-- UN SOLO CATÁLOGO PARA LAS TRES. Decisión del dueño del producto, y la que
-- esta migración hace cumplir: hay UNA tabla y UN bucket. Tres catálogos
-- paralelos (uno por superficie) significan que apagar un dibujo hay que
-- acordarse de hacerlo tres veces, y que el día que se apague en dos de tres
-- nadie se entera hasta que un usuario lo ve donde no debería estar.
--
-- ─── ESTO ES UN CALCO DE 0090 (música), A PROPÓSITO ─────────────────────────
-- El repo ya resolvió este problema exacto —catálogo de piezas que la
-- plataforma provee, compartido entre comunidades, con archivos en un bucket
-- público— y esa forma se copia entera en vez de inventar otra:
--
--   · `tenant_id` NULLABLE: NULL = catálogo GLOBAL que ven todas las
--     comunidades. Con valor = dibujo propio de una comunidad, invisible para
--     las demás. Ponerlo NOT NULL obligaría a duplicar los 60 dibujos por cada
--     comunidad nueva.
--   · `is_active` NACE EN FALSE: ningún dibujo se puede elegir hasta que una
--     persona lo encienda a mano. En música el interruptor era la LICENCIA;
--     acá es el mismo interruptor con dos motivos propios, y los dos importan:
--       (a) los archivos son del cliente y hay que confirmar que son suyos;
--       (b) EN COMENTARIOS el dibujo viaja como código corto (`:klk:`) dentro
--           del texto, y el renderer del comentario tiene que saber cambiarlo
--           por la imagen. Hasta que ese cambio esté en producción, encender un
--           emoji dejaría comentarios que muestran ":klk:" en crudo. El
--           interruptor es lo que impide que eso pase por descuido.
--   · GRANTS EXPLÍCITOS: ver §3. En esta base compartida los default privileges
--     de `public` NO incluyen a `anon`, y una tabla sin GRANT queda invisible
--     con la policy intacta — el fallo que costó la 0114.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. El catálogo
-- ---------------------------------------------------------------------------
create table public.community_emojis (
  id            uuid primary key default app.uuid_v7(),

  -- NULL = catálogo global de la plataforma. Con valor = dibujo propio de esa
  -- comunidad. La policy de select es la que impide que se filtre a otra.
  tenant_id     uuid references public.tenants(id),

  -- EL CÓDIGO CORTO. En un comentario el dibujo no puede viajar como imagen:
  -- `comments.body` es texto. Viaja como `:slug:` y el renderer lo cambia por
  -- la imagen al pintar. Por eso el formato es estricto —minúsculas, números y
  -- guiones— y no admite `:` ni espacios: un slug que se pudiera confundir con
  -- el delimitador rompería el parseo del texto de todos los comentarios.
  slug          text not null
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 40),

  -- Cómo se llama en el picker. Es el nombre que mandó el cliente ("KLK",
  -- "CHÉVERE"): sirve para BUSCARLO, no para describirlo.
  label         text not null check (length(btrim(label)) between 1 and 40),

  -- QUÉ SE VE EN EL DIBUJO. Obligatorio y sin excepción: un emoji sin texto
  -- alternativo es un agujero para quien usa lector de pantalla — escucha
  -- "imagen" y sigue de largo.
  --
  -- El check de abajo exige además que NO sea el mismo texto que `label`.
  -- No es celo: "KLK" leído en voz alta no describe nada. El alt tiene que
  -- decir qué muestra el dibujo ("saludo con la mano en alto"), que es
  -- justamente lo que el nombre del pack no dice.
  alt_text      text not null,

  -- Path dentro del bucket `community-emojis`. `global/…` o `{tenant_id}/…`,
  -- espejo de la nulabilidad de `tenant_id`.
  storage_path  text not null unique check (length(btrim(storage_path)) > 0),

  -- Con qué pestaña se abre en el picker. La lista es corta a propósito: cada
  -- categoría es una pestaña más para deslizar con el pulgar en 375 px.
  category      text not null default 'general'
                check (category in ('saludos', 'expresiones', 'animo', 'fiesta', 'comida', 'general')),

  sort_order    int not null default 100,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint community_emojis_alt_no_vacio check (
    length(btrim(alt_text)) between 4 and 140
  ),
  -- Un alt que repite el nombre del pack no describe el dibujo: quien no ve la
  -- imagen escucha "KLK" y sigue sin saber qué es. Se rechaza en la base
  -- porque en la revisión visual esto es invisible — la pantalla se ve bien.
  constraint community_emojis_alt_no_repite_el_nombre check (
    lower(btrim(alt_text)) <> lower(btrim(label))
  )
);

comment on table public.community_emojis is
  'Emojis propios de la comunidad (imágenes). Catálogo ÚNICO para las tres superficies: reacciones, editor de fotos y comentarios. tenant_id NULL = catálogo global. is_active nace false: se enciende a mano cuando el archivo está verificado Y el renderer de comentarios sabe leer su código corto.';
comment on column public.community_emojis.slug is
  'Código corto con el que el emoji viaja dentro de un texto: `:klk:`. El formato excluye `:` y espacios para que el parseo del cuerpo del comentario no sea ambiguo.';
comment on column public.community_emojis.alt_text is
  'Qué se VE en el dibujo, para lector de pantalla. Obligatorio y distinto del label: "KLK" no describe nada.';
comment on column public.community_emojis.tenant_id is
  'NULL = catálogo global visible por todas las comunidades. Con valor = emoji propio de esa comunidad; puede TAPAR a uno global con el mismo slug (ver los índices únicos parciales).';

-- UNICIDAD DEL SLUG, POR ÁMBITO — y en dos índices parciales y no en un
-- `unique (tenant_id, slug)`, porque con `tenant_id` NULL ese unique no
-- deduplica nada: en Postgres dos NULL no son iguales, así que el catálogo
-- global admitiría dos `:klk:` distintos y el renderer elegiría uno al azar.
create unique index community_emojis_slug_global_idx
  on public.community_emojis (slug) where tenant_id is null;
create unique index community_emojis_slug_tenant_idx
  on public.community_emojis (tenant_id, slug) where tenant_id is not null;

-- Que un tenant PUEDA repetir un slug global es deliberado: es cómo una
-- comunidad cambia el dibujo de `:klk:` por el suyo sin tocar el catálogo de
-- todas. Quien lee resuelve el empate a favor del tenant (ver
-- `src/lib/emojis/catalog.ts`, `indexBySlug`).

-- El picker lista por categoría y orden, y SIEMPRE filtra is_active.
create index community_emojis_catalogo_idx
  on public.community_emojis (is_active, category, sort_order, label);
-- La policy de select arranca por tenant_id: sin esto la evalúa fila a fila.
create index community_emojis_tenant_idx on public.community_emojis (tenant_id);

create trigger community_emojis_set_updated_at
before update on public.community_emojis
for each row execute function extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
alter table public.community_emojis enable row level security;
alter table public.community_emojis force row level security;

-- LECTURA: sólo activos, y sólo los globales o los de MI comunidad.
--
-- `anon` incluido A PROPÓSITO, por el mismo motivo que la música: una
-- publicación con un comentario que dice `:klk:` se abre desde un enlace
-- compartido, sin sesión. Si `anon` no puede leer el catálogo, ese comentario
-- muestra el código corto en crudo a quien llega por WhatsApp — que es
-- exactamente el público más grande de la app. Para `anon`
-- `app.current_tenant_id()` es NULL, así que le quedan los globales.
create policy community_emojis_select on public.community_emojis
for select to anon, authenticated
using (
  (
    is_active
    and (tenant_id is null or tenant_id = (select app.current_tenant_id()))
  )
  or (select app.is_global_admin())
);

-- ESCRITURA: sólo global_admin. Cargar un emoji es publicar un dibujo con la
-- marca de la plataforma encima y afirmar que hay derecho a usarlo; un
-- domain_admin administra SU comunidad, no ese riesgo. El camino real es el
-- script con service role (`scripts/cargar-emojis.mjs`) o el Dashboard.
create policy community_emojis_insert on public.community_emojis
for insert to authenticated
with check ((select app.is_global_admin()));

-- UPDATE lleva USING y WITH CHECK: sin WITH CHECK, quien puede editar podría
-- MOVER la fila a otro tenant_id en el mismo update.
create policy community_emojis_update on public.community_emojis
for update to authenticated
using ((select app.is_global_admin()))
with check ((select app.is_global_admin()));

create policy community_emojis_delete on public.community_emojis
for delete to authenticated
using ((select app.is_global_admin()));

-- ---------------------------------------------------------------------------
-- 3. GRANTS — el escalón de abajo, el que se olvida
-- ---------------------------------------------------------------------------
-- SIN ESTO LA POLICY NI SE EVALÚA. Es la lección de la 0114, escrita con la
-- app entera en blanco: en esta base compartida los default privileges de
-- `public` no alcanzan a `anon`, así que toda tabla nueva nace sin acceso y el
-- fallo es SILENCIOSO —PostgREST devuelve 42501, el código lo captura y sigue
-- con la lista vacía, y se lee como "todavía no hay emojis cargados".
--
-- `authenticated` va explícito aunque hoy lo herede: depender de un default
-- que ya nos falló una vez es cómo se repite el mismo martes.
grant select on public.community_emojis to anon, authenticated;

-- Las policies ya cierran la escritura, pero PostgREST igual publica los
-- endpoints. Sacarle el privilegio a `anon` deja la superficie del tamaño real
-- de lo que la feature necesita: leer.
revoke insert, update, delete on public.community_emojis from anon;

-- ---------------------------------------------------------------------------
-- 4. Storage: bucket `community-emojis`
-- ---------------------------------------------------------------------------
-- PÚBLICO como `post-media` (0025) y `music-tracks` (0090): un emoji de la
-- comunidad no es un secreto —se ve pegado en una foto que mira cualquiera— y
-- la app arma las URLs contra `/storage/v1/object/public/…`, endpoint que no
-- consulta RLS. Lo que sí se cierra es LISTAR el bucket.
--
-- SÓLO PNG Y WEBP, y las tres exclusiones son decisiones, no un olvido:
--
--  · SVG queda AFUERA. Un SVG servido desde un bucket público se abre en el
--    navegador como documento y ejecuta el script que traiga adentro, en el
--    dominio del proyecto de Supabase. Que hoy sólo suba un global_admin no
--    cambia que el formato sea una superficie de XSS almacenado; el script de
--    carga rasteriza los SVG de origen a PNG antes de subirlos, así que no se
--    pierde nada.
--  · GIF queda AFUERA. `ctx.drawImage` de un GIF animado dibuja UN cuadro. Un
--    emoji que se mueve en el picker y sale congelado en la foto publicada es
--    el fallo silencioso que `bake-photo.ts` viene evitando en todo lo demás.
--  · El tope es 256 KB. Un PNG de 512×512 con transparencia pesa 20–80 KB; el
--    tope corta el caso de subir el original de 4 MB sin achicarlo, que en un
--    picker de 60 imágenes es la diferencia entre abrir y no abrir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-emojis',
  'community-emojis',
  true,
  262144, -- 256 KB
  array['image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Enumerar el bucket: sólo la carpeta global y la de MI comunidad. Mostrar un
-- emoji no pasa por acá (el endpoint público no consulta RLS); esto cubre
-- `.list()` y las lecturas por API.
drop policy if exists community_emojis_objects_select on storage.objects;
create policy community_emojis_objects_select on storage.objects
for select to authenticated
using (
  bucket_id = 'community-emojis'
  and (
    (storage.foldername(name))[1] = 'global'
    or (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  )
);

-- Subir / reemplazar / borrar: NADIE desde el navegador salvo global_admin. El
-- camino previsto es `scripts/cargar-emojis.mjs` con service role. Las tres se
-- escriben aunque el efecto sea el mismo que ausentes, para que el permiso
-- quede DICHO y no haya que deducirlo de un silencio.
--
-- (Reemplazar un archivo con `upsert` necesita INSERT + SELECT + UPDATE: la
-- select de arriba es la que completa el trío para un admin con sesión.)
drop policy if exists community_emojis_objects_insert on storage.objects;
create policy community_emojis_objects_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'community-emojis' and (select app.is_global_admin()));

drop policy if exists community_emojis_objects_update on storage.objects;
create policy community_emojis_objects_update on storage.objects
for update to authenticated
using (bucket_id = 'community-emojis' and (select app.is_global_admin()))
with check (bucket_id = 'community-emojis' and (select app.is_global_admin()));

drop policy if exists community_emojis_objects_delete on storage.objects;
create policy community_emojis_objects_delete on storage.objects
for delete to authenticated
using (bucket_id = 'community-emojis' and (select app.is_global_admin()));

-- ---------------------------------------------------------------------------
-- 5. El catálogo queda VACÍO
-- ---------------------------------------------------------------------------
-- Sin filas de ejemplo, igual que la 0090. Una fila con `storage_path`
-- apuntando a un archivo que no existe es un emoji que el picker LISTA y que
-- se ve como un cuadrito roto: el peor de los dos fracasos, porque parece que
-- funciona.
--
-- Para encender la feature, POR EMOJI:
--   1. El archivo (PNG cuadrado, 512×512, fondo transparente) en
--      `community-emojis/global/…`.
--   2. `alt_text` escrito por una persona: qué SE VE, no cómo se llama.
--   3. `category` y `sort_order`.
--   4. Recién ahí `is_active = true` — y en comentarios, sólo después de que
--      el renderer sepa cambiar `:slug:` por la imagen (ver la cabecera).
--
-- Camino real: `node scripts/cargar-emojis.mjs --desde <carpeta> --activar`.

commit;
