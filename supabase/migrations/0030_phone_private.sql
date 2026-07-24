-- =============================================================================
-- 0030_phone_private.sql — Comunidad Latina
-- Teléfono + verificación (Twilio Verify) — PRIVADO POR DISEÑO.
--
-- REVERSIÓN CONTROLADA del anti-honeypot de 0003 ("SIN columna de teléfono").
-- El modelo de producto del cliente lo exige (una cuenta por número, requisito
-- de creador). Se preserva la minimización con mitigaciones:
--   1. El número NUNCA en profiles (público) ni en vistas/SEO — solo el boolean.
--   2. Storage en tabla solo-dueño/service; NI staff NI global lo leen por RLS.
--   3. OTP NUNCA persistido (Twilio es dueño del código, TTL, rate-limit).
--   4. Borrado de cuenta cascadea el teléfono (on delete cascade).
--   5. Sin cuarentena del número tras baja (decisión OQ#8): se va con la cuenta.
--
-- ⚠️ MODO TEST hasta firma legal (decisión Manuel OQ#2): se construye TODO el
-- flujo pero NO se recolecta ningún teléfono real de usuario hasta venia legal
-- + credenciales de Twilio en Vercel. En demo usa números de prueba; degrada
-- con elegancia (flag isTwilioConfigured en services.ts). user_phones es un
-- mapa teléfono↔identidad subpoenable: NECESITA firma legal antes de datos
-- reales (mismo gate que el pentest de Hito 1).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles: las ÚNICAS partes públicas (insignias), escritas solo por service_role.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone_verified boolean not null default false,
  add column if not exists email_verified boolean not null default false;

comment on column public.profiles.phone_verified is
  'Insignia PÚBLICA de teléfono verificado (OTP Twilio). El número NUNCA vive acá — solo el boolean. Escribe solo service_role (guarda protect_profile_columns), como identity_verified.';
comment on column public.profiles.email_verified is
  'Insignia de correo verificado, sincronizada de auth.users.email_confirmed_at por el servidor. Escribe solo service_role (guarda).';

-- Guarda ampliada: phone_verified/email_verified se suman a las columnas
-- solo-service_role (junto a role/identity_verified/tenant_id de 0003). El eje
-- account_status/suspended_until (staff, 0021) queda igual.
create or replace function app.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sin claims (postgres directo, pg_cron, seeds) o service_role: permitido.
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.identity_verified is distinct from old.identity_verified
     or new.identity_verified_at is distinct from old.identity_verified_at
     or new.phone_verified is distinct from old.phone_verified
     or new.email_verified is distinct from old.email_verified
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'PROTECTED_COLUMNS: role/identity_verified/phone_verified/email_verified/tenant_id de profiles solo se modifican via service_role';
  end if;

  if (new.account_status is distinct from old.account_status
      or new.suspended_until is distinct from old.suspended_until)
     and not app.is_staff() then
    raise exception 'PROTECTED_COLUMNS: account_status/suspended_until solo se modifican via moderación';
  end if;

  return new;
end;
$$;

comment on function app.protect_profile_columns() is
  'Impide que un usuario autenticado se auto-asigne rol, flags de verificación (identity/phone/email) o cambio de tenant por UPDATE directo. Desde 0021 también guarda account_status/suspended_until (staff/service). Desde 0030 suma phone_verified/email_verified (service).';

-- ---------------------------------------------------------------------------
-- user_phones — tabla PRIVADA (self-read / service-write). PK = profile_id
-- (una fila por cuenta). El unique global sobre phone_e164 = una cuenta por número.
-- ---------------------------------------------------------------------------
create table public.user_phones (
  profile_id           uuid primary key references public.profiles(id) on delete cascade,
  tenant_id            uuid not null references public.tenants(id),
  phone_e164           text not null,
  phone_verified       boolean not null default false,
  phone_verified_at    timestamptz,
  verification_channel text not null default 'sms',
  birthdate            date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint user_phones_e164_format check (phone_e164 ~ '^\+[1-9]\d{7,14}$')
);

comment on table public.user_phones is
  'Teléfono + DOB del usuario — PRIVADO (§4). RLS SOLO-DUEÑO: ni anon, ni otros miembros, ni staff, ni global lo leen (minimización > conveniencia, igual que profiles_private). Escribe SOLO service_role (el OTP prende una insignia de confianza → va por admin client, como signup/webhooks). Riesgo residual aceptado: mapa teléfono↔identidad subpoenable → necesita firma legal antes de datos reales (OQ#2).';
comment on column public.user_phones.phone_e164 is
  'Número en E.164, PRIVADO. NUNCA en profiles ni en vistas públicas/SEO. Unique global (user_phones_e164_uniq) = una cuenta por número (§2). La sonda de existencia solo ocurre server-side (signup mediado, número no seleccionable por RLS).';
comment on column public.user_phones.birthdate is
  'Fecha de nacimiento mínima (§2), PRIVADA. Habilita el gate 18+ del creador (§11) sin exponer la fecha (§3: nunca público la DOB completa).';

-- Una cuenta por número — GLOBAL (no por-tenant; single-community lo hace
-- irrelevante hoy, pero la regla es global). El número no es seleccionable
-- (RLS solo-dueño), así que la sonda de existencia queda server-side.
create unique index user_phones_e164_uniq on public.user_phones (phone_e164);

create trigger user_phones_set_updated_at
before update on public.user_phones
for each row execute function extensions.moddatetime(updated_at);

alter table public.user_phones enable row level security;
alter table public.user_phones force row level security;

-- SELECT: SOLO el dueño, en su tenant. Sin rama de staff/global (§4).
create policy user_phones_select on public.user_phones
for select to authenticated
using (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

-- INSERT/UPDATE/DELETE: solo service_role (admin client). El cliente no se
-- auto-verifica; el cambio de teléfono es flujo server con 2ª verificación (§2).
-- El borrado ocurre por cascade al eliminar la cuenta, no por API directa.
create policy user_phones_insert on public.user_phones
for insert to authenticated
with check (false);

create policy user_phones_update on public.user_phones
for update to authenticated
using (false)
with check (false);

create policy user_phones_delete on public.user_phones
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- NOTA Twilio Verify v2 (flujo app-layer, Fase 2 — NO en esta migración).
-- Confirmado contra la doc actual de twilio-node (verify/v2):
--   startPhoneVerification(phone):  admin client. Zod valida E.164. Pre-chequea
--     "una cuenta por número". Si isTwilioConfigured:
--       twilio.verify.v2.services(SID).verifications.create({ to, channel:'sms' })
--       → status:'pending'. Upsert user_phones (verified=false). Si NO configurado
--       (demo): guarda el teléfono en estado demo, NO revela ningún código.
--   checkPhoneVerification(phone, code):  admin client.
--       twilio.verify.v2.services(SID).verificationChecks.create({ to, code })
--       → si status==='approved': user_phones.phone_verified=true + _at +
--       profiles.phone_verified=true (service) → dispara recalc_user_score (0037).
-- Twilio es dueño del código: TTL, rate-limit y máximo de intentos → CL NO
-- almacena el OTP ni un contador de intentos.
-- Flag nuevo en services.ts: isTwilioConfigured =
--   Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID).
-- ---------------------------------------------------------------------------
