-- =============================================================================
-- 0042_job_privacy_and_listing_ownership.sql — Comunidad Latina
--
-- Cierra DOS agujeros reales, encontrados al construir /admin/empleos y
-- REPRODUCIDOS EN VIVO contra PostgREST con el token de carlos@demo
-- (domain_admin) antes de escribir una línea de este archivo.
--
-- El panel de empleos aplica una barrera de privacidad por DUEÑO del aviso
-- (src/app/admin/empleos/policy.ts):
--   * aviso de la PLATAFORMA (listings.created_by is null, o publicado por ese
--     mismo staff) ⇒ el staff ve nombre, nota y respuestas, y puede resolver;
--   * aviso de un MIEMBRO ⇒ el staff ve SOLO metadatos (estado y fecha).
-- Esa barrera era 100% de aplicación. La base decía otra cosa.
--
-- AGUJERO 1 — job_applications_select (0040) tenía una rama `or app.is_staff()`.
--   Probado: GET /rest/v1/job_applications con el token del domain_admin
--   devolvió 3 filas con `message`, `answers` y `applicant_id` de postulaciones
--   a avisos DE MIEMBROS, salteando el panel entero. Espejo del mismo problema
--   en job_applications_update. Además `app.is_staff()` incluye 'moderator',
--   que ni siquiera ve la pestaña (el panel exige domain_admin+).
--
-- AGUJERO 2 — nada congelaba listings.created_by, y listings_update (0004)
--   deja escribir al staff. Probado: PATCH /rest/v1/listings {created_by:null}
--   sobre el aviso de un miembro → HTTP 200, el aviso quedó "de la plataforma".
--   O sea: el agujero 1 se podía REABRIR de forma legítima aunque se cerrara,
--   porque `created_by` es el ancla de la que cuelga toda la política.
--
-- Cerrar solo uno de los dos no sirve de nada. Van juntos.
-- =============================================================================


-- =============================================================================
-- 1 · job_applications — la policy dice lo MISMO que la app, no más
--
-- Regla única, idéntica a jobDisclosure() en policy.ts: se accede a una
-- postulación si sos el postulante, o si sos el dueño del aviso, o si el aviso
-- NO tiene dueño miembro y sos admin del dominio. El ROL ya no abre nada por sí
-- solo: la propiedad del aviso decide, que es exactamente la doctrina que
-- policy.ts escribió en prosa ("NO se sube por rol: un global_admin tampoco ve
-- las respuestas de un aviso ajeno").
--
-- Qué se cae respecto de 0040, a propósito:
--   * `or app.is_staff()` — era el agujero. Se reemplaza por la rama acotada a
--     avisos sin dueño (created_by is null) y a domain_admin/global_admin.
--   * `or app.is_global_admin()` de cierre — daba lectura CROSS-TENANT y total.
--     No lo usa ninguna pantalla: el panel filtra siempre por el tenant del JWT
--     (fetchAdminJobs/fetchAdminJobDetail reciben ctx.tenantId y hacen
--     .eq("tenant_id", ...)), así que sacarlo no rompe ninguna vista. Y si un
--     global_admin necesitara el contenido de un aviso ajeno, el camino es el
--     reporte de estafa —que ya viaja con su contenido a moderación— no una
--     puerta abierta acá.
--
-- Qué NO se toca (los caminos legítimos que 0040 protege siguen igual):
--   * el postulante sobre su propia fila (fetchViewerApplication, retirarse);
--   * quien publicó el aviso sobre las postulaciones que recibió
--     (fetchJobApplications, aceptar/rechazar).
-- =============================================================================

drop policy job_applications_select on public.job_applications;
create policy job_applications_select on public.job_applications
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    applicant_id = (select auth.uid())
    or exists (
      select 1 from public.listings l
      where l.id = job_applications.job_id
        and l.tenant_id = job_applications.tenant_id
        and (
          -- dueño del aviso (miembro o staff que lo publicó él mismo)
          l.created_by = (select auth.uid())
          -- aviso SIN dueño miembro = de la plataforma: ahí el admin del
          -- dominio SÍ es el destinatario legítimo de las respuestas.
          or (
            l.created_by is null
            and (select app.current_user_role()) in ('domain_admin', 'global_admin')
          )
        )
    )
  )
);

