-- =============================================================================
-- 0072_precios_por_dominio.sql — Comunidad Latina
--
-- El pliego pide "configurar planes y precios por dominio" desde el panel. Hoy
-- los montos viven como constantes de TypeScript en `src/lib/stripe/index.ts` y
-- `src/lib/monetization/premium.ts`, marcadas con todas las letras como
-- "[EJEMPLO §18] precios de ejemplo para validar el modelo". Cambiar un precio
-- es hoy un commit y un deploy — y encima el mismo precio para las 4 comunidades.
--
-- QUÉ RESUELVE ESTA MIGRACIÓN
--   1. `tenant_prices`: el precio vigente de cada producto, POR COMUNIDAD.
--   2. `tenant_price_history`: el precio ANTERIOR, para siempre.
--
-- POR QUÉ DOS TABLAS Y NO UNA CON `valid_from`/`valid_to`
--   Porque el 99% de las lecturas son "cuánto cobro hoy" (las hace el Checkout,
--   en el camino crítico de un pago) y ese camino no puede depender de un
--   `order by valid_from desc limit 1` con la ventana bien cerrada. La tabla
--   vigente tiene un UNIQUE que hace IMPOSIBLE que existan dos precios activos
--   para el mismo producto: la ambigüedad no se resuelve en la query, se prohíbe
--   en el esquema. El historial es una tabla aparte, append-only, que nadie lee
--   para cobrar — se lee para EXPLICAR un cobro viejo, que es otro problema.
--
-- CENTAVOS ENTEROS, NUNCA FLOTANTES
--   `amount_cents integer`. Es la unidad con la que Stripe cobra (`unit_amount`),
--   así que no hay conversión en el borde y no hay redondeo que discutir. Un
--   `numeric` sería correcto pero obligaría a decidir la escala en cada lectura;
--   un `float` sería directamente un bug esperando: 19.99 no existe en binario.
--
-- MONEDA EXPLÍCITA
--   `currency` es NOT NULL con CHECK de 3 letras mayúsculas (ISO 4217). No hay
--   default heredado "del tenant" a propósito: `tenants.currency` describe cómo
--   se MUESTRAN los precios de los avisos entre vecinos, y esto es lo que la
--   plataforma COBRA. Que se parezcan no los hace lo mismo.
--
-- LA AUSENCIA DE FILA SIGNIFICA LA CONSTANTE DEL CÓDIGO (mismo criterio que
-- notification_prefs 0045, profile_privacy 0063 y creator_eligibility_config
-- 0064). Es lo que impide que exista una ventana —entre esta migración y la
-- siembra, o al crear una comunidad nueva— en la que un tenant se quede sin
-- precio y el Checkout no sepa cuánto cobrar. La 0073 siembra las constantes
-- actuales para que el día del deploy nada cambie de comportamiento.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. El precio vigente
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_prices (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null references public.tenants(id),

  product          text not null check (product in (
                     'presencia',          -- Presencia Verificada del negocio
                     'listing_premium',    -- Aviso premium autoservicio (0054)
                     'boost',              -- Impulso geolocalizado de un aviso
                     'post_promo',         -- Campaña de una publicación
                     'store_membership'    -- Membresía de tienda del marketplace
                   )),
  variant          text not null check (variant in (
                     'basico', 'destacado', 'pro',   -- planes de presencia
                     '7d', '14d', '30d',             -- paquetes de impulso
                     'estandar'                      -- productos de variante única
                   )),
  billing_interval text not null check (billing_interval in ('mensual', 'anual', 'unico')),

  amount_cents     integer not null check (amount_cents >= 0 and amount_cents <= 100000000),
  currency         text    not null check (currency ~ '^[A-Z]{3}$'),
  active           boolean not null default true,

  updated_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (tenant_id, product, variant, billing_interval)
);

comment on table public.tenant_prices is
  'Precio VIGENTE de cada producto pago, por comunidad — lo que el pliego llama "configurar planes y precios por dominio". Una fila por (tenant, producto, variante, intervalo); el UNIQUE hace imposible que haya dos precios vigentes del mismo producto. La AUSENCIA de fila significa la constante del código (src/lib/stripe/index.ts), para que nunca exista un tenant sin precio. El historial vive en tenant_price_history.';
