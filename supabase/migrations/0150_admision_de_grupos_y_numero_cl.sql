begin;

alter table public.chat_groups
  drop constraint if exists chat_groups_visibility_check;
alter table public.chat_groups
  add constraint chat_groups_visibility_check
  check (visibility in ('public', 'private', 'request'));

drop index if exists public.chat_groups_descubrir_idx;
drop index if exists public.chat_groups_descubrir_todos_idx;
create index chat_groups_descubrir_idx
  on public.chat_groups (tenant_id, category, created_at desc, id desc)
  where visibility in ('public', 'request') and status = 'active';
create index chat_groups_descubrir_todos_idx
  on public.chat_groups (tenant_id, created_at desc, id desc)
  where visibility in ('public', 'request') and status = 'active';

-- La tercera rama (created_by) NO es nueva acá: es la de la 0147, que esta
-- migración tiene que preservar al reemplazar el USING entero. Sin ella,
-- crear un grupo PRIVADO vuelve a fallar con 42501 en el RETURNING del
-- insert (el trigger AFTER que hace dueño al creador todavía no corrió
-- cuando Postgres evalúa esta policy). 'request' entra en la misma rama de
-- descubrimiento que 'public' porque ambos se listan sin ser miembro.
alter policy chat_groups_select on public.chat_groups
using (
  tenant_id = (select app.current_tenant_id())
  and (
    visibility in ('public', 'request')
    or app.es_miembro_de_grupo(id)
    or (
      created_by = (select auth.uid())
      and not exists (
        select 1
          from public.chat_group_bans b
         where b.group_id = chat_groups.id
           and b.profile_id = (select auth.uid())
      )
    )
  )
);

alter policy chat_group_members_insert on public.chat_group_members
with check (
  tenant_id = (select app.current_tenant_id())
  and role = 'member'
  and exists (
    select 1
      from public.chat_groups g
     where g.id = chat_group_members.group_id
       and g.tenant_id = chat_group_members.tenant_id
       and g.status = 'active'
       and (
         (
           chat_group_members.profile_id = (select auth.uid())
           and g.visibility = 'public'
           and not exists (
             select 1
               from public.chat_group_bans b
              where b.group_id = chat_group_members.group_id
                and b.profile_id = (select auth.uid())
           )
         )
         or (
           app.rol_en_grupo(g.id) in ('owner', 'admin')
           and not app.pair_blocked((select auth.uid()), chat_group_members.profile_id)
         )
       )
  )
  and exists (
    select 1
      from public.profiles p
     where p.id = chat_group_members.profile_id
       and p.tenant_id = chat_group_members.tenant_id
  )
);

create table public.chat_group_join_requests (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index chat_group_join_requests_pending_idx
  on public.chat_group_join_requests (group_id, requested_at, profile_id);
create index chat_group_join_requests_profile_idx
  on public.chat_group_join_requests (profile_id, requested_at desc);

create trigger chat_group_join_requests_enforce_account_active
before insert on public.chat_group_join_requests
for each row execute function app.enforce_account_active();

alter table public.chat_group_join_requests enable row level security;
alter table public.chat_group_join_requests force row level security;

create policy chat_group_join_requests_select on public.chat_group_join_requests
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or app.rol_en_grupo(group_id) in ('owner', 'admin')
  )
);

create policy chat_group_join_requests_insert on public.chat_group_join_requests
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and not app.es_miembro_de_grupo(group_id)
  and exists (
    select 1
      from public.chat_groups g
     where g.id = group_id
       and g.tenant_id = chat_group_join_requests.tenant_id
       and g.visibility = 'request'
       and g.status = 'active'
  )
  and not exists (
    select 1
      from public.chat_group_bans b
     where b.group_id = chat_group_join_requests.group_id
       and b.profile_id = (select auth.uid())
  )
);

create policy chat_group_join_requests_update on public.chat_group_join_requests
for update to authenticated
using (false)
with check (false);

create policy chat_group_join_requests_delete on public.chat_group_join_requests
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or app.rol_en_grupo(group_id) in ('owner', 'admin')
  )
);

revoke all on table public.chat_group_join_requests from anon, authenticated;
grant select, insert, delete on table public.chat_group_join_requests to authenticated;
grant all on table public.chat_group_join_requests to service_role;

