-- =============================================================================
-- 0112_indice_de_articulos_por_tienda.sql — Comunidad Latina
--
-- Un índice. Lo pidió la auditoría del 2026-08-24 sobre el directorio de
-- Marketplace.
--
-- ── QUÉ ESCANEA HOY ─────────────────────────────────────────────────────────
-- Dos consultas preguntan "qué artículos son de esta tienda", y las dos lo
-- hacen por una expresión sobre `attrs`, que no tiene índice:
--
--   · `fetchActiveListingCounts()` (`src/lib/marketplace/store-directory.ts`)
--     — el contador de "artículos activos" de CADA tarjeta del directorio, con
--     un `in (...)` de todas las tiendas de la página.
--   · La vidriera de una tienda (`marketplace/tienda/[storeId]`) — un `eq`.
--
-- Las dos filtran además por `tenant_id`, `kind='product'` y
-- `status='published'`. Sin índice, cada visita al directorio barre `listings`
-- entera, que es la tabla más grande del producto (propiedades, negocios,
-- profesionales, eventos, empleos, productos y servicios de creador, todos
-- ahí). Hoy no se nota porque hay ocho artículos; se va a notar exactamente
-- cuando el módulo empiece a funcionar.
--
-- ── POR QUÉ PARCIAL, Y POR QUÉ CON `tenant_id` ADELANTE ─────────────────────
-- Parcial (`where kind='product' and status='published'`) porque el vínculo a
-- una tienda sólo existe para productos, y sólo se consulta sobre publicados:
-- las otras seis verticales y todo lo que está en borrador o vencido quedan
-- afuera del índice en vez de ocupar lugar en él. Es la diferencia entre
-- indexar un puñado de filas e indexar la tabla.
--
-- `tenant_id` va primero porque es el filtro que toda consulta de esta app
-- lleva siempre —es la frontera de aislamiento, no un filtro opcional— y es el
-- que más descarta.
--
-- ── SIN `CONCURRENTLY`, A PROPÓSITO ─────────────────────────────────────────
-- `create index concurrently` no puede correr dentro de una transacción, y
-- `scripts/apply-migrations.mjs` envuelve cada archivo en `begin`/`commit` — o
-- sea que usarlo acá rompería el aplicador. Con el volumen actual el lock de
-- escritura sobre `listings` dura milisegundos. Si algún día esta tabla crece a
-- millones de filas, este índice hay que crearlo a mano y fuera del script.
-- =============================================================================

begin;

create index if not exists listings_store_listing_id_idx
  on public.listings (tenant_id, (attrs->>'store_listing_id'))
  where kind = 'product' and status = 'published';

commit;
