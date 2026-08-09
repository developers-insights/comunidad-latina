-- =============================================================================
-- 0073_semilla_de_precios.sql — Comunidad Latina
--
-- Siembra `tenant_prices` (0072) con EXACTAMENTE los montos que hoy están
-- escritos en el código, para cada comunidad que ya existe.
--
-- POR QUÉ SEMBRAR SI LA AUSENCIA DE FILA YA CAE A LA CONSTANTE
--   Porque el editor del panel necesita algo que editar. Una pantalla que
--   arranca vacía obliga a quien la abre a tipear de memoria los siete precios
--   antes de poder cambiar uno — y tipear precios de memoria es exactamente
--   cómo se cobra mal. Con la semilla, el súper admin abre la pantalla, ve lo
--   que hoy se cobra, y toca el número que quiere cambiar.
--
-- POR QUÉ NADA CAMBIA DE COMPORTAMIENTO EL DÍA QUE ESTO SE APLICA
--   Los montos de abajo son copia literal de:
--     src/lib/stripe/index.ts        → PLANES_PRESENCIA (19/29/49 mensual,
--                                       190/290/490 anual), BOOST_PACKAGES y
--                                       POST_PROMO_PACKAGES (10/25/45)
--     src/lib/monetization/premium.ts → PREMIUM_LISTING_PRICE_CENTS (900)
--     store_memberships.price_cents   → default 1000 (0048)
--   El test `src/lib/pricing/seed-matches-constants.test.ts` lee ESTE archivo y
--   compara número por número contra esas constantes: si alguien toca una de
--   las dos puntas sin la otra, el test rompe. Es el único modo de que "la
--   semilla es la constante" siga siendo cierto dentro de seis meses.
--
-- POR QUÉ SOLO LOS TENANTS QUE YA EXISTEN
--   Un tenant nuevo NO necesita semilla: la ausencia de fila significa la
--   constante (0072), así que nace cobrando lo mismo que todos. Sembrar en el
--   alta obligaría a mantener sincronizados dos lugares —`createTenant` y esta
--   migración— y el día que se desincronicen la comunidad nueva cobraría
--   distinto sin que nadie lo haya decidido.
--
-- IDEMPOTENTE: `on conflict do nothing` contra el UNIQUE de 0072. Si alguien ya
-- cargó un precio a mano antes de esta migración, se respeta el suyo — la
-- semilla NUNCA pisa una decisión comercial ya tomada.
-- =============================================================================

begin;

insert into public.tenant_prices (tenant_id, product, variant, billing_interval, amount_cents, currency)
select t.id, p.product, p.variant, p.billing_interval, p.amount_cents, 'USD'
  from public.tenants t
  cross join (values
    -- Presencia Verificada — PLANES_PRESENCIA. El anual son 10 mensualidades
    -- (dos meses gratis), no 12: la relación es parte del precio, no un
    -- descuento que se recalcula en la pantalla.
    ('presencia',        'basico',    'mensual',  1900),
    ('presencia',        'basico',    'anual',   19000),
    ('presencia',        'destacado', 'mensual',  2900),
    ('presencia',        'destacado', 'anual',   29000),
    ('presencia',        'pro',       'mensual',  4900),
    ('presencia',        'pro',       'anual',   49000),

    -- Impulso geolocalizado de un aviso — BOOST_PACKAGES. Cobro único.
    ('boost',            '7d',        'unico',    1000),
    ('boost',            '14d',       'unico',    2500),
    ('boost',            '30d',       'unico',    4500),

    -- Campaña de una publicación — POST_PROMO_PACKAGES. Espeja al boost a
    -- propósito (mismos montos, mismas duraciones): el sujeto cambia, el
    -- precio de la visibilidad no.
    ('post_promo',       '7d',        'unico',    1000),
    ('post_promo',       '14d',       'unico',    2500),
    ('post_promo',       '30d',       'unico',    4500),

    -- Membresía de tienda del marketplace — default de store_memberships.price_cents.
    ('store_membership', 'estandar',  'mensual',  1000),

    -- Aviso premium autoservicio (0054) — PREMIUM_LISTING_PRICE_CENTS.
    ('listing_premium',  'estandar',  'mensual',   900)
  ) as p(product, variant, billing_interval, amount_cents)
on conflict (tenant_id, product, variant, billing_interval) do nothing;

commit;
