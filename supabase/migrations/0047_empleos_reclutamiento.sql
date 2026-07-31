-- =============================================================================
-- 0047_empleos_reclutamiento.sql — Comunidad Latina
-- EMPLEOS: de "contacto suelto" a FLUJO DE RECLUTAMIENTO (feedback consolidado
-- 2026-07-30 §5).
--
-- 0040 dejó la postulación con lo mínimo: mensaje + respuestas + tres estados.
-- La spec pide el embudo completo (enviada · en revisión · entrevista ·
-- contratado · no seleccionado · vacante cerrada · retirada), currículum
-- adjunto, enlaces de portafolio, nota privada del empleador y una lista de
-- candidatos guardados.
--
-- MIGRACIÓN DEL VOCABULARIO DE ESTADOS (0040 → 0047), literal:
--     submitted  → submitted   (sin cambio)
--     accepted   → hired       ("aceptada" era ambiguo: ¿te leyeron o te tomaron?)
--     declined   → rejected
--     withdrawn  → withdrawn   (sin cambio)
--   NUEVOS: reviewing, interview, closed (la vacante se cerró sin contratar).
--   Verificado antes de escribir esto: en la base sólo hay filas 'submitted' y
--   'withdrawn' (0 en accepted/declined), así que el UPDATE de migración es una
--   red de seguridad, no la operación principal.
--
-- LA DECISIÓN NO OBVIA — POR QUÉ `employer_note` NO ES UNA COLUMNA.
-- La nota del empleador tiene una AUDIENCIA DISTINTA del resto de la fila: el
-- candidato tiene que poder leer su propia postulación y NO tiene que poder leer
-- lo que el empleador escribió sobre él. RLS filtra FILAS, no columnas — no
-- existe un `using` que devuelva la fila con una columna en blanco. Los GRANT
-- por columna tampoco sirven acá: separan por ROL de base de datos, y candidato
-- y empleador llegan los dos como `authenticated`. Una columna cuya visibilidad
-- no se puede expresar es una filtración esperando el SELECT que se olvidó de
-- excluirla. Por eso va en `job_application_notes`, con su propia RLS donde el
-- candidato sencillamente no es sujeto.
-- =============================================================================


-- =============================================================================
-- 1 · El embudo de estados
-- =============================================================================

-- Los datos ANTES de la constraint, si no el ALTER falla contra las filas viejas.
alter table public.job_applications drop constraint job_applications_status_check;

update public.job_applications
   set status = case status
                  when 'accepted' then 'hired'
                  when 'declined' then 'rejected'
                  else status
                end
 where status in ('accepted', 'declined');

alter table public.job_applications
  add constraint job_applications_status_check check (
    status in ('submitted', 'reviewing', 'interview', 'hired', 'rejected', 'withdrawn', 'closed')
  );

comment on column public.job_applications.status is
  'Embudo de reclutamiento. Lo mueve el DUEÑO del aviso (reviewing, interview, hired, rejected, closed) salvo ''withdrawn'', que es del postulante. Avanza en un solo sentido: app.job_applications_freeze rechaza volver atrás (una postulación resuelta no se re-abre; sin eso el rechazado se re-pone en la bandeja del dueño por PostgREST, en loop). Vocabulario migrado desde 0040: accepted→hired, declined→rejected.';


-- =============================================================================
-- 2 · Currículum, portafolio y privacidad del perfil
-- =============================================================================

-- ---------------------------------------------------------------------------
-- app.portfolio_links_ok — validación por ELEMENTO dentro de un CHECK
--
-- Un CHECK no puede llevar subconsulta, así que "cada link mide entre 8 y 300
-- caracteres y empieza con http(s)" no se puede escribir inline. Sí puede llamar
-- a una función IMMUTABLE que recorra su propio argumento (no una tabla), que es
-- lo que hace esta. Sin ella el tope sería sólo la cantidad, y un solo link de
-- 2 MB rompería el render de la bandeja del empleador — el mismo modo de falla
-- que 0040 documentó para `answers`.
-- ---------------------------------------------------------------------------
create or replace function app.portfolio_links_ok(p_links text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_length(p_links, 1), 0) <= 5
     and not exists (
       select 1
         from unnest(coalesce(p_links, '{}'::text[])) as l
        where l is null
           or char_length(l) not between 8 and 300
           or l !~* '^https?://'
     );
