-- =============================================================================
-- 0066_telefono_por_tenant_y_codigos_sms.sql — Comunidad Latina
--
-- SÓLO LA CAPA DE DATOS. No se integra ningún proveedor de SMS: eso queda
-- pendiente de decisión comercial (y del gate legal de 0030, que sigue vigente:
-- user_phones es un mapa teléfono↔identidad subpoenable y NO se recolectan
-- números reales hasta que haya firma).
--
-- -----------------------------------------------------------------------------
-- 1. "Una cuenta por número DENTRO DEL DOMINIO"
-- -----------------------------------------------------------------------------
-- 0030 puso `user_phones_e164_uniq` UNIQUE sobre `phone_e164` a secas, o sea
-- unicidad GLOBAL, con esta nota: "no por-tenant; single-community lo hace
-- irrelevante hoy". Ya no es irrelevante — el pliego dice explícitamente
-- "dentro del dominio", y esta plataforma es white-label multi-tenant: la misma
-- persona puede querer estar en dominicanos.com y en comunidadlatina.com. Con
-- el índice global, la segunda cuenta es imposible y el producto está roto.
--
-- Se cambia a UNIQUE (tenant_id, phone_e164). Es lo ÚNICO destructivo de toda
-- la tanda y vale aclararlo: se borra un ÍNDICE, no datos. La tabla tiene 0
-- filas hoy, así que no hay ni siquiera un caso límite que resolver, y el
-- índice viejo se puede recrear con una línea si la decisión se revierte.
--
-- -----------------------------------------------------------------------------
-- 2. Códigos de verificación
-- -----------------------------------------------------------------------------
-- 0030 decidió NO persistir el OTP porque Twilio Verify era dueño del código,
-- del TTL y del rate limit. Al quedar el proveedor sin decidir, esa garantía no
-- existe: si el día de mañana se usa un proveedor de SMS "pelado" (que sólo
-- manda texto), alguien tiene que ser dueño del ciclo de vida del código. Esta
-- tabla lo es, con las tres defensas que el pliego pide: expiración, tope de
-- intentos y rate limit.
--
-- EL CÓDIGO NUNCA SE GUARDA EN CLARO. La columna es `code_hash`: el servidor
-- calcula sha256(código + pepper) y guarda eso. Un volcado de esta tabla no le
-- sirve a nadie para verificar un teléfono ajeno. Y la tabla no es legible por
-- NADIE vía API: las cuatro policies están en false, incluida la de SELECT.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Unicidad por tenant
-- ---------------------------------------------------------------------------
create unique index if not exists user_phones_tenant_e164_uniq
  on public.user_phones (tenant_id, phone_e164);

drop index if exists public.user_phones_e164_uniq;

comment on column public.user_phones.phone_e164 is
  'Número en E.164, PRIVADO. NUNCA en profiles ni en vistas públicas/SEO. Desde 0066 la unicidad es POR TENANT (user_phones_tenant_e164_uniq), no global: el pliego pide "una cuenta por número telefónico dentro del dominio", y en una plataforma white-label la misma persona puede pertenecer legítimamente a dos comunidades. La sonda de existencia sigue siendo imposible desde el cliente (RLS solo-dueño).';

