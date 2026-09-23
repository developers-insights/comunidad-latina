begin;

-- =============================================================================
-- 0154 · Las impresiones de un impulso vuelven a llegarle a quien lo pagó
-- =============================================================================
--
-- EL SÍNTOMA. "Veces que se mostró" decía "No pudimos traerlo" SIEMPRE, en las
-- dos pantallas que lo muestran: /impulsar/resultados (Ajustes › Tu publicidad)
-- y las estadísticas de un aviso. Toda lectura de `boost_impressions` hecha por
-- un miembro caía con 42501.
--
-- LA CAUSA. La policy `boost_impressions_select` hacía
--
--     exists (select 1 from public.boosts b where … and b.buyer_id = auth.uid() …)
--
-- y la subconsulta de una policy corre con los privilegios de QUIEN CONSULTA.
-- `boosts.buyer_id` está fuera del grant por columnas de `boosts` (0018/0085,
-- ver la cabecera de la 0152 para el porqué), así que la policy misma no se
-- podía evaluar: la tabla tiene su grant, pero la regla que la protege pedía
-- una columna que el lector no puede ver. Sólo funcionaba para el staff de
-- plataforma, que entra por `app.is_global_admin()` sin tocar esa columna.
--
-- LA VÍA. La pregunta "¿este impulso es mío?" se hace con un helper SECURITY
-- DEFINER (mismo patrón que `app.es_miembro_de_grupo`, `app.can_manage_listing`)
-- que responde sí/no y nunca devuelve el comprador. La rama del staff de la
-- comunidad se queda igual: sólo usa columnas otorgadas.
-- =============================================================================

create or replace function app.compre_el_impulso(p_boost uuid, p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.boosts b
     where b.id        = p_boost
       and b.tenant_id = p_tenant
       and b.buyer_id  = auth.uid()
  );
$$;

comment on function app.compre_el_impulso(uuid, uuid) is
  'true si quien llama compró ese impulso en esa comunidad. Existe para boost_impressions_select: la policy no puede leer boosts.buyer_id directamente porque la columna está fuera del grant (0018/0085) y una subconsulta de policy corre con los privilegios del lector.';

revoke execute on function app.compre_el_impulso(uuid, uuid) from public;
revoke execute on function app.compre_el_impulso(uuid, uuid) from anon;
grant  execute on function app.compre_el_impulso(uuid, uuid) to authenticated, service_role;

drop policy if exists boost_impressions_select on public.boost_impressions;
create policy boost_impressions_select on public.boost_impressions
  for select to authenticated
  using (
    app.compre_el_impulso(boost_impressions.boost_id, boost_impressions.tenant_id)
    or exists (
      select 1
        from public.boosts b
       where b.id        = boost_impressions.boost_id
         and b.tenant_id = boost_impressions.tenant_id
         and b.tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = any (array['domain_admin', 'global_admin'])
    )
    or (select app.is_global_admin())
  );

commit;
