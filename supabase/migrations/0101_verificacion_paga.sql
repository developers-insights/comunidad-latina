-- =============================================================================
-- 0101_verificacion_paga.sql — Comunidad Latina
--
-- EL CHECK AZUL. Pedido textual del cliente: «falta dar la opción del check
-- azul», «el mismo que tiene Instagram», «pero la gente tiene que pagar para
-- tener el check azul». Tres precios según a quién se le vende: USD 6.99 una
-- persona, USD 9.99 un negocio, USD 19.99 un profesional. Y: «cuando pagan por
-- el check azul, se le da al comienzo del mes (7 días) un boost por pagar el
-- verificado».
--
-- ── LO PRIMERO, PORQUE DE ACÁ SALE TODO EL MODELO ────────────────────────────
-- ESTO NO ES LA VERIFICACIÓN DE IDENTIDAD, Y NO PUEDE PARECERLO.
--
-- La plataforma ya tiene DOS cosas que se llaman "verificado" y que esta
-- migración no toca ni renombra:
--
--   1. `profiles.identity_verified` (§5.4) — Stripe Identity. La persona mostró
--      un documento y Stripe dijo que sí. Es GRATIS, suma Trust Score, y su
--      insignia es un ESCUDO VERDE (`IdentityBadge`). Significa un hecho
--      comprobado por un tercero.
--   2. `business_accounts.plan` / "Presencia Verificada" (§7) — la suscripción
--      del negocio en el directorio, USD 19/29/49. Es OTRO producto: prioridad
--      de listado, no insignia.
--
-- Lo que se agrega acá es una TERCERA cosa, y la diferencia importa tanto que
-- está en el esquema y no sólo en la UI: el check azul es una INSIGNIA PAGA.
-- Lo que acredita es que la cuenta paga una suscripción activa. Nada más.
--
-- POR ESO `identity_verified` ES REQUISITO PREVIO Y NO UN EXTRA.
--   El cliente lo pidió con todas las letras en el mismo hilo: «Stripe Identity
--   para los usuarios regulares que quieren vender o hacer negocios en la app»,
--   «negocios lo mismo, Stripe Identity», «se tienen que verificar con Stripe».
--   Pero además hay una razón que sola bastaría: una insignia que se compra sin
--   comprobar NADA es una mentira con forma de tilde. Quien la ve entiende
--   "esta cuenta es quien dice ser" —eso es lo que enseñó Instagram— y si lo
--   único detrás es una tarjeta, la plataforma está vendiendo confianza que no
--   verificó. Es exactamente el riesgo que §11 ya nos prohíbe en
--   `verification_checks` («prohibido un badge mudo "Verificado"»).
--   Con Identity como puerta previa, el check azul significa algo verdadero:
--   IDENTIDAD CONFIRMADA CON DOCUMENTO + SUSCRIPCIÓN AL DÍA. Las dos cosas, y
--   se dicen las dos en la UI.
--   Esa exigencia vive en la server action y NO como CHECK de esta tabla, a
--   propósito: si alguien pierde la verificación de identidad después (una
--   revocación, un fraude detectado) lo que corresponde es apagar la insignia,
--   no volver la fila de facturación imposible de actualizar.
--
-- POR ESO TAMPOCO SUMA TRUST SCORE. Ni un punto. §7 es no negociable: pagar
-- JAMÁS altera el Trust Score ni el resultado del Escudo Anti-Estafa. Si el
-- check azul sumara reputación, sería reputación comprada.
--
-- ── EL SUJETO ES LA CUENTA, NO EL AVISO ──────────────────────────────────────
-- Una sola fila por persona (`unique (profile_id)`), igual que Instagram: una
-- cuenta, un check. `subject_type` (persona | negocio | profesional) NO es un
-- sujeto distinto, es EL ESCALÓN DE PRECIO y lo que la insignia dice de quién
-- la lleva.
--
-- La alternativa —un sujeto polimórfico (perfil | aviso)— se descartó y conviene
-- que quede escrito por qué: un negocio que publica cinco avisos tendría que
-- elegir cuál lleva el check, la insignia aparecería y desaparecería según qué
-- aviso estés mirando, y habría que duplicar RLS y verificación de propiedad
-- para cada tipo de sujeto. El check de Instagram está al lado del NOMBRE de la
-- cuenta, no al lado de cada publicación. Acá igual: cuelga del perfil, y un
-- aviso lo hereda de su `created_by` porque la cuenta detrás del aviso es la
-- que está verificada. Es lo que la insignia dice y es lo único que es cierto.
--
-- ── EL REGALO MENSUAL: UN CRÉDITO, NO UN IMPULSO AUTOMÁTICO ──────────────────
-- «Se le da al comienzo del mes (7 días) un boost». La lectura literal —crear
-- un `boosts` activo apenas se cobra la factura— no se puede implementar sin
-- inventar dos decisiones que no son nuestras:
--
--   · SOBRE QUÉ AVISO. Una persona verificada puede tener cero avisos (y el
--     check azul se vende también a personas que no publican nada), o quince.
--     Elegirle uno "el más reciente" es gastarle el regalo en lo que a ella no
--     le servía, y una vez encendido no se puede devolver: los siete días
--     corren igual.
--   · CUÁNDO. El valor de un impulso depende de cuándo se usa. Encenderlo el
--     día 1 del ciclo, sí o sí, es tirarlo a la basura de quien todavía no
--     publicó lo que quería impulsar.
--
-- Por eso lo que se otorga es un CRÉDITO (`verification_boost_grants`) que la
-- persona canjea sobre el aviso que ella elija, y el canje SÍ crea un `boosts`
-- normal —el mismo motor de siempre, `src/lib/boosts/`—, con `amount_cents = 0`
-- y `origin = 'verificacion'`. El crédito vence al terminar el período: es un
-- regalo MENSUAL, no un saldo que se acumula. Sin vencimiento, alguien podría
-- juntar doce créditos y encender tres meses seguidos de impulso al año
-- siguiente, que no es lo que se prometió ni lo que se cobró.
--
-- LA IDEMPOTENCIA DEL REGALO ES UN ÍNDICE, NO UNA VERIFICACIÓN.
--   `unique (subscription_id, period_start)`. Un webhook repetido, un reintento
--   de Stripe, el cron de red y el webhook corriendo el mismo día: todos chocan
--   contra el mismo UNIQUE y el segundo no escribe. La única forma de garantizar
--   "un solo regalo por período" que no depende de que el código se acuerde de
--   preguntar antes.
--
-- ── PRECIOS: EN `tenant_prices`, COMO TODO LO DEMÁS ──────────────────────────
-- 6.99 / 9.99 / 19.99 son los DEFAULT del cliente, no una constante clavada.
-- Entran al catálogo de 0072 como producto `verificacion` con tres variantes, y
-- cada comunidad puede moverlos desde el panel sin un deploy. Es la misma
-- doctrina de 0073/0092: la semilla copia lo que dice el código, el test
-- `src/lib/pricing/catalog.test.ts` compara los dos lados fila por fila, y la
-- ausencia de fila cae a la constante para que nunca exista un tenant sin
-- precio.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ───────────────────────────────
--   · No toca `business_verifications` (0031). Esa tabla existe en el esquema y
--     no la referencia una sola línea de `src/`: es letra muerta desde que se
--     creó. Revivirla para colgarle un producto pago sería atar plata a un
--     modelo que nadie usa ni probó. Si algún día se usa, será por su propio
--     mérito y en su propia migración.
--   · No toca `identity_verified`, ni su webhook, ni su bonus de Trust Score.
--     La verificación de identidad sigue siendo gratis. Que ahora además sea la
--     puerta de entrada a un producto pago no la vuelve paga: sin suscripción,
--     el escudo verde se sigue dando igual que antes.
--   · No agrega el check a `verification_checks` (§11). Esa tabla es para
--     hechos comprobados contra registros oficiales, fechados y con descriptor
--     literal. Una suscripción paga no es un hecho de ese tipo y mezclarlas
--     sería, otra vez, vender confianza que no verificamos.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · El catálogo de precios: producto `verificacion`
--
-- Se reemplazan los CHECK enteros (no se "agrega" un valor: en Postgres un
-- CHECK se reescribe) siguiendo el mismo do-block que escribió la 0092 — busca
-- la constraint POR SU DEFINICIÓN y no sólo por su nombre, porque una base que
-- viene de un restore puede tenerla con otro nombre y un `drop ... if exists`
-- no la encontraría, no fallaría, y la migración "aplicaría bien" dejando viva
-- la constraint vieja que rechaza el producto nuevo. El silencio es el modo de
-- falla que hay que evitar.
-- ---------------------------------------------------------------------------
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'tenant_prices'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%product%=%ANY%'
  loop
    execute format('alter table public.tenant_prices drop constraint %I', v_nombre);
  end loop;
