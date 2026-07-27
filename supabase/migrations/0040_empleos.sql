-- =============================================================================
-- 0040_empleos.sql — Comunidad Latina
-- EMPLEOS COMUNITARIOS (feedback Geovanny/Henry 2026-07-24): postularse a un
-- aviso de trabajo (niñera, mesera, construcción) respondiendo las preguntas
-- que puso quien publica, sin salir de la plataforma.
--
--   * job_applications — espejo de gig_applications (0024) adaptado a empleos:
--     el MENSAJE es opcional (las preguntas ya llevan la información dura) y
--     suma `answers` jsonb con lo que respondió el postulante.
--
-- El AVISO no estrena tabla: un empleo sigue siendo `listings` kind='job'
-- (0004) — reusa moderación, fotos, RLS, boosts y FTS. `attrs.employment_type`
-- y `attrs.questions` viajan en el jsonb del listing y los valida zod
-- app-side (src/components/empleos/helpers.ts); `price_period = 'hour'` ya
-- estaba permitido desde 0004, no se toca ese CHECK.
--
-- BLINDAJE que gigs no tenía: un trigger congela las columnas del postulante
-- (answers, message, job_id, applicant_id, tenant_id) después del INSERT. Sin
-- eso, el dueño del aviso —que SÍ puede hacer UPDATE para aceptar/rechazar—
-- podría reescribir las respuestas ajenas: la policy autoriza la fila, no las
-- columnas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- job_applications — alguien se postula a un aviso (kind='job')
-- ---------------------------------------------------------------------------
create table public.job_applications (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  job_id       uuid not null references public.listings(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  -- A diferencia de gig_applications, acá el mensaje NO es obligatorio: las
  -- preguntas del aviso son el contenido; la nota es un extra.
  message      text check (message is null or char_length(message) <= 1000),
  -- Respuestas [{questionId, answer}] contra listings.attrs.questions. La forma
  -- exacta la valida validateJobAnswers() server-side (helpers.ts); la DB
  -- garantiza array + topes duros (un INSERT directo por PostgREST saltea el
  -- zod de la action: sin esto entraría un jsonb de megas y tumbaría el render
  -- de la bandeja del dueño).
  answers      jsonb not null default '[]'::jsonb
                 check (
                   jsonb_typeof(answers) = 'array'
                   and jsonb_array_length(answers) <= 20
                   and char_length(answers::text) <= 4000
                 ),
  status       text not null default 'submitted'
                 check (status in ('submitted', 'accepted', 'declined', 'withdrawn')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint job_applications_one_per_job unique (job_id, applicant_id)
);

comment on table public.job_applications is
  'Postulación a un aviso de empleo (listings kind=''job''). accepted/declined las marca quien publicó el aviso; withdrawn el postulante. answers guarda las respuestas a listings.attrs.questions y queda congelada después del insert (app.job_applications_freeze).';

comment on column public.job_applications.answers is
  'Array [{questionId, answer}] — answer es boolean (yes_no) o el texto exacto de la opción (multiple_choice). Se valida contra las preguntas REALES del aviso en la server action, nunca contra lo que mande el cliente.';

-- La única lectura por lote es la bandeja del dueño: (tenant, aviso) ordenada
-- por fecha — sin status en el medio, así el índice también aporta el ORDER BY.
-- La lectura del postulante (job_id, applicant_id) la sirve el unique.
create index job_applications_job_idx
  on public.job_applications (tenant_id, job_id, created_at desc);

create trigger job_applications_set_updated_at
before update on public.job_applications
for each row execute function extensions.moddatetime(updated_at);

alter table public.job_applications enable row level security;
alter table public.job_applications force row level security;

-- Ven la postulación SOLO las partes (postulante y dueño del aviso) + staff.
create policy job_applications_select on public.job_applications
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      applicant_id = (select auth.uid())
      or exists (
        select 1 from public.listings l
        where l.id = job_applications.job_id
          and l.tenant_id = job_applications.tenant_id
          and l.created_by = (select auth.uid())
      )
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- Se postula la persona en primera persona, a un aviso published de kind='job'
-- que no sea suyo, sin bloqueo entre las partes.
create policy job_applications_insert on public.job_applications
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and applicant_id = (select auth.uid())
  and status = 'submitted'
  and exists (
    select 1 from public.listings l
    where l.id = job_applications.job_id
      and l.tenant_id = job_applications.tenant_id
      and l.kind = 'job'
      and l.status = 'published'
      and (l.created_by is null or l.created_by <> (select auth.uid()))
      and (l.created_by is null or not app.pair_blocked((select auth.uid()), l.created_by))
  )
);

-- El postulante retira la suya; el dueño del aviso acepta/rechaza las recibidas.
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
        and l.created_by = (select auth.uid())
    )
    or (select app.is_staff())
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
          and l.created_by = (select auth.uid())
      )
      and status in ('accepted', 'declined')
    )
    or (select app.is_staff())
  )
);

