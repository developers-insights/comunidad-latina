-- =============================================================================
-- 0006_messaging.sql — Comunidad Latina
-- conversations + messages (contacto protegido §9.2 + minimización §5.4).
--   * TTL 90 días en messages (job pg_cron en 0013): lo que se borra rápido
--     no es subpoenable después.
--   * cipher_envelope reservada para E2E futuro.
--   * Privacidad estricta: SOLO participantes. Ni staff ni global_admin leen
--     mensajes privados por policy (§5.4 — no somos un honeypot de chats).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table public.conversations (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants(id),
  listing_id     uuid references public.listings(id) on delete set null,
  created_by     uuid not null references public.profiles(id),
  counterpart_id uuid not null references public.profiles(id),
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  accepted_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint conversations_no_self check (created_by <> counterpart_id)
);

comment on table public.conversations is
  'Contacto protegido: el interesado solicita (pending) y la contraparte acepta/bloquea. El dato de contacto real nunca sale del aviso: la relación vive acá. RETENCIÓN §5.4: el grafo quién-contactó-a-quién NO es indefinido — pg_cron (0013, purge-stale-conversations) borra conversaciones de +90 días sin mensajes vivos; la actividad renueva. Así el TTL de messages no deja huérfano el metadato subpoenable.';
comment on column public.conversations.status is
  'pending → accepted (solo counterpart, via accept_conversation) | blocked. El creador NO puede auto-aceptar.';

create index conversations_tenant_creator_idx on public.conversations (tenant_id, created_by, created_at desc);
create index conversations_tenant_counterpart_idx on public.conversations (tenant_id, counterpart_id, created_at desc);
create index conversations_listing_idx on public.conversations (listing_id);
-- Una solicitud por (listing, interesado): request_contact es idempotente.
create unique index conversations_listing_requester_uniq
  on public.conversations (listing_id, created_by)
  where listing_id is not null;

-- Guarda: por update directo solo pueden cambiar status/accepted_at.
create or replace function app.protect_conversation_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.created_by is distinct from old.created_by
     or new.counterpart_id is distinct from old.counterpart_id
     or new.listing_id is distinct from old.listing_id then
    raise exception 'PROTECTED_COLUMNS: solo status/accepted_at son mutables en conversations';
  end if;

  return new;
end;
$$;

comment on function app.protect_conversation_columns() is
  'Congela participantes/listing/tenant de una conversación: solo el estado cambia post-creación.';

create trigger conversations_protect_columns
before update on public.conversations
for each row execute function app.protect_conversation_columns();

alter table public.conversations enable row level security;
alter table public.conversations force row level security;

-- Participantes only. Sin rama de staff/global: los chats no se husmean.
create policy conversations_select on public.conversations
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    created_by = (select auth.uid())
    or counterpart_id = (select auth.uid())
  )
);

-- Crear: yo como solicitante, en mi tenant, nace pending, contraparte de MI
-- tenant y (si hay listing) listing del MISMO tenant. El flujo canónico es la
-- RPC request_contact(); esta policy cubre conversaciones directas.
create policy conversations_insert on public.conversations
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and status = 'pending'
  and accepted_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = conversations.counterpart_id
      and p.tenant_id = conversations.tenant_id
  )
  and (
    listing_id is null
    or exists (
      select 1 from public.listings l
      where l.id = conversations.listing_id
        and l.tenant_id = conversations.tenant_id
    )
  )
);

-- Actualizar estado: SOLO la contraparte (aceptar/bloquear). El creador no
-- puede auto-aceptar su propia solicitud.
create policy conversations_update on public.conversations
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and counterpart_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and counterpart_id = (select auth.uid())
);

-- Cualquiera de los dos participantes puede borrar la conversación (cascade
-- borra los mensajes: menos datos retenidos = mejor, §5.4).
create policy conversations_delete on public.conversations
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    created_by = (select auth.uid())
    or counterpart_id = (select auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants(id),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id),
  body            text not null,
  cipher_envelope jsonb,
  expires_at      timestamptz not null default now() + interval '90 days',
  created_at      timestamptz not null default now()
);

comment on table public.messages is
  'Mensajes privados con TTL 90 días (§5.4): pg_cron purga diariamente los vencidos (0013_cron_ttl). Inmutables (sin UPDATE); borra solo el emisor. RLS: exclusivamente participantes de la conversación.';
comment on column public.messages.body is
  'Texto plano TRANSITORIO (TTL 90d). Gate E2E pendiente (§5.4): cuando se implemente cifrado de extremo a extremo, body pasa a null y el contenido viaja en cipher_envelope; la plataforma no podrá descifrar ni entregar contenido.';
comment on column public.messages.cipher_envelope is
  'RESERVADA para E2E futuro: {alg, ciphertext, nonce, key_refs}. Hoy siempre null. No usar para otra cosa.';
comment on column public.messages.expires_at is
  'TTL duro NO NEGOCIABLE: app.messages_force_ttl() lo pisa a now()+90 días en cada INSERT (el valor del cliente se ignora — sin trigger, un INSERT vía PostgREST con expires_at lejano evadiría la purga y mantendría vivos mensaje y conversación para siempre). La policy de SELECT ya oculta vencidos aunque el cron aún no haya purgado.';

create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_expires_idx on public.messages (expires_at);

-- Guarda: el TTL de 90 días no es negociable por el cliente. Sin esto,
-- expires_at es solo un DEFAULT y cualquier INSERT por API con un expires_at
-- lejano crearía un mensaje imborrable (evade purge-expired-messages y
-- mantiene la conversación viva frente a purge-stale-conversations),
-- derrotando el contrato §5.4. Mismo patrón que app.protect_conversation_columns().
create or replace function app.messages_force_ttl()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  new.expires_at := now() + interval '90 days';
  return new;
end;
$$;

comment on function app.messages_force_ttl() is
  'BEFORE INSERT en messages: fuerza expires_at = now()+90d ignorando el valor del cliente (TTL §5.4 no evadible). service_role exento (tooling/migraciones).';

create trigger messages_force_ttl
before insert on public.messages
for each row execute function app.messages_force_ttl();

alter table public.messages enable row level security;
alter table public.messages force row level security;

-- Leer: participante de la conversación (mismo tenant), y solo no-vencidos.
create policy messages_select on public.messages
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and expires_at > now()
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and c.tenant_id = messages.tenant_id
      and (
        c.created_by = (select auth.uid())
        or c.counterpart_id = (select auth.uid())
      )
  )
);

-- Enviar: soy el sender, participante, y la conversación está accepted — o
-- pending si soy quien la inició (mensaje de presentación estilo "solicitud").
-- En blocked no escribe nadie.
create policy messages_insert on public.messages
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and c.tenant_id = messages.tenant_id
      and (
        (c.status = 'accepted' and (c.created_by = (select auth.uid()) or c.counterpart_id = (select auth.uid())))
        or (c.status = 'pending' and c.created_by = (select auth.uid()))
      )
  )
);

-- Sin edición de mensajes: inmutables por contrato.
create policy messages_update on public.messages
for update to authenticated
using (false)
with check (false);

-- Borra solo el emisor sus propios mensajes.
create policy messages_delete on public.messages
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and sender_id = (select auth.uid())
);
