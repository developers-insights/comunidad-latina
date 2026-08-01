-- =============================================================================
-- 0054_aviso_premium_autoservicio.sql — Comunidad Latina
-- AUTOSERVICIO GRATIS → PREMIUM de una PUBLICACIÓN (listings.tier).
--
-- EL AGUJERO QUE ESTA MIGRACIÓN TAPA
-- 0048 creó `listings.tier` y lo blindó bien: `app.protect_listing_counters()`
-- impide que el dueño se lo suba desde el formulario y `listings_insert` exige
-- nacer 'free'. Lo que 0048 dejó explícitamente para "el agente de pagos" es el
-- OTRO lado: no existía ninguna tabla que dijera POR QUÉ un aviso es premium ni
-- HASTA CUÁNDO. En la práctica el tier se concedía a mano con service_role, que
-- es exactamente lo que no escala y lo que nadie puede dar de baja solo.
--
-- QUÉ YA EXISTÍA Y NO SE DUPLICA (se leyó antes de escribir una línea):
--   * store_memberships (0048) — membresía de TIENDA (USD 10/mes). Misma
--     doctrina de escritura y mismo espejo; esta tabla es su hermana para el
--     AVISO. No se reutiliza aquella porque el sujeto es otro (una tienda es un
--     listing kind='business'; premium aplica a los 7 kinds) y porque mezclar
--     dos productos en una fila hace imposible que alguien tenga uno y no el otro.
--   * boosts (0016) / post_promotions (0023) — pagos ÚNICOS de visibilidad
--     temporal. Premium es una SUSCRIPCIÓN de capacidades permanentes: no son lo
--     mismo y no se pisan (un aviso puede ser premium y además estar impulsado).
--   * campaigns (0048) — configuración de campaña. Nada que ver con el tier.
--
-- LA DECISIÓN NO OBVIA — EL DOWNGRADE GUARDA LOS BOTONES ANTES DE BORRARLOS
-- 0048 dejó el problema planteado con todas las letras: `listings_cta_premium_only`
-- hace que bajar a 'free' FALLE mientras queden botones cargados, así que la
-- baja tiene que limpiarlos en la MISMA sentencia; y avisaba que un trigger que
-- borre datos del comercio "en silencio" era peor que un downgrade ruidoso.
-- Acá se resuelven las dos cosas a la vez: antes de limpiar, los 7 valores se
-- copian a `listing_premiums.ctas_snapshot`, y al reactivar se restauran. El
-- borrado deja de ser una pérdida y pasa a ser una pausa — que es lo honesto
-- para alguien que pagó, se le venció la tarjeta y vuelve a los tres días.
--
-- POR QUÉ EL ESPEJO ES UN TRIGGER Y NO CÓDIGO DE LA APP
-- Igual que `app.mirror_store_active()` (0048) y `app.mirror_store_verified()`
-- (0039): `listings.tier` lo leen el feed, la búsqueda, el detalle y los topes
-- de carga. Si el tier lo escribiera la app, cada camino de baja (webhook, cron,
-- refund manual) tendría que acordarse de limpiar los CTAs, y el día que uno se
-- olvide el UPDATE revienta con un error de constraint en producción.
-- =============================================================================


-- =============================================================================
-- 1 · listing_premiums — la suscripción premium de UN aviso
-- =============================================================================

create table public.listing_premiums (
  id                         uuid primary key default app.uuid_v7(),
  tenant_id                  uuid not null references public.tenants(id),
  listing_id                 uuid not null references public.listings(id) on delete cascade,
  owner_id                   uuid not null references public.profiles(id) on delete cascade,
  status                     text not null default 'active'
                               check (status in ('active', 'past_due', 'canceled', 'expired')),
  price_cents                int not null default 900 check (price_cents > 0),
  currency                   text not null default 'usd',
  current_period_end         timestamptz,
  -- Cancelación programada: Stripe manda `customer.subscription.updated` con
  -- cancel_at_period_end=true y el status TODAVÍA en 'active'. El aviso sigue
  -- premium hasta que termine lo pagado —es lo que se cobró— y la pantalla del
  -- dueño necesita esta bandera para decir "seguís premium hasta el 12 de marzo"
  -- en vez de mentirle con "activo" a secas.
  cancel_at_period_end       boolean not null default false,
  -- Los 7 botones externos guardados en la última baja, para devolverlos al
  -- reactivar. Ver la cabecera: sin esto, el downgrade borra el teléfono y la
  -- dirección que el comercio cargó, y nadie los puede recuperar.
  ctas_snapshot              jsonb,
  stripe_subscription_id     text,
  stripe_customer_id         text,
  stripe_checkout_session_id text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint listing_premiums_one_per_listing unique (listing_id)
);

