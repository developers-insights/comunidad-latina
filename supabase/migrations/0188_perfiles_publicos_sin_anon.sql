-- 0188 · Cierra lo que dejó abierto la 0185. Va DESPUÉS del deploy que lee por
-- `perfiles_visitante` / `puntajes_visitante` (0187): aplicada antes, las páginas
-- públicas se quedan sin autores.

create or replace function public.perfiles_publicos(p_ids uuid[])
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  area_label text,
  identity_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Sólo lo que muestra la firma de un aviso. Bio y país salen de `profile_card`,
  -- que respeta la privacidad que eligió cada persona.
  select p.id, p.display_name, p.avatar_url, p.area_label, p.identity_verified
    from public.profiles p
   where p.id = any (p_ids[1:200])
     and (
       p.id = auth.uid()
       or p.tenant_id = app.current_tenant_id()
       or app.is_global_admin()
     );
$$;

create or replace function public.puntajes_publicos(p_ids uuid[])
returns table (
  profile_id uuid,
  score integer,
  level text,
  signals jsonb,
  computed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.profile_id, t.score, t.level, t.signals, t.computed_at
    from public.trust_scores t
   where t.profile_id = any (p_ids[1:200])
     and (
       t.profile_id = auth.uid()
       or t.tenant_id = app.current_tenant_id()
       or app.is_global_admin()
     );
$$;

revoke execute on function public.perfiles_publicos(uuid[]) from anon;
revoke execute on function public.puntajes_publicos(uuid[]) from anon;
