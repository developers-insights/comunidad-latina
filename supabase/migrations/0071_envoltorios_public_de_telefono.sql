-- 0071 — Envoltorios en `public` para las dos funciones de verificación por SMS.
--
-- Misma causa que la 0070, distinto módulo: `app.phone_verification_can_send` y
-- `app.phone_verification_consume` (0066) viven en el schema `app`, que PostgREST
-- no expone. `grant execute … to service_role` es necesario pero NO suficiente:
-- `supabase.rpc("phone_verification_consume")` devuelve 404 porque el schema
-- entero está fuera de la API.
--
-- El costo de no tenerlos: la capa de aplicación tuvo que replicar la lógica en
-- TypeScript, y esa réplica no puede expresar `attempts = attempts + 1` en una
-- sola sentencia — o sea que el contador de intentos tiene una ventana de carrera
-- ante dos fallos simultáneos. El canje en sí ya era seguro (UPDATE condicional
-- sobre `consumed_at is null`), pero el rate limit por intentos no. Con estos
-- envoltorios la lógica vuelve a un solo lugar, dentro de la transacción del
-- motor.
--
-- SECURITY INVOKER a propósito: el cuerpo real de `app.*` ya es DEFINER, así que
-- declarar definer el envoltorio sería privilegio de más y un advisory nuevo sin
-- ganancia. EXECUTE sólo para `service_role`: emitir y canjear códigos de
-- verificación es decisión del servidor, jamás del navegador — si `authenticated`
-- pudiera llamarlas, cualquiera podría enumerar códigos o agotarle los intentos a
-- otro.

-- ---------------------------------------------------------------------------
-- ¿Se puede mandar un código a este número ahora? → ok | rate_limited_hora | rate_limited_dia
-- ---------------------------------------------------------------------------
create or replace function public.phone_verification_can_send(
  p_tenant uuid,
  p_phone  text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app.phone_verification_can_send(p_tenant, p_phone);
$$;

comment on function public.phone_verification_can_send(uuid, text) is
  'Envoltorio de app.phone_verification_can_send para que la aplicación pueda llamarla por PostgREST (que solo expone public). EXECUTE solo para service_role.';

revoke all on function public.phone_verification_can_send(uuid, text) from public;
revoke all on function public.phone_verification_can_send(uuid, text) from anon;
revoke all on function public.phone_verification_can_send(uuid, text) from authenticated;
grant execute on function public.phone_verification_can_send(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Canje atómico del código → ok | invalido | expirado | agotado | sin_codigo
-- ---------------------------------------------------------------------------
create or replace function public.phone_verification_consume(
  p_tenant    uuid,
  p_phone     text,
  p_code_hash text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app.phone_verification_consume(p_tenant, p_phone, p_code_hash);
$$;

comment on function public.phone_verification_consume(uuid, text, text) is
  'Envoltorio de app.phone_verification_consume para que la aplicación pueda llamarla por PostgREST. EXECUTE solo para service_role. Es la única forma de canjear un código de forma atómica: la réplica en TypeScript no puede incrementar el contador de intentos sin una ventana de carrera.';

revoke all on function public.phone_verification_consume(uuid, text, text) from public;
revoke all on function public.phone_verification_consume(uuid, text, text) from anon;
revoke all on function public.phone_verification_consume(uuid, text, text) from authenticated;
grant execute on function public.phone_verification_consume(uuid, text, text) to service_role;
