-- 0187 · Los autores que ve un visitante salen de la comunidad del dominio.
--
-- HALLAZGO (revisión 06/11): `perfiles_publicos` y `puntajes_publicos` tienen una
-- rama `auth.uid() is null` sin filtro, así que con la anon key se lee cualquier id
-- de cualquier comunidad. Un parámetro no lo arregla: lo elegiría quien pregunta,
-- porque el `Host` no llega a Postgres (0091). Estas dos funciones las llama sólo el
-- servidor, con la comunidad que resolvió del dominio.
--
-- ORDEN:
--   1. Esta migración: sólo agrega.
--   2. Deploy del sitio leyendo por acá sin sesión.
--   3. 0188: recién ahí se le saca `anon` a las RPC abiertas. Aplicada antes, las
--      páginas públicas se quedan sin autores.

create function public.perfiles_visitante(p_tenant uuid, p_ids uuid[])
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  area_label text,
  identity_verified boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_url, p.area_label, p.identity_verified
    from public.profiles p
   where p.tenant_id = p_tenant
     and p.id = any (p_ids[1:200]);
$$;

create function public.puntajes_visitante(p_tenant uuid, p_ids uuid[])
returns table (
  profile_id uuid,
  score integer,
  level text,
  signals jsonb,
  computed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.profile_id, t.score, t.level, t.signals, t.computed_at
    from public.trust_scores t
   where t.tenant_id = p_tenant
     and t.profile_id = any (p_ids[1:200]);
$$;

revoke execute on function public.perfiles_visitante(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.puntajes_visitante(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.perfiles_visitante(uuid, uuid[]) to service_role;
grant execute on function public.puntajes_visitante(uuid, uuid[]) to service_role;
