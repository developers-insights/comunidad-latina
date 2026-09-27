begin;

-- =============================================================================
-- 0165 — El contrato de colaboración se firma, y lo firmado no se toca.
--
-- Hasta acá "aceptar la propuesta" era todo el contrato: no había texto, ni
-- firma, ni registro de quién aceptó qué. Ahora:
--   * la propuesta suma revisiones incluidas, derechos de uso y un mensaje;
--   * al aceptarla se congela el TEXTO del contrato y su huella (sha256);
--   * cada parte firma (nombre legal, firma dibujada, IP, navegador, huella);
--   * con las dos firmas el contrato pasa a 'signed' y recién ahí se paga;
--   * todo movimiento queda en un registro append-only (gig_contract_events).
-- =============================================================================

alter table public.gig_contracts
  add column if not exists revisions_included int not null default 1,
  add column if not exists usage_rights text not null default 'Redes sociales del negocio · 90 días',
  add column if not exists proposal_message text,
  add column if not exists terms_version int not null default 1,
  add column if not exists contract_text text,
  add column if not exists terms_hash text,
  add column if not exists template_version text,
  add column if not exists signed_at timestamptz;

alter table public.gig_contracts
  drop constraint if exists gig_contracts_revisions_included_check,
  add constraint gig_contracts_revisions_included_check check (revisions_included between 0 and 5),
  drop constraint if exists gig_contracts_usage_rights_check,
  add constraint gig_contracts_usage_rights_check check (char_length(usage_rights) between 3 and 120),
  drop constraint if exists gig_contracts_proposal_message_check,
  add constraint gig_contracts_proposal_message_check check (proposal_message is null or char_length(proposal_message) <= 600),
  drop constraint if exists gig_contracts_terms_version_check,
  add constraint gig_contracts_terms_version_check check (terms_version >= 1),
  drop constraint if exists gig_contracts_terms_hash_check,
  add constraint gig_contracts_terms_hash_check check (terms_hash is null or terms_hash ~ '^[0-9a-f]{64}$');

alter table public.gig_contracts drop constraint if exists gig_contracts_status_check;
alter table public.gig_contracts
  add constraint gig_contracts_status_check
  check (status in (
    'proposed', 'accepted', 'signed', 'funded', 'delivered',
    'changes_requested', 'final_delivery', 'approved',
    'released', 'closed', 'canceled', 'disputed', 'rejected'
  ));

comment on column public.gig_contracts.contract_text is
  'Texto íntegro del contrato congelado al aceptar la propuesta. Es lo que firman las partes; la huella está en terms_hash.';
comment on column public.gig_contracts.terms_hash is
  'sha256 (hex) de contract_text. Una firma cuenta sólo si su terms_hash coincide con éste.';
comment on column public.gig_contracts.signed_at is
  'Cuándo quedó la segunda firma. Lo escribe public.firmar_contrato_de_colaboracion.';

-- Las condiciones sólo se editan en 'proposed'. El texto y la huella además
-- pueden escribirse al salir de 'proposed' (aceptación), al volver a él
-- (pedido de cambios) o por primera vez en un contrato viejo sin texto.
create or replace function app.gig_contract_terminos_congelados()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'proposed' and (
       new.title is distinct from old.title
    or new.scope is distinct from old.scope
    or new.delivery_days is distinct from old.delivery_days
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
    or new.revisions_included is distinct from old.revisions_included
    or new.usage_rights is distinct from old.usage_rights
    or new.proposal_message is distinct from old.proposal_message
    or new.client_id is distinct from old.client_id
    or new.creator_id is distinct from old.creator_id
    or new.tenant_id is distinct from old.tenant_id
  ) then
    raise exception 'Las condiciones del contrato % ya no se pueden modificar (estado %).', old.code, old.status
      using errcode = 'check_violation';
  end if;

  if (new.contract_text is distinct from old.contract_text
      or new.terms_hash is distinct from old.terms_hash
      or new.template_version is distinct from old.template_version
      or new.terms_version is distinct from old.terms_version)
     and not (old.status = 'proposed' or new.status = 'proposed' or old.terms_hash is null)
  then
    raise exception 'El texto del contrato % está firmado o en firma y no se puede reemplazar.', old.code
      using errcode = 'check_violation';
  end if;

  if old.signed_at is not null and new.signed_at is distinct from old.signed_at then
    raise exception 'La fecha de firma del contrato % no se puede cambiar.', old.code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function app.gig_contract_terminos_congelados() from public, anon, authenticated;