comment on column public.tenant_prices.product is
  'Qué se cobra. Espeja los cinco flujos de Checkout que existen hoy: presencia (suscripción del negocio), listing_premium (aviso premium autoservicio 0054), boost (impulso de aviso), post_promo (campaña de publicación) y store_membership (membresía de tienda).';
comment on column public.tenant_prices.variant is
  'El escalón dentro del producto: el plan (basico/destacado/pro) o la duración del paquete (7d/14d/30d). "estandar" es para los productos que tienen un solo precio (listing_premium, store_membership) — un NULL acá rompería el UNIQUE, que en Postgres no distingue dos NULL.';
comment on column public.tenant_prices.billing_interval is
  'mensual | anual | unico. Va separado de la variante porque el MISMO plan se cobra de las dos formas y son dos precios distintos (el anual son 10 mensualidades, no 12: dos meses gratis).';
comment on column public.tenant_prices.amount_cents is
  'CENTAVOS ENTEROS, la misma unidad con la que Stripe cobra (unit_amount). Nunca un float: 19.99 no tiene representación binaria exacta y un precio mal guardado cobra mal. El tope de 100.000.000 (USD 1.000.000) no es una regla de negocio, es un cinturón contra el cero de más pegado sin querer.';
comment on column public.tenant_prices.currency is
  'ISO 4217 en mayúsculas. Explícita y obligatoria: un monto sin moneda no es un precio. NO se hereda de tenants.currency, que describe cómo se muestran los avisos entre vecinos y no lo que la plataforma factura.';
comment on column public.tenant_prices.active is
  'Un producto se APAGA, no se borra. Con active=false el Checkout cae a la constante del código; borrar la fila haría lo mismo pero además se llevaría puesta la trazabilidad de quién y cuándo la puso.';
comment on column public.tenant_prices.updated_by is
  'Quién tocó el precio por última vez. Cambiar lo que se le cobra a la gente es una decisión que tiene que tener nombre.';

create index if not exists tenant_prices_tenant_active_idx
  on public.tenant_prices (tenant_id, product) where active;
create index if not exists tenant_prices_updated_by_idx
  on public.tenant_prices (updated_by);

drop trigger if exists tenant_prices_set_updated_at on public.tenant_prices;
create trigger tenant_prices_set_updated_at
before update on public.tenant_prices
for each row execute function extensions.moddatetime(updated_at);

alter table public.tenant_prices enable row level security;
alter table public.tenant_prices force row level security;

-- LECTURA: cualquier miembro de la comunidad. Es la lista de precios que ve
-- quien está por pagar — esconderla sería vender sin decir cuánto. El súper
-- admin lee todas porque tiene que poder editar la de cualquier comunidad.
create policy tenant_prices_select on public.tenant_prices
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  or (select app.is_global_admin())
);

-- ESCRITURA: el admin de la comunidad sobre la suya; el súper admin sobre
-- cualquiera. Un moderador NO toca precios: moderar contenido y fijar tarifas
-- son dos trabajos distintos.
create policy tenant_prices_insert on public.tenant_prices
for insert to authenticated
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

create policy tenant_prices_update on public.tenant_prices
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

-- Borrar un precio lo devolvería a la constante EN SILENCIO y dejaría el
-- historial apuntando a una fila que ya no existe. Se apaga con active=false.
create policy tenant_prices_delete on public.tenant_prices
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 2. El historial
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_price_history (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null references public.tenants(id),
  price_id         uuid references public.tenant_prices(id) on delete set null,

  product          text not null,
  variant          text not null,
  billing_interval text not null,

  old_amount_cents integer,
  old_currency     text,
  old_active       boolean,
  new_amount_cents integer not null,
  new_currency     text    not null,
  new_active       boolean not null,

  changed_by       uuid references public.profiles(id) on delete set null,
  changed_at       timestamptz not null default now()
);

comment on table public.tenant_price_history is
  'Append-only: cada alta y cada cambio de tenant_prices deja una fila acá con el valor viejo y el nuevo. Existe para poder EXPLICAR UN COBRO VIEJO — "en marzo te cobramos USD 19 porque ese era el precio hasta el 4 de abril". Sin esto, subir un precio borraría la única prueba de cuál era el anterior. Lo escribe un trigger, no la aplicación: un historial que depende de que alguien se acuerde de escribirlo no es un historial.';
