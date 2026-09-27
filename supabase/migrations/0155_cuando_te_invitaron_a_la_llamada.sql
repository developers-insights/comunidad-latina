begin;

-- =============================================================================
-- 0155 · Cuándo te invitaron a una llamada
-- =============================================================================
--
-- EL SÍNTOMA. En una llamada de grupo, el timbre dejaba de sonarles a todos en
-- cuanto atendía el primero, y a quien se sumaba con la llamada ya en curso no
-- le sonaba nunca. El vigilante preguntaba por `calls.status = 'sonando'` y
-- `calls.created_at` de hace menos de un minuto: dos datos de la LLAMADA, que en
-- un grupo no dicen nada de cuándo le tocó sonar a cada uno.
--
-- LA VÍA. Cada invitación guarda su propio momento. El timbre suena mientras la
-- llamada siga viva (`sonando` o `en_curso`), yo no haya entrado y me hayan
-- invitado hace menos de un minuto.
--
-- Lo escribe el trigger y nadie más: si el cliente pudiera fijarlo, podría
-- hacer sonar para siempre el teléfono de otra persona.
-- =============================================================================

alter table public.call_participants
  add column if not exists invitada_at timestamptz not null default now();

-- Las filas que ya existían nacen con la fecha de su llamada, no con la de hoy:
-- si no, una llamada viva al aplicar esto volvería a sonar un minuto entero.
update public.call_participants cp
   set invitada_at = c.created_at
  from public.calls c
 where c.id = cp.call_id;

comment on column public.call_participants.invitada_at is
  'Cuándo se creó la invitación (0155). La fija el trigger validar_participante_de_llamada; el timbre de una llamada viva suena el primer minuto desde acá.';

create index if not exists call_participants_timbre_idx
  on public.call_participants (profile_id, invitada_at desc)
  where joined_at is null and left_at is null;

create or replace function app.validar_participante_de_llamada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_llamada_viva boolean;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.profile_id = auth.uid() then
      new.joined_at := coalesce(new.joined_at, now());
    else
      new.joined_at := null;
    end if;
    new.left_at := null;
    new.invitada_at := now();
    return new;
  end if;

  new.call_id := old.call_id;
  new.profile_id := old.profile_id;
  new.tenant_id := old.tenant_id;
  new.invitada_at := old.invitada_at;

  -- REINGRESO: ver 0149. Única puerta por la que left_at deja de ser inmutable.
  if old.left_at is not null and new.left_at is null then
    select c.status in ('sonando', 'en_curso') into v_llamada_viva
      from public.calls c
     where c.id = new.call_id;

    if not coalesce(v_llamada_viva, false) then
      raise exception 'CALL_PARTICIPANT_REJOIN: la llamada ya no está viva.';
    end if;

    new.joined_at := coalesce(new.joined_at, now());
    return new;
  end if;

  if old.joined_at is not null and new.joined_at is distinct from old.joined_at then
    raise exception 'CALL_PARTICIPANT_JOINED: joined_at es inmutable mientras sigue adentro.';
  end if;
  if old.left_at is not null and new.left_at is distinct from old.left_at then
    raise exception 'CALL_PARTICIPANT_LEFT: left_at es inmutable salvo para reingresar.';
  end if;

  if old.joined_at is null and new.joined_at is not null then
    new.joined_at := now();
  end if;
  if old.left_at is null and new.left_at is not null then
    if new.joined_at is null then
      raise exception 'CALL_PARTICIPANT_NOT_JOINED: no se puede salir antes de entrar.';
    end if;
    new.left_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function app.validar_participante_de_llamada() from public, anon;

commit;
