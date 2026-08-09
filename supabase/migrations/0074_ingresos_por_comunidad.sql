-- =============================================================================
-- 0074_ingresos_por_comunidad.sql — Comunidad Latina
--
-- El pliego pide un tablero de pagos e ingresos dentro del panel. El dato ya
-- existe: `payment_events` (0008) guarda el evento CRUDO de Stripe con su
-- payload completo. Lo que no existía era una forma de mirarlo sin abrir el
-- Table Editor de Supabase.
--
-- POR QUÉ NO SE AFLOJA LA RLS DE `payment_events` Y SE USA UNA FUNCIÓN
--   Sus cuatro policies son `false`: nadie con un JWT de usuario lee esa tabla,
--   ni el súper admin. Es correcto y NO se toca. El payload crudo de Stripe
--   trae mail del comprador, datos de facturación y —en los eventos de
--   Identity— el resultado de una verificación de documento. Un tablero de
--   ingresos necesita SUMAS, no expedientes. Estas funciones devuelven montos,
--   monedas y tipos de evento; el payload no sale nunca de la base.
--
--   El costo es un advisory conocido ("Signed-In Users Can Execute SECURITY
--   DEFINER Function"), el mismo que ya tienen `admin_metrics_overview` (0055)
--   y `job_application_tally` (0042). Es el doble candado deliberado de la
--   casa: el panel filtra por rol y la función VUELVE a filtrar por rol adentro
--   de la base, así que pegarle directo por PostgREST sin ser admin devuelve
--   FORBIDDEN. La alternativa —abrir la tabla a `domain_admin`— cambiaría un
--   WARN de linter por una fuga real de datos personales.
--
-- VIVEN EN `public` A PROPÓSITO (lección de 0070/0071): PostgREST sólo expone
-- `public` y `graphql_public`. Una función que la aplicación tiene que llamar y
-- que vive en `app` es una función que la aplicación no puede llamar.
--
-- CÓMO SE CUENTA EL DINERO (y por qué no se cuenta dos veces)
--   Stripe emite VARIOS eventos por un mismo cobro. Para una suscripción llegan
--   `checkout.session.completed` Y `invoice.paid` por el primer pago; para un
--   pago único llegan `checkout.session.completed`, `payment_intent.succeeded` y
--   `charge.succeeded`. Sumarlos todos triplicaría los ingresos.
--   La regla, explícita:
--     · pago único      → `checkout.session.completed` con mode='payment'
--     · suscripción     → `invoice.paid` (el primero y todas las renovaciones)
--     · devolución      → `charge.refunded`, en NEGATIVO
--     · todo lo demás   → NO es dinero y no entra en la suma.
--   `payment_intent.succeeded` y `charge.succeeded` quedan fuera a propósito:
--   son el mismo peso ya contado por los dos primeros.
--
-- UN NÚMERO QUE NO SE PUEDE CALCULAR SE INFORMA VACÍO, NUNCA CERO
--   Un evento de dinero cuyo monto no se puede leer (payload truncado, versión
--   de API distinta, campo ausente) NO suma cero: se cuenta aparte en
--   `unreadable`. El tablero muestra el hueco. Un cero falso en un tablero de
--   ingresos es peor que un hueco, porque el hueco se investiga y el cero se
--   cree.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Lectores del payload — puros, sin permisos, sin I/O
-- ---------------------------------------------------------------------------

create or replace function app.stripe_event_object(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
           when jsonb_typeof(p_payload -> 'data' -> 'object') = 'object'
             then p_payload -> 'data' -> 'object'
           else '{}'::jsonb
         end;
$$;

comment on function app.stripe_event_object(jsonb) is
  'El objeto del evento de Stripe (`data.object`) o un objeto vacío. Existe para que ningún lector de abajo tenga que repetir el camino ni preocuparse por un payload con otra forma.';

create or replace function app.stripe_event_metadata(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with obj as (select app.stripe_event_object(p_payload) as o)
  select coalesce(
    (select case
       when jsonb_typeof(o -> 'metadata') = 'object' and o -> 'metadata' <> '{}'::jsonb
         then o -> 'metadata'
       -- Una factura NO trae la metadata de la Session: viaja en la suscripción
       -- (por eso los checkouts la repiten en `subscription_data.metadata`) o,
       -- en versiones viejas de la API, en la primera línea de la factura.
       when jsonb_typeof(o -> 'subscription_details' -> 'metadata') = 'object'
            and o -> 'subscription_details' -> 'metadata' <> '{}'::jsonb
         then o -> 'subscription_details' -> 'metadata'
       when jsonb_typeof(o -> 'lines' -> 'data' -> 0 -> 'metadata') = 'object'
            and o -> 'lines' -> 'data' -> 0 -> 'metadata' <> '{}'::jsonb
         then o -> 'lines' -> 'data' -> 0 -> 'metadata'
     end from obj),
    '{}'::jsonb
  );
$$;

comment on function app.stripe_event_metadata(jsonb) is
  'La metadata del evento, buscada en los tres lugares donde Stripe la deja según el tipo de objeto. Es de donde sale a qué comunidad y a qué producto pertenece un cobro — el resto del payload no se mira.';

create or replace function app.payment_event_product(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  with md as (select app.stripe_event_metadata(p_payload) as m)
  select case
           when (select m ->> 'kind' from md) = 'store_membership' then 'store_membership'
           when (select m ->> 'kind' from md) = 'listing_premium'  then 'listing_premium'
           when (select m ? 'boost_id' from md)                    then 'boost'
           when (select m ? 'post_promotion_id' from md)           then 'post_promo'
           when (select m ? 'plan' from md)                        then 'presencia'
           else 'sin_clasificar'
         end;
$$;

comment on function app.payment_event_product(jsonb) is
  'A qué producto corresponde el cobro, deducido de la metadata que ponen las cinco server actions de Checkout. "sin_clasificar" NO se traduce a cero ni se esconde: el tablero lo muestra como tal, porque un peso que entró y no sabemos por qué es justo el que hay que ir a mirar.';

create or replace function app.payment_event_currency(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(app.stripe_event_object(p_payload) ->> 'currency'), '');
$$;

comment on function app.payment_event_currency(jsonb) is
  'Moneda del cobro en mayúsculas (Stripe la manda en minúsculas). NULL si el payload no la trae — y sin moneda el monto no se suma, porque sumar dólares con pesos da un número que no significa nada.';

create or replace function app.payment_event_cents(p_event_type text, p_payload jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  with obj as (select app.stripe_event_object(p_payload) as o)
  select case p_event_type
    -- Pago único (boost, campaña de post). El filtro por mode evita contar de
    -- nuevo la sesión que inaugura una suscripción, cuyo dinero llega por la
    -- factura.
    when 'checkout.session.completed' then
      case when (select o ->> 'mode' from obj) = 'payment'
        then nullif((select o ->> 'amount_total' from obj), '')::bigint
      end
    -- Suscripciones: la factura es la única verdad, primera y renovaciones.
    when 'invoice.paid' then
      nullif((select o ->> 'amount_paid' from obj), '')::bigint
    -- Devoluciones, en negativo. Un reembolso que no restara convertiría el
    -- tablero en una lista de ventas, no en uno de ingresos.
    when 'charge.refunded' then
      -nullif((select o ->> 'amount_refunded' from obj), '')::bigint
  end;
$$;

comment on function app.payment_event_cents(text, jsonb) is
  'Centavos netos del evento, o NULL si el tipo de evento no mueve dinero o el monto no se puede leer. Sólo tres tipos cuentan (checkout.session.completed mode=payment, invoice.paid, charge.refunded en negativo) porque Stripe emite varios eventos por el mismo cobro y sumarlos todos multiplicaría los ingresos. Devuelve NULL, jamás 0, cuando no puede leer: la diferencia entre "cobré cero" y "no sé cuánto cobré" es todo el punto de este tablero.';

create or replace function app.is_money_event(p_event_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event_type in ('checkout.session.completed', 'invoice.paid', 'charge.refunded');
$$;

comment on function app.is_money_event(text) is
  'Los tres tipos de evento que representan dinero. Se usa para separar "no es un cobro" (se ignora) de "es un cobro y no le pude leer el monto" (se cuenta como ilegible y se muestra el hueco).';

revoke execute on function app.stripe_event_object(jsonb)        from public, anon, authenticated;
revoke execute on function app.stripe_event_metadata(jsonb)      from public, anon, authenticated;
revoke execute on function app.payment_event_product(jsonb)      from public, anon, authenticated;
revoke execute on function app.payment_event_currency(jsonb)     from public, anon, authenticated;
revoke execute on function app.payment_event_cents(text, jsonb)  from public, anon, authenticated;
revoke execute on function app.is_money_event(text)              from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. El alcance de quien pregunta
-- ---------------------------------------------------------------------------
create or replace function app.revenue_scope(p_tenant uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role   text := app.current_user_role();
  v_tenant uuid := app.current_tenant_id();
begin
  if v_role not in ('domain_admin', 'global_admin') then
    raise exception 'FORBIDDEN: los ingresos son solo para administradores.';
  end if;

  -- El súper admin elige: una comunidad, o NULL = todas.
  if v_role = 'global_admin' then
    return p_tenant;
  end if;

  -- Para cualquier otro rol, el parámetro se IGNORA (no se rechaza): el alcance
  -- es su propia comunidad, escriba lo que escriba en la URL. Mismo criterio
  -- que `effectiveTenantId` en src/app/admin/scope.ts.
  if v_tenant is null then
    raise exception 'FORBIDDEN: sin comunidad en el token.';
  end if;
  return v_tenant;
end;
$$;

comment on function app.revenue_scope(uuid) is
  'Resuelve sobre qué comunidad se calculan los ingresos. Un domain_admin queda atado a la suya aunque mande el uuid de otra; un global_admin puede pedir una o todas (NULL). Está separada de las funciones de reporte para que la regla de alcance se escriba UNA vez y las dos la compartan.';

revoke execute on function app.revenue_scope(uuid) from public, anon;
grant execute on function app.revenue_scope(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. El resumen: ingresos por comunidad y por producto
-- ---------------------------------------------------------------------------
create or replace function public.admin_revenue_summary(
  p_tenant uuid,
  p_from   timestamptz,
  p_to     timestamptz
)
returns table (
  tenant_id   uuid,
  product     text,
  currency    text,
  net_cents   bigint,
  payments    integer,
  refunds     integer,
  unreadable  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid;
begin
  v_scope := app.revenue_scope(p_tenant);

  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'INVALID_RANGE: el período tiene que empezar antes de terminar.';
  end if;

  return query
  with eventos as (
    select
      coalesce(
        pe.tenant_id,
        nullif(app.stripe_event_metadata(pe.payload) ->> 'tenant_id', '')::uuid
      )                                                     as tenant_id,
      app.payment_event_product(pe.payload)                 as product,
      app.payment_event_currency(pe.payload)                as currency,
      app.payment_event_cents(pe.event_type, pe.payload)    as cents
      from public.payment_events pe
     where pe.received_at >= p_from
       and pe.received_at <  p_to
       and app.is_money_event(pe.event_type)
  )
  select e.tenant_id,
         e.product,
         e.currency,
         -- El monto sólo se suma cuando hay monto Y moneda. Sin moneda no se
         -- suma nada: la fila cae en el grupo currency=NULL, que el tablero
         -- muestra como hueco y no como ingreso.
         sum(e.cents) filter (where e.cents is not null)::bigint,
         count(*) filter (where e.cents > 0)::int,
         count(*) filter (where e.cents < 0)::int,
         count(*) filter (where e.cents is null or e.currency is null)::int
    from eventos e
   where (v_scope is null or e.tenant_id = v_scope)
   group by e.tenant_id, e.product, e.currency;
end;
$$;

comment on function public.admin_revenue_summary(uuid, timestamptz, timestamptz) is
  'Ingresos netos por comunidad, producto y moneda en un período. `unreadable` cuenta los eventos de dinero a los que no se les pudo leer monto o moneda — se informan aparte para que el tablero muestre un hueco en vez de un cero inventado. SECURITY DEFINER porque payment_events tiene SELECT bloqueado por RLS para todo JWT: el gate por rol lo pone app.revenue_scope() adentro de la base, no la pantalla. El payload crudo NUNCA sale de acá.';

revoke all on function public.admin_revenue_summary(uuid, timestamptz, timestamptz) from public;
revoke all on function public.admin_revenue_summary(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.admin_revenue_summary(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. El detalle navegable — keyset, jamás offset
-- ---------------------------------------------------------------------------
create or replace function public.admin_revenue_events(
  p_tenant    uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_product   text        default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid        default null,
  p_limit     integer     default 30
)
returns table (
  id          uuid,
  tenant_id   uuid,
  event_type  text,
  product     text,
  amount_cents bigint,
  currency    text,
  processed   boolean,
  failed      boolean,
  received_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  v_scope := app.revenue_scope(p_tenant);

  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'INVALID_RANGE: el período tiene que empezar antes de terminar.';
  end if;

  if p_product is not null and p_product not in (
    'presencia', 'listing_premium', 'boost', 'post_promo', 'store_membership', 'sin_clasificar'
  ) then
    raise exception 'INVALID_PRODUCT: ese producto no existe.';
  end if;

  return query
  with eventos as (
    select
      pe.id,
      coalesce(
        pe.tenant_id,
        nullif(app.stripe_event_metadata(pe.payload) ->> 'tenant_id', '')::uuid
      )                                                    as tenant_id,
      pe.event_type,
      app.payment_event_product(pe.payload)                as product,
      app.payment_event_cents(pe.event_type, pe.payload)   as cents,
      app.payment_event_currency(pe.payload)               as currency,
      pe.processed,
      pe.error is not null                                 as failed,
      pe.received_at
      from public.payment_events pe
     where pe.received_at >= p_from
       and pe.received_at <  p_to
       and app.is_money_event(pe.event_type)
  )
  select e.id, e.tenant_id, e.event_type, e.product, e.cents, e.currency,
         e.processed, e.failed, e.received_at
    from eventos e
   where (v_scope is null or e.tenant_id = v_scope)
     and (p_product is null or e.product = p_product)
     -- KEYSET, no offset (§6 de ARQUITECTURA): la comparación de tuplas usa el
     -- mismo par (received_at, id) por el que se ordena, así que una página
     -- nueva no repite ni se saltea filas aunque lleguen eventos mientras se
     -- pagina. `id` es uuid_v7, o sea monótono en el tiempo: desempata bien.
     and (
       p_cursor_at is null or p_cursor_id is null
       or (e.received_at, e.id) < (p_cursor_at, p_cursor_id)
     )
   order by e.received_at desc, e.id desc
   limit v_limit;
end;
$$;

comment on function public.admin_revenue_events(uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) is
  'Detalle navegable de los eventos de dinero: qué producto, cuánto, en qué moneda y si el webhook lo pudo procesar. Paginación KEYSET por (received_at, id) — nunca offset. NO devuelve el payload: un tablero de ingresos necesita montos, no el mail ni los datos de facturación del comprador. Mismo gate de rol que admin_revenue_summary.';

revoke all on function public.admin_revenue_events(uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) from public;
revoke all on function public.admin_revenue_events(uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) from anon;
grant execute on function public.admin_revenue_events(uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) to authenticated, service_role;

-- El tablero filtra SIEMPRE por ventana de tiempo; sin este índice cada
-- consulta es un seq scan sobre la tabla que más crece de la base.
create index if not exists payment_events_received_at_idx
  on public.payment_events (received_at desc, id desc);

commit;
