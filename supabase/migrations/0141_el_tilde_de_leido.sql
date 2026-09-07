-- =============================================================================
-- 0141_el_tilde_de_leido.sql — Comunidad Latina
--
-- El doble tilde de la bandeja, sin publicar cuándo abrió el chat la otra persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · El tilde de una conversación
--
-- SECURITY DEFINER es indispensable porque la policy de conversation_reads deja
-- ver sólo la marca propia. La función vuelve ÚNICAMENTE un booleano: la hora
-- ajena sigue privada aun para quien compartió la conversación.
-- ---------------------------------------------------------------------------
create or replace function public.fue_leido_por_el_otro(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant           uuid := app.current_tenant_id();
  v_uid              uuid := auth.uid();
  v_otro_profile_id  uuid;
  v_ultimo_envio_at  timestamptz;
  v_ultimo_leido_at  timestamptz;
begin
  if v_uid is null or v_tenant is null then
    return false;
  end if;

  select case
           when c.created_by = v_uid then c.counterpart_id
           else c.created_by
         end
    into v_otro_profile_id
    from public.conversations c
   where c.id = p_conversation_id
     and c.tenant_id = v_tenant
     and (c.created_by = v_uid or c.counterpart_id = v_uid);

  if v_otro_profile_id is null then
    return false;
  end if;

  select pg_catalog.max(m.created_at)
    into v_ultimo_envio_at
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.tenant_id = v_tenant
     and m.sender_id = v_uid
     and m.deleted_at is null;

  if v_ultimo_envio_at is null then
    return false;
  end if;

  select r.last_read_at
    into v_ultimo_leido_at
    from public.conversation_reads r
   where r.conversation_id = p_conversation_id
     and r.profile_id = v_otro_profile_id
     and r.tenant_id = v_tenant;

  return coalesce(v_ultimo_leido_at >= v_ultimo_envio_at, false);
end;
$$;

comment on function public.fue_leido_por_el_otro(uuid) is
  'Dice sólo si la otra persona ya llegó al último mensaje no borrado que envió quien consulta (0141). SECURITY DEFINER es necesario para comparar la marca ajena sin abrir conversation_reads; devuelve booleano, nunca last_read_at, porque la hora exacta en que alguien abrió un chat sigue siendo privada. Un id ajeno, inexistente o sin mensajes propios devuelve false para no distinguirlos.';

revoke all    on function public.fue_leido_por_el_otro(uuid) from public, anon;
grant execute on function public.fue_leido_por_el_otro(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2 · Los tildes de toda la bandeja
--
-- La bandeja pide hasta 100 conversaciones de una vez: sin este límite un array
-- fabricado puede convertir un RPC liviano en joins sobre una cantidad arbitraria
-- de mensajes. Más de 100 se parte del lado de la app, no se repite una consulta
-- por fila.
-- ---------------------------------------------------------------------------
create or replace function public.fue_leido_por_el_otro_en_lote(p_conversation_ids uuid[])
returns table (
  conversation_id uuid,
  leido           boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
begin
  if v_uid is null or v_tenant is null or p_conversation_ids is null then
    return;
  end if;

  if coalesce(pg_catalog.cardinality(p_conversation_ids), 0) > 100 then
    raise exception 'TOO_MANY_CONVERSATIONS: el máximo por consulta es 100.';
  end if;

  return query
  with solicitadas as (
    select distinct ids.conversation_id
      from pg_catalog.unnest(p_conversation_ids) as ids(conversation_id)
     where ids.conversation_id is not null
  ),
  participantes as (
    select s.conversation_id,
           case
             when c.created_by = v_uid then c.counterpart_id
             else c.created_by
           end as otro_profile_id
      from solicitadas s
      left join public.conversations c
        on c.id = s.conversation_id
       and c.tenant_id = v_tenant
       and (c.created_by = v_uid or c.counterpart_id = v_uid)
  ),
  ultimos_envios as (
    select m.conversation_id,
           pg_catalog.max(m.created_at) as ultimo_envio_at
      from public.messages m
      join solicitadas s
        on s.conversation_id = m.conversation_id
     where m.tenant_id = v_tenant
       and m.sender_id = v_uid
       and m.deleted_at is null
     group by m.conversation_id
  )
  select p.conversation_id,
         coalesce(r.last_read_at >= u.ultimo_envio_at, false)
    from participantes p
    left join ultimos_envios u
      on u.conversation_id = p.conversation_id
    left join public.conversation_reads r
      on r.conversation_id = p.conversation_id
     and r.profile_id = p.otro_profile_id
     and r.tenant_id = v_tenant;
end;
$$;

comment on function public.fue_leido_por_el_otro_en_lote(uuid[]) is
  'Versión en lote de fue_leido_por_el_otro() para que la bandeja resuelva todos los tildes en UNA consulta y no haga N viajes, uno por chat (0141). Acepta como máximo 100 ids para que un array fabricado no fuerce joins sobre una cantidad arbitraria de mensajes; la app parte lotes mayores. Conserva la misma privacidad: por cada id devuelve sólo un booleano y false no revela si el chat existe, es ajeno o no tiene mensajes propios.';

revoke all    on function public.fue_leido_por_el_otro_en_lote(uuid[]) from public, anon;
grant execute on function public.fue_leido_por_el_otro_en_lote(uuid[]) to authenticated, service_role;

commit;