comment on column public.tenant_price_history.price_id is
  'Fila de tenant_prices que cambió. ON DELETE SET NULL y no CASCADE: si algún día se borrara el precio, el historial tiene que sobrevivir — es justamente cuando más se lo necesita. Las columnas product/variant/billing_interval se copian por eso mismo, para que la fila siga siendo legible sin el join.';
comment on column public.tenant_price_history.old_amount_cents is
  'NULL significa que esta fila es el ALTA del precio (antes no había fila y regía la constante del código), no que el precio anterior fuera cero. La diferencia importa: cero es un precio, "no había" no lo es.';
comment on column public.tenant_price_history.changed_by is
  'Quién lo cambió, tomado de auth.uid() en el momento del cambio. NULL si el cambio vino de un proceso sin sesión (una migración, un script).';

create index if not exists tenant_price_history_tenant_changed_idx
  on public.tenant_price_history (tenant_id, changed_at desc, id desc);
create index if not exists tenant_price_history_price_idx
  on public.tenant_price_history (price_id);
create index if not exists tenant_price_history_changed_by_idx
  on public.tenant_price_history (changed_by);

alter table public.tenant_price_history enable row level security;
alter table public.tenant_price_history force row level security;

-- Lo lee el staff que puede tocar precios; el súper admin, todas. Un miembro
-- común no necesita saber cuánto costaba antes, y publicarlo sería regalar la
-- historia comercial de la comunidad.
create policy tenant_price_history_select on public.tenant_price_history
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

-- Append-only de verdad: NADIE escribe con un JWT de usuario. La única fuente
-- es el trigger de abajo, que corre como SECURITY DEFINER (mismo patrón que
-- account_sanctions en 0021: la tabla se escribe sola o no se escribe).
create policy tenant_price_history_insert on public.tenant_price_history
for insert to authenticated
with check (false);

create policy tenant_price_history_update on public.tenant_price_history
for update to authenticated
using (false)
with check (false);

create policy tenant_price_history_delete on public.tenant_price_history
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 3. El trigger que llena el historial
-- ---------------------------------------------------------------------------
create or replace function app.record_tenant_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Un UPDATE que no cambia nada de lo que se cobra no es un cambio de precio.
  -- Sin esta guarda, tocar `updated_by` desde el panel ensuciaría el historial
  -- con filas donde el precio viejo y el nuevo son idénticos.
  if tg_op = 'UPDATE'
     and old.amount_cents is not distinct from new.amount_cents
     and old.currency     is not distinct from new.currency
     and old.active       is not distinct from new.active then
    return new;
  end if;

  insert into public.tenant_price_history (
    tenant_id, price_id, product, variant, billing_interval,
    old_amount_cents, old_currency, old_active,
    new_amount_cents, new_currency, new_active,
    changed_by
  ) values (
    new.tenant_id, new.id, new.product, new.variant, new.billing_interval,
    case when tg_op = 'UPDATE' then old.amount_cents end,
    case when tg_op = 'UPDATE' then old.currency     end,
    case when tg_op = 'UPDATE' then old.active       end,
    new.amount_cents, new.currency, new.active,
    coalesce(new.updated_by, auth.uid())
  );

  return new;
end;
$$;

comment on function app.record_tenant_price_change() is
  'Copia al historial cada alta y cada cambio real de precio. SECURITY DEFINER porque tenant_price_history tiene INSERT bloqueado por RLS para todo JWT de usuario: la tabla la escribe este trigger o no la escribe nadie. Vive en el schema `app` a propósito — un trigger no lo llama la aplicación, así que no necesita estar expuesto por PostgREST (lección de 0070: lo que la app SÍ llama va en `public`).';

revoke execute on function app.record_tenant_price_change() from public, anon, authenticated;

drop trigger if exists tenant_prices_record_history on public.tenant_prices;
create trigger tenant_prices_record_history
after insert or update on public.tenant_prices
for each row execute function app.record_tenant_price_change();

commit;
