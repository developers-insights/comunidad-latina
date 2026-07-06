-- =============================================================================
-- 0014_rpcs.sql — Comunidad Latina
-- RPCs security definer (schema public, search_path fijado). Regla de la casa:
-- toda RPC valida tenant EXPLÍCITAMENTE contra el claim del JWT — nunca confía
-- en que "el bypass ya filtró". Los mensajes de error usan prefijo CODE: para
-- que la UI los traduzca a copy §4 sin regex frágiles.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- get_tenant_by_domain — resolución Host → tenant para el middleware (anon OK)
-- ---------------------------------------------------------------------------
create or replace function public.get_tenant_by_domain(p_domain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  v_domain text;
  v_result jsonb;
begin
  v_domain := lower(btrim(coalesce(p_domain, '')));
  v_domain := regexp_replace(v_domain, ':[0-9]+$', ''); -- sin puerto
  if v_domain = '' then
    return null;
  end if;

  select jsonb_build_object(
           'id',            t.id,
           'slug',          t.slug,
           'name',          t.name,
           'brand_hex',     t.brand_hex,
           'logo_url',      t.logo_url,
           'locale',        t.locale,
           'currency',      t.currency,
           'country_focus', t.country_focus,
           'city_seed',     t.city_seed,
           'modules',       t.modules,
           'theme',         t.theme
         )
    into v_result
    from public.tenant_domains d
    join public.tenants t on t.id = d.tenant_id
   where t.status = 'active'
     and (
       d.domain = v_domain
       or d.domain = regexp_replace(v_domain, '^www\.', '')
     )
   order by d.is_primary desc
   limit 1;

  return v_result; -- null = dominio no registrado o tenant pausado
end;
$$;

comment on function public.get_tenant_by_domain(text) is
  'Resuelve un hostname a su tenant ACTIVO + theme/modules para el middleware. Pública (anon): solo expone branding pre-login. Devuelve null si no hay tenant activo.';

revoke execute on function public.get_tenant_by_domain(text) from public;
grant execute on function public.get_tenant_by_domain(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- request_contact — contacto protegido (§9.2): crea conversación pending
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
  'Contacto protegido: crea (o devuelve) la conversación pending entre auth.uid() y el creador del listing published del MISMO tenant. Seed sin cuenta → error claro LISTING_HAS_NO_ACCOUNT. El dato de contacto real nunca se expone.';

revoke execute on function public.request_contact(uuid) from public, anon;
grant execute on function public.request_contact(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- accept_conversation — solo la contraparte acepta
-- ---------------------------------------------------------------------------
create or replace function public.accept_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_conv   record;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  select c.id, c.tenant_id, c.counterpart_id, c.status, c.accepted_at
    into v_conv
    from public.conversations c
   where c.id = p_conversation_id;

  if not found or v_conv.tenant_id is distinct from v_tenant then
    raise exception 'CONVERSATION_NOT_FOUND: la conversación no existe.';
  end if;

  if v_conv.counterpart_id <> v_uid then
    -- Ni el creador ni terceros: solo quien recibió la solicitud puede aceptar.
    raise exception 'NOT_COUNTERPART: solo quien recibió la solicitud puede aceptarla.';
  end if;

  if v_conv.status = 'blocked' then
    raise exception 'CONVERSATION_BLOCKED: la conversación está bloqueada.';
  end if;

  if v_conv.status = 'accepted' then
    return jsonb_build_object('id', v_conv.id, 'status', 'accepted', 'accepted_at', v_conv.accepted_at);
  end if;

  update public.conversations
     set status = 'accepted',
         accepted_at = now()
   where id = v_conv.id;

  return jsonb_build_object('id', v_conv.id, 'status', 'accepted', 'accepted_at', now());
end;
$$;

comment on function public.accept_conversation(uuid) is
  'Acepta una solicitud de contacto. Valida tenant + que auth.uid() sea la CONTRAPARTE (el creador no puede auto-aceptar). Idempotente si ya estaba aceptada.';

revoke execute on function public.accept_conversation(uuid) from public, anon;
grant execute on function public.accept_conversation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- report_scam — reporte ponderado por Trust Score del reportante
-- ---------------------------------------------------------------------------
create or replace function public.report_scam(
  p_target_kind text,
  p_target_id   uuid,
  p_reason      text,
  p_details     text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid := app.current_tenant_id();
  v_report_id uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para reportar.';
  end if;

  if p_target_kind not in ('listing', 'profile', 'message') then
    raise exception 'INVALID_TARGET_KIND: tipo de reporte inválido.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: contanos brevemente qué pasó.';
  end if;

  -- El objetivo debe existir EN MI tenant (y, si es un mensaje, tengo que ser
  -- participante de esa conversación: nadie reporta chats que no puede ver).
  if p_target_kind = 'listing' then
    if not exists (
      select 1 from public.listings l
      where l.id = p_target_id and l.tenant_id = v_tenant
    ) then
      raise exception 'TARGET_NOT_FOUND: el aviso no existe en tu comunidad.';
    end if;
  elsif p_target_kind = 'profile' then
    if not exists (
      select 1 from public.profiles p
      where p.id = p_target_id and p.tenant_id = v_tenant
    ) then
      raise exception 'TARGET_NOT_FOUND: el perfil no existe en tu comunidad.';
    end if;
  else -- message
    if not exists (
      select 1
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
       where m.id = p_target_id
         and m.tenant_id = v_tenant
         and c.tenant_id = v_tenant
         and (c.created_by = v_uid or c.counterpart_id = v_uid)
    ) then
      raise exception 'TARGET_NOT_FOUND: el mensaje no existe o no es de una conversación tuya.';
    end if;
  end if;

  -- weight lo fija el trigger app.scam_report_set_weight() según el Trust
  -- Score del reportante: acá no se acepta peso del cliente.
  insert into public.scam_reports (tenant_id, reporter_id, target_kind, target_id, reason, details, status)
  values (v_tenant, v_uid, p_target_kind, p_target_id, btrim(p_reason), nullif(btrim(coalesce(p_details, '')), ''), 'open')
  returning id into v_report_id;

  return v_report_id;
end;
$$;

comment on function public.report_scam(text, uuid, text, text) is
  'Crea un scam_report validando que el objetivo exista en el tenant del reportante (y que sea participante si reporta un mensaje). El peso sale del Trust Score via trigger, jamás del cliente.';

revoke execute on function public.report_scam(text, uuid, text, text) from public, anon;
grant execute on function public.report_scam(text, uuid, text, text) to authenticated, service_role;