end;
$$;

alter table public.tenant_prices
  drop constraint if exists tenant_prices_product_check;
alter table public.tenant_prices
  add constraint tenant_prices_product_check check (product in (
    'presencia',          -- Presencia Verificada del negocio
    'listing_premium',    -- Aviso premium autoservicio (0054)
    'boost',              -- Impulso de un aviso: la DURACIÓN
    'boost_scope',        -- Impulso de un aviso: el ALCANCE (recargo, 0092)
    'post_promo',         -- Campaña de una publicación
    'store_membership',   -- Membresía de tienda del marketplace
    'verificacion'        -- Check azul: insignia paga de la cuenta (0101)
  ));

do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'tenant_prices'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%variant%=%ANY%'
  loop
    execute format('alter table public.tenant_prices drop constraint %I', v_nombre);
  end loop;
end;
$$;

alter table public.tenant_prices
  drop constraint if exists tenant_prices_variant_check;
alter table public.tenant_prices
  add constraint tenant_prices_variant_check check (variant in (
    'basico', 'destacado', 'pro',        -- planes de presencia
    '7d', '14d', '30d',                  -- paquetes de impulso y de campaña
    'local', 'nacional', 'global',       -- alcance del impulso (0092)
    'persona', 'negocio', 'profesional', -- a quién se le vende el check (0101)
    'estandar'                           -- productos de variante única
  ));