-- ---------------------------------------------------------------------------
-- 2. Códigos de verificación
-- ---------------------------------------------------------------------------
create table if not exists public.phone_verification_codes (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  profile_id   uuid references public.profiles(id) on delete cascade,
  phone_e164   text not null,
  code_hash    text not null,
  channel      text not null default 'sms' check (channel in ('sms','whatsapp','voz')),
  expires_at   timestamptz not null default (now() + interval '10 minutes'),
  attempts     int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 10),
  consumed_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint phone_verification_codes_e164_format
    check (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  constraint phone_verification_codes_hash_format
    check (code_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.phone_verification_codes is
  'Códigos de verificación por SMS: expiración, tope de intentos y rate limit. NO HAY PROVEEDOR INTEGRADO — esta migración deja sólo la capa de datos, la elección del proveedor es una decisión comercial pendiente. Las 4 policies están en FALSE, incluida la de SELECT: nadie lee esta tabla por API, ni siquiera su dueño. Sólo la tocan las funciones app.phone_verification_* y service_role.';
comment on column public.phone_verification_codes.code_hash is
  'sha256(código + pepper del servidor) en hexadecimal. EL CÓDIGO EN CLARO NUNCA SE GUARDA: un volcado de esta tabla no permite verificar el teléfono de nadie. El pepper vive en variable de entorno, fuera de la base, para que ni siquiera un backup completo alcance.';
comment on column public.phone_verification_codes.profile_id is
  'A quién pertenece el intento. NULLABLE a propósito: permite verificar un teléfono ANTES de crear la cuenta (el pliego pide teléfono obligatorio en el registro, y ese orden es una decisión de la capa de app, no de la base).';
comment on column public.phone_verification_codes.attempts is
  'Intentos fallidos contra ESTE código. Al llegar a max_attempts el código queda muerto aunque no haya expirado — si no, el tope de 6 dígitos se rompe por fuerza bruta en minutos. Lo incrementa app.phone_verification_consume() dentro de la misma transacción que valida, para que dos intentos en paralelo no se pisen el contador.';
comment on column public.phone_verification_codes.expires_at is
  'Vencimiento (10 minutos por default). Las filas vencidas las borra el cron purge-expired-phone-codes: un código usado o vencido es sólo un hash inútil atado a un teléfono, y un teléfono es dato personal (§5.4).';

-- El camino caliente: "¿hay un código vivo para este teléfono?" y el rate limit.
create index if not exists phone_verification_codes_lookup_idx
  on public.phone_verification_codes (tenant_id, phone_e164, created_at desc);
create index if not exists phone_verification_codes_vivos_idx
  on public.phone_verification_codes (tenant_id, phone_e164)
  where consumed_at is null;
create index if not exists phone_verification_codes_expiry_idx
  on public.phone_verification_codes (expires_at);
create index if not exists phone_verification_codes_profile_idx
  on public.phone_verification_codes (profile_id);

alter table public.phone_verification_codes enable row level security;
alter table public.phone_verification_codes force row level security;

-- Las CUATRO en false, SELECT incluida. Una tabla de códigos que alguien pueda
-- leer no es una tabla de códigos: es una lista de contraseñas de un solo uso.
create policy phone_verification_codes_select on public.phone_verification_codes
for select to authenticated
using (false);

create policy phone_verification_codes_insert on public.phone_verification_codes
for insert to authenticated
with check (false);

create policy phone_verification_codes_update on public.phone_verification_codes
for update to authenticated
using (false)
with check (false);

create policy phone_verification_codes_delete on public.phone_verification_codes
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 3. Rate limit
-- ---------------------------------------------------------------------------
create or replace function app.phone_verification_can_send(
  p_tenant uuid,
  p_phone  text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hora int;
  v_dia  int;
begin
  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
    into v_hora, v_dia
    from public.phone_verification_codes
   where tenant_id = p_tenant
     and phone_e164 = p_phone;

  if v_hora >= 3 then return 'rate_limited_hora'; end if;
  if v_dia  >= 10 then return 'rate_limited_dia'; end if;
  return 'ok';
end;
$$;

comment on function app.phone_verification_can_send(uuid, text) is
  'Rate limit de envío por (tenant, teléfono): 3 por hora y 10 por día. Cuenta filas de phone_verification_codes, así que el límite sigue valiendo aunque el proceso se reinicie o haya varias instancias — un contador en memoria de la app no daría esa garantía. Devuelve ok | rate_limited_hora | rate_limited_dia. Los números son deliberadamente austeros: cada SMS cuesta plata y un teléfono ajeno bombardeado a códigos es acoso.';

revoke execute on function app.phone_verification_can_send(uuid, text) from public, anon, authenticated;
grant execute on function app.phone_verification_can_send(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Canje del código
-- ---------------------------------------------------------------------------
-- En una sola función y no en la app porque acá hay una carrera real: leer el
-- código, compararlo y sumar el intento tienen que pasar juntos. Dos requests
-- simultáneos contra el mismo código, con la lógica en la app, gastan un solo
-- intento entre los dos — que es exactamente el agujero por donde se fuerza
-- bruta un OTP de 6 dígitos.
create or replace function app.phone_verification_consume(
  p_tenant    uuid,
  p_phone     text,
  p_code_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  -- FOR UPDATE: el candidato queda bloqueado hasta el commit.
  select * into v_row
    from public.phone_verification_codes
   where tenant_id = p_tenant
     and phone_e164 = p_phone
     and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then
    return 'sin_codigo';
  end if;

  if v_row.expires_at <= now() then
    return 'expirado';
  end if;

  if v_row.attempts >= v_row.max_attempts then
    return 'agotado';
  end if;

  if v_row.code_hash <> p_code_hash then
    update public.phone_verification_codes
       set attempts = attempts + 1
     where id = v_row.id;
    return 'invalido';
  end if;

  update public.phone_verification_codes
     set consumed_at = now()
   where id = v_row.id;

  -- Los códigos anteriores del mismo teléfono mueren con el canje: si no, un
  -- código viejo todavía vivo seguiría siendo utilizable después de haber
  -- verificado con otro.
  update public.phone_verification_codes
     set consumed_at = now()
   where tenant_id = p_tenant
     and phone_e164 = p_phone
     and consumed_at is null;

  return 'ok';
end;
$$;

comment on function app.phone_verification_consume(uuid, text, text) is
  'Canjea un código de verificación de forma atómica: busca el vivo más reciente con FOR UPDATE, valida vencimiento y tope de intentos, compara el hash y suma el intento fallido EN LA MISMA transacción. Devuelve ok | invalido | expirado | agotado | sin_codigo. Al canjear con éxito mata también los códigos anteriores del mismo teléfono. NO toca user_phones ni profiles.phone_verified: prender la insignia es decisión del servidor (admin client), que además dispara el recálculo de score.';

revoke execute on function app.phone_verification_consume(uuid, text, text) from public, anon, authenticated;
grant execute on function app.phone_verification_consume(uuid, text, text) to service_role;

commit;
