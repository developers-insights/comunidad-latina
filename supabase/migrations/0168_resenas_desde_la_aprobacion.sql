begin;

-- =============================================================================
-- 0168 — Las reseñas se abren cuando el trabajo se aprueba, no cuando sale la
-- transferencia.
--
-- Con Stripe Connect puede pasar que el negocio apruebe y el pago quede en
-- 'approved' esperando que el creador configure su cuenta. El trabajo ya está
-- cerrado entre las partes: bloquear las reseñas hasta que el creador complete
-- un trámite bancario no tiene sentido. El doble ciego (0033) no cambia.
-- =============================================================================

drop policy if exists gig_reviews_insert on public.gig_reviews;
create policy gig_reviews_insert on public.gig_reviews
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and reviewer_id = (select auth.uid())
  and exists (
    select 1 from public.gig_contracts c
    where c.id = gig_reviews.contract_id
      and c.tenant_id = gig_reviews.tenant_id
      and c.status in ('approved', 'released')
      and (
        (c.client_id = (select auth.uid()) and gig_reviews.ratee_id = c.creator_id)
        or (c.creator_id = (select auth.uid()) and gig_reviews.ratee_id = c.client_id)
      )
  )
);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reveal-stale-gig-reviews') then
    perform cron.unschedule('reveal-stale-gig-reviews');
  end if;
end;
$$;

select cron.schedule(
  'reveal-stale-gig-reviews',
  '0 5 * * *',
  $$update public.gig_reviews r
       set visible = true, visible_at = now()
      from public.gig_contracts c
     where c.id = r.contract_id
       and r.visible = false
       and c.status in ('approved', 'released')
       and coalesce(c.approved_at, c.released_at) is not null
       and coalesce(c.approved_at, c.released_at) < now() - interval '14 days'$$
);

commit;
