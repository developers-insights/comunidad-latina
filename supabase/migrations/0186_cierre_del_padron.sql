-- 0186 · Cierra lo que abrió el hallazgo de la 0185. Va DESPUÉS del deploy que lee
-- por `perfiles_publicos` / `puntajes_publicos`: aplicada antes, las páginas
-- públicas se quedan sin autores.

alter policy profiles_select on public.profiles
  to authenticated
  using (
    id = (select auth.uid())
    or tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

alter policy trust_scores_select on public.trust_scores
  to authenticated
  using (
    profile_id = (select auth.uid())
    or tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

-- Revocar a nivel tabla se lleva también los grants por columna (0058).
revoke select on public.profiles from anon;
revoke select on public.trust_scores from anon;

-- `global_search` estaba abierta a la anon key y cualquiera podía llamarla directo
-- contra PostgREST, sin pasar por el tope por IP de /buscar/api. Los visitantes
-- buscan por ese handler, que la llama con service_role.
revoke execute on function public.global_search(text, integer, uuid) from anon;