comment on table public.listing_premiums is
  'Suscripción PREMIUM de una publicación (§3: 20 fotos, video de 5 min, botones de acción, feed recomendado, prioridad en búsqueda y estadísticas por botón). Estado de facturación: lo escribe SOLO el webhook de Stripe o el cron via service_role — las 3 policies de escritura están en false, igual que boosts (0016) y store_memberships (0048). El dueño LEE la suya. El aviso se baja solo al vencer: el cron expire-listing-premiums pasa la fila a ''expired'' y app.mirror_listing_tier() espeja el resultado en listings.tier, que es la columna que leen el feed, la búsqueda y los topes de carga.';
comment on column public.listing_premiums.status is
  'active | past_due | canceled | expired. active y past_due dejan el aviso PREMIUM (un cobro que rebotó da margen para actualizar la tarjeta, no le apaga los botones a un comercio en el acto); canceled y expired lo bajan a free. Espejado en TypeScript por statusKeepsListingPremium() en src/lib/monetization/premium.ts: si las dos se separan, la app le miente al dueño sobre lo que la comunidad está viendo.';
comment on column public.listing_premiums.price_cents is
  '[EJEMPLO §18] USD 9/mes por publicación premium. Vive como default de fila y NO como CHECK a propósito: el precio real es una decisión comercial humana previa al go-live, y cambiarlo tiene que ser una fila nueva, no una migración.';
comment on column public.listing_premiums.current_period_end is
  'Fin del período pagado. El cron compara contra now() para expirar. NULL = todavía no llegó el evento de suscripción con período (la Checkout Session no lo trae): el cron NO toca filas con NULL, así que la ventana entre checkout.session.completed y customer.subscription.updated no baja nada.';
comment on column public.listing_premiums.ctas_snapshot is
  'Los 7 cta_* del aviso tal como estaban en la última baja, por nombre de columna. Lo escribe app.mirror_listing_tier() antes de limpiarlos (listings_cta_premium_only obliga a que en free sean NULL) y lo consume el mismo trigger al reactivar. NULL = nunca hubo baja con botones cargados.';
comment on column public.listing_premiums.stripe_subscription_id is
  'Suscripción de Stripe (sub_...). Nullable: sin credenciales de Stripe la app degrada elegante (§5.6) y no se crea ninguna fila — este flujo NUNCA concede premium sin un pago confirmado.';

-- "Mis avisos premium", los últimos primero.
create index listing_premiums_owner_idx
  on public.listing_premiums (tenant_id, owner_id, created_at desc);
-- El cron busca las vencidas; la pantalla del dueño, las que están al caer.
create index listing_premiums_expiry_idx
  on public.listing_premiums (status, current_period_end);
-- Una suscripción de Stripe pertenece a UN aviso. Sin esto, un evento
-- customer.subscription.* podría actualizar dos filas y dejar dos avisos
-- premium con un solo pago.
create unique index listing_premiums_subscription_uniq
  on public.listing_premiums (stripe_subscription_id)
  where stripe_subscription_id is not null;
