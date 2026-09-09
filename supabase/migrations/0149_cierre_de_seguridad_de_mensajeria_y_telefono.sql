begin;

drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    iniciada_por = (select auth.uid())
    or app.estoy_en_la_llamada(id)
  )
);

drop policy if exists calls_delete on public.calls;
create policy calls_delete on public.calls
for delete to authenticated
using (false);

drop policy if exists call_participants_delete on public.call_participants;
create policy call_participants_delete on public.call_participants
for delete to authenticated
using (false);

create or replace function app.validar_cambio_de_llamada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id           := old.id;
  new.tenant_id    := old.tenant_id;
  new.canal        := old.canal;
  new.iniciada_por := old.iniciada_por;
  new.kind         := old.kind;
  new.group_id     := old.group_id;
  new.created_at   := old.created_at;

  if old.status in ('terminada', 'perdida', 'rechazada') then
    if new.status <> old.status
       or new.started_at is distinct from old.started_at
       or new.ended_at is distinct from old.ended_at then
      raise exception 'CALL_FINAL: una llamada finalizada no se puede reabrir.';
    end if;
    return new;
  end if;

  if new.status = old.status then
    new.started_at := old.started_at;
    new.ended_at := old.ended_at;
    return new;
  end if;

  if old.status = 'sonando' and new.status = 'en_curso' then
    new.started_at := now();
    new.ended_at := null;
    return new;
  end if;

  if old.status = 'sonando' and new.status in ('terminada', 'perdida', 'rechazada') then
    new.started_at := null;
    new.ended_at := now();
    return new;
  end if;

  if old.status = 'en_curso' and new.status = 'terminada' then
    new.started_at := old.started_at;
    new.ended_at := now();
    return new;
  end if;

  raise exception 'CALL_TRANSITION: cambio de estado inválido (% -> %).', old.status, new.status;
end;
$$;

revoke execute on function app.validar_cambio_de_llamada() from public, anon;

drop trigger if exists calls_proteger_columnas on public.calls;
drop trigger if exists calls_validar_cambio on public.calls;
create trigger calls_validar_cambio
before update on public.calls
for each row execute function app.validar_cambio_de_llamada();

create or replace function app.validar_participante_de_llamada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.profile_id = auth.uid() then
      new.joined_at := coalesce(new.joined_at, now());
    else
      new.joined_at := null;
    end if;
    new.left_at := null;
    return new;
  end if;

  new.call_id := old.call_id;
  new.profile_id := old.profile_id;
  new.tenant_id := old.tenant_id;

  if old.joined_at is not null and new.joined_at is distinct from old.joined_at then
    raise exception 'CALL_PARTICIPANT_JOINED: joined_at es inmutable.';
  end if;
  if old.left_at is not null and new.left_at is distinct from old.left_at then
    raise exception 'CALL_PARTICIPANT_LEFT: left_at es inmutable.';
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

drop trigger if exists call_participants_validar on public.call_participants;
create trigger call_participants_validar
before insert or update on public.call_participants
for each row execute function app.validar_participante_de_llamada();

create or replace function app.validar_adjunto_de_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if new.adjunto is null then
    return new;
  end if;

  if jsonb_typeof(new.adjunto) <> 'object' then
    raise exception 'CHAT_MEDIA_METADATA: metadatos de adjunto inválidos.';
  end if;

  v_path := new.adjunto ->> 'path';
  if v_path is null
     or char_length(v_path) > 300
     or v_path not like new.tenant_id::text || '/' || new.sender_id::text || '/%' then
    raise exception 'CHAT_MEDIA_PATH: el adjunto no pertenece a quien envía.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'chat-media'
       and o.name = v_path
       and o.owner_id = new.sender_id::text
  ) then
    raise exception 'CHAT_MEDIA_OBJECT: el adjunto no existe o no pertenece a quien envía.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function app.validar_adjunto_de_chat() from public, anon;

drop trigger if exists messages_validar_adjunto_seguro on public.messages;
create trigger messages_validar_adjunto_seguro
before insert or update of adjunto, tenant_id, sender_id on public.messages
for each row execute function app.validar_adjunto_de_chat();

