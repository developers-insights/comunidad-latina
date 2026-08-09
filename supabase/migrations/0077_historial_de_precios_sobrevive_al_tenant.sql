-- 0077 — El historial de precios deja de morir con la comunidad.
--
-- Qué pasó (observado, no teórico):
--   Durante la prueba técnica multidominio se creó y después se borró el tenant
--   `pruebapliego`. Al borrarlo se llevó puestas sus 14 filas de `tenant_prices`
--   Y sus 14 filas de `tenant_price_history` (42 → 28). Lo primero es correcto:
--   un precio vigente de una comunidad que ya no existe no tiene sentido. Lo
--   segundo contradice la razón de ser de la tabla.
--
-- Por qué importa:
--   `tenant_price_history` es append-only y sus policies de INSERT/UPDATE/DELETE
--   están en `false` para todo JWT justamente para que nadie pueda reescribir la
--   historia de lo que se cobró. Una FK que borra en cascada indirecta deja una
--   puerta por la que la historia SÍ se pierde — y encima sin dejar rastro.
--   Si mañana hay que explicar un cobro viejo, o responder un contracargo, o
--   auditar por qué a alguien se le facturó un monto, el historial tiene que
--   existir aunque la comunidad se haya archivado.
--
-- Qué hace:
--   Saca la FK de `tenant_id` contra `tenants`. La COLUMNA se queda —el
--   enumerador de RLS (`npm run check:rls`) exige `tenant_id` en toda tabla con
--   datos de tenant, y las 4 policies siguen filtrando por ella igual que antes.
--   Lo único que se pierde es la garantía de integridad referencial hacia
--   `tenants`, que es exactamente el precio a pagar por conservar el registro
--   de una comunidad que ya no está.
--
--   Las otras dos FK de la tabla NO se tocan: `changed_by` y `price_id` ya son
--   `ON DELETE SET NULL`, o sea que la fila del historial sobrevive a que se
--   borre quien hizo el cambio o la casilla de precio. Sólo faltaba ésta.
--
-- Nota operativa: en producción los tenants se archivan (`tenant_domains.status`
-- = 'archived'), no se borran. Esta migración cubre el caso en que igual se
-- borren — que es el que ya ocurrió una vez.

alter table public.tenant_price_history
  drop constraint if exists tenant_price_history_tenant_id_fkey;

comment on column public.tenant_price_history.tenant_id is
  'Comunidad a la que pertenecía el precio. SIN foreign key a propósito (0077): el historial tiene que sobrevivir al borrado de la comunidad, porque es el registro de lo que se cobró y puede hacer falta para explicar un cobro viejo o responder un contracargo. Las policies siguen filtrando por esta columna.';
