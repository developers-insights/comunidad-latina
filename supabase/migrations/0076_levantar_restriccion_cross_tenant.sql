-- =============================================================================
-- 0076_levantar_restriccion_cross_tenant.sql — Comunidad Latina
--
-- BUG QUE ARREGLA (encontrado por la auditoría de aislamiento multidominio y
-- verificado ejecutando contra la base):
--
--   `admin_lift_restriction` (0033) es la ÚNICA de la familia de acciones
--   administrativas sin la guarda de pertenencia. Sus cinco hermanas
--   —admin_suspend_user, admin_ban_user, admin_reactivate_user,
--   admin_restrict_user y admin_resolve_creator_activation— buscan el perfil y
--   levantan PROFILE_NOT_FOUND si no es de su comunidad. Ésta no: filtra el
--   UPDATE por `tenant_id = v_tenant` (así que el aislamiento de DATOS aguanta:
--   no levanta ninguna restricción ajena) pero después INSERTA igual la fila de
--   `account_sanctions` y devuelve 204.
--
--   Consecuencia real: un `domain_admin` puede llamar la función con el uuid de
--   alguien de OTRA comunidad y la llamada le sale bien. Queda una anotación en
--   su propio registro afirmando que levantó una restricción que nunca existió,
--   sobre una persona que no es suya. No es una fuga de datos —no lee nada del
--   otro lado— pero es un registro que MIENTE, y un registro que miente es peor
--   que no tener registro: alguien lo va a leer y creerle.
--
-- LOS DOS ARREGLOS, EN UNA SOLA REESCRITURA
--   1. GUARDA DE PERTENENCIA ANTES DE ESCRIBIR. Se busca el perfil primero y se
--      falla con el MISMO código y el MISMO texto que usan las otras cinco
--      ('PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.'), que además
--      no distingue "no existe" de "no es tuyo" — si distinguiera, la función
--      serviría para averiguar quién es miembro de otra comunidad.
--   2. NO SE ANOTA LO QUE NO PASÓ. La fila de `account_sanctions` se escribe
--      SÓLO si el UPDATE levantó algo. Levantar una restricción que no estaba
--      vigente no es un error —el botón tiene que poder apretarse dos veces sin
--      romperse— pero tampoco es un hecho que merezca quedar escrito.
--
-- Y LA RAMA DEL SÚPER ADMIN, porque va en el mismo cambio
--   La 0075 le dio al `global_admin` alcance en cualquier comunidad para
--   suspender, banear, reactivar y moderar. `admin_restrict_user` y
--   `admin_lift_restriction` son el mismo par aplicar/deshacer una escala más
--   abajo: dejarlas afuera significaría que el súper admin puede BANEAR a
--   alguien de otra comunidad pero no puede levantarle una restricción de
--   marketplace. Se le suma la rama a las dos, con la misma forma exacta que en
--   0075 — y el `domain_admin` sigue sin poder tocar nada ajeno, que es lo que
--   prueba `src/lib/pricing/cross-tenant-admin.test.ts`.
--
-- LA RESTRICCIÓN SE LEVANTA EN LA COMUNIDAD DE LA PERSONA, no en la de quien la
-- levanta. Para un `domain_admin` los dos valores son idénticos; para el súper
-- admin es la única opción correcta.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Levantar una restricción
-- ---------------------------------------------------------------------------
create or replace function public.admin_lift_restriction(
  p_profile_id uuid,
  p_scope      text
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
  v_lifted    integer;
begin
  if v_uid is null or (not v_is_global and v_tenant is null) then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;
  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;
  if p_scope not in ('social', 'marketplace', 'pagos', 'publicidad', 'total') then
    raise exception 'INVALID_SCOPE: social | marketplace | pagos | publicidad | total.';
  end if;

  -- LA GUARDA QUE FALTABA. Va ANTES de cualquier escritura: el registro no
  -- puede anotar una acción que la función todavía no decidió permitir.
  select p.id, p.tenant_id into v_target
    from public.profiles p
   where p.id = p_profile_id;

  if not found or (not v_is_global and v_target.tenant_id is distinct from v_tenant) then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;

  update public.account_restrictions
     set lifted_at = now(), lifted_by = v_uid
   where profile_id = p_profile_id
     and tenant_id  = v_target.tenant_id
     and scope      = p_scope
     and lifted_at is null;

  get diagnostics v_lifted = row_count;

  -- Si no había nada vigente, no pasó nada. No es un error (apretar dos veces
  -- el mismo botón tiene que ser inofensivo), pero tampoco es un hecho: no se
  -- anota. Antes se anotaba siempre, y eso era el registro afirmando algo falso.
  if v_lifted = 0 then
    return;
  end if;

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason, scope)
  values (v_target.tenant_id, p_profile_id, v_uid,
          'reactivate', 'levantar restricción ' || p_scope, p_scope);
end;
$$;

comment on function public.admin_lift_restriction(uuid, text) is
  'Levanta una restricción vigente. Desde 0076 verifica PERTENENCIA antes de escribir nada —era la única de la familia que no lo hacía, y por eso una llamada cross-tenant devolvía 204 y dejaba una anotación falsa— y sólo registra la sanción si efectivamente levantó algo. El global_admin puede hacerlo en cualquier comunidad (misma rama que 0075); el resto del staff sigue acotado al tenant de su JWT y recibe el mismo PROFILE_NOT_FOUND que las otras cinco.';

-- ---------------------------------------------------------------------------
-- 2. Aplicar una restricción — la contracara, para que no queden asimétricas
-- ---------------------------------------------------------------------------
create or replace function public.admin_restrict_user(
  p_profile_id uuid,
  p_scope      text,
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
  v_expires   timestamptz;
begin
  if v_uid is null or (not v_is_global and v_tenant is null) then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;
  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;
  if p_scope not in ('social', 'marketplace', 'pagos', 'publicidad', 'total') then
    raise exception 'INVALID_SCOPE: social | marketplace | pagos | publicidad | total.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: dejá registrado el motivo.';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then
    raise exception 'INVALID_DAYS: la restricción va de 1 a 365 días (o null = indefinida).';
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

  v_expires := case when p_days is null then null else now() + make_interval(days => p_days) end;

  insert into public.account_restrictions (tenant_id, profile_id, scope, reason, expires_at, applied_by)
  values (v_target.tenant_id, p_profile_id, p_scope, btrim(p_reason), v_expires, v_uid);

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason, expires_at, scope)
  values (v_target.tenant_id, p_profile_id, v_uid, 'suspend', btrim(p_reason), v_expires, p_scope);
end;
$$;

comment on function public.admin_restrict_user(uuid, text, integer, text) is
  'Restringe a una persona en un ámbito (social, marketplace, pagos, publicidad, total). Desde 0076 el global_admin puede hacerlo en cualquier comunidad, para no quedar en la situación absurda de poder banear a alguien de otra comunidad pero no restringirle el marketplace. La guarda de pertenencia y el CANNOT_SANCTION_STAFF no cambiaron: un domain_admin sigue sin poder tocar a nadie de afuera. La restricción se archiva en la comunidad DE LA PERSONA.';

commit;
