-- =============================================================================
-- 0020_user_blocks.sql — Comunidad Latina
-- Bloqueo global de usuario (a diferencia de "Ignorar", que bloquea UN hilo):
--   * user_blocks — quién bloqueó a quién, unidireccional, solo-dueño por RLS.
--   * app.pair_blocked(a,b) — ¿existe bloqueo en cualquiera de las direcciones?
--   * block_user / unblock_user — RPCs canónicas.
--   * request_contact se re-crea con el chequeo de bloqueo: MISMO mensaje en
--     ambas direcciones para no filtrar quién bloqueó a quién.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- user_blocks
-- ---------------------------------------------------------------------------
create table public.user_blocks (
  tenant_id  uuid not null references public.tenants(id),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

comment on table public.user_blocks is
  'Bloqueo GLOBAL de usuario (vs. "Ignorar", que solo bloquea una conversación). Unidireccional: A bloquea a B; el efecto (sin contacto nuevo) aplica en ambas direcciones via app.pair_blocked(). Solo el bloqueador ve/gestiona sus filas: quién te bloqueó NUNCA es consultable — ni por vos, ni por staff via API.';
comment on column public.user_blocks.blocked_id is
  'Perfil bloqueado. La UI del bloqueado nunca recibe señal explícita: solo ve "no disponible" (mismo copy en ambas direcciones).';

create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;
alter table public.user_blocks force row level security;

-- Solo el dueño (bloqueador) lee su lista, en su tenant. Anon: nada.
create policy user_blocks_select on public.user_blocks
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and blocker_id = (select auth.uid())
);

-- Crear: yo como bloqueador, en mi tenant, contra un perfil de MI tenant.
-- El flujo canónico es la RPC block_user() (que además bloquea los hilos).
create policy user_blocks_insert on public.user_blocks
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and blocker_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = user_blocks.blocked_id
      and p.tenant_id = user_blocks.tenant_id
  )
);

-- Sin edición: un bloqueo se crea o se borra, no se transfiere.
create policy user_blocks_update on public.user_blocks
for update to authenticated
using (false)
with check (false);

-- Desbloquear: solo el dueño borra su propia fila.
create policy user_blocks_delete on public.user_blocks
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and blocker_id = (select auth.uid())
);

-- ---------------------------------------------------------------------------
-- app.pair_blocked — ¿hay bloqueo entre a y b en CUALQUIER dirección?
-- ---------------------------------------------------------------------------
create or replace function app.pair_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = a and ub.blocked_id = b)
       or (ub.blocker_id = b and ub.blocked_id = a)
  );
$$;

comment on function app.pair_blocked(uuid, uuid) is
  'true si existe un bloqueo entre a y b en cualquiera de las dos direcciones. Security definer: se usa desde RPCs para cortar contacto sin revelar quién bloqueó a quién.';