drop trigger if exists gig_contracts_terminos_congelados on public.gig_contracts;
create trigger gig_contracts_terminos_congelados
before update on public.gig_contracts
for each row execute function app.gig_contract_terminos_congelados();

-- -----------------------------------------------------------------------------
-- Firmas — inmutables, incluso para service_role.
-- -----------------------------------------------------------------------------
create table if not exists public.gig_contract_signatures (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null references public.tenants(id),
  contract_id      uuid not null references public.gig_contracts(id) on delete restrict,
  signer_id        uuid not null references public.profiles(id),
  signer_role      text not null check (signer_role in ('client', 'creator')),
  legal_name       text not null check (char_length(legal_name) between 5 and 120),
  signature_png    text not null check (
                     signature_png like 'data:image/png;base64,%'
                     and char_length(signature_png) between 300 and 200000
                   ),
  terms_hash       text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  terms_version    int not null,
  template_version text not null,
  ip               text,
  user_agent       text check (user_agent is null or char_length(user_agent) <= 512),
  signed_at        timestamptz not null default now(),
  constraint gig_contract_signatures_una_por_texto unique (contract_id, signer_id, terms_hash)
);

comment on table public.gig_contract_signatures is
  'Firma electrónica de cada parte sobre un texto de contrato (terms_hash). Inmutable: no se actualiza ni se borra. La escribe sólo public.firmar_contrato_de_colaboracion (service_role).';

create index if not exists gig_contract_signatures_contract_idx
  on public.gig_contract_signatures (tenant_id, contract_id, signed_at);

alter table public.gig_contract_signatures enable row level security;
alter table public.gig_contract_signatures force row level security;

drop policy if exists gig_contract_signatures_select on public.gig_contract_signatures;
create policy gig_contract_signatures_select on public.gig_contract_signatures
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.is_staff())
      or exists (
        select 1 from public.gig_contracts c
        where c.id = gig_contract_signatures.contract_id
          and c.tenant_id = gig_contract_signatures.tenant_id
          and (c.client_id = (select auth.uid()) or c.creator_id = (select auth.uid()))
      )
    )
  )
  or (select app.is_global_admin())
);

revoke all on table public.gig_contract_signatures from anon, authenticated;
grant select on table public.gig_contract_signatures to authenticated;
grant all on table public.gig_contract_signatures to service_role;

-- -----------------------------------------------------------------------------
-- Registro de la colaboración — append-only.
-- -----------------------------------------------------------------------------
create table if not exists public.gig_contract_events (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants(id),
  contract_id uuid not null references public.gig_contracts(id) on delete restrict,
  actor_id    uuid references public.profiles(id),
  kind        text not null check (kind in (
                'proposed', 'terms_edited', 'terms_changes_requested', 'accepted', 'rejected',
                'signed', 'fully_signed', 'checkout_opened', 'funded', 'payment_orphan_refunded',
                'milestone_added', 'milestone_done', 'milestone_undone', 'delivered',
                'revision_requested', 'approved', 'auto_approved', 'payout_blocked',
                'payout_failed', 'released', 'disputed', 'chargeback', 'canceled', 'refunded',
                'template_reset'
              )),
  note        text check (note is null or char_length(note) <= 2000),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.gig_contract_events is
  'Historial append-only de una colaboración (quién hizo qué y cuándo). actor_id null = el sistema (webhook de Stripe, liberación automática). Lo escribe sólo el server con service_role.';

create index if not exists gig_contract_events_contract_idx
  on public.gig_contract_events (tenant_id, contract_id, created_at);

alter table public.gig_contract_events enable row level security;
alter table public.gig_contract_events force row level security;

drop policy if exists gig_contract_events_select on public.gig_contract_events;
create policy gig_contract_events_select on public.gig_contract_events
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.is_staff())
      or exists (
        select 1 from public.gig_contracts c
        where c.id = gig_contract_events.contract_id
          and c.tenant_id = gig_contract_events.tenant_id
          and (c.client_id = (select auth.uid()) or c.creator_id = (select auth.uid()))
      )
    )
  )
  or (select app.is_global_admin())
);

revoke all on table public.gig_contract_events from anon, authenticated;
grant select on table public.gig_contract_events to authenticated;
grant all on table public.gig_contract_events to service_role;

create or replace function app.registro_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La tabla % es un registro: no se modifica ni se borra.', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function app.registro_inmutable() from public, anon, authenticated;

