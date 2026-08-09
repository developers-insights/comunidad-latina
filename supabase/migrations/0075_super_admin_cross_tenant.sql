-- =============================================================================
-- 0075_super_admin_cross_tenant.sql — Comunidad Latina
--
-- El pliego exige que el súper admin pueda "acceder administrativamente a
-- cualquier dominio" y "ver reportes y moderación". Hoy puede MIRAR cualquier
-- comunidad —el selector del panel y las policies de SELECT ya tienen rama
-- `app.is_global_admin()` desde 0053— pero no puede ACTUAR fuera de la suya:
-- cinco superficies gatean contra el tenant del JWT y no distinguen al súper
-- admin de un admin de dominio.
--
-- LAS CINCO, Y POR QUÉ CADA UNA
--   1-3. `admin_suspend_user`, `admin_ban_user`, `admin_reactivate_user` (0021)
--        buscan el perfil con `... and p.tenant_id = app.current_tenant_id()`.
--        Para el súper admin, una persona de otra comunidad simplemente "no
--        existe" y la sanción falla con PROFILE_NOT_FOUND.
--   4.   policy `listings_update` (0004): no puede aprobar ni pausar un aviso
--        de otra comunidad.
--   5.   policy `scam_reports_update` (0005): no puede resolver un reporte de
--        estafa de otra comunidad.
--   6.   `job_application_tally` (0042): no puede contar postulaciones de otra
--        comunidad — por eso `AdminJobRow.applications` es `number | null` y el
--        panel de Empleos muestra un aviso de "sólo desde tu comunidad".
--
-- LO QUE ESTA MIGRACIÓN **NO** HACE
--   No afloja el aislamiento para nadie más. Cada cambio es una rama NUEVA que
--   sólo se enciende con `app.is_global_admin()`, que lee el claim `role` del
--   JWT — el mismo que ya gobierna `tenants`, `tenant_domains` y `broadcasts`.
--   Un `domain_admin` que apunte a otra comunidad sigue recibiendo EXACTAMENTE
--   el mismo error que hoy, con el mismo texto: no se le informa siquiera si el
--   perfil existe. Esa parte está probada, no supuesta:
--   `src/lib/pricing/cross-tenant-admin.test.ts`.
--
-- POR QUÉ LA SANCIÓN SE ASIENTA EN LA COMUNIDAD DE LA PERSONA
--   `account_sanctions.tenant_id` pasa a ser el tenant DEL SANCIONADO, no el
--   del que sanciona. Para un `domain_admin` los dos valores son idénticos
--   (ya no puede tocar a nadie de afuera), así que nada cambia. Para el súper
--   admin es la única opción correcta: una suspensión archivada en la comunidad
--   equivocada es una suspensión que la comunidad afectada no puede auditar.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Suspender
-- ---------------------------------------------------------------------------
create or replace function public.admin_suspend_user(
  p_profile_id uuid,
  p_days       integer,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = 'public', 'app'
as $$
declare
  v_uid       uuid    := auth.uid();
  v_tenant    uuid    := app.current_tenant_id();
  v_is_global boolean := app.is_global_admin();
  v_target    record;
  v_until     timestamptz;
begin
  -- Un súper admin puede no tener comunidad propia (o tenerla archivada) y
  -- aun así ser quien manda en la plataforma: para él, el tenant del token no
  -- es un requisito. Para el resto sigue siéndolo.
  if v_uid is null or (not v_is_global and v_tenant is null) then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  -- Rol SIEMPRE contra el claim del JWT, nunca profiles.role.
  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'INVALID_DAYS: la suspensión va de 1 a 90 días.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: dejá registrado el motivo de la sanción.';
  end if;

  select p.id, p.role, p.tenant_id into v_target
    from public.profiles p
   where p.id = p_profile_id;

  -- El aislamiento se aplica DESPUÉS de traer la fila y con el MISMO mensaje
  -- que "no existe": si el error distinguiera los dos casos, un domain_admin
  -- podría usar esta función para averiguar quién es miembro de otra
  -- comunidad. El error es idéntico a propósito.
  if not found or (not v_is_global and v_target.tenant_id is distinct from v_tenant) then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;

  if v_target.role <> 'member' then
    raise exception 'CANNOT_SANCTION_STAFF: no se puede sancionar a un miembro del staff desde acá.';
  end if;

  v_until := now() + make_interval(days => p_days);

  update public.profiles
     set account_status = 'suspended',
         suspended_until = v_until
   where id = p_profile_id;

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason, expires_at)
  values (v_target.tenant_id, p_profile_id, v_uid, 'suspend', btrim(p_reason), v_until);
