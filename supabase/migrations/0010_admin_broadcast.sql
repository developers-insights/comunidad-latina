-- =============================================================================
-- 0010_admin_broadcast.sql — Comunidad Latina
-- Broadcast Global (§12) — modelo PULL: broadcasts + broadcast_targets +
-- broadcast_receipts. broadcasts y broadcast_receipts son CROSS-TENANT BY
-- DESIGN (sin tenant_id): el enumerador las whitelistea explícitamente pero
-- les exige RLS FORCE + 4 policies como a todas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- broadcasts (global, sin tenant_id — BY DESIGN)
-- ---------------------------------------------------------------------------
create table public.broadcasts (
  id         uuid primary key default app.uuid_v7(),
  created_by uuid not null references auth.users(id),
  title      text not null,
  body       text not null,
  cta_url    text,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint broadcasts_window check (ends_at is null or ends_at > starts_at)
);

comment on table public.broadcasts is
  'Mensaje global del Super Admin (emergencias, anuncios). CROSS-TENANT BY DESIGN: sin tenant_id; el alcance lo definen broadcast_targets y se LEE por pull (nunca fan-out masivo de filas). Whitelisted en el enumerador RLS con RLS FORCE igual.';

create index broadcasts_window_idx on public.broadcasts (starts_at, ends_at);

alter table public.broadcasts enable row level security;
alter table public.broadcasts force row level security;

-- NOTA DE ORDEN: las policies de broadcasts referencian broadcast_targets en
-- su USING, y CREATE POLICY resuelve las relaciones en el momento de crearse.
-- Por eso se crean DESPUÉS de la tabla broadcast_targets (más abajo).

-- ---------------------------------------------------------------------------
-- broadcast_targets (SÍ lleva tenant_id: a qué tenants aplica el mensaje)
-- ---------------------------------------------------------------------------
create table public.broadcast_targets (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  primary key (broadcast_id, tenant_id)
);

comment on table public.broadcast_targets is
  'Targeting del broadcast: (broadcast, tenant). Escribe solo global_admin; el lector solo ve las filas de su propio tenant.';

create index broadcast_targets_tenant_idx on public.broadcast_targets (tenant_id);

alter table public.broadcast_targets enable row level security;
alter table public.broadcast_targets force row level security;

create policy broadcast_targets_select on public.broadcast_targets
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  or (select app.is_global_admin())
);

create policy broadcast_targets_insert on public.broadcast_targets
for insert to authenticated
with check ((select app.is_global_admin()));

create policy broadcast_targets_update on public.broadcast_targets
for update to authenticated
using ((select app.is_global_admin()))
with check ((select app.is_global_admin()));

create policy broadcast_targets_delete on public.broadcast_targets
for delete to authenticated
using ((select app.is_global_admin()));

-- ---------------------------------------------------------------------------
-- Policies de broadcasts — creadas acá porque su USING referencia
-- broadcast_targets (que debe existir al momento del CREATE POLICY).
-- ---------------------------------------------------------------------------

-- Un usuario ve SOLO broadcasts vigentes targeteados a SU tenant (pull).
create policy broadcasts_select on public.broadcasts
for select to authenticated
using (
  (select app.is_global_admin())
  or (
    starts_at <= now()
    and (ends_at is null or ends_at > now())
    and exists (
      select 1 from public.broadcast_targets bt
      where bt.broadcast_id = broadcasts.id
        and bt.tenant_id = (select app.current_tenant_id())
    )
  )
);

create policy broadcasts_insert on public.broadcasts
for insert to authenticated
with check (
  (select app.is_global_admin())
  and created_by = (select auth.uid())
);

create policy broadcasts_update on public.broadcasts
for update to authenticated
using ((select app.is_global_admin()))
with check ((select app.is_global_admin()));

create policy broadcasts_delete on public.broadcasts
for delete to authenticated
using ((select app.is_global_admin()));

-- ---------------------------------------------------------------------------
-- broadcast_receipts (global BY DESIGN: la fila referencia broadcast+profile)
-- ---------------------------------------------------------------------------
create table public.broadcast_receipts (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  seen_at      timestamptz not null default now(),
  primary key (broadcast_id, profile_id)
);

comment on table public.broadcast_receipts is
  'Marca de visto bajo demanda (pull, §12): se inserta cuando el usuario ve el broadcast. Sin tenant_id (el tenant vive en profile) — whitelisted en el enumerador con RLS FORCE igual. RETENCIÓN §5.4: el historial quién-vio-qué no es indefinido — pg_cron (0013, purge-old-broadcast-receipts) borra receipts de broadcasts vencidos hace +30 días; los de broadcasts vigentes se conservan para no re-mostrar.';

create index broadcast_receipts_profile_idx on public.broadcast_receipts (profile_id);

alter table public.broadcast_receipts enable row level security;
alter table public.broadcast_receipts force row level security;

create policy broadcast_receipts_select on public.broadcast_receipts
for select to authenticated
using (
  profile_id = (select auth.uid())
  or (select app.is_global_admin())
);

-- Solo marco visto YO, y solo broadcasts targeteados a MI tenant.
create policy broadcast_receipts_insert on public.broadcast_receipts
for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and exists (
    select 1 from public.broadcast_targets bt
    where bt.broadcast_id = broadcast_receipts.broadcast_id
      and bt.tenant_id = (select app.current_tenant_id())
  )
);

-- Un visto no se edita ni se des-ve por API.
create policy broadcast_receipts_update on public.broadcast_receipts
for update to authenticated
using (false)
with check (false);

create policy broadcast_receipts_delete on public.broadcast_receipts
for delete to authenticated
using (false);