$$;

comment on function app.portfolio_links_ok(text[]) is
  'true si el array de enlaces de portafolio cumple: máximo 5, cada uno de 8 a 300 caracteres y con esquema http/https. IMMUTABLE para poder usarse dentro de un CHECK (que no admite subconsultas, pero sí una función que recorra su propio argumento).';

alter table public.job_applications
  add column cv_url text
    check (cv_url is null or char_length(cv_url) <= 400),
  add column portfolio_links text[] not null default '{}'::text[]
    check (app.portfolio_links_ok(portfolio_links)),
  add column share_profile boolean not null default true;

-- El CV vive en un bucket PRIVADO con path {tenant}/{postulante}/archivo. Este
-- CHECK ata la fila a ese path: aunque alguien mandara por PostgREST el
-- cv_url de OTRA persona, la fila no entra. Sin esto, `cv_url` sería un puntero
-- libre a cualquier objeto del bucket y la policy de Storage —que autoriza al
-- dueño del aviso a leer "el CV de quien se postuló"— se convertiría en un
-- oráculo para leer CVs ajenos.
alter table public.job_applications
  add constraint job_applications_cv_path check (
    cv_url is null
    or cv_url like (tenant_id::text || '/' || applicant_id::text || '/%')
  );

comment on column public.job_applications.cv_url is
  'RUTA dentro del bucket privado `job-cvs`, NO una URL pública: {tenant_id}/{applicant_id}/{archivo}. La forma la exige job_applications_cv_path — de ese CHECK depende que la policy de Storage del empleador no se convierta en un lector de CVs ajenos. La app sirve el archivo con una signed URL de vida corta; jamás construye una URL pública.';
comment on column public.job_applications.portfolio_links is
  'Hasta 5 enlaces http/https de 8 a 300 caracteres (app.portfolio_links_ok). Congelados después del insert, igual que `answers` y `message`.';
comment on column public.job_applications.share_profile is
  'Autocompletado desde el perfil (nombre, foto, ciudad, idiomas, Trust Score). true = el empleador ve esos datos junto a la postulación. Es la ÚNICA columna del postulante que sigue siendo editable después de postularse, y SÓLO por el postulante: retirar el consentimiento de mostrar tu perfil es un derecho, no una edición de contenido. La base garantiza quién puede moverla; que la pantalla del empleador respete el false es responsabilidad de la app.';


-- =============================================================================
-- 3 · job_application_notes — la nota privada del empleador
-- =============================================================================