comment on column public.tenant_prices.product is
  'Qué se cobra. Espeja los flujos de Checkout que existen hoy: presencia (suscripción del negocio), listing_premium (aviso premium autoservicio 0054), boost (duración del impulso), boost_scope (recargo por alcance 0092), post_promo (campaña de publicación), store_membership (membresía de tienda) y verificacion (check azul de la cuenta, 0101).';
comment on column public.tenant_prices.variant is
  'El escalón dentro del producto: el plan (basico/destacado/pro), la duración del paquete (7d/14d/30d), el alcance del impulso (local/nacional/global) o a quién se le vende el check azul (persona/negocio/profesional). "estandar" es para los productos que tienen un solo precio (listing_premium, store_membership) — un NULL acá rompería el UNIQUE, que en Postgres no distingue dos NULL.';

-- La semilla. Mismos criterios que 0073/0092: sólo los tenants que ya existen
-- (uno nuevo cae a la constante y nace cobrando lo mismo), e idempotente contra
-- el UNIQUE — si alguien ya cargó un precio a mano, se respeta el suyo.
insert into public.tenant_prices (tenant_id, product, variant, billing_interval, amount_cents, currency)
select t.id, p.product, p.variant, p.billing_interval, p.amount_cents, 'USD'
  from public.tenants t
  cross join (values
    -- Check azul — VERIFICACION_TIERS de src/lib/verificacion/catalogo.ts.
    -- Precios textuales del cliente. Terminan en .99 porque así los dijo, y un
    -- precio es una decisión comercial: no se "redondea para que quede lindo".
    ('verificacion',    'persona',      'mensual',   699),
    ('verificacion',    'negocio',      'mensual',   999),
    ('verificacion',    'profesional',  'mensual',  1999)
  ) as p(product, variant, billing_interval, amount_cents)
on conflict (tenant_id, product, variant, billing_interval) do nothing;

