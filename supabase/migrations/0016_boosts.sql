-- =============================================================================
-- 0016_boosts.sql — Comunidad Latina
-- boosts: impulso geolocalizado one-time de un listing (PLAN §7, precios
-- [EJEMPLO] §18). El alcance es la zona del listing (area_label/geo_zone ya
-- aproximados por §5.4 — acá NO se agrega geo nueva).
--
-- Principios:
--   * Pagar visibilidad NUNCA toca Trust Score ni verificación (§7): esta
--     tabla solo ordena resultados y pinta un chip "Destacado" HONESTO (FTC:
--     es publicidad y se marca como tal).
--   * El estado de pago lo escribe SOLO el webhook de Stripe (service_role):
--     un cliente jamás activa su propio boost. INSERT/UPDATE/DELETE en false
--     para authenticated; la server action inserta via admin tras verificar
--     ownership del listing.
-- =============================================================================

create table public.boosts (
  id                         uuid primary key default app.uuid_v7(),
  tenant_id                  uuid not null references public.tenants(id),
  listing_id                 uuid not null references public.listings(id) on delete cascade,
  buyer_id                   uuid not null references public.profiles(id) on delete cascade,
  package                    text not null check (package in ('7d', '14d', '30d')),
  duration_days              int not null check (duration_days in (7, 14, 30)),
  amount_cents               int not null check (amount_cents > 0),
  currency                   text not null default 'usd',
  status                     text not null default 'pending_payment'
                               check (status in ('pending_payment', 'active', 'expired', 'canceled')),
  stripe_checkout_session_id text,
  starts_at                  timestamptz,
  ends_at                    timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

comment on table public.boosts is
  'Impulso one-time de un listing (§7). status/starts_at/ends_at los escribe SOLO el webhook Stripe (service_role). La UI marca el resultado como "Destacado · Publicidad" (FTC). Pagar no altera Trust Score ni verificación.';
comment on column public.boosts.package is
  'Paquete [EJEMPLO §18]: 7d/14d/30d. La fuente de precios es BOOST_PACKAGES en src/lib/stripe.';
comment on column public.boosts.stripe_checkout_session_id is
  'Checkout Session asociada (cs_...). No es PII; permite reconciliar con el Dashboard de Stripe.';

create index boosts_tenant_active_idx
  on public.boosts (tenant_id, status, ends_at desc);
create index boosts_listing_idx on public.boosts (listing_id, status);
create index boosts_buyer_idx on public.boosts (tenant_id, buyer_id, created_at desc);
create unique index boosts_checkout_session_uniq
  on public.boosts (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create trigger boosts_set_updated_at
before update on public.boosts
for each row execute function extensions.moddatetime(updated_at);

alter table public.boosts enable row level security;
alter table public.boosts force row level security;

-- Lectura: los boosts ACTIVOS son públicos por diseño (el orden del feed y el
-- chip "Destacado" deben ser auditables — transparencia FTC). El comprador ve
-- además los suyos en cualquier estado, dentro de su tenant.
create policy boosts_select on public.boosts
for select to anon, authenticated
using (
  status = 'active'
  or (
    tenant_id = (select app.current_tenant_id())
    and (
      buyer_id = (select auth.uid())
      or (select app.current_user_role()) in ('domain_admin', 'global_admin')
    )
  )
  or (select app.is_global_admin())
);

-- Escritura EXCLUSIVA de service_role (server action gateada + webhook).
-- Policies en false para cumplir el contrato del enumerador (4 nombradas).
create policy boosts_insert on public.boosts
for insert to authenticated
with check (false);

create policy boosts_update on public.boosts
for update to authenticated
using (false)
with check (false);

create policy boosts_delete on public.boosts
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- pg_cron: expirar boosts vencidos (04:30 UTC diario, patrón de 0013) y purgar
-- los pending_payment abandonados a los 7 días (checkout nunca completado).
-- Las queries de la app filtran ends_at > now() igualmente — esto es higiene.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('expire-finished-boosts');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'expire-finished-boosts',
  '30 4 * * *',
  $$update public.boosts
       set status = 'expired'
     where status = 'active'
       and ends_at is not null
       and ends_at < now()$$
);

do $$
begin
  perform cron.unschedule('purge-abandoned-boosts');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-abandoned-boosts',
  '40 4 * * *',
  $$delete from public.boosts
     where status = 'pending_payment'
       and created_at < now() - interval '7 days'$$
);
