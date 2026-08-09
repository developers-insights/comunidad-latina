-- 0078 — Los precios de una comunidad se pueden leer sin haber iniciado sesión.
--
-- El problema:
--   `tenant_prices_select` (0072) es `for select to authenticated` y filtra por
--   `tenant_id = app.current_tenant_id()`. Un visitante sin sesión no tiene JWT,
--   así que `current_tenant_id()` es NULL y no lee ninguna fila. Pero hay dos
--   pantallas que muestran precio A PROPÓSITO sin pedir cuenta:
--     · /negocios/presencia
--     · /marketplace/membresia
--   Ahí el visitante veía la constante del código en vez del precio real de la
--   comunidad. O sea: un precio antes de entrar y otro después. Con el editor de
--   precios en producción (0072/0073) eso pasa de rareza a dato equivocado
--   publicado.
--
-- Por qué NO se resuelve agregando `anon` a la policy:
--   La expresión de la policy depende de `app.current_tenant_id()`, que sale del
--   JWT. Sin sesión no hay JWT, así que sumar el rol no cambiaría nada. Y
--   reemplazarla por un `using (true)` para `anon` abriría los precios de TODAS
--   las comunidades a cualquiera — justo la clase de lectura cross-tenant que la
--   auditoría de aislamiento multidominio ya dejó marcada como deuda. No se suma
--   otra.
--
-- Cómo se resuelve:
--   Una función acotada que recibe el tenant EXPLÍCITO y devuelve sólo sus
--   precios activos. El `tenant_id` no lo elige el visitante: lo resuelve el
--   servidor desde el `Host` (ver `resolve_tenant_domain`, 0060), que es
--   información en la que ya confiamos para decidir qué comunidad se está
--   sirviendo. Mismo patrón que `profile_card` (0063): la tabla queda cerrada y
--   la única puerta es una función que aplica la regla antes de devolver.
--
--   Devuelve SOLO lo que una pantalla pública necesita mostrar —producto,
--   variante, intervalo, monto y moneda—. Nada de `updated_by`, `created_at` ni
--   `updated_at`: quién tocó el precio y cuándo es información de gestión, no de
--   vidriera.
--
--   Las filas con `active = false` no salen: un precio dado de baja no se muestra.

create or replace function public.tenant_public_prices(p_tenant_id uuid)
returns table (
  product          text,
  variant          text,
  billing_interval text,
  amount_cents     integer,
  currency         text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.product, p.variant, p.billing_interval, p.amount_cents, p.currency
  from public.tenant_prices p
  where p.tenant_id = p_tenant_id
    and p.active
  order by p.product, p.variant, p.billing_interval;
$$;

comment on function public.tenant_public_prices(uuid) is
  'Precios activos de UNA comunidad, legibles sin sesión. Existe porque /negocios/presencia y /marketplace/membresia muestran precio a visitantes anónimos y la policy de tenant_prices depende del JWT. El tenant lo pasa el servidor (resuelto desde el Host), no el visitante. Devuelve solo lo que se muestra: sin updated_by ni timestamps, y sin las filas inactivas.';

revoke all on function public.tenant_public_prices(uuid) from public;
grant execute on function public.tenant_public_prices(uuid) to anon;
grant execute on function public.tenant_public_prices(uuid) to authenticated;
grant execute on function public.tenant_public_prices(uuid) to service_role;