-- Solo admins borran. El postulante RETIRA (status='withdrawn'), no borra: si
-- pudiera borrar la fila, se saltearía el unique y re-postularse dispararía
-- otra notificación + email al dueño en loop (y desaparecería la constancia
-- de una postulación ya resuelta).
create policy job_applications_delete on public.job_applications
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- En INSERT y también en UPDATE (patrón 0038/listing_comments): una cuenta
-- suspendida no sigue aceptando/rechazando gente con la voz de la plataforma.
create trigger job_applications_enforce_account_active
before insert on public.job_applications
for each row execute function app.enforce_account_active();

create trigger job_applications_update_enforce_account_active
before update on public.job_applications
for each row execute function app.enforce_account_active();

-- ---------------------------------------------------------------------------
-- Blindaje: lo que escribió el postulante es INMUTABLE
--
-- job_applications_update deja al dueño del aviso hacer UPDATE de la fila para
-- resolverla — pero una policy autoriza FILAS, no COLUMNAS: sin esta guarda
-- podría mandar `update ... set answers = '[]'` y reescribir las respuestas
-- ajenas (o mover la postulación a otro aviso/tenant). Después del INSERT lo
-- único que se mueve es `status` (+ `updated_at`, que pone moddatetime), y
-- SOLO desde 'submitted': una postulación resuelta no vuelve atrás — sin eso
-- el rechazado se re-pone 'submitted' por PostgREST y reaparece en la bandeja
-- del dueño en loop. OJO: el auto-aceptarse lo frena justamente el freeze de
-- job_id (la rama del dueño en la policy mira el job_id de la fila NUEVA);
-- si alguien "simplifica" este trigger, abre esa escalada.
--
-- Bypass solo service_role (seed/moderación). A esta tabla no la escribe
-- ningún trigger interno, así que acá NO va el bypass de pg_trigger_depth de
-- app.protect_listing_counters: dejarlo sería una puerta dormida.
-- ---------------------------------------------------------------------------
create or replace function app.job_applications_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.status is distinct from old.status and old.status <> 'submitted' then
    raise exception 'PROTECTED_TRANSITION: una postulación ya resuelta no vuelve atrás';
  end if;
  if new.answers is distinct from old.answers then
    raise exception 'PROTECTED_COLUMNS: answers no se puede modificar después de postularse';
  end if;
  if new.message is distinct from old.message then
    raise exception 'PROTECTED_COLUMNS: message no se puede modificar después de postularse';
  end if;
  if new.job_id is distinct from old.job_id then
    raise exception 'PROTECTED_COLUMNS: job_id no se puede modificar';
  end if;
  if new.applicant_id is distinct from old.applicant_id then
    raise exception 'PROTECTED_COLUMNS: applicant_id no se puede modificar';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'PROTECTED_COLUMNS: tenant_id no se puede modificar';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'PROTECTED_COLUMNS: created_at no se puede modificar';
  end if;
  if new.id is distinct from old.id then
    raise exception 'PROTECTED_COLUMNS: id no se puede modificar';
  end if;
  return new;
end;
$$;

comment on function app.job_applications_freeze() is
  'Congela lo que escribió el postulante (answers, message, job_id, applicant_id, tenant_id, created_at, id) y hace monótono el status (solo se mueve desde submitted). El UPDATE de job_applications existe SOLO para resolver una postulación pendiente.';

create trigger job_applications_freeze
before update on public.job_applications
for each row execute function app.job_applications_freeze();