drop trigger if exists chat_group_messages_validar_adjunto_seguro on public.chat_group_messages;
create trigger chat_group_messages_validar_adjunto_seguro
before insert or update of adjunto, tenant_id, sender_id on public.chat_group_messages
for each row execute function app.validar_adjunto_de_chat();

do $$
begin
  if exists (
    select 1
      from public.messages m
     where m.adjunto is not null
       and (
         m.adjunto ->> 'path' not like m.tenant_id::text || '/' || m.sender_id::text || '/%'
         or not exists (
           select 1 from storage.objects o
            where o.bucket_id = 'chat-media'
              and o.name = m.adjunto ->> 'path'
              and o.owner_id = m.sender_id::text
         )
       )
  ) or exists (
    select 1
      from public.chat_group_messages m
     where m.adjunto is not null
       and (
         m.adjunto ->> 'path' not like m.tenant_id::text || '/' || m.sender_id::text || '/%'
         or not exists (
           select 1 from storage.objects o
            where o.bucket_id = 'chat-media'
              and o.name = m.adjunto ->> 'path'
              and o.owner_id = m.sender_id::text
         )
       )
  ) then
    raise exception 'CHAT_MEDIA_EXISTING: hay referencias de adjuntos inválidas; corregir antes de aplicar.';
  end if;
end;
$$;

drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

drop policy if exists chat_media_update on storage.objects;
create policy chat_media_update on storage.objects
for update to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
)
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

drop policy if exists chat_media_delete on storage.objects;
create policy chat_media_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

drop policy if exists chat_media_select on storage.objects;
create policy chat_media_select on storage.objects
for select to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (
    (
      (storage.foldername(name))[2] = (select auth.uid())::text
      and owner_id = (select auth.uid())::text
    )
    or exists (
      select 1
        from public.messages m
       where m.tenant_id::text = (storage.foldername(name))[1]
         and m.sender_id::text = (storage.foldername(name))[2]
         and m.adjunto ->> 'path' = storage.objects.name
    )
    or exists (
      select 1
        from public.chat_group_messages m
       where m.tenant_id::text = (storage.foldername(name))[1]
         and m.sender_id::text = (storage.foldername(name))[2]
         and m.adjunto ->> 'path' = storage.objects.name
    )
  )
);

create index if not exists phone_verification_codes_actor_rate_idx
  on public.phone_verification_codes (tenant_id, profile_id, created_at desc);

create or replace function app.phone_verification_request(
  p_tenant uuid,
  p_profile uuid,
  p_phone text,
  p_code_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_key bigint;
  v_phone_key bigint;
  v_hora int;
  v_dia int;
  v_taken boolean;
begin
  if p_phone !~ '^\+[1-9]\d{7,14}$' or p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'PHONE_REQUEST_INVALID: parámetros inválidos.';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_profile and p.tenant_id = p_tenant
  ) then
    raise exception 'PHONE_REQUEST_PROFILE: perfil fuera de la comunidad.' using errcode = '42501';
  end if;

  v_actor_key := pg_catalog.hashtextextended(p_tenant::text || ':actor:' || p_profile::text, 0);
  v_phone_key := pg_catalog.hashtextextended(p_tenant::text || ':phone:' || p_phone, 0);
  perform pg_catalog.pg_advisory_xact_lock(least(v_actor_key, v_phone_key));
  if v_actor_key <> v_phone_key then
    perform pg_catalog.pg_advisory_xact_lock(greatest(v_actor_key, v_phone_key));
  end if;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
    into v_hora, v_dia
    from public.phone_verification_codes
   where tenant_id = p_tenant
     and (profile_id = p_profile or phone_e164 = p_phone);

  if v_hora >= 3 then return 'rate_limited_hora'; end if;
  if v_dia >= 10 then return 'rate_limited_dia'; end if;

  select exists (
    select 1
      from public.user_phones up
     where up.tenant_id = p_tenant
       and up.phone_e164 = p_phone
       and up.phone_verified
       and up.profile_id <> p_profile
  ) into v_taken;

  insert into public.phone_verification_codes (
    tenant_id, profile_id, phone_e164, code_hash, consumed_at
  ) values (
    p_tenant, p_profile, p_phone, p_code_hash,
    case when v_taken then now() else null end
  );

  if v_taken then return 'accepted'; end if;
  return 'send';