create table public.job_application_notes (
  tenant_id      uuid not null references public.tenants(id),
  application_id uuid not null references public.job_applications(id) on delete cascade,
  -- Autor = quien publicó el aviso (o el admin del dominio en avisos de la
  -- plataforma). Se guarda explícito y no se deduce del listing: si mañana un
  -- aviso pasa a tener varios administradores, cada uno escribe la suya.
  author_id      uuid not null references public.profiles(id) on delete cascade,
  note           text not null check (char_length(note) between 1 and 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Sin columna `id`: la PK ES la unicidad (una nota por evaluador y candidatura),
  -- mismo criterio que post_views (0038) y post_poll_votes (0041).
  constraint job_application_notes_one_per_author primary key (application_id, author_id)
);

comment on table public.job_application_notes is
  'Nota PRIVADA de quien evalúa sobre una postulación. Tabla aparte y no columna de job_applications porque la audiencia es distinta: el candidato lee su postulación y NO puede leer esto, y la RLS filtra filas, no columnas (los GRANT por columna tampoco sirven: candidato y empleador llegan los dos como `authenticated`). Acá el candidato directamente no es sujeto de ninguna policy.';
comment on column public.job_application_notes.note is
  'Texto libre de hasta 2000 caracteres. NUNCA se muestra al candidato ni viaja en ninguna respuesta que él pueda pedir.';

-- La lectura real es "las notas de las postulaciones de MI aviso": el join
-- entra por application_id, que ya es el primer campo de la PK. Sin índice extra.

create trigger job_application_notes_set_updated_at
before update on public.job_application_notes
for each row execute function extensions.moddatetime(updated_at);

create trigger job_application_notes_enforce_account_active
before insert on public.job_application_notes
for each row execute function app.enforce_account_active();

alter table public.job_application_notes enable row level security;
alter table public.job_application_notes force row level security;

-- Sólo el AUTOR de la nota, y sólo si sigue siendo quien puede ver esa
-- postulación. La condición de acceso es la MISMA de job_applications_select
-- (0042): la propiedad del aviso decide, no el rol — un moderador no entra y un
-- global_admin tampoco lee las notas de un aviso ajeno.
create policy job_application_notes_select on public.job_application_notes
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and exists (
    select 1
      from public.job_applications a
      join public.listings l
        on l.id = a.job_id
       and l.tenant_id = a.tenant_id
     where a.id = job_application_notes.application_id
       and a.tenant_id = job_application_notes.tenant_id
       and (
         l.created_by = (select auth.uid())
         or (
           l.created_by is null
           and (select app.current_user_role()) in ('domain_admin', 'global_admin')
         )
       )
  )
);

create policy job_application_notes_insert on public.job_application_notes
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and exists (
    select 1
      from public.job_applications a
      join public.listings l
        on l.id = a.job_id
       and l.tenant_id = a.tenant_id
     where a.id = job_application_notes.application_id
       and a.tenant_id = job_application_notes.tenant_id
       -- El postulante NO puede escribirse una nota sobre sí mismo: la nota es
       -- del evaluador, y si el postulante pudiera crear la fila se quedaría
       -- con la única que la PK permite para ese author_id.
       and a.applicant_id <> (select auth.uid())
       and (
         l.created_by = (select auth.uid())
         or (
           l.created_by is null
           and (select app.current_user_role()) in ('domain_admin', 'global_admin')
         )
       )
  )
);

create policy job_application_notes_update on public.job_application_notes
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
);

create policy job_application_notes_delete on public.job_application_notes
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
);


-- =============================================================================
-- 4 · saved_candidates — "me sirve para otra vacante"
-- =============================================================================

create table public.saved_candidates (
  tenant_id             uuid not null references public.tenants(id),
  employer_id           uuid not null references public.profiles(id) on delete cascade,
  candidate_id          uuid not null references public.profiles(id) on delete cascade,
  -- Desde qué postulación se lo guardó. on delete set null: si esa candidatura
  -- se borra, el candidato guardado NO desaparece — el punto de guardarlo es
  -- justamente que sobreviva a la vacante que lo trajo.
  source_application_id uuid references public.job_applications(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint saved_candidates_one_per_pair primary key (employer_id, candidate_id),
  constraint saved_candidates_no_self check (employer_id <> candidate_id)
);

comment on table public.saved_candidates is
  'Candidatos que un empleador guardó para futuras vacantes. UNILATERAL Y PRIVADO: el candidato NUNCA sabe que lo guardaron — no hay rama de select para él, ni para staff (mismo criterio que saves 0038 y post_poll_votes 0041). Que a alguien "lo estén mirando" no es información que la plataforma tenga por qué revelar, y publicarla convertiría una lista de trabajo en una señal social.';
comment on column public.saved_candidates.source_application_id is
  'Postulación desde la que se guardó, si vino de una. NULL cuando la candidatura original se borró (on delete set null) o cuando se guardó desde el perfil.';

-- La pantalla lista "mis candidatos guardados", los últimos primero.
create index saved_candidates_employer_idx
  on public.saved_candidates (tenant_id, employer_id, created_at desc);
-- Existe por el ON DELETE CASCADE desde profiles: sin él, borrar una cuenta
-- (§5.4, derecho a borrarse) escanea la tabla entera por esta FK.
create index saved_candidates_candidate_idx on public.saved_candidates (candidate_id);

create trigger saved_candidates_enforce_account_active
before insert on public.saved_candidates
for each row execute function app.enforce_account_active();

alter table public.saved_candidates enable row level security;
alter table public.saved_candidates force row level security;

create policy saved_candidates_select on public.saved_candidates
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and employer_id = (select auth.uid())
);

