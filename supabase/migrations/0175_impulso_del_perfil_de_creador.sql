begin;

-- =============================================================================
-- 0175 · Un creador puede pagar para que su perfil aparezca primero
-- =============================================================================
--
-- EL PEDIDO (PM, 23/9): "si un influencer quiere pagar una publicidad que se le
-- dé la oportunidad, ya que en la sección de boost no hay una chance para que
-- ellos puedan publicar". Boost sólo sabía promocionar filas de `listings` y de
-- `posts`, y el perfil de un creador (`creator_profiles`) no es ninguna de las
-- dos: la única fila "de creadores" que ofrecía Boost era `creator_gig`, que es
-- el aviso de QUIEN CONTRATA, no del creador.
--
-- POR QUÉ UNA TABLA PROPIA Y NO UNA COLUMNA MÁS EN `boosts`. `boosts.listing_id`
-- es NOT NULL, tiene alcance geográfico con tres checks cruzados, la rama de
-- "verificación" con monto cero y un webhook que ya activa, reembolsa y audita
-- en base a esa forma. Volver `listing_id` opcional obligaba a revisar cada
-- lector de `boosts` del repo para que no tratara un perfil como un aviso. Una
-- tabla con la MISMA disciplina (pending_payment → webhook → active, monto
-- congelado, sesión vinculada) no toca nada de lo que ya cobra.
--
-- PRECIO. No hay producto nuevo en `tenant_prices`: se cobra la fila
-- `boost/<duración>` de la comunidad (la del impulso de aviso equivalente), que
-- ya es configuración por comunidad desde el panel de precios.
--
-- LO QUE ES PÚBLICO Y LO QUE NO. Igual que `boosts`: que un perfil está
-- patrocinado es público (el chip "Patrocinado" tiene que ser auditable), y por
-- eso las filas `active` se leen sin sesión. Cuánto pagó, la sesión de Stripe y
-- cuántas veces se mostró quedan FUERA del grant por columnas; el dueño los lee
-- por `my_creator_profile_boosts()`.
-- =============================================================================

create table public.creator_profile_boosts (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id),
  creator_id                  uuid not null references public.creator_profiles(profile_id) on delete cascade,
  package                     text not null check (package in ('7d', '14d', '30d')),
  duration_days               integer not null check (duration_days in (7, 14, 30)),
  amount_cents                integer not null check (amount_cents > 0),
  currency                    text not null check (currency ~ '^[a-z]{3}$'),
  status                      text not null default 'pending_payment'
                                check (status in ('pending_payment', 'active', 'expired', 'canceled')),
  stripe_checkout_session_id  text unique,
  starts_at                   timestamptz,
  ends_at                     timestamptz,
  impressions                 integer not null default 0 check (impressions >= 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.creator_profile_boosts is
  'Impulso pagado del PERFIL de un creador: lo pone primero en el directorio de creadores, marcado "Patrocinado". Nace pending_payment desde la server action (service_role) y sólo el webhook de Stripe lo activa. Mismo precio que boost/<duración> de la comunidad.';
comment on column public.creator_profile_boosts.impressions is
  'Veces que el perfil ocupó un lugar pago en el directorio. Lo suma SÓLO record_creator_profile_boost_impressions() con service_role; fuera del grant para que nadie lo lea ni lo infle salvo el dueño por su RPC.';

create index creator_profile_boosts_vigentes_idx
  on public.creator_profile_boosts (tenant_id, ends_at desc)
  where status = 'active';

create index creator_profile_boosts_creador_idx
  on public.creator_profile_boosts (creator_id, created_at desc);

alter table public.creator_profile_boosts enable row level security;
alter table public.creator_profile_boosts force row level security;

create policy creator_profile_boosts_select on public.creator_profile_boosts
for select to anon, authenticated
using (
  status = 'active'
  or (
    tenant_id = (select app.current_tenant_id())
    and (
      creator_id = (select auth.uid())
      or (select app.current_user_role()) in ('domain_admin', 'global_admin')
    )
  )
  or (select app.is_global_admin())
);

-- Las tres de escritura en false: el estado de pago nace y muere en el
-- servidor (action con service_role + webhook). Nombradas por el contrato del
-- enumerador de RLS, igual que `boosts`.
create policy creator_profile_boosts_insert on public.creator_profile_boosts
for insert to authenticated
with check (false);

create policy creator_profile_boosts_update on public.creator_profile_boosts
for update to authenticated
using (false);

create policy creator_profile_boosts_delete on public.creator_profile_boosts
for delete to authenticated
using (false);

revoke all on public.creator_profile_boosts from public, anon, authenticated;
grant select (id, tenant_id, creator_id, status, starts_at, ends_at, created_at)
  on public.creator_profile_boosts to anon, authenticated;
grant all on public.creator_profile_boosts to service_role;

-- -----------------------------------------------------------------------------
-- Lectura del dueño, CON monto e impresiones (para "Tu publicidad").
-- -----------------------------------------------------------------------------
create or replace function public.my_creator_profile_boosts(p_limit integer default 20)
returns table (
  id           uuid,
  status       text,
  amount_cents integer,
  impressions  integer,
  ends_at      timestamptz,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  -- ⚠️ Alias `b.` obligatorio: los nombres de salida son variables OUT y
  -- columnas a la vez (mismo tropiezo que la 0153).
  return query
    select b.id, b.status, b.amount_cents, b.impressions, b.ends_at, b.created_at
      from public.creator_profile_boosts b
     where b.creator_id = auth.uid()
       and b.tenant_id  = v_tenant
       and b.status <> 'pending_payment'
     order by b.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.my_creator_profile_boosts(integer) is
  'Los impulsos de perfil que pagó quien llama, con monto e impresiones, para /impulsar/resultados. Creador = auth.uid(), tenant = JWT; nada entra por parámetro salvo el tope (1..50).';

revoke execute on function public.my_creator_profile_boosts(integer) from public, anon;
grant  execute on function public.my_creator_profile_boosts(integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Contador de impresiones: sólo service_role, sólo impulsos vigentes.
-- -----------------------------------------------------------------------------
create or replace function public.record_creator_profile_boost_impressions(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 24 then
    raise exception 'record_creator_profile_boost_impressions: demasiados impulsos en una llamada (%)',
      cardinality(p_ids);
  end if;

  update public.creator_profile_boosts b
     set impressions = b.impressions + 1
   where b.id = any(p_ids)
     and b.status = 'active'
     and b.ends_at is not null
     and b.ends_at > now();
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke execute on function public.record_creator_profile_boost_impressions(uuid[]) from public, anon, authenticated;
grant  execute on function public.record_creator_profile_boost_impressions(uuid[]) to service_role;

commit;
