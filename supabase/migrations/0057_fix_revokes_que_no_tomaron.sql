-- 0057 — Los dos REVOKE de 0056 que Postgres aceptó sin efecto.
--
-- La 0056 se aplicó sin error y, verificando después con SQL real, dos de sus
-- cambios no habían hecho nada. Postgres no avisa en ninguno de los dos casos:
-- el REVOKE es válido, sólo que apunta a un permiso que no era el que estaba
-- concediendo el acceso. De ahí esta migración aparte.

begin;

-- ---------------------------------------------------------------------------
-- 1. job_application_tally: el permiso lo daba PUBLIC, no `anon`
-- ---------------------------------------------------------------------------
-- Su ACL era `{=X/postgres, postgres=X/postgres, authenticated=X/postgres, ...}`.
-- Esa primera entrada sin nombre a la izquierda del `=` es PUBLIC, el grant que
-- Postgres pone solo al crear cualquier función. `revoke ... from anon` no lo
-- toca, y anon lo sigue heredando por ser miembro de PUBLIC.
--
-- Las otras tres de 0056 sí quedaron bien porque una migración anterior les
-- había hecho el revoke a PUBLIC y el grant explícito por rol.

revoke execute on function public.job_application_tally(uuid[]) from public;
grant  execute on function public.job_application_tally(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. verification_checks.evidence: el grant de tabla le gana al de columna
-- ---------------------------------------------------------------------------
-- `revoke select (evidence)` es un no-op mientras el rol tenga SELECT sobre la
-- tabla entera: Postgres sólo mira los permisos por columna cuando NO hay
-- permiso de tabla. Y anon/authenticated tienen el `grant all on all tables`
-- que Supabase deja por defecto en `public`.
--
-- Verificado en vivo antes de este arreglo: como anon,
--   select evidence from public.verification_checks limit 1;
-- devolvía {"matched_name":"Rosa M. Peralta", "query":{"license_number":...},
--           "registry_status_text":"Notary Public — Commission active"}
-- o sea el nombre real de una persona y su matrícula, legibles sin cuenta.
--
-- La forma correcta es sacar el SELECT de tabla y devolverlo columna por
-- columna. Se conceden TODAS menos `evidence`, no sólo las seis que hoy lee la
-- app: así un `select` nuevo sobre una columna inocua no se rompe por sorpresa.
-- `service_role` no se toca — el panel y los jobs siguen viendo la evidencia.

revoke select on public.verification_checks from anon, authenticated;

grant select (
  id,
  tenant_id,
  subject_kind,
  subject_id,
  license_number,
  registry,
  registry_url,
  result,
  checked_at,
  disclaimer_version,
  created_at
) on public.verification_checks to anon, authenticated;

commit;
