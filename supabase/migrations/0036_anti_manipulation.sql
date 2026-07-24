-- =============================================================================
-- 0036_anti_manipulation.sql — Comunidad Latina
-- Anti-manipulación (§34): CAPTURAR señales, no sobre-construir. Se guarda lo
-- mínimo Connect-ready para detectar clusters DESPUÉS, sin construir el motor de
-- detección ahora.
--   * security_signals — append-only, service-write, STAFF-READ (nunca público),
--     TTL 90 días. ip_hash/device_hash HASHEADOS (HMAC con secreto de servidor),
--     NUNCA IP cruda (anti-honeypot §5.4).
-- ⚠️ Aun hasheada es una tabla de tracking conductual → necesita venia legal
-- (OQ#2, mismo gate que el pentest de Hito 1) y es staff-only.
-- =============================================================================

-- HMAC de una señal con secreto de servidor. El secreto se pasa por GUC
-- app.signal_hmac_key (seteable en la sesión/config de Supabase); sin secreto,
-- cae a una clave de dev (NUNCA usar en prod para datos reales). Devuelve null
-- para entradas vacías.
create or replace function app.hash_signal(p_value text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    else encode(
      extensions.hmac(
        p_value,
        coalesce(nullif(current_setting('app.signal_hmac_key', true), ''), 'cl-dev-signal-key-rotate-in-prod'),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

comment on function app.hash_signal(text) is
  'HMAC-SHA256 de una señal (IP/device) con secreto de servidor (GUC app.signal_hmac_key). NUNCA se guarda el valor crudo (§5.4). Sin GUC cae a una clave de dev — setear un secreto real antes de recolectar señales reales.';

create table public.security_signals (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants(id),
  profile_id  uuid references public.profiles(id) on delete set null,
  event_type  text not null check (event_type in ('signup', 'phone_verify', 'review', 'application', 'login')),
  ip_hash     text,
  device_hash text,
  created_at  timestamptz not null default now()
);

comment on table public.security_signals is
  'Señales anti-manipulación (§34), append-only, service-write, STAFF-READ (nunca público, ni el dueño). ip_hash/device_hash HASHEADOS (app.hash_signal), nunca IP cruda (§5.4). Permite detectar clusters mismo-dispositivo/misma-IP DESPUÉS, sin motor de detección ahora. TTL 90 días. Necesita venia legal (OQ#2).';
comment on column public.security_signals.profile_id is
  'on delete set null: la señal (hasheada) sobrevive al borrado de cuenta dentro del TTL de 90d, para detección de recreación-tras-baneo. El hash no reidentifica sin el secreto.';

create index security_signals_event_idx on public.security_signals (tenant_id, event_type, created_at desc);
create index security_signals_device_idx on public.security_signals (device_hash) where device_hash is not null;
create index security_signals_ip_idx on public.security_signals (ip_hash) where ip_hash is not null;

alter table public.security_signals enable row level security;
alter table public.security_signals force row level security;

-- SELECT: SOLO staff (nunca público, nunca el dueño — es tracking conductual).
create policy security_signals_select on public.security_signals
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_staff())
  )
  or (select app.is_global_admin())
);

create policy security_signals_insert on public.security_signals
for insert to authenticated
with check (false);

create policy security_signals_update on public.security_signals
for update to authenticated
using (false)
with check (false);

create policy security_signals_delete on public.security_signals
for delete to authenticated
using (false);

-- TTL 90 días (05:10 UTC diario). Idempotente (patrón 0013).
do $$
begin
  perform cron.unschedule('purge-old-security-signals');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-old-security-signals',
  '10 5 * * *',
  $$delete from public.security_signals where created_at < now() - interval '90 days'$$
);