-- ---------------------------------------------------------------------------
-- 2 · La suscripción del check azul
-- ---------------------------------------------------------------------------
create table if not exists public.verification_subscriptions (
  id                     uuid primary key default app.uuid_v7(),
  tenant_id              uuid not null references public.tenants(id),
  profile_id             uuid not null references public.profiles(id) on delete cascade,

  subject_type           text not null check (subject_type in ('persona', 'negocio', 'profesional')),

  -- Los mismos 4 estados que persisten store_memberships (0048) y
  -- listing_premiums (0054), traducidos por `mapStripeSubscriptionStatus` desde
  -- los 9 de Stripe. Un quinto estado propio sería un quinto significado que
  -- después hay que explicarle a alguien.
  status                 text not null default 'expired'
                           check (status in ('active', 'past_due', 'canceled', 'expired')),

  -- LO PACTADO al abrir el Checkout, no lo que dice `tenant_prices` hoy. Si la
  -- comunidad sube el precio, esta fila sigue diciendo qué se pactó — que es lo
  -- que hace explicable un cobro viejo (mismo motivo que tenant_price_history).
  price_cents            integer not null check (price_cents >= 0),
  currency               text not null check (currency ~ '^[A-Z]{3}$'),

  stripe_customer_id     text,
  stripe_subscription_id text,

  -- El período VIGENTE. Ojo con de dónde salen: desde la API que usa
  -- stripe-node 22, `current_period_start/end` NO viven en la Subscription sino
  -- en cada SubscriptionItem (ver el comentario largo de
  -- src/lib/stripe/subscription.ts, que este repo ya pagó una vez). `period_start`
  -- es además la CLAVE DEL REGALO: es lo que hace que un período tenga un solo
  -- boost por más veces que llegue el evento.
  current_period_start   timestamptz,
  current_period_end     timestamptz,

  started_at             timestamptz,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- UNA CUENTA, UN CHECK. Es lo que hace idempotente el alta: el webhook hace
  -- `upsert ... on conflict (profile_id)` y un reintento reescribe los mismos
  -- valores en la MISMA fila en vez de crear una segunda suscripción.
  unique (profile_id)
);

comment on table public.verification_subscriptions is
  'Suscripción del CHECK AZUL (0101): la insignia paga de una cuenta. NO es identity_verified (Stripe Identity, gratis, escudo verde) ni Presencia Verificada (0048/§7, el plan del negocio en el directorio) — son tres cosas distintas y confundirlas es engañoso para quien mira la insignia. Lo que acredita el check azul es: identidad ya confirmada con documento (requisito previo que exige la server action) MÁS suscripción al día. Una fila por perfil. El estado lo escribe SOLO el webhook de Stripe o el cron via service_role: las 3 policies de escritura están en false, igual que boosts (0016), store_memberships (0048) y listing_premiums (0054). Pagar esto NO suma Trust Score ni altera el Escudo Anti-Estafa (§7).';
comment on column public.verification_subscriptions.subject_type is
  'A quién se le vendió el check y, por lo tanto, qué precio rige: persona (USD 6.99), negocio (USD 9.99) o profesional (USD 19.99) — los defaults del cliente, configurables por comunidad en tenant_prices. NO es un sujeto distinto: el sujeto siempre es la CUENTA (profile_id). Es el escalón de precio y lo que la insignia dice de quién la lleva.';
comment on column public.verification_subscriptions.price_cents is
  'Lo PACTADO al abrir el Checkout, en centavos enteros. No se recalcula cuando la comunidad cambia su precio: sirve para explicar un cobro viejo y para que una reactivación no se compare contra un número que ya no es el que se acordó.';
comment on column public.verification_subscriptions.current_period_start is
  'Inicio del período pagado vigente. Es la CLAVE DE IDEMPOTENCIA del regalo mensual: verification_boost_grants es unique (subscription_id, period_start), así que un período no puede tener dos boosts de regalo por más veces que Stripe reintente el webhook o corra el cron de red.';
comment on column public.verification_subscriptions.current_period_end is
  'Fin del período pagado. Lo lee el cron expire-verification-subscriptions para apagar la insignia sola. ⚠️ Sale de subscription.items[].current_period_end, NO del objeto Subscription: se movió de lugar y leerlo del raíz devuelve NULL, el cron nunca vence la fila y el check queda encendido para siempre.';

create index if not exists verification_subscriptions_tenant_status_idx
  on public.verification_subscriptions (tenant_id, status);
create index if not exists verification_subscriptions_profile_idx
  on public.verification_subscriptions (profile_id);
create index if not exists verification_subscriptions_expiry_idx
  on public.verification_subscriptions (current_period_end)
  where status in ('active', 'past_due');
create unique index if not exists verification_subscriptions_stripe_sub_uniq
  on public.verification_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

drop trigger if exists verification_subscriptions_set_updated_at on public.verification_subscriptions;
create trigger verification_subscriptions_set_updated_at
before update on public.verification_subscriptions
for each row execute function extensions.moddatetime(updated_at);

alter table public.verification_subscriptions enable row level security;
alter table public.verification_subscriptions force row level security;

-- Lectura: el dueño ve la suya, el staff de la comunidad ve las de su comunidad.
-- NO es pública: el estado de facturación de alguien (past_due, cuánto paga,
-- qué customer de Stripe tiene) no le importa a la comunidad. Lo que SÍ es
-- público es el RESULTADO —la insignia— y para eso está profiles.verified_badge,
-- que es un booleano sin plata adentro.
create policy verification_subscriptions_select on public.verification_subscriptions
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

