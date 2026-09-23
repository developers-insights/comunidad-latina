begin;

-- =============================================================================
-- 0153 · Mi publicidad — los impulsos que pagué, con el monto
-- =============================================================================
--
-- EL SÍNTOMA. `/impulsar/resultados` ("Cómo van tus promociones", a la que ahora
-- se llega desde Ajustes › Mi publicidad) pedía
--
--     .from("boosts").select("id, listing_id, status, amount_cents, …")
--       .eq("buyer_id", user.id)
--
-- y las dos columnas, `amount_cents` y `buyer_id`, están FUERA del grant por
-- columnas de `public.boosts` (0018/0085). La consulta entera caía con 42501,
-- el código la leía como "no hay filas", y la pantalla sólo mostraba las
-- promociones de PUBLICACIONES: todo impulso de un AVISO pagado desaparecía.
-- Mismo modo de falla que arregló la 0152 en la pantalla de un solo aviso.
--
-- ⚠️ NO SE ARREGLA AGREGANDO LAS COLUMNAS AL GRANT. `boosts_select` tiene una
-- rama pública (status = 'active') por transparencia publicitaria; con el
-- grant abierto, cualquiera leería cuánto paga y QUIÉN es cada anunciante.
-- La explicación completa está en la cabecera de la 0152.
--
-- LA VÍA: la misma de la 0152, pero con alcance "lo que YO compré" en vez de
-- "los impulsos de MI aviso". El comprador sale de `auth.uid()` y el tenant del
-- JWT: no entra ningún identificador por parámetro, así que no hay nada que
-- falsificar.
-- =============================================================================

create or replace function public.my_boosts(p_limit integer default 20)
returns table (
  id           uuid,
  listing_id   uuid,
  status       text,
  amount_cents integer,
  ends_at      timestamptz,
  created_at   timestamptz
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

  -- ⚠️ El alias `b.` es obligatorio: los seis nombres de salida son variables
  -- OUT de la función Y columnas de `boosts`. Sin calificar revienta con
  -- "column reference is ambiguous" en EJECUCIÓN, no al crearla.
  return query
    select b.id,
           b.listing_id,
           b.status,
           b.amount_cents,
           b.ends_at,
           b.created_at
      from public.boosts b
     where b.buyer_id  = auth.uid()
       and b.tenant_id = v_tenant
       -- Un checkout abandonado nunca se sirvió: no tiene resultados que mostrar.
       and b.status <> 'pending_payment'
     order by b.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.my_boosts(integer) is
  'Los impulsos de avisos que pagó quien llama, CON el monto, para /impulsar/resultados (Ajustes › Mi publicidad). boosts.amount_cents y boosts.buyer_id están fuera del grant a propósito (ver 0152): ésta es la vía de lectura del dueño. Comprador = auth.uid(), tenant = JWT; nada entra por parámetro salvo el tope (1..50).';

revoke execute on function public.my_boosts(integer) from public;
revoke execute on function public.my_boosts(integer) from anon;
grant  execute on function public.my_boosts(integer) to authenticated, service_role;

commit;
