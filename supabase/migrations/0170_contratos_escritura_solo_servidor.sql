begin;

-- Firmas, historial e hitos se escriben sólo desde el servidor (service role, que
-- ignora RLS). Las policies en false dejan esa decisión explícita y nombrada.

drop policy if exists gig_contract_signatures_insert on public.gig_contract_signatures;
create policy gig_contract_signatures_insert on public.gig_contract_signatures
for insert to authenticated
with check (false);

drop policy if exists gig_contract_signatures_update on public.gig_contract_signatures;
create policy gig_contract_signatures_update on public.gig_contract_signatures
for update to authenticated
using (false);

drop policy if exists gig_contract_signatures_delete on public.gig_contract_signatures;
create policy gig_contract_signatures_delete on public.gig_contract_signatures
for delete to authenticated
using (false);

drop policy if exists gig_contract_events_insert on public.gig_contract_events;
create policy gig_contract_events_insert on public.gig_contract_events
for insert to authenticated
with check (false);

drop policy if exists gig_contract_events_update on public.gig_contract_events;
create policy gig_contract_events_update on public.gig_contract_events
for update to authenticated
using (false);

drop policy if exists gig_contract_events_delete on public.gig_contract_events;
create policy gig_contract_events_delete on public.gig_contract_events
for delete to authenticated
using (false);

drop policy if exists gig_contract_milestones_insert on public.gig_contract_milestones;
create policy gig_contract_milestones_insert on public.gig_contract_milestones
for insert to authenticated
with check (false);

drop policy if exists gig_contract_milestones_update on public.gig_contract_milestones;
create policy gig_contract_milestones_update on public.gig_contract_milestones
for update to authenticated
using (false);

drop policy if exists gig_contract_milestones_delete on public.gig_contract_milestones;
create policy gig_contract_milestones_delete on public.gig_contract_milestones
for delete to authenticated
using (false);

commit;