-- Idempotencia de la ALTA a nivel base: una Checkout Session activa un solo
-- aviso. Si un replay llega con la misma session apuntando a otro listing, el
-- insert rebota en vez de regalar un segundo premium.
create unique index listing_premiums_checkout_session_uniq
  on public.listing_premiums (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create trigger listing_premiums_set_updated_at
before update on public.listing_premiums
for each row execute function extensions.moddatetime(updated_at);

alter table public.listing_premiums enable row level security;
alter table public.listing_premiums force row level security;

-- El dueño ve la suya (estado, vencimiento, si está por darse de baja); el
-- visitante no la necesita, porque lo único que le importa —si el aviso es
-- premium— viaja en listings.tier. Exponer la tabla filtraría ids de Stripe y
-- el historial de cobro de un comercio: mismo problema que 0039 resolvió con un
-- espejo, y se resuelve igual.
create policy listing_premiums_select on public.listing_premiums
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    owner_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- Las tres de escritura en false: nadie se activa a sí mismo el estado por el
-- que paga. Si esta policy dejara insertar, cualquiera con la sesión abierta
-- tendría un aviso premium llamando al endpoint de PostgREST.
create policy listing_premiums_insert on public.listing_premiums
for insert to authenticated
with check (false);

create policy listing_premiums_update on public.listing_premiums
for update to authenticated
using (false)
with check (false);

create policy listing_premiums_delete on public.listing_premiums
for delete to authenticated
using (false);


-- =============================================================================
-- 2 · Espejo: listing_premiums.status → listings.tier (+ los 7 botones)
-- =============================================================================

create or replace function app.mirror_listing_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_premium  boolean := new.status in ('active', 'past_due');
  v_snapshot jsonb;
begin
  if v_premium then
    -- SUBIDA. Los cta_* se restauran con coalesce: en `free` el CHECK garantiza
    -- que son NULL, así que esto no puede pisar nada cargado; y si no hubo baja
    -- previa, `new.ctas_snapshot` es NULL y ->> devuelve NULL, que es el valor
    -- que ya tenían. La condición del WHERE evita reescribir un aviso que ya
    -- está premium (p. ej. un customer.subscription.updated de renovación).
    update public.listings l
       set tier             = 'premium',
           cta_phone        = coalesce(l.cta_phone,        new.ctas_snapshot ->> 'cta_phone'),
           cta_whatsapp     = coalesce(l.cta_whatsapp,     new.ctas_snapshot ->> 'cta_whatsapp'),
           cta_website      = coalesce(l.cta_website,      new.ctas_snapshot ->> 'cta_website'),
           cta_purchase_url = coalesce(l.cta_purchase_url, new.ctas_snapshot ->> 'cta_purchase_url'),
           cta_tickets_url  = coalesce(l.cta_tickets_url,  new.ctas_snapshot ->> 'cta_tickets_url'),
           cta_booking_url  = coalesce(l.cta_booking_url,  new.ctas_snapshot ->> 'cta_booking_url'),
           cta_address      = coalesce(l.cta_address,      new.ctas_snapshot ->> 'cta_address')
     where l.id = new.listing_id
       and l.tenant_id = new.tenant_id
       and l.tier is distinct from 'premium';
    return new;
  end if;

  -- BAJA. Primero se guarda lo que el comercio cargó, DESPUÉS se limpia: al
  -- revés se pierde para siempre (el UPDATE ... RETURNING devuelve los valores
  -- nuevos, que ya serían NULL).
  select nullif(
           jsonb_strip_nulls(
             jsonb_build_object(
               'cta_phone',        l.cta_phone,
               'cta_whatsapp',     l.cta_whatsapp,
               'cta_website',      l.cta_website,
               'cta_purchase_url', l.cta_purchase_url,
               'cta_tickets_url',  l.cta_tickets_url,
               'cta_booking_url',  l.cta_booking_url,
               'cta_address',      l.cta_address
             )
           ),
           '{}'::jsonb
         )
    into v_snapshot
    from public.listings l
   where l.id = new.listing_id
     and l.tenant_id = new.tenant_id;

  if v_snapshot is not null then
    -- El SET no incluye `status` ni `listing_id`, así que este UPDATE NO vuelve
    -- a disparar este trigger (que está declarado `update of status, listing_id`):
    -- no hay recursión, y no hace falta un guard de pg_trigger_depth().
    update public.listing_premiums
       set ctas_snapshot = v_snapshot
     where id = new.id;
  end if;

  -- tier y los 7 botones en la MISMA sentencia: `listings_cta_premium_only` es
  -- un CHECK de fila, así que bajar el tier sin limpiar los botones falla, y
  -- limpiarlos en dos statements deja una ventana donde el aviso es free con
  -- botones vivos.
  update public.listings l
     set tier             = 'free',
         cta_phone        = null,
         cta_whatsapp     = null,
         cta_website      = null,
         cta_purchase_url = null,
         cta_tickets_url  = null,
         cta_booking_url  = null,
         cta_address      = null
   where l.id = new.listing_id
     and l.tenant_id = new.tenant_id
     and l.tier is distinct from 'free';

  return new;
end;
$$;

comment on function app.mirror_listing_tier() is
  'Copia el estado de la suscripción al aviso (listings.tier) cada vez que el webhook de Stripe o el cron tocan listing_premiums. active/past_due = premium; canceled/expired = free. En la BAJA guarda los 7 cta_* en listing_premiums.ctas_snapshot antes de limpiarlos —listings_cta_premium_only obliga a que en free sean NULL, y 0048 pidió explícitamente que el downgrade no borre datos del comercio en silencio— y en la SUBIDA los devuelve con coalesce. Corre con pg_trigger_depth()>1, así que app.protect_listing_counters() lo deja pasar.';

create trigger listing_premiums_mirror_tier
after insert or update of status, listing_id on public.listing_premiums
for each row execute function app.mirror_listing_tier();


-- =============================================================================
-- 3 · pg_cron: el premium se baja solo (04:55 UTC diario)
--
-- Patrón de 0013/0016/0048. Es la RED DE SEGURIDAD, no el camino principal: lo
-- normal es que Stripe mande customer.subscription.deleted y el webhook baje la
-- fila en el momento. Esto cubre el caso en que ese evento se pierda —webhook
-- caído, endpoint mal configurado, reintentos agotados—, que es justo el caso en
-- que un aviso se quedaría premium para siempre sin que nadie lo note.
--
-- 04:55 y no 04:50: la de tiendas ya ocupa ese minuto y las dos escriben sobre
-- listings a través de sus triggers.
-- =============================================================================
do $$
begin
  perform cron.unschedule('expire-listing-premiums');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'expire-listing-premiums',
  '55 4 * * *',
  $$update public.listing_premiums
       set status = 'expired'
     where status in ('active', 'past_due')
       and current_period_end is not null
       and current_period_end < now()$$
);