-- Escritura EXCLUSIVA de service_role (server action gateada + webhook + cron).
-- Las tres en false, que es el contrato del enumerador: 4 policies nombradas.
-- Doctrina de boosts (0016): nadie se activa a sí mismo el estado por el que
-- paga. Si esta tabla fuera escribible por su dueño, el check azul sería un
-- INSERT gratis.
create policy verification_subscriptions_insert on public.verification_subscriptions
for insert to authenticated
with check (false);

create policy verification_subscriptions_update on public.verification_subscriptions
for update to authenticated
using (false)
with check (false);

create policy verification_subscriptions_delete on public.verification_subscriptions
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 3 · El regalo mensual: un crédito de impulso por período pagado
-- ---------------------------------------------------------------------------
create table if not exists public.verification_boost_grants (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants(id),
  subscription_id uuid not null references public.verification_subscriptions(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,

  -- El período que lo generó. Con `subscription_id` forma el UNIQUE que hace
  -- imposible el doble regalo.
  period_start    timestamptz not null,

  duration_days   integer not null default 7 check (duration_days in (7, 14, 30)),

  status          text not null default 'pendiente'
                    check (status in ('pendiente', 'usado', 'vencido')),

  -- El impulso que salió de canjearlo. `on delete set null` y no cascade: si
  -- algún día se borrara el boost, el crédito tiene que seguir diciendo que se
  -- usó — si volviera a 'pendiente' se canjearía dos veces.
  boost_id        uuid references public.boosts(id) on delete set null,

  -- Vence con el período. Un regalo MENSUAL no se acumula: sin esto, doce meses
  -- de suscripción serían doce impulsos guardados para gastar todos juntos.
  expires_at      timestamptz not null,

  granted_at      timestamptz not null default now(),
  redeemed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- ⭐ LA IDEMPOTENCIA DEL REGALO, EN EL ESQUEMA Y NO EN EL CÓDIGO.
  -- Un webhook repetido, un reintento de Stripe tras un 500, el cron de red
  -- corriendo el mismo día que llegó la factura: los tres intentan insertar la
  -- MISMA tupla y sólo el primero escribe. No depende de que nadie se acuerde
  -- de preguntar "¿ya se lo di?" antes.
  unique (subscription_id, period_start)
);

comment on table public.verification_boost_grants is
  'Crédito de impulso que regala la suscripción del check azul (0101): «cuando pagan por el check azul, se le da al comienzo del mes (7 días) un boost». Es un CRÉDITO y no un impulso ya encendido porque la app no puede elegirle a la persona sobre qué aviso ni cuándo gastarlo (una cuenta verificada puede tener cero avisos o quince). Se canjea sobre el aviso que ella elija y ahí sí nace un boosts normal con amount_cents=0 y origin=''verificacion''. Vence al terminar el período: es mensual, no acumulable. El UNIQUE (subscription_id, period_start) es lo que hace imposible el doble regalo.';
comment on column public.verification_boost_grants.period_start is
  'El período que generó el crédito, tal como lo informa Stripe. Junto a subscription_id forma el UNIQUE: un período, un regalo, sin importar cuántas veces llegue el evento.';
comment on column public.verification_boost_grants.status is
  'pendiente (dado, sin canjear) | usado (ya generó su boost, ver boost_id) | vencido (se terminó el período sin canjearlo — lo marca el cron expire-verification-boost-grants). Un crédito NUNCA vuelve de usado a pendiente.';
comment on column public.verification_boost_grants.expires_at is
  'Fin del período que lo generó. Después de esta fecha el crédito no se puede canjear y el cron lo pasa a vencido.';

create index if not exists verification_boost_grants_profile_idx
  on public.verification_boost_grants (tenant_id, profile_id, status);
-- El de arriba NO cubre la FK a `profiles`: `profile_id` va segundo, y un índice
-- compuesto sólo sirve como cobertura de FK cuando la columna es la PRIMERA.
-- Lo detectó `get_advisors` (unindexed_foreign_keys). Sin este índice, borrar
-- una cuenta obliga a un seq scan de toda la tabla para resolver el ON DELETE
-- CASCADE — barato hoy con cero filas, caro justo cuando el producto funcione.
create index if not exists verification_boost_grants_profile_fk_idx
  on public.verification_boost_grants (profile_id);
create index if not exists verification_boost_grants_pendientes_idx
  on public.verification_boost_grants (expires_at)
  where status = 'pendiente';
create index if not exists verification_boost_grants_subscription_idx
  on public.verification_boost_grants (subscription_id);
create index if not exists verification_boost_grants_boost_idx
  on public.verification_boost_grants (boost_id);

drop trigger if exists verification_boost_grants_set_updated_at on public.verification_boost_grants;
create trigger verification_boost_grants_set_updated_at
before update on public.verification_boost_grants
for each row execute function extensions.moddatetime(updated_at);

alter table public.verification_boost_grants enable row level security;
alter table public.verification_boost_grants force row level security;

-- Lectura: su dueño (necesita ver "tenés un impulso de regalo sin usar") y el
-- staff de la comunidad. No es público: cuántos regalos tiene alguien sin usar
-- no es información de la comunidad.
create policy verification_boost_grants_select on public.verification_boost_grants
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

-- Escritura EXCLUSIVA de service_role. Misma doctrina que la tabla de arriba y
-- que boosts: si el dueño pudiera hacer UPDATE, se re-marcaría 'pendiente' un
-- crédito ya usado y tendría impulsos gratis ilimitados.
create policy verification_boost_grants_insert on public.verification_boost_grants
for insert to authenticated
with check (false);

create policy verification_boost_grants_update on public.verification_boost_grants
for update to authenticated
using (false)
with check (false);

create policy verification_boost_grants_delete on public.verification_boost_grants
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 4 · `boosts` acepta impulsos de regalo
--
-- El motor de impulsos NO se reescribe: un boost de regalo es un boost normal
-- —misma tabla, mismo ranking de src/lib/boosts/select.ts, mismo chip
-- "Patrocinado" (FTC §255: es publicidad igual, que sea gratis para quien la
-- recibe no la vuelve orgánica)—. Lo único que cambia es de dónde salió.
-- ---------------------------------------------------------------------------
alter table public.boosts
  add column if not exists origin text not null default 'compra'
    check (origin in ('compra', 'verificacion'));

comment on column public.boosts.origin is
  'De dónde salió el impulso: compra (pagado con su propio Checkout) o verificacion (canje del crédito mensual del check azul, 0101). Existe para que el tablero de ingresos (0074) pueda distinguir un impulso que entró plata de uno que se regaló — los dos ocupan el mismo lugar pago, pero sólo uno se factura.';

-- El CHECK de monto pasa a ser CONTEXTUAL en vez de relajarse.
--
-- Lo obvio era bajar `amount_cents > 0` a `>= 0` para que entre el regalo. Sería
-- peor que lo que hay: dejaría pasar un impulso COMPRADO por cero pesos, que es
-- exactamente el bug que ninguna de las verificaciones del webhook atrapa
-- (comparan lo cobrado contra la fila, y si la fila dice 0 y se cobró 0,
-- coinciden). Así queda más estricto que antes: un impulso comprado sigue
-- exigiendo plata, y sólo el de regalo puede valer cero.
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'boosts'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%amount_cents%>%0%'
       and pg_get_constraintdef(c.oid) not like '%origin%'
  loop
    execute format('alter table public.boosts drop constraint %I', v_nombre);
  end loop;
end;
$$;

alter table public.boosts
  drop constraint if exists boosts_amount_coherente_con_origen;
alter table public.boosts
  add constraint boosts_amount_coherente_con_origen check (
    (origin = 'compra'       and amount_cents > 0)
    or (origin = 'verificacion' and amount_cents = 0)
  );

-- ---------------------------------------------------------------------------
-- 5 · La insignia, espejada en `profiles`
--
-- POR QUÉ UNA COLUMNA ESPEJO Y NO UN JOIN
-- Porque la insignia se pinta al lado de CADA nombre: en el feed, en la lista
-- de creadores, en cada tarjeta de aviso, en cada comentario. Resolverla con un
-- join contra verification_subscriptions en cada render sería agregar una
-- consulta al camino más caliente de la app para leer un booleano. Es la misma
-- doctrina que ya escribieron app.mirror_store_active() (0048) y
-- app.mirror_listing_tier() (0054): el estado vive en la tabla de facturación,
-- el ESPEJO vive donde se lee.
--
-- Y hay una razón de privacidad además de una de performance: la fila de
-- facturación no es pública (cuánto paga alguien, si está en past_due, qué
-- customer de Stripe tiene). El espejo publica UN BOOLEANO y nada más.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists verified_badge boolean not null default false;
alter table public.profiles
  add column if not exists verified_badge_type text
    check (verified_badge_type is null or verified_badge_type in ('persona', 'negocio', 'profesional'));

comment on column public.profiles.verified_badge is
  'Insignia PÚBLICA del check azul: la cuenta tiene una suscripción de verificación ACTIVA (0101). Espejo mantenido por trigger desde verification_subscriptions — la app NUNCA la escribe (guarda protect_profile_columns), igual que identity_verified. NO confundir con identity_verified, que es el escudo verde de Stripe Identity, es gratis y significa otra cosa: un documento comprobado. El check azul significa identidad confirmada MÁS suscripción al día; la UI dice las dos cosas.';
comment on column public.profiles.verified_badge_type is
  'Qué escalón contrató quien lleva el check: persona | negocio | profesional. Sirve para que la insignia diga de qué tipo de cuenta se trata sin exponer la fila de facturación. NULL cuando no hay insignia activa.';

-- Guarda ampliada. SIN ESTO EL CHECK AZUL ES GRATIS: `profiles_update` (0003)
-- deja que cada quien edite su propio perfil, así que un UPDATE directo por
-- PostgREST con `verified_badge = true` se auto-otorgaba la insignia paga. Se
-- suman a las columnas solo-service_role junto a role/identity_verified/
-- phone_verified/email_verified/tenant_id.
create or replace function app.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sin claims (postgres directo, pg_cron, seeds) o service_role: permitido.
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.identity_verified is distinct from old.identity_verified
     or new.identity_verified_at is distinct from old.identity_verified_at
     or new.phone_verified is distinct from old.phone_verified
     or new.email_verified is distinct from old.email_verified
     or new.verified_badge is distinct from old.verified_badge
     or new.verified_badge_type is distinct from old.verified_badge_type
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'PROTECTED_COLUMNS: role/identity_verified/phone_verified/email_verified/verified_badge/tenant_id de profiles solo se modifican via service_role';
  end if;

  if (new.account_status is distinct from old.account_status
      or new.suspended_until is distinct from old.suspended_until)
     and not app.is_staff() then
    raise exception 'PROTECTED_COLUMNS: account_status/suspended_until solo se modifican via moderación';
  end if;

  return new;
end;
$$;

comment on function app.protect_profile_columns() is
  'Impide que un usuario autenticado se auto-asigne rol, flags de verificación (identity/phone/email), la insignia paga del check azul (verified_badge/verified_badge_type, 0101) o un cambio de tenant por UPDATE directo. Desde 0021 también guarda account_status/suspended_until (staff/service).';

-- El espejo. Se dispara con CADA cambio de la suscripción, incluido el borrado:
-- una fila que desaparece tiene que apagar la insignia igual que una que pasa a
-- 'canceled'. Si no, una baja dejaría el check encendido para siempre.
create or replace function app.mirror_verified_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_activa  boolean;
  v_tipo    text;
begin
  -- Se ramifica por TG_OP y NO con `coalesce(new.profile_id, old.profile_id)`.
  -- En PL/pgSQL, tocar `new.<campo>` dentro de un trigger de DELETE no devuelve
  -- NULL: LANZA ("record new is not assigned yet"), y el coalesce nunca llega a
  -- evaluarse. El síntoma sería que borrar una suscripción falla con un error
  -- críptico y la insignia queda encendida para siempre.
  if tg_op = 'DELETE' then
    v_profile := old.profile_id;
  else
    v_profile := new.profile_id;
  end if;

  -- Se recalcula LEYENDO la tabla en vez de deducirlo de NEW, para que el
  -- resultado sea el mismo venga el trigger de un insert, un update o un
  -- delete — y para que un DELETE no tenga que adivinar si quedaba otra fila.
  select vs.status = 'active', vs.subject_type
    into v_activa, v_tipo
    from public.verification_subscriptions vs
   where vs.profile_id = v_profile;

  update public.profiles p
     set verified_badge = coalesce(v_activa, false),
         verified_badge_type = case when coalesce(v_activa, false) then v_tipo else null end
   where p.id = v_profile
     and (p.verified_badge is distinct from coalesce(v_activa, false)
          or p.verified_badge_type is distinct from
             (case when coalesce(v_activa, false) then v_tipo else null end));

  -- AFTER trigger: el valor de retorno se ignora, pero tiene que existir y no
  -- puede tocar `new` en un DELETE (mismo motivo que arriba).
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function app.mirror_verified_badge() is
  'Espeja verification_subscriptions.status en profiles.verified_badge (0101), que es la columna que lee cada render de insignia. Mismo patrón que app.mirror_store_active() (0048) y app.mirror_listing_tier() (0054): el estado de facturación vive en su tabla, el booleano público vive donde se lee. Sólo escribe si el valor CAMBIA, para no despertar triggers de profiles en cada sincronización de Stripe.';

drop trigger if exists verification_subscriptions_mirror_badge on public.verification_subscriptions;
create trigger verification_subscriptions_mirror_badge
after insert or update or delete on public.verification_subscriptions
for each row execute function app.mirror_verified_badge();

-- ---------------------------------------------------------------------------
-- 6 · pg_cron — que nada quede encendido ni prometido de más
--
-- Los tres jobs son IDEMPOTENTES por construcción: el primero y el segundo sólo
-- apagan (correrlos dos veces no cambia nada), y el tercero choca contra el
-- UNIQUE del regalo.
-- ---------------------------------------------------------------------------

-- (a) Vencimiento de la suscripción. Espeja expire-store-memberships (0048):
-- una fila cuyo período terminó y que Stripe no renovó se apaga sola, y el
-- trigger de arriba apaga la insignia en la misma transacción. Sin esto, un
-- webhook perdido dejaría el check azul encendido sin que nadie pague.
do $$
begin
  perform cron.unschedule('expire-verification-subscriptions');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'expire-verification-subscriptions',
  '50 4 * * *',
  $$update public.verification_subscriptions
       set status = 'expired'
     where status in ('active', 'past_due')
       and current_period_end is not null
       and current_period_end < now() - interval '2 days'$$
);

