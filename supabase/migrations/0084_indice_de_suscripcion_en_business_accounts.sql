-- =============================================================================
-- 0084_indice_de_suscripcion_en_business_accounts.sql — Comunidad Latina
--
-- `business_accounts.stripe_subscription_id` (0008) no tenía ningún índice. Sus
-- dos tablas hermanas —las que modelan exactamente lo mismo, una suscripción de
-- Stripe espejada en una fila nuestra— sí lo tienen, y con la misma forma:
--   listing_premiums_subscription_uniq   (0054)  unique parcial, where not null
--   store_memberships_subscription_uniq  (0048)  unique parcial, where not null
--
-- Ésta quedó afuera. Era deuda barata mientras la columna se consultaba sólo en
-- el handler de bajas; dejó de serlo ahora que src/lib/monetization/renovacion.ts
-- correlaciona CADA `invoice.paid` con nuestra fila por esa columna
-- (.from("business_accounts").eq("stripe_subscription_id", subId)). Sin índice,
-- eso es un seq scan por renovación sobre una tabla que crece con cada negocio
-- verificado: el costo sube con el éxito del producto, que es la peor forma de
-- que suba.
--
-- POR QUÉ **UNIQUE** Y NO UN ÍNDICE COMÚN
--   Por la misma razón que lo es en las hermanas: una suscripción de Stripe
--   pertenece a UNA cuenta de negocio. Si dos filas compartieran `sub_...`, un
--   solo customer.subscription.updated actualizaría las dos y habría dos
--   negocios con presencia paga por un solo pago. El unique convierte esa clase
--   de bug en un error al escribir, en vez de en una diferencia de facturación
--   que se descubre meses después.
--
--   VERIFICADO ANTES DE CREARLO, contra la base y no por optimismo — un unique
--   sobre datos duplicados falla al crearse:
--       filas en business_accounts .......................... 1
--       filas con stripe_subscription_id no nulo ............ 0
--       valores duplicados ................................. 0  (ninguno)
--   Cero duplicados, así que el unique entra limpio.
--
--   PARCIAL (where stripe_subscription_id is not null) por lo mismo que las
--   hermanas: la columna es nullable a propósito —sin credenciales de Stripe la
--   app degrada elegante (§5.6 / §7 de ARQUITECTURA) y la cuenta existe sin
--   suscripción—, y en un unique común los NULL no chocan entre sí pero igual
--   ocupan el índice. Fuera del índice, no pesan y no se recorren.
--
-- POR QUÉ **SIN** `concurrently`
--   `business_accounts` pesa hoy 104 kB y tiene 1 fila. Un `create index` común
--   toma ACCESS EXCLUSIVE por el tiempo que tarda en leer esa fila:
--   microsegundos, sin ventana real de bloqueo. `concurrently`, además de ser
--   dos escaneos en vez de uno, NO puede correr dentro de un bloque de
--   transacción —que es como se aplican estas migraciones— y puede quedar como
--   índice INVÁLIDO si falla a mitad de camino, obligando a limpiarlo a mano.
--   Para esta tabla es todo costo y ningún beneficio. Si algún día la tabla
--   tuviera volumen, la conversación es otra; hoy no la tiene.
--
-- ADITIVO Y REVERSIBLE: no toca datos. Deshacerlo es
--   `drop index public.business_accounts_subscription_uniq;`
-- =============================================================================

create unique index if not exists business_accounts_subscription_uniq
  on public.business_accounts (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on index public.business_accounts_subscription_uniq is
  'Una suscripción de Stripe pertenece a UNA cuenta de negocio. Misma forma que listing_premiums_subscription_uniq (0054) y store_memberships_subscription_uniq (0048), que modelan lo mismo. Existe por dos motivos a la vez: correctitud —sin el unique, un solo customer.subscription.* podría actualizar dos filas y dejar dos negocios con presencia paga por un único pago— y velocidad, porque desde el observador de invoice.paid de src/lib/monetization/renovacion.ts esta columna se consulta por igualdad en CADA renovación, y sin índice eso era un seq scan que se encarece a medida que entran más negocios. Parcial porque la columna es nullable a propósito (sin credenciales de Stripe la cuenta existe sin suscripción, §5.6) y esas filas no tienen por qué ocupar el índice.';