end;
$$;

comment on function public.admin_suspend_user(uuid, integer, text) is
  'Suspende una cuenta por N días. Desde 0075 el global_admin puede hacerlo en CUALQUIER comunidad (el pliego pide "acceder administrativamente a cualquier dominio"); el resto del staff sigue acotado al tenant de su JWT y recibe el mismo PROFILE_NOT_FOUND de siempre, que no revela si la persona existe en otra comunidad. La sanción se archiva en la comunidad DEL SANCIONADO.';

-- ---------------------------------------------------------------------------
-- 2. Dar de baja
-- ---------------------------------------------------------------------------
create or replace function public.admin_ban_user(
  p_profile_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = 'public', 'app'
as $$
declare
  v_uid       uuid    := auth.uid();
  v_tenant    uuid    := app.current_tenant_id();
  v_is_global boolean := app.is_global_admin();
  v_target    record;
begin
  if v_uid is null or (not v_is_global and v_tenant is null) then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  -- Ban = irreversible salvo reactivación explícita: pide domain_admin+.
  if app.current_user_role() not in ('domain_admin', 'global_admin') then
    raise exception 'FORBIDDEN: dar de baja una cuenta requiere permisos de administración.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: dejá registrado el motivo de la sanción.';
  end if;

  select p.id, p.role, p.tenant_id into v_target
    from public.profiles p
   where p.id = p_profile_id;

  if not found or (not v_is_global and v_target.tenant_id is distinct from v_tenant) then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;

  if v_target.role <> 'member' then
    raise exception 'CANNOT_SANCTION_STAFF: no se puede sancionar a un miembro del staff desde acá.';
  end if;

  update public.profiles
     set account_status = 'banned',
         suspended_until = null
   where id = p_profile_id;

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason)
  values (v_target.tenant_id, p_profile_id, v_uid, 'ban', btrim(p_reason));
end;
$$;

comment on function public.admin_ban_user(uuid, text) is
  'Da de baja una cuenta. Desde 0075 el global_admin puede hacerlo en cualquier comunidad; un domain_admin sigue sin poder tocar otra. Sigue exigiendo domain_admin+ (un moderador no da de baja a nadie) y sigue sin poder sancionar staff.';

-- ---------------------------------------------------------------------------
-- 3. Reactivar
-- ---------------------------------------------------------------------------
create or replace function public.admin_reactivate_user(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'app'
as $$
declare
  v_uid       uuid    := auth.uid();
  v_tenant    uuid    := app.current_tenant_id();
  v_is_global boolean := app.is_global_admin();
  v_target    record;
begin
  if v_uid is null or (not v_is_global and v_tenant is null) then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;

  select p.id, p.tenant_id into v_target
    from public.profiles p
   where p.id = p_profile_id;

  if not found or (not v_is_global and v_target.tenant_id is distinct from v_tenant) then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;

  update public.profiles
     set account_status = 'active',
         suspended_until = null
   where id = p_profile_id;

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason)
  values (v_target.tenant_id, p_profile_id, v_uid, 'reactivate', 'reactivación manual');
end;
$$;

comment on function public.admin_reactivate_user(uuid) is
  'Levanta una suspensión o una baja. Desde 0075 el global_admin puede hacerlo en cualquier comunidad — deshacer una sanción tiene que alcanzar tan lejos como aplicarla, o quedaría gente sancionada por la plataforma que su propia comunidad no puede liberar.';