-- Los DOS DÍAS DE GRACIA no son pereza: el evento de renovación puede llegar
-- unos minutos —o unas horas, si hubo un reintento— después de que venza el
-- período. Apagar en el instante exacto le sacaría la insignia a alguien que sí
-- pagó, por una carrera entre el reloj del cron y el webhook de Stripe. Y la
-- baja REAL no depende de este cron: llega por customer.subscription.deleted,
-- que la apaga en el momento. Esto es sólo la red por si ese evento se pierde.

-- (b) Vencimiento del crédito sin canjear. Un regalo mensual que no se usó se
-- pierde: es lo que dice la pantalla al contratarlo, y tiene que ser cierto.
do $$
begin
  perform cron.unschedule('expire-verification-boost-grants');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'expire-verification-boost-grants',
  '55 4 * * *',
  $$update public.verification_boost_grants
       set status = 'vencido'
     where status = 'pendiente'
       and expires_at < now()$$
);

-- (c) LA RED DEL REGALO. Si `invoice.paid` se pierde del todo —el endpoint
-- caído más de los tres días que Stripe reintenta—, la persona pagó y no
-- recibió su impulso. Este job le da el crédito del período VIGENTE que la base
-- ya conoce.
--
-- POR QUÉ NO PUEDE DUPLICAR NADA: inserta exactamente la misma tupla
-- (subscription_id, current_period_start) que insertaría el webhook, y el
-- UNIQUE la rechaza. `on conflict do nothing` lo vuelve silencioso. Los dos
-- caminos escriben contra la misma llave, así que "webhook + cron el mismo día"
-- da UN crédito, no dos.
--
-- POR QUÉ NO INVENTA PERÍODOS: sólo usa `current_period_start` de la fila, que
-- lo escribe el webhook desde el objeto de Stripe. El cron nunca calcula una
-- fecha de facturación por su cuenta — hacerlo sería reimplementar el calendario
-- de Stripe y regalarle impulsos a quien no pagó.
do $$
begin
  perform cron.unschedule('backfill-verification-boost-grants');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'backfill-verification-boost-grants',
  '5 5 * * *',
  $$insert into public.verification_boost_grants
      (tenant_id, subscription_id, profile_id, period_start, expires_at)
    select vs.tenant_id, vs.id, vs.profile_id, vs.current_period_start, vs.current_period_end
      from public.verification_subscriptions vs
     where vs.status = 'active'
       and vs.current_period_start is not null
       and vs.current_period_end is not null
       and vs.current_period_end > now()
    on conflict (subscription_id, period_start) do nothing$$
);

commit;