drop trigger if exists gig_contract_signatures_inmutable on public.gig_contract_signatures;
create trigger gig_contract_signatures_inmutable
before update or delete on public.gig_contract_signatures
for each row execute function app.registro_inmutable();

drop trigger if exists gig_contract_events_inmutable on public.gig_contract_events;
create trigger gig_contract_events_inmutable
before update or delete on public.gig_contract_events
for each row execute function app.registro_inmutable();

-- -----------------------------------------------------------------------------
-- Firmar. Toma el lock de la fila del contrato para que dos firmas simultáneas
-- no queden las dos viendo "falta la otra" y nadie pase el contrato a 'signed'.
-- IP y navegador los pasa el server desde los headers del request: por eso la
-- función NO es ejecutable por authenticated.
-- -----------------------------------------------------------------------------
create or replace function public.firmar_contrato_de_colaboracion(
  p_contract_id   uuid,
  p_signer_id     uuid,
  p_legal_name    text,
  p_signature_png text,
  p_terms_hash    text,
  p_ip            text,
  p_user_agent    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          public.gig_contracts;
  v_role     text;
  v_inserted int;
  v_roles    int;
begin
  select * into c from public.gig_contracts where id = p_contract_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_role := case
    when p_signer_id = c.client_id then 'client'
    when p_signer_id = c.creator_id then 'creator'
  end;
  if v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'not_party');
  end if;

  if c.status = 'signed' then
    return jsonb_build_object('ok', true, 'status', 'signed', 'both', true, 'already', true);
  end if;
  if c.status <> 'accepted' then
    return jsonb_build_object('ok', false, 'reason', 'status');
  end if;
  if c.terms_hash is null or c.terms_hash <> p_terms_hash then
    return jsonb_build_object('ok', false, 'reason', 'stale_terms');
  end if;

  insert into public.gig_contract_signatures (
    tenant_id, contract_id, signer_id, signer_role, legal_name, signature_png,
    terms_hash, terms_version, template_version, ip, user_agent
  ) values (
    c.tenant_id, c.id, p_signer_id, v_role, p_legal_name, p_signature_png,
    c.terms_hash, c.terms_version, coalesce(c.template_version, 'desconocida'),
    left(p_ip, 64), left(p_user_agent, 512)
  )
  on conflict (contract_id, signer_id, terms_hash) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    insert into public.gig_contract_events (tenant_id, contract_id, actor_id, kind, meta)
    values (c.tenant_id, c.id, p_signer_id, 'signed',
            jsonb_build_object('role', v_role, 'terms_version', c.terms_version));
  end if;

  select count(distinct s.signer_role) into v_roles
    from public.gig_contract_signatures s
   where s.contract_id = c.id and s.terms_hash = c.terms_hash;

  if v_roles = 2 then
    update public.gig_contracts
       set status = 'signed', signed_at = now()
     where id = c.id and status = 'accepted';
    insert into public.gig_contract_events (tenant_id, contract_id, actor_id, kind, meta)
    values (c.tenant_id, c.id, null, 'fully_signed', jsonb_build_object('terms_version', c.terms_version));
    return jsonb_build_object('ok', true, 'status', 'signed', 'both', true, 'already', v_inserted = 0);
  end if;

  return jsonb_build_object('ok', true, 'status', 'accepted', 'both', false, 'already', v_inserted = 0);
end;
$$;

comment on function public.firmar_contrato_de_colaboracion(uuid, uuid, text, text, text, text, text) is
  'Registra la firma de una parte sobre el texto vigente y, con las dos firmas, pasa el contrato a signed. Sólo service_role: IP y navegador vienen del server.';

revoke all on function public.firmar_contrato_de_colaboracion(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.firmar_contrato_de_colaboracion(uuid, uuid, text, text, text, text, text)
  to service_role;

-- Los contratos 'accepted' previos no tienen texto que firmar: vuelven a
-- propuesta para que el creador la acepte y se genere el contrato.
insert into public.gig_contract_events (tenant_id, contract_id, actor_id, kind, note)
select c.tenant_id, c.id, null, 'template_reset',
       'El contrato vuelve a propuesta para generarse con firma de ambas partes.'
  from public.gig_contracts c
 where c.status = 'accepted' and c.terms_hash is null;

update public.gig_contracts
   set status = 'proposed', accepted_at = null
 where status = 'accepted' and terms_hash is null;

commit;