-- Guardar en primera persona, a alguien de MI comunidad y sin bloqueo entre
-- las partes (pair_blocked es security definer: ve las dos direcciones sin
-- revelar quién bloqueó a quién).
create policy saved_candidates_insert on public.saved_candidates
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and employer_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
     where p.id = saved_candidates.candidate_id
       and p.tenant_id = saved_candidates.tenant_id
  )
  and not app.pair_blocked((select auth.uid()), saved_candidates.candidate_id)
);

-- Existe para poder re-apuntar source_application_id; el par (empleador,
-- candidato) es la PK y no se mueve.
create policy saved_candidates_update on public.saved_candidates
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and employer_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and employer_id = (select auth.uid())
);

create policy saved_candidates_delete on public.saved_candidates
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and employer_id = (select auth.uid())
);


-- =============================================================================
-- 5 · Blindaje: el freeze de 0040, extendido
--
-- Dos cambios sobre app.job_applications_freeze:
--
--   (a) COLUMNAS NUEVAS. `cv_url` y `portfolio_links` son contenido del
--       postulante, exactamente como `answers` y `message`: el dueño del aviso
--       tiene UPDATE sobre la fila para resolverla, y sin congelarlas podría
--       reescribir el currículum ajeno. `share_profile` es distinta — es el
--       consentimiento del postulante, así que la mueve ÉL y nadie más.
--
--   (b) EL EMBUDO. 0040 sólo permitía moverse desde 'submitted' (había tres
--       estados y ninguno intermedio). Ahora hay un recorrido real, y la regla
--       es que AVANCE: se le da un rango a cada estado y sólo se admite subir.
--       Así reviewing → interview → hired funciona, y hired → submitted (que es
--       lo que devuelve a la bandeja a alguien ya resuelto, en loop) no.
--       Los cuatro estados terminales comparten rango, así que ninguno pasa a
--       otro: contratado no se convierte en rechazado, y retirado no se
--       convierte en nada.
-- =============================================================================
create or replace function app.job_applications_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- submitted(1) → reviewing(2) → interview(3) → terminales(4).
  v_rank constant jsonb := '{"submitted":1,"reviewing":2,"interview":3,"hired":4,"rejected":4,"withdrawn":4,"closed":4}'::jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if (v_rank ->> new.status)::int <= (v_rank ->> old.status)::int then
      raise exception 'PROTECTED_TRANSITION: una postulación sólo avanza — no vuelve a un estado anterior ni cambia de resultado';
    end if;
  end if;

  if new.answers is distinct from old.answers then
    raise exception 'PROTECTED_COLUMNS: answers no se puede modificar después de postularse';
  end if;
  if new.message is distinct from old.message then
    raise exception 'PROTECTED_COLUMNS: message no se puede modificar después de postularse';
  end if;
  if new.cv_url is distinct from old.cv_url then
    raise exception 'PROTECTED_COLUMNS: cv_url no se puede modificar después de postularse';
  end if;
  if new.portfolio_links is distinct from old.portfolio_links then
    raise exception 'PROTECTED_COLUMNS: portfolio_links no se puede modificar después de postularse';
  end if;
  -- Consentimiento, no contenido: lo retira quien lo dio.
  if new.share_profile is distinct from old.share_profile
     and new.applicant_id is distinct from auth.uid() then
    raise exception 'PROTECTED_COLUMNS: share_profile sólo lo cambia el postulante';
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
  'Congela lo que escribió el postulante (answers, message, cv_url, portfolio_links, job_id, applicant_id, tenant_id, created_at, id) y hace que el embudo sólo AVANCE: submitted(1) → reviewing(2) → interview(3) → terminal(4: hired|rejected|withdrawn|closed), sin retrocesos ni cambios entre terminales. share_profile es la excepción: es consentimiento del postulante y sólo él lo mueve.';


