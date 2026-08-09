-- =============================================================================
-- 0080_precios_solo_de_comunidades_en_el_aire.sql — Comunidad Latina
--
-- `public.tenant_public_prices(uuid)` (0078) es SECURITY DEFINER, ejecutable por
-- `anon`, y RECIBE EL TENANT COMO PARÁMETRO. Eso encadena con
-- `tenant_domains_select`, que es `using (true)` para `anon`: se listan todos los
-- `tenant_id` de la plataforma y después se le piden los precios a cada uno.
--
-- Reproducido contra la base, como `anon`, sin cuenta:
--   · enumeración por tenant_domains -> 3 tenant_id
--   · tenant_public_prices(comunidadlatina) -> 14 precios
--   · tenant_public_prices(<comunidad sembrada SIN dominio activo>) -> 2 precios
--
-- POR QUÉ IMPORTA POCO Y POR QUÉ IMPORTA IGUAL
--   Los precios de una comunidad viva se muestran en su propio sitio sin pedir
--   cuenta: que se puedan leer por RPC no revela nada nuevo. La excepción es la
--   que sí duele: una comunidad TODAVÍA NO LANZADA tiene su pliego de precios
--   legible antes de tiempo. Eso es información comercial de un cliente que aún
--   no salió al aire, y la filtra cualquiera con la anon key (que es pública por
--   diseño).
--
-- EL ARREGLO, Y POR QUÉ ESTE Y NO OTRO
--   Resolver el tenant desde el `Host` no es posible acá: el header no llega a
--   Postgres. Y no alcanza con no aceptar el parámetro —sin parámetro la función
--   no tendría forma de saber qué comunidad se está sirviendo—. Así que la regla
--   no puede ser "quién pregunta" sino "de qué comunidad se puede preguntar".
--
--   La condición que se agrega: la comunidad tiene que ESTAR EN EL AIRE. Se
--   define exactamente igual que la sirve el middleware en
--   `resolve_tenant_domain` (0060), y a propósito con las DOS mitades:
--
--       tenants.status = 'active'  AND  existe tenant_domains.status = 'active'
--
--   Se eligen las dos y no sólo el dominio porque `resolve_tenant_domain` exige
--   las dos: un tenant pausado con un dominio activo NO resuelve, así que su
--   sitio no se sirve y su pliego no tiene por qué ser público. Gatear sólo por
--   el dominio habría dejado ese caso abierto.
--
-- EL CONSUMIDOR NO SE ROMPE
--   `src/lib/pricing/read.ts` llama a esta función cuando la lectura directa de
--   `tenant_prices` vuelve vacía (el visitante sin sesión, porque
--   `tenant_prices_select` es `to authenticated`). Ese `tenantId` sale de
--   `getTenant()`, o sea del `Host` ya resuelto por el middleware — que sólo
--   devuelve tenant si hay dominio ACTIVO y tenant ACTIVO. El conjunto que pasa
--   esta guarda es exactamente el conjunto que el consumidor legítimo puede
--   pedir. Verificado contra la base con control positivo.
--
--   El único caso que degrada es dev/seed: un tenant local sin fila en
--   `tenant_domains` deja de devolver precios y rigen las constantes de
--   `defaults.ts`. Es el camino de respaldo que `read.ts` ya documenta, así que
--   degrada sin romper y sin lanzar.
--
--   NO se quita el parámetro ni se cambia la firma: eso rompería a `read.ts`,
--   que es código de aplicación y no se toca en esta migración.
--
-- QUÉ **NO** RESUELVE ESTO, dicho explícito: entre comunidades vivas, cualquiera
-- puede seguir leyendo el pliego de cualquiera. Es información que ya está
-- publicada en cada sitio; cerrarlo requeriría que la base conociera el `Host`,
-- que es justamente lo que no puede. La deuda que se cierra es la de la
-- comunidad que todavía no salió al aire.
-- =============================================================================

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
    -- LA GUARDA DE 0080: sólo comunidades EN EL AIRE. Misma definición que usa
    -- `resolve_tenant_domain` (0060) para decidir si sirve un Host, con las dos
    -- mitades: dominio activo Y tenant activo. Una comunidad sin lanzar no pasa,
    -- y su pliego de precios deja de ser enumerable con la anon key.
    and exists (
      select 1
        from public.tenant_domains d
        join public.tenants t on t.id = d.tenant_id
       where d.tenant_id = p_tenant_id
         and d.status    = 'active'
         and t.status    = 'active'
    )
  order by p.product, p.variant, p.billing_interval;
$$;

comment on function public.tenant_public_prices(uuid) is
  'Precios activos de UNA comunidad, legibles sin sesión. Existe porque /negocios/presencia y /marketplace/membresia muestran precio a visitantes anónimos y la policy de tenant_prices depende del JWT. Devuelve solo lo que se muestra: sin updated_by ni timestamps, y sin las filas inactivas. Desde 0080 además exige que la comunidad ESTÉ EN EL AIRE —dominio en estado active y tenant active, la misma definición con la que resolve_tenant_domain (0060) decide si sirve un Host—. Ese agregado existe porque la función acepta el tenant por parámetro y tenant_domains es legible por anon con using(true): encadenando las dos se enumeraba el pliego de precios de CUALQUIER comunidad, incluida una que todavía no salió al aire. Entre comunidades ya publicadas la lectura cruzada sigue siendo posible y es aceptada: ese precio ya está en la vidriera de cada sitio.';

revoke all on function public.tenant_public_prices(uuid) from public;
grant execute on function public.tenant_public_prices(uuid) to anon;
grant execute on function public.tenant_public_prices(uuid) to authenticated;
grant execute on function public.tenant_public_prices(uuid) to service_role;