-- Mismo criterio en UPDATE. El WITH CHECK además deja de tener la rama suelta
-- `or app.is_staff()`, que permitía a un moderador mover una postulación a
-- CUALQUIER status: ahora el staff solo puede lo que hace la server action
-- (accepted/declined), y solo sobre avisos de la plataforma.
drop policy job_applications_update on public.job_applications;
create policy job_applications_update on public.job_applications
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    applicant_id = (select auth.uid())
    or exists (
      select 1 from public.listings l
      where l.id = job_applications.job_id
        and l.tenant_id = job_applications.tenant_id
        and (
          l.created_by = (select auth.uid())
          or (
            l.created_by is null
            and (select app.current_user_role()) in ('domain_admin', 'global_admin')
          )
        )
    )
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    (applicant_id = (select auth.uid()) and status in ('submitted', 'withdrawn'))
    or (
      exists (
        select 1 from public.listings l
        where l.id = job_applications.job_id
          and l.tenant_id = job_applications.tenant_id
          and (
            l.created_by = (select auth.uid())
            or (
              l.created_by is null
              and (select app.current_user_role()) in ('domain_admin', 'global_admin')
            )
          )
      )
      and status in ('accepted', 'declined')
    )
  )
);

-- job_applications_delete NO cambia (sigue domain_admin/global_admin del
-- tenant), pero conviene dejar escrito POR QUÉ ya no es un bypass de lectura:
-- PostgREST puede pedir `Prefer: return=representation` en un DELETE, y en
-- Postgres el RETURNING de un DELETE está sujeto a las policies de SELECT. Con
-- el select de arriba arreglado, un DELETE sobre la postulación de un aviso
-- ajeno borra pero NO devuelve contenido. Verificado en vivo, no supuesto.

comment on table public.job_applications is
  'Postulación a un aviso de empleo (listings kind=''job''). accepted/declined las marca quien publicó el aviso; withdrawn el postulante. answers guarda las respuestas a listings.attrs.questions y queda congelada después del insert (app.job_applications_freeze). PRIVACIDAD (0042): el acceso lo decide la PROPIEDAD DEL AVISO, no el rol — postulante, dueño del aviso, o admin del dominio SOLO si el aviso no tiene dueño miembro (created_by is null). Un moderador no accede, y un global_admin tampoco lee las respuestas de un aviso ajeno.';


