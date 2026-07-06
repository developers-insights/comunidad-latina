-- =============================================================================
-- 0011_notifications_audit.sql — Comunidad Latina
-- notifications (TTL 60 días) + audit_log (TTL 365 días).
-- §5.4: TTLs cortos = el dato que se borra rápido no es subpoenable después.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  href       text,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days'
);

comment on table public.notifications is
  'Notificaciones in-app del usuario. TTL 60 días (purga pg_cron en 0013). Las genera el sistema (service_role); el dueño las lee, las marca leídas y las borra.';
comment on column public.notifications.expires_at is
  'TTL: default now()+60 días. Vencidas se purgan a diario; la policy de SELECT ya las oculta.';

create index notifications_inbox_idx on public.notifications (tenant_id, profile_id, created_at desc)
  where read_at is null;
create index notifications_profile_idx on public.notifications (tenant_id, profile_id, created_at desc);
create index notifications_expires_idx on public.notifications (expires_at);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Owner only. Ni staff ni global: tu bandeja es tuya.
create policy notifications_select on public.notifications
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and expires_at > now()
);

-- Las emite el sistema (service_role): nadie se auto-notifica por API.
create policy notifications_insert on public.notifications
for insert to authenticated
with check (false);

-- Marcar leída: el dueño, sin poder mover la fila de tenant/dueño.
create policy notifications_update on public.notifications
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

create policy notifications_delete on public.notifications
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- ---------------------------------------------------------------------------
-- audit_log — acciones administrativas/sistema (append-only, TTL 365d)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid references public.tenants(id),
  actor_id     uuid,
  action       text not null,
  subject_kind text,
  subject_id   uuid,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.audit_log is
  'Auditoría de acciones admin/sistema. INSERT solo via service_role o funciones security definer (nunca API directa). TTL 365 días via pg_cron (§5.4: log viejo = riesgo, no activo). tenant_id null = acción global de plataforma.';
comment on column public.audit_log.meta is
  'Contexto de la acción. PROHIBIDO guardar IPs, user-agents crudos o contenido de mensajes (§5.4: no construimos logs subpoenables).';

create index audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);
create index audit_log_created_idx on public.audit_log (created_at);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- global_admin ve todo; domain_admin SOLO lo de su tenant (nunca filas globales).
create policy audit_log_select on public.audit_log
for select to authenticated
using (
  (select app.is_global_admin())
  or (
    tenant_id is not null
    and tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- Append-only via service/definer: sin escritura por API con JWT de usuario.
create policy audit_log_insert on public.audit_log
for insert to authenticated
with check (false);

create policy audit_log_update on public.audit_log
for update to authenticated
using (false)
with check (false);

create policy audit_log_delete on public.audit_log
for delete to authenticated
using (false);