-- ---------------------------------------------------------------------------
-- Re-creación de job_applications_update (base: 0042) con el vocabulario nuevo
--
-- El `using` no cambia una coma respecto de 0042 (la propiedad del aviso decide,
-- no el rol). Lo que cambia es el WITH CHECK: el postulante sigue pudiendo sólo
-- retirarse, y quien evalúa pasa de ('accepted','declined') al embudo completo.
-- El ORDEN de los pasos lo sigue poniendo el freeze de arriba: la policy dice
-- QUIÉN puede escribir qué estado, el trigger dice DESDE DÓNDE.
-- ---------------------------------------------------------------------------
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
      and status in ('reviewing', 'interview', 'hired', 'rejected', 'closed')
    )
  )
);


-- =============================================================================
-- 6 · Storage: bucket PRIVADO `job-cvs`
--
-- Path canónico: {tenant_id}/{applicant_id}/{archivo} — espejo de avatars (0012)
-- y post-media (0025).
--
-- public = FALSE, y esta vez importa de verdad: en los buckets públicos el
-- objeto se sirve por /object/public/ salteando RLS. Un currículum tiene
-- nombre, teléfono, domicilio y trayectoria laboral de una persona: si el bucket
-- fuera público, la URL sería la autorización. La app tiene que servirlo con
-- signed URL de vida corta.
--
-- Quién LEE: el postulante (es suyo) y el dueño del aviso al que se postuló —
-- y esa segunda rama es exactamente por qué job_applications_cv_path existe: la
-- policy pregunta "¿hay una postulación a un aviso mío cuyo cv_url sea este
-- objeto?", así que si `cv_url` pudiera apuntar a cualquier objeto, publicar un
-- aviso y postularse a él mismo apuntando al CV de otro sería un lector
-- universal. El CHECK cierra esa puerta en la otra punta.
--
-- Se aplica por migración: probado contra esta base que el rol de migraciones
-- SÍ puede crear policies en storage.objects en este proyecto (a diferencia del
-- precedente de supabase/manual/harden-storage-listing.sql). Si en otro entorno
-- fallara con "must be owner of relation objects", esta sección se corre tal
-- cual desde el SQL Editor del Dashboard.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('job-cvs', 'job-cvs', false)
on conflict (id) do update set public = false;

create policy job_cvs_select on storage.objects
for select to authenticated
using (
  bucket_id = 'job-cvs'
  and (
    -- el dueño del archivo
    (storage.foldername(name))[2] = (select auth.uid())::text
    -- o quien publicó el aviso al que ese CV se postuló
    or exists (
      select 1
        from public.job_applications a
        join public.listings l
          on l.id = a.job_id
         and l.tenant_id = a.tenant_id
       where a.cv_url = storage.objects.name
         and l.created_by = (select auth.uid())
    )
  )
);

create policy job_cvs_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'job-cvs'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

-- Reemplazar el archivo: sólo su dueño. El empleador jamás escribe acá.
create policy job_cvs_update on storage.objects
for update to authenticated
using (
  bucket_id = 'job-cvs'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'job-cvs'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy job_cvs_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'job-cvs'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);
