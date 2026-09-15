begin;

-- =============================================================================
-- 0152 · Cuánto pagaste por tu impulso
-- =============================================================================
--
-- EL SÍNTOMA. La pantalla de estadísticas de un aviso impulsado
-- (`app/(app)/impulsar/[listingId]/estadisticas/page.tsx`) no podía listar las
-- promociones: la consulta se caía con 42501 y el panel mostraba "Todavía no
-- promocionaste este aviso" sobre un aviso promocionado y PAGO. El cartel se
-- corrigió para que diga "No pudimos traerlo" en vez de mentir, pero el dato
-- seguía sin llegar — y el dato es justo lo que el cliente pidió ver: "si no
-- sabés qué tan efectiva es la publicidad, no tiene sentido pagar".
--
-- LA CAUSA, QUE NO ES UN BUG DE LA RLS. `src/lib/monetization/stats.ts` pedía
--
--     .from("boosts").select("duration_days, status, ends_at, amount_cents")
--
-- y el grant de `public.boosts` es POR COLUMNA desde la 0018, re-afirmado en la
-- 0085 (§ "boosts: solo columnas de transparencia FTC"):
--
--     grant select (id, tenant_id, listing_id, package, duration_days, status,
--                   starts_at, ends_at, created_at) on public.boosts
--       to anon, authenticated;
--
-- `amount_cents` no está en esa lista, y en Postgres pedir UNA columna sin
-- grant tumba la consulta ENTERA con 42501. No falla la fila: falla el select.
--
-- ⚠️ POR QUÉ NO SE ARREGLA AGREGANDO amount_cents AL GRANT — LEER ANTES DE
-- "SIMPLIFICAR" ESTO.
--
-- La policy `boosts_select` tiene una rama PÚBLICA deliberada:
--
--     using (status = 'active' or (tenant_id = … and buyer_id = auth.uid()) or …)
--          ↑ esta rama alcanza a `anon` y a cualquier `authenticated`
--
-- Existe por transparencia publicitaria: cualquiera tiene que poder confirmar
-- que un aviso destacado está pago. Esa política exige mostrar QUE algo es
-- publicidad, no CUÁNTO costó. Con un `grant select (amount_cents)` esa misma
-- rama pasaría a entregar lo que paga cada anunciante de la comunidad a
-- cualquiera que consulte `/rest/v1/boosts?status=eq.active&select=amount_cents`
-- — una fuga de datos comerciales de todos los comercios, incluida la lista de
-- precios efectiva de la competencia. Por eso `amount_cents`, `buyer_id`,
-- `currency` y `stripe_checkout_session_id` quedaron fuera del grant, y por eso
-- tienen que seguir afuera.
--
-- (`campaigns` sí expone `budget_cents` por grant de tabla, y no es una
-- inconsistencia: su `campaigns_select` es sólo `to authenticated` y exige
-- `created_by = auth.uid()` o administración — no tiene rama pública que
-- explotar. La asimetría es la rama pública de boosts, no el criterio.)
--
-- LA VÍA: ACCESO CON ALCANCE DE DUEÑO, calcado de `public.listing_reach()`
-- (0050), que resuelve el mismo problema en la misma pantalla — un dato que el
-- dueño tiene que ver y que la tabla no puede entregar sin abrirlo a terceros.
-- Entra un uuid de aviso, sale lo que ese dueño pagó, y la identidad del
-- comprador nunca sale de la base.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- listing_boosts_for_owner — los últimos impulsos de MI aviso, con el monto
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER con el gate EXPLÍCITO adentro (regla de la casa de 0014: una
-- RPC definer nunca confía en que "el bypass ya filtró"). El gate es, palabra
-- por palabra, el de `listing_reach`: la pantalla que consume las dos ya está
-- reservada al dueño del aviso, y dos gates distintos sobre la misma pantalla
-- es una de las dos mal.
--
-- EL TENANT SALE DEL JWT, NUNCA DEL PARÁMETRO. `p_listing_id` es lo único que
-- entra, y se lo cruza contra `app.current_tenant_id()` en las DOS tablas: un
-- uuid de aviso conseguido de otra comunidad no alcanza para leer un monto.
--
-- POR QUÉ ALCANZA CON SER DUEÑO DEL AVISO Y NO SE EXIGE ADEMÁS
-- `buyer_id = auth.uid()`: hoy son la misma persona por construcción — el
-- checkout (`impulsar/[listingId]/actions.ts`) verifica `created_by = user.id`
-- ANTES de insertar y escribe `buyer_id: user.id`, y `boosts_insert` está en
-- `false` para authenticated, así que nadie más escribe esa tabla. Si algún día
-- una cuenta de negocio paga el impulso de un aviso creado por otro miembro,
-- esa invariante se rompe y hay que volver acá a decidir a propósito quién ve
-- el monto. Este comentario es el recordatorio.
create or replace function public.listing_boosts_for_owner(p_listing_id uuid)
returns table (
  duration_days integer,
  status        text,
  ends_at       timestamptz,
  amount_cents  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  -- Mismo mensaje para "no existe" y para "no es tuyo": confirmar la existencia
  -- de un aviso ajeno ya sería información (criterio de 0050).
  if not exists (
    select 1 from public.listings l
     where l.id = p_listing_id
       and l.tenant_id = v_tenant
       and (
         l.created_by = auth.uid()
         or app.current_user_role() in ('domain_admin', 'global_admin')
       )
  ) then
    raise exception 'LISTING_NOT_FOUND: el aviso no está disponible en tu comunidad.';
  end if;

  -- ⚠️ EL ALIAS `b.` ES OBLIGATORIO EN CADA COLUMNA, no es estilo: los cuatro
  -- nombres de salida (duration_days, status, ends_at, amount_cents) son
  -- variables OUT de esta función Y columnas de `boosts`. Una referencia sin
  -- calificar revienta con "column reference is ambiguous" — y revienta en
  -- tiempo de EJECUCIÓN, no al crear la función, así que el dry-run pasaría.
  return query
    select b.duration_days,
           b.status,
           b.ends_at,
           b.amount_cents
      from public.boosts b
     where b.listing_id = p_listing_id
       and b.tenant_id  = v_tenant
       -- Un impulso que nunca se pagó no es una promoción: es un carrito
       -- abandonado. Mismo filtro que traía la consulta original.
       and b.status <> 'pending_payment'
     order by b.created_at desc
     limit 5;
end;
$$;

comment on function public.listing_boosts_for_owner(uuid) is
  'Los últimos 5 impulsos pagos de un aviso CON el monto, para el bloque premium del panel de estadísticas. Único camino de lectura de boosts.amount_cents desde el cliente: la columna está fuera del grant de public.boosts a propósito, porque boosts_select tiene una rama pública (status = active) por transparencia publicitaria y abrirla filtraría cuánto paga cada anunciante. Valida sesión, tenant del JWT y que el aviso sea del solicitante (o de la administración) — mismo gate que public.listing_reach(). El límite de 5 es el de la lista que muestra el panel; cambiarlo es cambiar esta función.';

-- Sin sesión no hay monto: la rama pública de `boosts_select` existe para que
-- `anon` confirme que algo es publicidad, no para que sepa cuánto costó.
revoke execute on function public.listing_boosts_for_owner(uuid) from public;
revoke execute on function public.listing_boosts_for_owner(uuid) from anon;
grant  execute on function public.listing_boosts_for_owner(uuid) to authenticated, service_role;

commit;