create or replace function public.solicitar_ingreso_a_grupo(p_group uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
begin
  if v_uid is null or v_tenant is null then
    return 'sin_sesion';
  end if;

  if app.es_miembro_de_grupo(p_group) then
    return 'ya_es_miembro';
  end if;

  insert into public.chat_group_join_requests (group_id, profile_id, tenant_id)
  values (p_group, v_uid, v_tenant)
  on conflict (group_id, profile_id) do nothing;

  return 'pendiente';
exception
  when insufficient_privilege or check_violation or foreign_key_violation then
    return 'sin_permiso';
  -- app.enforce_account_active() (0021) rechaza con un raise exception
  -- crudo (P0001, "ACCOUNT_SUSPENDED: ..."), no con un código propio: sin
  -- este catch, una cuenta suspendida ve el mensaje interno tal cual en
  -- vez de la respuesta 'sin_permiso' que el cliente ya sabe traducir.
  when raise_exception then
    if sqlerrm like 'ACCOUNT_SUSPENDED%' then
      return 'sin_permiso';
    end if;
    raise;
end;
$$;

revoke all on function public.solicitar_ingreso_a_grupo(uuid) from public, anon;
grant execute on function public.solicitar_ingreso_a_grupo(uuid) to authenticated, service_role;

create or replace function public.resolver_solicitud_de_grupo(
  p_group uuid,
  p_profile uuid,
  p_aprobar boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_mi_rol text;
  v_request public.chat_group_join_requests%rowtype;
begin
  if v_uid is null or v_tenant is null then
    return 'sin_sesion';
  end if;

  select m.role into v_mi_rol
    from public.chat_group_members m
   where m.group_id = p_group
     and m.profile_id = v_uid
     and m.tenant_id = v_tenant;

  if v_mi_rol is null or v_mi_rol not in ('owner', 'admin') then
    return 'sin_permiso';
  end if;

  select r.* into v_request
    from public.chat_group_join_requests r
   where r.group_id = p_group
     and r.profile_id = p_profile
     and r.tenant_id = v_tenant
   for update;

  if not found then
    return 'no_estaba';
  end if;

  if p_aprobar then
    if not exists (
      select 1
        from public.chat_groups g
       where g.id = p_group
         and g.tenant_id = v_tenant
         and g.status = 'active'
    ) then
      return 'cerrado';
    end if;

    if exists (
      select 1
        from public.chat_group_bans b
       where b.group_id = p_group
         and b.profile_id = p_profile
    ) then
      return 'sin_permiso';
    end if;

    if not exists (
      select 1
        from public.profiles p
       where p.id = p_profile
         and p.tenant_id = v_tenant
    ) then
      return 'sin_permiso';
    end if;

    insert into public.chat_group_members (group_id, profile_id, tenant_id, role)
    values (p_group, p_profile, v_tenant, 'member')
    on conflict (group_id, profile_id) do nothing;
  end if;

  delete from public.chat_group_join_requests r
   where r.group_id = p_group
     and r.profile_id = p_profile;

  return case when p_aprobar then 'aprobada' else 'rechazada' end;
end;
$$;

revoke all on function public.resolver_solicitud_de_grupo(uuid, uuid, boolean) from public, anon;
grant execute on function public.resolver_solicitud_de_grupo(uuid, uuid, boolean) to authenticated, service_role;

create or replace function app.proteger_claves_de_membresia_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.group_id is distinct from old.group_id
     or new.profile_id is distinct from old.profile_id
     or new.tenant_id is distinct from old.tenant_id
     or new.joined_at is distinct from old.joined_at then
    raise exception 'PROTECTED_COLUMNS: la identidad de una membresía no se edita';
  end if;

  return new;
end;
$$;

revoke execute on function app.proteger_claves_de_membresia_de_grupo() from public, anon;
create trigger chat_group_members_proteger_claves
before update on public.chat_group_members
for each row execute function app.proteger_claves_de_membresia_de_grupo();

alter policy chat_group_members_update on public.chat_group_members
using (
  tenant_id = (select app.current_tenant_id())
  and role <> 'owner'
  and app.rol_en_grupo(group_id) = 'owner'
)
with check (
  tenant_id = (select app.current_tenant_id())
  and role in ('admin', 'member')
  and app.rol_en_grupo(group_id) = 'owner'
);

create or replace function public.cambiar_rol_en_grupo(
  p_group uuid,
  p_profile uuid,
  p_role text
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mi_rol text;
  v_su_rol text;
begin
  if v_uid is null or p_role not in ('admin', 'member') then
    return 'sin_permiso';
  end if;

  select m.role into v_mi_rol
    from public.chat_group_members m
   where m.group_id = p_group
     and m.profile_id = v_uid;

  if v_mi_rol <> 'owner' then
    return 'sin_permiso';
  end if;

  select m.role into v_su_rol
    from public.chat_group_members m
   where m.group_id = p_group
     and m.profile_id = p_profile;

  if v_su_rol is null or v_su_rol = 'owner' then
    return 'sin_permiso';
  end if;

  update public.chat_group_members
     set role = p_role
   where group_id = p_group
     and profile_id = p_profile;

  return 'ok';
end;
$$;

revoke all on function public.cambiar_rol_en_grupo(uuid, uuid, text) from public, anon;
grant execute on function public.cambiar_rol_en_grupo(uuid, uuid, text) to authenticated, service_role;

create or replace function app.limpiar_solicitud_al_sumar_miembro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.chat_group_join_requests r
   where r.group_id = new.group_id
     and r.profile_id = new.profile_id;
  return new;
end;
$$;

revoke execute on function app.limpiar_solicitud_al_sumar_miembro() from public, anon;
create trigger chat_group_members_limpia_solicitud
after insert on public.chat_group_members
for each row execute function app.limpiar_solicitud_al_sumar_miembro();

create or replace function app.candidato_numero_cl()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'CL-' || lpad(
    (
      ('x' || encode(extensions.gen_random_bytes(7), 'hex'))::bit(56)::bigint
      % 1000000000000
    )::text,
    12,
    '0'
  );
$$;

revoke execute on function app.candidato_numero_cl() from public, anon, authenticated;
grant execute on function app.candidato_numero_cl() to service_role;

alter table public.profiles add column numero_cl text;

create unique index profiles_numero_cl_idx
  on public.profiles (numero_cl)
  where numero_cl is not null;

create or replace function app.asignar_numero_cl()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidato text;
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role'
     and new.numero_cl is not null then
    return new;
  end if;

  loop
    v_candidato := app.candidato_numero_cl();
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_candidato, 150)
    );
    exit when not exists (
      select 1 from public.profiles p where p.numero_cl = v_candidato
    );
  end loop;

  new.numero_cl := v_candidato;
  return new;
end;
$$;

revoke execute on function app.asignar_numero_cl() from public, anon, authenticated;

create trigger profiles_asignar_numero_cl
before insert on public.profiles
for each row execute function app.asignar_numero_cl();

do $$
declare
  v_id uuid;
  v_candidato text;
begin
  for v_id in select p.id from public.profiles p order by p.created_at, p.id loop
    loop
      v_candidato := app.candidato_numero_cl();
      begin
        update public.profiles p
           set numero_cl = v_candidato
         where p.id = v_id;
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
  end loop;
end;
$$;

alter table public.profiles
  alter column numero_cl set not null,
  add constraint profiles_numero_cl_formato check (numero_cl ~ '^CL-[0-9]{12}$');

create or replace function app.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.identity_verified is distinct from old.identity_verified
     or new.identity_verified_at is distinct from old.identity_verified_at
     or new.phone_verified is distinct from old.phone_verified
     or new.email_verified is distinct from old.email_verified
     or new.verified_badge is distinct from old.verified_badge
     or new.verified_badge_type is distinct from old.verified_badge_type
     or new.numero_cl is distinct from old.numero_cl
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'PROTECTED_COLUMNS: campos administrados de profiles sólo se modifican desde el sistema';
  end if;

  if (new.account_status is distinct from old.account_status
      or new.suspended_until is distinct from old.suspended_until)
     and not app.is_staff() then
    raise exception 'PROTECTED_COLUMNS: account_status/suspended_until solo se modifican via moderación';
  end if;

  return new;
end;
$$;

drop function public.buscar_personas_de_la_comunidad(text, int);
create function public.buscar_personas_de_la_comunidad(q text, limite int default 8)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  area_label text,
  identity_verified boolean,
  numero_cl text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(limite, 8), 1), 20);
  v_q text;
  v_like text;
  v_numero text;
  v_es_numero boolean;