-- ---------------------------------------------------------------------------
-- CONSECUENCIA del fix, y su resolución SIN aflojar la policy
--
-- El panel promete, para un aviso de un MIEMBRO, exactamente un dato: CUÁNTAS
-- postulaciones hay y cuántas están pendientes ("¿está entrando gente y nadie
-- contesta?"). Ese conteo lo hacía fetchAdminJobs() leyendo job_applications
-- con el token del staff — que ahora, correctamente, no ve ninguna fila de un
-- aviso ajeno. Sin nada más, la pantalla pasaría a mostrar 0/0 para los avisos
-- de miembros: no un error, algo peor — la mentira exacta que queries.ts dice
-- que el panel existe para evitar ("diría 'Sin postulaciones' cuando en
-- realidad hay gente esperando").
--
-- La salida NO es devolverle al staff la lectura de las filas. Es darle el
-- AGREGADO sin el contenido: esta RPC devuelve solo (job_id, total, pending).
-- No expone applicant_id, ni message, ni answers, ni fechas por persona — o
-- sea, no divulga nada que la política de 0042 acabe de cerrar.
-- ---------------------------------------------------------------------------
create or replace function public.job_application_tally(p_job_ids uuid[])
returns table (job_id uuid, total int, pending int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_role   text := app.current_user_role();
begin
  -- Mismo umbral que el panel (page.tsx exige domain_admin+): un moderador no
  -- entra acá tampoco. SECURITY DEFINER saltea RLS, así que el gate lo pone
  -- esta función EXPLÍCITAMENTE — regla de la casa de 0014.
  if v_role not in ('domain_admin', 'global_admin') then
    raise exception 'FORBIDDEN: solo administradores del dominio';
  end if;
  if v_tenant is null then
    raise exception 'FORBIDDEN: sin tenant en el token';
  end if;
  if p_job_ids is null or array_length(p_job_ids, 1) is null then
    return;
  end if;
  if array_length(p_job_ids, 1) > 200 then
    raise exception 'TOO_MANY_IDS: máximo 200 avisos por consulta';
  end if;

  return query
    select a.job_id,
           count(*)::int,
           count(*) filter (where a.status = 'submitted')::int
      from public.job_applications a
      join public.listings l
        on l.id = a.job_id
       and l.tenant_id = a.tenant_id
       and l.kind = 'job'
     where a.job_id = any(p_job_ids)
       -- El tenant del JWT manda en las DOS tablas: un id de aviso filtrado de
       -- afuera no alcanza para contar postulaciones de otra comunidad.
       and a.tenant_id = v_tenant
       and l.tenant_id = v_tenant
       -- 'withdrawn' no cuenta: al retirarse, la postulación deja de verse
       -- (misma promesa que tallyApplications en policy.ts).
       and a.status <> 'withdrawn'
     group by a.job_id;
end;
$$;

comment on function public.job_application_tally(uuid[]) is
  'Conteo de postulaciones por aviso (total y pendientes) para /admin/empleos, SIN divulgar contenido: no devuelve applicant_id, message ni answers. Existe porque 0042 le sacó al staff la lectura de postulaciones de avisos ajenos y el panel igual necesita el metadato agregado. Gate explícito: domain_admin/global_admin y tenant del JWT en ambas tablas.';

grant execute on function public.job_application_tally(uuid[]) to authenticated, service_role;


-- =============================================================================
-- 2 · listings.created_by es INMUTABLE (con una sola excepción, hacia un lado)
--
-- `created_by` dejó de ser un dato de auditoría el día que la política de
-- divulgación de empleos colgó de él: hoy es un ANCLA DE SEGURIDAD. Y una
-- policy autoriza FILAS, no COLUMNAS — listings_update (0004) deja al staff
-- editar cualquier aviso de su tenant, así que sin esta guarda el fix de arriba
-- se saltea en un PATCH: poné created_by en null y el aviso ajeno pasa a ser
-- "de la plataforma", con divulgación completa y perfectamente legítima.
--
-- POR QUÉ SÍ LLEVA EXCEPCIÓN DE service_role (y el freeze de votos de 0041 no):
-- allá lo que se protegía era la coherencia de un contador, y mover un voto por
-- service_role tampoco lo habría recalculado bien — no existía un uso legítimo.
-- Acá sí existe uno previsible: el producto siembra avisos sin dueño
-- (created_by null + publisher_name, §9.1) y "reclamar este aviso/negocio" es
-- la continuación natural — asignarle dueño a algo que no lo tenía. Además el
-- atacante de este agujero es un token de STAFF contra PostgREST, que llega
-- SIEMPRE como rol `authenticated`: la excepción de service_role no le sirve
-- de nada.
--
-- Pero la excepción es DIRECCIONAL, no un cheque en blanco: solo se permite
-- null → dueño (reclamar). Nunca dueño → null (que es justo la dirección que
-- destraba la divulgación) ni dueño A → dueño B (regalar las postulaciones
-- recibidas por alguien). Así un futuro server action con createAdminClient()
-- no puede reabrir el agujero por descuido.
-- =============================================================================

create or replace function app.listings_freeze_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not distinct from old.created_by then
    return new; -- no se toca la propiedad: nada que validar
  end if;

  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    -- Única transición permitida, y solo por service_role: reclamar un aviso
    -- sembrado (sin dueño) para asignarle uno real.
    if old.created_by is null and new.created_by is not null then
      return new;
    end if;
    raise exception 'PROTECTED_COLUMNS: created_by solo puede pasar de null a un dueño (reclamar); nunca se libera ni se transfiere';
  end if;

  raise exception 'PROTECTED_COLUMNS: created_by no se puede modificar — la propiedad del aviso define quién ve las postulaciones';
end;
$$;

comment on function app.listings_freeze_ownership() is
  'Congela listings.created_by después del INSERT. Ningún cliente authenticated (dueño ni staff) puede cambiarlo: la propiedad del aviso es el ancla de la política de divulgación de /admin/empleos (0042). service_role solo puede la transición null → dueño (reclamar un aviso sembrado); jamás dueño → null ni dueño A → dueño B.';

create trigger listings_freeze_ownership
before update on public.listings
for each row execute function app.listings_freeze_ownership();

comment on column public.listings.created_by is
  'Autor del aviso. null = aviso sembrado/importado por la plataforma (§9.1, va con publisher_name). INMUTABLE después del insert (app.listings_freeze_ownership, 0042): no es solo auditoría — de esta columna cuelga quién puede leer las postulaciones del aviso en /admin/empleos.';