-- ---------------------------------------------------------------------------
-- 4. Contar postulaciones
-- ---------------------------------------------------------------------------
create or replace function public.job_application_tally(p_job_ids uuid[])
returns table(job_id uuid, total integer, pending integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant    uuid    := app.current_tenant_id();
  v_role      text    := app.current_user_role();
  v_is_global boolean := (v_role = 'global_admin');
begin
  -- Mismo umbral que el panel (page.tsx exige domain_admin+): un moderador no
  -- entra acá tampoco. SECURITY DEFINER saltea RLS, así que el gate lo pone
  -- esta función EXPLÍCITAMENTE — regla de la casa de 0014.
  if v_role not in ('domain_admin', 'global_admin') then
    raise exception 'FORBIDDEN: solo administradores del dominio';
  end if;
  -- El súper admin cuenta en toda la plataforma, así que no necesita comunidad
  -- propia. El domain_admin sin tenant en el token sigue sin poder contar nada.
  if v_tenant is null and not v_is_global then
    raise exception 'FORBIDDEN: sin tenant en el token';
  end if;
  if p_job_ids is null or array_length(p_job_ids, 1) is null then
    return;
  end if;
  if array_length(p_job_ids, 1) > 200 then
    raise exception 'TOO_MANY_IDS: máximo 200 avisos por consulta';
  end if;

  return query
    select a.job_id,
           count(*)::int,
           count(*) filter (where a.status = 'submitted')::int
      from public.job_applications a
      join public.listings l
        on l.id = a.job_id
       and l.tenant_id = a.tenant_id
       and l.kind = 'job'
     where a.job_id = any(p_job_ids)
       -- Para todo el que no es súper admin, el tenant del JWT manda en las DOS
       -- tablas: un id de aviso filtrado de afuera no alcanza para contar
       -- postulaciones de otra comunidad. Para el súper admin la restricción se
       -- levanta, pero el join sigue exigiendo que aviso y postulación
       -- pertenezcan al MISMO tenant — nunca se mezclan dos comunidades en un
       -- mismo número.
       and (v_is_global or (a.tenant_id = v_tenant and l.tenant_id = v_tenant))
       -- 'withdrawn' no cuenta: al retirarse, la postulación deja de verse
       -- (misma promesa que tallyApplications en policy.ts).
       and a.status <> 'withdrawn'
     group by a.job_id;
end;
$$;

comment on function public.job_application_tally(uuid[]) is
  'Cuenta postulaciones por aviso, sin exponer quién postuló. Desde 0075 el global_admin cuenta en cualquier comunidad (el panel de Empleos ya no necesita mostrar "sólo desde tu comunidad" ni devolver null); un domain_admin sigue acotado al tenant de su JWT. El join aviso↔postulación exige el mismo tenant en las dos tablas incluso para el súper admin: un conteo que mezclara comunidades sería un número inventado.';

-- ---------------------------------------------------------------------------
-- 5. Moderar avisos de otra comunidad
-- ---------------------------------------------------------------------------
-- La rama es la MISMA forma que ya usan `listings_select`, `posts_select` y
-- `scam_reports_select` desde 0053: un OR al final, envuelto en (select …) para
-- que Postgres lo evalúe una vez por consulta y no una vez por fila.
drop policy if exists listings_update on public.listings;
create policy listings_update on public.listings
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      created_by = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (
        created_by = (select auth.uid())
        and source = 'user'
        and status in ('draft', 'pending_review', 'paused', 'removed')
      )
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy listings_update on public.listings is
  'Edita el dueño (con los límites de estado de 0004), el staff de la comunidad, y —desde 0075— el global_admin en CUALQUIER comunidad, que es lo que el pliego llama "acceder administrativamente a cualquier dominio". El dueño y el staff local no ganaron nada: sus dos ramas están intactas y siguen atadas a app.current_tenant_id().';

-- ---------------------------------------------------------------------------
-- 6. Resolver reportes de estafa de otra comunidad
-- ---------------------------------------------------------------------------
drop policy if exists scam_reports_update on public.scam_reports;
create policy scam_reports_update on public.scam_reports
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_staff())
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_staff())
  )
  or (select app.is_global_admin())
);

comment on policy scam_reports_update on public.scam_reports is
  'Resuelve el staff de la comunidad del reporte y —desde 0075— el global_admin en cualquiera. Es la contracara de scam_reports_select, que ya dejaba MIRAR reportes ajenos desde 0053: poder leer un reporte de estafa y no poder cerrarlo era una asimetría sin sentido.';

commit;
