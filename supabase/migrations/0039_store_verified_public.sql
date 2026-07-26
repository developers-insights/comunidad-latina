-- =============================================================================
-- 0039 — Badge público "Tienda verificada"
--
-- Problema: business_accounts.verified_presence (plan Stripe "Presencia
-- Verificada", 0008) solo lo puede leer su DUEÑO por RLS — el badge del
-- marketplace no se veía para visitantes ni compradores, que es justo su
-- público. Exponer business_accounts entera sería filtrar plan/stripe ids.
--
-- Solución: espejar SOLO el boolean en el aviso público de la tienda
-- (listings.store_verified), mantenido por trigger de DB sobre
-- business_accounts. El webhook de Stripe no cambia: sigue escribiendo
-- verified_presence y el espejo se actualiza solo. La columna queda blindada
-- contra escrituras directas con el mismo mecanismo que los contadores
-- (app.protect_listing_counters, 0038).
-- =============================================================================

alter table public.listings
  add column store_verified boolean not null default false;

comment on column public.listings.store_verified is
  'Espejo público de business_accounts.verified_presence (plan Presencia Verificada de Stripe). Mantenido por app.mirror_store_verified(); escritura directa bloqueada por app.protect_listing_counters().';

-- ---------------------------------------------------------------------------
-- Blindaje: extender la guarda de 0038 para cubrir también store_verified.
-- Los updates internos (trigger sobre trigger) llegan con pg_trigger_depth()>1.
-- ---------------------------------------------------------------------------
create or replace function app.protect_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno (trigger de comentarios o del espejo verificado)
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.comment_count is distinct from old.comment_count then
    raise exception 'PROTECTED_COLUMNS: comment_count solo se actualiza por triggers';
  end if;
  if new.store_verified is distinct from old.store_verified then
    raise exception 'PROTECTED_COLUMNS: store_verified solo se actualiza por triggers';
  end if;
  return new;
end;
$$;

comment on function app.protect_listing_counters() is
  'Bloquea manipulación directa de listings.comment_count y listings.store_verified por clientes autenticados (espejo de app.protect_post_counters).';

-- ---------------------------------------------------------------------------
-- Espejo: business_accounts.verified_presence → listings.store_verified
-- ---------------------------------------------------------------------------
create or replace function app.mirror_store_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Si la cuenta se re-vinculó a otro aviso, el aviso viejo pierde el badge.
  if tg_op = 'UPDATE'
     and old.listing_id is not null
     and old.listing_id is distinct from new.listing_id then
    update public.listings
       set store_verified = false
     where id = old.listing_id;
  end if;

  if new.listing_id is not null then
    update public.listings
       set store_verified = new.verified_presence
     where id = new.listing_id
       and tenant_id = new.tenant_id
       and store_verified is distinct from new.verified_presence;
  end if;

  return new;
end;
$$;

comment on function app.mirror_store_verified() is
  'Copia verified_presence al listing de la tienda cada vez que el webhook de Stripe (u otro flujo service_role) toca business_accounts.';

create trigger business_accounts_mirror_verified
after insert or update of verified_presence, listing_id on public.business_accounts
for each row execute function app.mirror_store_verified();

-- ---------------------------------------------------------------------------
-- Un aviso no puede NACER verificado: la guarda de arriba es BEFORE UPDATE.
-- Re-creación de listings_insert (base: 0004, última versión: 0038) sumando
-- `store_verified = false`. Todo lo demás queda igual.
-- ---------------------------------------------------------------------------
drop policy listings_insert on public.listings;
create policy listings_insert on public.listings
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and source = 'user'
  and status in ('draft', 'pending_review')
  and publisher_name is null
  and publisher_kind is null
  and published_at is null
  and comment_count = 0
  and store_verified = false
);

-- ---------------------------------------------------------------------------
-- Backfill: tiendas que ya tenían Presencia Verificada activa.
-- ---------------------------------------------------------------------------
update public.listings l
   set store_verified = true
  from public.business_accounts ba
 where ba.listing_id = l.id
   and ba.verified_presence = true;