-- ---------------------------------------------------------------------------
-- block_user — bloqueo global + bloquear los hilos existentes entre ambos
-- ---------------------------------------------------------------------------
create or replace function public.block_user(p_profile_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  if p_profile_id = v_uid then
    raise exception 'CANNOT_BLOCK_SELF: no podés bloquearte a vos misma/o.';
  end if;

  -- Mismo mensaje para "no existe" y "es de otro tenant": no filtrar existencia
  -- cross-tenant por diferencia de errores.
  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.tenant_id = v_tenant
  ) then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;

  -- Idempotente: bloquear dos veces no es error.
  insert into public.user_blocks (tenant_id, blocker_id, blocked_id)
  values (v_tenant, v_uid, p_profile_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Bloquear TODOS los hilos existentes entre ambos (ambas direcciones).
  -- Solo se toca status: el trigger app.protect_conversation_columns() congela
  -- el resto de las columnas post-creación.
  update public.conversations c
     set status = 'blocked'
   where c.tenant_id = v_tenant
     and c.status <> 'blocked'
     and (
       (c.created_by = v_uid and c.counterpart_id = p_profile_id)
       or (c.created_by = p_profile_id and c.counterpart_id = v_uid)
     );
end;
$$;

comment on function public.block_user(uuid) is
  'Bloqueo global: registra el bloqueo (idempotente) y marca blocked todas las conversaciones del tenant entre auth.uid() y el bloqueado, en ambas direcciones. El bloqueado no recibe notificación ni señal explícita.';

revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- unblock_user — borra MI bloqueo; las conversaciones quedan blocked
-- ---------------------------------------------------------------------------
create or replace function public.unblock_user(p_profile_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  -- Idempotente: desbloquear a alguien no bloqueado no es error.
  -- DECISIÓN DE PRODUCTO: las conversaciones bloqueadas NO se reabren al
  -- desbloquear; si quieren volver a hablar, arranca una solicitud nueva.
  delete from public.user_blocks
   where tenant_id = v_tenant
     and blocker_id = v_uid
     and blocked_id = p_profile_id;
end;
$$;

comment on function public.unblock_user(uuid) is
  'Elimina el bloqueo propio hacia p_profile_id (idempotente). Las conversaciones previamente bloqueadas quedan blocked: desbloquear habilita contacto NUEVO, no revive hilos.';

revoke execute on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- request_contact — re-creada COMPLETA (base: 0014) + chequeo de bloqueo.
-- Mismo mensaje en ambas direcciones: no se filtra quién bloqueó a quién.
-- ---------------------------------------------------------------------------
create or replace function public.request_contact(p_listing_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid := app.current_tenant_id();
  v_listing   record;
  v_conv_id   uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para contactar.';
  end if;

  select l.id, l.tenant_id, l.created_by, l.status
    into v_listing
    from public.listings l
   where l.id = p_listing_id;

  -- Mismo mensaje para "no existe" y "es de otro tenant": no filtrar existencia
  -- cross-tenant por diferencia de errores.
  if not found or v_listing.tenant_id is distinct from v_tenant then
    raise exception 'LISTING_NOT_FOUND: el aviso no está disponible en tu comunidad.';
  end if;

  if v_listing.status <> 'published' then
    raise exception 'LISTING_NOT_AVAILABLE: el aviso ya no está publicado.';
  end if;

  if v_listing.created_by is null then
    -- Seed legal sin cuenta (publisher_name): no hay contraparte para chatear.
    raise exception 'LISTING_HAS_NO_ACCOUNT: quien publicó este aviso todavía no tiene cuenta en la comunidad, así que el chat no está disponible.';
  end if;

  if v_listing.created_by = v_uid then
    raise exception 'CANNOT_CONTACT_SELF: es tu propio aviso.';
  end if;

  -- Bloqueo global (0020): corta el contacto en ambas direcciones con el MISMO
  -- mensaje — quien fue bloqueado no puede deducir quién bloqueó a quién.
  if app.pair_blocked(v_uid, v_listing.created_by) then
    raise exception 'USER_BLOCKED: el contacto con esta persona no está disponible.';
  end if;

  -- Idempotente: si ya pedí contacto por este aviso, devuelvo esa conversación.
  select c.id into v_conv_id
    from public.conversations c
   where c.listing_id = p_listing_id
     and c.created_by = v_uid;

  if v_conv_id is not null then
    return v_conv_id;
  end if;

  begin
    insert into public.conversations (tenant_id, listing_id, created_by, counterpart_id, status)
    values (v_tenant, p_listing_id, v_uid, v_listing.created_by, 'pending')
    returning id into v_conv_id;
  exception
    when unique_violation then
      -- carrera con otra pestaña del mismo usuario: recuperar la existente
      select c.id into v_conv_id
        from public.conversations c
       where c.listing_id = p_listing_id
         and c.created_by = v_uid;
  end;

  return v_conv_id;
end;
$$;

comment on function public.request_contact(uuid) is
  'Contacto protegido: crea (o devuelve) la conversación pending entre auth.uid() y el creador del listing published del MISMO tenant. Seed sin cuenta → error claro LISTING_HAS_NO_ACCOUNT. Con bloqueo global entre las partes (0020) → USER_BLOCKED, mismo mensaje en ambas direcciones. El dato de contacto real nunca se expone.';

revoke execute on function public.request_contact(uuid) from public, anon;
grant execute on function public.request_contact(uuid) to authenticated, service_role;