end;
$$;

create or replace function public.phone_verification_request(
  p_tenant uuid,
  p_profile uuid,
  p_phone text,
  p_code_hash text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app.phone_verification_request(p_tenant, p_profile, p_phone, p_code_hash);
$$;

revoke all on function app.phone_verification_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.phone_verification_request(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function app.phone_verification_request(uuid, uuid, text, text) to service_role;
grant execute on function public.phone_verification_request(uuid, uuid, text, text) to service_role;

create or replace function app.phone_verification_consume_and_bind(
  p_tenant uuid,
  p_profile uuid,
  p_phone text,
  p_code_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.phone_verification_codes%rowtype;
begin
  select * into v_row
    from public.phone_verification_codes
   where tenant_id = p_tenant
     and profile_id = p_profile
     and phone_e164 = p_phone
     and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then return 'sin_codigo'; end if;
  if v_row.expires_at <= now() then return 'expirado'; end if;
  if v_row.attempts >= v_row.max_attempts then return 'agotado'; end if;
  if v_row.code_hash <> p_code_hash then
    update public.phone_verification_codes set attempts = attempts + 1 where id = v_row.id;
    return 'invalido';
  end if;

  update public.phone_verification_codes
     set consumed_at = now()
   where tenant_id = p_tenant
     and profile_id = p_profile
     and phone_e164 = p_phone
     and consumed_at is null;

  begin
    insert into public.user_phones (
      profile_id, tenant_id, phone_e164, phone_verified, phone_verified_at, verification_channel
    ) values (
      p_profile, p_tenant, p_phone, true, now(), 'sms'
    )
    on conflict (profile_id) do update set
      tenant_id = excluded.tenant_id,
      phone_e164 = excluded.phone_e164,
      phone_verified = true,
      phone_verified_at = excluded.phone_verified_at,
      verification_channel = excluded.verification_channel;
  exception when unique_violation then
    return 'ocupado';
  end;

  update public.profiles
     set phone_verified = true
   where id = p_profile
     and tenant_id = p_tenant;
  if not found then
    raise exception 'PHONE_BIND_PROFILE: perfil fuera de la comunidad.' using errcode = '42501';
  end if;

  return 'ok';
end;
$$;

create or replace function public.phone_verification_consume_and_bind(
  p_tenant uuid,
  p_profile uuid,
  p_phone text,
  p_code_hash text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app.phone_verification_consume_and_bind(p_tenant, p_profile, p_phone, p_code_hash);
$$;

revoke all on function app.phone_verification_consume_and_bind(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.phone_verification_consume_and_bind(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function app.phone_verification_consume_and_bind(uuid, uuid, text, text) to service_role;
grant execute on function public.phone_verification_consume_and_bind(uuid, uuid, text, text) to service_role;

create or replace function app.phone_verification_remove(p_tenant uuid, p_profile uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = p_profile and p.tenant_id = p_tenant
  ) then
    raise exception 'PHONE_REMOVE_PROFILE: perfil fuera de la comunidad.' using errcode = '42501';
  end if;

  delete from public.user_phones
   where profile_id = p_profile
     and tenant_id = p_tenant;
  update public.profiles
     set phone_verified = false
   where id = p_profile
     and tenant_id = p_tenant;
  return true;
end;
$$;

create or replace function public.phone_verification_remove(p_tenant uuid, p_profile uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app.phone_verification_remove(p_tenant, p_profile);
$$;

revoke all on function app.phone_verification_remove(uuid, uuid) from public, anon, authenticated;
revoke all on function public.phone_verification_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function app.phone_verification_remove(uuid, uuid) to service_role;
grant execute on function public.phone_verification_remove(uuid, uuid) to service_role;

commit;