begin
  v_q := left(btrim(coalesce(q, '')), 80);
  if char_length(v_q) < 2 or v_tenant is null or v_uid is null then
    return;
  end if;

  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_numero := regexp_replace(upper(v_q), '[^A-Z0-9]', '', 'g');
  v_es_numero := v_numero ~ '^CL[0-9]{12}$';
  if v_es_numero then
    v_q := 'CL-' || substring(v_numero from 3);
  end if;

  return query
  select p.id,
         p.display_name,
         p.avatar_url,
         p.area_label,
         p.identity_verified,
         p.numero_cl
    from public.profiles p
   where p.tenant_id = v_tenant
     and p.id <> v_uid
     and not app.pair_blocked(v_uid, p.id)
     and (
       app.unaccent_immutable(p.display_name)
         ilike app.unaccent_immutable(v_like) escape '\'
       or (v_es_numero and p.numero_cl = v_q)
     )
   order by (upper(p.numero_cl) = upper(v_q)) desc,
            extensions.similarity(p.display_name, v_q) desc,
            p.display_name
   limit v_limit;
end;
$$;

revoke all on function public.buscar_personas_de_la_comunidad(text, int) from public, anon;
grant execute on function public.buscar_personas_de_la_comunidad(text, int) to authenticated, service_role;

create or replace function public.buscar_en_mensajeria(termino text, limite int default 20)
returns table (tipo text, id uuid, titulo text, fragmento text, cuando timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(limite, 20), 1), 50);
  v_q text;
  v_like text;
  v_numero text;
  v_es_numero boolean;
begin
  v_q := left(btrim(coalesce(termino, '')), 80);
  if char_length(v_q) < 2 or v_tenant is null or v_uid is null then
    return;
  end if;

  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_numero := regexp_replace(upper(v_q), '[^A-Z0-9]', '', 'g');
  v_es_numero := v_numero ~ '^CL[0-9]{12}$';
  if v_es_numero then
    v_q := 'CL-' || substring(v_numero from 3);
  end if;

  return query
  with hallazgos as (
    select 'conversacion'::text h_tipo,
           c.id h_id,
           p.display_name h_titulo,
           null::text h_fragmento,
           c.created_at h_cuando
      from public.conversations c
      join public.profiles p
        on p.id = case when c.created_by = v_uid then c.counterpart_id else c.created_by end
     where c.tenant_id = v_tenant
       and p.tenant_id = v_tenant
       and (
         app.unaccent_immutable(p.display_name)
           ilike app.unaccent_immutable(v_like) escape '\'
         or (v_es_numero and p.numero_cl = v_q)
       )

    union all

    select 'conversacion'::text,
           c.id,
           p.display_name,
           left(m.body, 140),
           m.created_at
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      join public.profiles p
        on p.id = case when c.created_by = v_uid then c.counterpart_id else c.created_by end
     where m.tenant_id = v_tenant
       and p.tenant_id = v_tenant
       and m.body ilike v_like escape '\'

    union all

    select 'grupo'::text,
           g.id,
           g.name,
           g.description,
           g.created_at
      from public.chat_groups g
     where g.tenant_id = v_tenant
       and app.es_miembro_de_grupo(g.id)
       and (g.name ilike v_like escape '\' or g.description ilike v_like escape '\')

    union all

    select 'grupo'::text,
           g.id,
           g.name,
           left(m.body, 140),
           m.created_at
      from public.chat_group_messages m
      join public.chat_groups g on g.id = m.group_id
     where m.tenant_id = v_tenant
       and m.body ilike v_like escape '\'

    union all

    select 'llamada'::text,
           c.id,
           coalesce(g.name, otro.display_name),
           c.kind || ' · ' || c.status,
           c.created_at
      from public.calls c
      left join public.chat_groups g on g.id = c.group_id
      left join lateral (
        select pr.display_name, pr.numero_cl
          from public.call_participants cp
          join public.profiles pr on pr.id = cp.profile_id
         where cp.call_id = c.id
           and cp.profile_id <> v_uid
         order by pr.display_name
         limit 1
      ) otro on true
     where c.tenant_id = v_tenant
       and (
         g.name ilike v_like escape '\'
         or app.unaccent_immutable(otro.display_name) ilike app.unaccent_immutable(v_like) escape '\'
         or (v_es_numero and otro.numero_cl = v_q)
       )

    union all

    select 'persona'::text,
           p.id,
           p.display_name,
           p.numero_cl,
           null::timestamptz
      from public.profiles p
     where p.tenant_id = v_tenant
       and p.id <> v_uid
       and not app.pair_blocked(v_uid, p.id)
       and (
         app.unaccent_immutable(p.display_name) ilike app.unaccent_immutable(v_like) escape '\'
         or (v_es_numero and p.numero_cl = v_q)
       )
  )
  select d.h_tipo, d.h_id, d.h_titulo, d.h_fragmento, d.h_cuando
    from (
      select distinct on (h.h_tipo, h.h_id) h.*
        from hallazgos h
       order by h.h_tipo, h.h_id, h.h_cuando desc nulls last
    ) d
   order by d.h_cuando desc nulls last, d.h_titulo
   limit v_limit;
end;
$$;

revoke all on function public.buscar_en_mensajeria(text, int) from public, anon;
grant execute on function public.buscar_en_mensajeria(text, int) to authenticated, service_role;

commit;
