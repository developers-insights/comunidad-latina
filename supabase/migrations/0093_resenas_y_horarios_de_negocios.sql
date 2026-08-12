-- =============================================================================
-- 0093_resenas_y_horarios_de_negocios.sql — Comunidad Latina
--
-- LAS DOS SECCIONES QUE LA FICHA DE UN NEGOCIO MOSTRABA VACÍAS
-- -----------------------------------------------------------------------------
-- `src/app/(app)/negocios/[id]/page.tsx` lo decía con todas las letras: horarios
-- de atención y reseñas de negocios no los guardaba NINGUNA tabla del esquema.
-- La única tabla de reseñas era `gig_reviews` (0024), que es del Creator
-- Marketplace y califica personas dentro de un contrato — no tiene nada que ver
-- con un negocio del directorio. Esta migración crea lo que faltaba.
--
-- Alcance: `listings` de kind 'business' y 'professional'. Son las dos verticales
-- donde alguien atiende público y donde el contrato pide reseñas y horarios.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 1 — EL AGREGADO DE PUNTAJE VIVE EN UNA TABLA APARTE, MANTENIDA POR
-- TRIGGER (y no se calcula por render)
-- -----------------------------------------------------------------------------
-- El precedente es `gig_reviews` → `creator_profiles.rating_avg/rating_count`:
-- el promedio no se recalcula al leer, lo escribe un trigger después de cada
-- reseña. Se sigue ese precedente en la IDEA y se cambia el LUGAR.
--
-- Por qué NO en columnas de `listings`: `listings` es la tabla más policiada del
-- esquema (0004 + 0022 + 0042 + 0053 + 0075) y es actualizable por su dueño.
-- Meterle dos columnas de reputación obliga a un trigger de guarda —como
-- `app.protect_creator_reputation()`— para que nadie se infle el promedio
-- editando su propio aviso, y suma superficie a la tabla que menos conviene
-- tocar. Una tabla satélite con INSERT/UPDATE/DELETE en `false` para todo JWT de
-- usuario no necesita guarda: no hay forma de escribirla desde la app.
--
-- Por qué NO una vista: el listado de Negocios pinta N tarjetas. Una vista con
-- `avg()` obliga a agregar sobre `listing_reviews` en cada render del listado;
-- la tabla satélite se lee con un solo `in (…)` de N claves primarias. El costo
-- se paga una vez al escribir la reseña, que es el evento raro, en vez de en
-- cada lectura, que es el evento constante.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 2 — EL HORARIO ES UNA TABLA DE TRAMOS, NO SIETE COLUMNAS DE TEXTO
-- -----------------------------------------------------------------------------
-- Siete columnas `lunes text`, `martes text`… no soportan lo único que de verdad
-- pasa en un negocio de barrio: el corte del mediodía. "9:00-13:00 y 16:00-20:00"
-- terminaría siendo un string que nadie puede consultar, ni comparar, ni usar
-- para responder "¿está abierto ahora?". Con una fila por TRAMO:
--
--   · cerrado       → el día no tiene ninguna fila (la ausencia es el dato)
--   · corte de mediodía → dos filas del mismo día
--   · cruce de medianoche → `closes_at < opens_at` (20:00 → 02:00)
--   · abierto 24 h  → 00:00 → 24:00 (Postgres admite `time '24:00:00'`)
--
-- `opens_at = closes_at` queda PROHIBIDO por CHECK: sería ambiguo entre "cero
-- minutos" y "veinticuatro horas", y esa ambigüedad la termina resolviendo mal
-- alguien seis meses después.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 3 — EL HORARIO SE INTERPRETA EN LA ZONA DEL NEGOCIO
-- -----------------------------------------------------------------------------
-- La 0067 puso la zona horaria en `profiles` porque una FECHA se lee con el
-- reloj de quien mira. Un HORARIO DE ATENCIÓN es al revés: "abrimos a las 9" es
-- 9 de la mañana en la vereda del local, y alguien que mira desde Los Ángeles un
-- negocio de Nueva York tiene que ver "9:00" igual, no "6:00". Por eso la zona
-- del negocio es obligatoria y vive en `listing_hours`, que además es lo que
-- hace posible resolver "¿está abierto AHORA?" sin adivinar.
--
-- `listing_hours` (una fila por aviso, con la zona) es el padre de
-- `listing_hours_slots` (los tramos). El FK garantiza el invariante que importa:
-- NUNCA puede haber tramos sin zona horaria que los interprete.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 4 — NO SE TOCA EL MOTOR DE SCORE
-- -----------------------------------------------------------------------------
-- `app.recalc_business_score()` (0037) tiene el factor de reseñas en 0 con un
-- comentario que dice "se cablea en Fase 2". Acá se deja LISTA la función que
-- calcula ese factor (`app.listing_reviews_score_factor`) y NO se cambia el
-- motor: enganchar reseñas al Business Score mueve scores vigentes de producción
-- y eso merece su propia migración, con su propio backfill y su propio aviso.
--
-- -----------------------------------------------------------------------------
-- GRANTS EXPLÍCITOS (0085)
-- -----------------------------------------------------------------------------
-- Los default privileges de `public` en esta base están rotos para `anon`: una
-- tabla nueva NACE sin acceso. Sin `grant select` la RLS ni se evalúa y la app
-- se ve vacía SIN errores. Cada tabla de acá abajo termina con su grant escrito
-- a mano, y eso no es ceremonia: es el bug de la 0085 esperando repetirse.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Helpers de permiso
-- ---------------------------------------------------------------------------

/**
 * ¿Puede ESTA persona administrar ESTE aviso? Es el predicado que decide quién
 * carga el horario y quién responde una reseña.
 *
 * Dos caminos, los dos ya existentes en el esquema:
 *   1. es quien publicó el aviso (`listings.created_by`), o
 *   2. es miembro ACTIVO del negocio que cuelga de ese aviso, con rol de
 *      gestión (`business_members`, 0031 — propietario/administrador/editor).
 *
 * `atencion` y `analista` quedan afuera a propósito: son roles de operación y de
 * lectura, y publicar el horario o contestarle a un cliente en público es voz
 * del negocio.
 */
create or replace function app.can_manage_listing(p_listing uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and (
    exists (
      select 1 from public.listings l
       where l.id = p_listing
         and l.created_by = p_profile
    )
    or exists (
      select 1
        from public.business_accounts ba
        join public.business_members bm on bm.business_id = ba.id
       where ba.listing_id = p_listing
         and bm.profile_id = p_profile
         and bm.status = 'active'
         and bm.role in ('propietario', 'administrador', 'editor')
    )
  );
$$;

comment on function app.can_manage_listing(uuid, uuid) is
  'true si el perfil publicó el aviso o es miembro activo del negocio con rol de gestión (propietario/administrador/editor, 0031). Decide quién edita el horario y quién responde reseñas. security definer para poder usarse dentro de policies sin recursión.';

revoke execute on function app.can_manage_listing(uuid, uuid) from public, anon;
grant execute on function app.can_manage_listing(uuid, uuid) to authenticated, service_role;

/**
 * El mismo predicado, preguntable desde la app. PostgREST sólo expone `public`,
 * así que sin este envoltorio la UI tendría que reconstruir la regla leyendo
 * `business_accounts` y `business_members` por su cuenta — y ahí empieza la
 * deriva entre lo que la pantalla muestra y lo que la RLS permite.
 *
 * No toma el perfil por parámetro A PROPÓSITO: sale de `auth.uid()`. Una
 * función que acepta "¿puede administrar Fulano?" es un enumerador de permisos
 * ajenos servido en bandeja.
 */
create or replace function public.puedo_administrar_aviso(p_listing uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_manage_listing(p_listing, (select auth.uid()));
$$;

comment on function public.puedo_administrar_aviso(uuid) is
  'Envoltorio en public de app.can_manage_listing() para el usuario de la sesión. Lo consume la UI para decidir si muestra el botón de responder una reseña y el editor de horarios. Nunca acepta el perfil por parámetro: eso sería un enumerador de permisos ajenos.';

revoke all    on function public.puedo_administrar_aviso(uuid) from public, anon;
grant execute on function public.puedo_administrar_aviso(uuid) to authenticated, service_role;

/**
 * ¿Puede ESTA persona reseñar ESTE aviso?
 *
 * ACÁ VIVE LA DEFENSA QUE MÁS IMPORTA: no se reseña el negocio propio. Y no
 * alcanza con mirar `created_by` — un negocio puede tener varios administradores
 * (0031), y cualquiera de ellos poniéndose cinco estrellas es exactamente el
 * mismo fraude. Por eso se excluye a TODO miembro activo, con cualquier rol.
 *
 * Va en la base y no sólo en la UI porque la UI no es una defensa: el endpoint
 * de PostgREST está abierto a cualquiera con un token válido.
 */
create or replace function app.can_review_listing(p_listing uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and exists (
    select 1
      from public.listings l
     where l.id = p_listing
       and l.kind in ('business', 'professional')
       and l.status = 'published'
       and l.tenant_id = (select app.current_tenant_id())
       and l.created_by is distinct from p_profile
       and not exists (
         select 1
           from public.business_accounts ba
           join public.business_members bm on bm.business_id = ba.id
          where ba.listing_id = l.id
            and bm.profile_id = p_profile
            and bm.status = 'active'
       )
  );
$$;

comment on function app.can_review_listing(uuid, uuid) is
  'true si el perfil puede dejar una reseña del aviso: es de kind business/professional, está published, es de SU comunidad, y la persona no es ni quien lo publicó ni miembro activo del negocio. "No reseñás tu propio negocio" se resuelve acá, en la base — la UI sola no es una defensa.';

revoke execute on function app.can_review_listing(uuid, uuid) from public, anon;
grant execute on function app.can_review_listing(uuid, uuid) to authenticated, service_role;

-- ===========================================================================
-- A. RESEÑAS
-- ===========================================================================

create table public.listing_reviews (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants(id),
  listing_id     uuid not null references public.listings(id) on delete cascade,
  author_id      uuid not null references public.profiles(id) on delete cascade,
  rating         int  not null check (rating between 1 and 5),
  body           text check (body is null or char_length(body) <= 1000),
  -- Respuesta del dueño: UNA sola, editable. Va en la misma fila y no en una
  -- tabla aparte porque es 1:1 con la reseña y SIEMPRE se muestra pegada a
  -- ella — una tabla más sería un join en cada lectura para no ganar nada.
  -- Quién puede escribir QUÉ columna lo resuelve el trigger de guarda de abajo.
  owner_reply    text check (owner_reply is null or char_length(owner_reply) <= 1000),
  owner_reply_by uuid references public.profiles(id) on delete set null,
  owner_reply_at timestamptz,
  status         text not null default 'published'
                   check (status in ('published', 'hidden')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- UNA reseña por persona por aviso. Es el piso de todo lo demás: sin esto,
  -- diez reseñas del mismo usuario son diez estrellas.
  constraint listing_reviews_one_per_author unique (listing_id, author_id),
  -- Una respuesta o ninguna, pero nunca a medias (texto sin autor ni fecha).
  constraint listing_reviews_reply_completa check (
    (owner_reply is null and owner_reply_by is null and owner_reply_at is null)
    or (owner_reply is not null and owner_reply_by is not null and owner_reply_at is not null)
  )
);

comment on table public.listing_reviews is
  'Reseñas de avisos de Negocios y Profesionales. Una por persona por aviso (índice único), editable por su autor y NUNCA por el negocio. Quién puede reseñar lo decide app.can_review_listing() —que excluye al dueño y a los miembros del negocio—; qué columna puede tocar cada parte lo decide el trigger listing_reviews_guard_columns. El promedio NO se calcula al leer: lo mantiene listing_review_stats por trigger. Se reporta con public.report_listing_review(), que escribe en scam_reports (0005) — no hay una segunda cola de reportes.';
comment on column public.listing_reviews.status is
  'published | hidden. hidden lo escribe la moderación (service_role/staff): una reseña ocultada sigue existiendo para su autor y deja de contar en el promedio.';
comment on column public.listing_reviews.owner_reply is
  'Respuesta pública del negocio. Es lo que vuelve útil el sistema para quien lo recibe: una reseña sin derecho a réplica es un pizarrón, no una conversación.';

create index listing_reviews_listing_idx
  on public.listing_reviews (listing_id, status, created_at desc);
create index listing_reviews_author_idx
  on public.listing_reviews (tenant_id, author_id, created_at desc);

create trigger listing_reviews_set_updated_at
before update on public.listing_reviews
for each row execute function extensions.moddatetime(updated_at);

create trigger listing_reviews_enforce_account_active
before insert on public.listing_reviews
for each row execute function app.enforce_account_active();

/**
 * GUARDA DE COLUMNAS — el reparto de poder dentro de una misma fila.
 *
 * Dos actores distintos actualizan esta fila y no pueden pisarse:
 *   · el AUTOR corrige su puntaje y su texto, y no toca la respuesta del negocio;
 *   · el NEGOCIO escribe y edita su respuesta, y no toca ni el puntaje ni el
 *     texto de quien lo calificó.
 *
 * Una policy de RLS no distingue columnas, así que esto va por trigger — el
 * mismo patrón que `app.protect_creator_reputation()` (0024). `owner_reply_by`
 * y `owner_reply_at` se derivan acá y se ignora lo que mande el cliente: la
 * autoría de una respuesta no se acepta por parámetro.
 */
create or replace function app.listing_reviews_guard_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- El backoffice (service_role) y el staff moderan sin estas restricciones.
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role'
     or app.is_staff() then
    return new;
  end if;

  -- Identidad y pertenencia son inmutables para todos.
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.listing_id is distinct from old.listing_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'RESENA_INMUTABLE: no se puede mover una reseña de aviso, de autor ni de comunidad';
  end if;

  if v_uid = old.author_id then
    -- El autor edita lo suyo. La respuesta del negocio queda intacta.
    if new.owner_reply    is distinct from old.owner_reply
       or new.owner_reply_by is distinct from old.owner_reply_by
       or new.owner_reply_at is distinct from old.owner_reply_at then
      raise exception 'RESPUESTA_AJENA: la respuesta del negocio no la edita quien reseñó';
    end if;
    if new.status is distinct from old.status then
      raise exception 'ESTADO_MODERADO: el estado de una reseña lo cambia la moderación';
    end if;
    return new;
  end if;

  -- No es el autor: sólo puede estar respondiendo, y sólo si administra el aviso.
  if not app.can_manage_listing(old.listing_id, v_uid) then
    raise exception 'RESENA_AJENA: sólo quien la escribió puede editar una reseña';
  end if;

  if new.rating is distinct from old.rating
     or new.body is distinct from old.body
     or new.status is distinct from old.status then
    raise exception 'PUNTAJE_AJENO: el negocio responde la reseña, no la corrige';
  end if;

  -- La autoría y la fecha de la respuesta las pone la base, no el cliente.
  if new.owner_reply is null then
    new.owner_reply_by := null;
    new.owner_reply_at := null;
  else
    new.owner_reply_by := v_uid;
    new.owner_reply_at := case
      when old.owner_reply is distinct from new.owner_reply then now()
      else coalesce(old.owner_reply_at, now())
    end;
  end if;

  return new;
end;
$$;

comment on function app.listing_reviews_guard_columns() is
  'BEFORE UPDATE de listing_reviews: el autor edita puntaje y texto pero no la respuesta del negocio; el negocio edita su respuesta pero no el puntaje ajeno; nadie mueve la reseña de aviso, de autor ni de comunidad. owner_reply_by/at se derivan del JWT. RLS no distingue columnas — por eso esto es un trigger (patrón app.protect_creator_reputation, 0024).';

create trigger listing_reviews_guard_columns
before update on public.listing_reviews
for each row execute function app.listing_reviews_guard_columns();

-- ---------------------------------------------------------------------------
-- listing_review_stats — el agregado que evita el N+1 (ver DECISIÓN 1)
-- ---------------------------------------------------------------------------
create table public.listing_review_stats (
  listing_id   uuid primary key references public.listings(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id),
  rating_avg   numeric(3,2) check (rating_avg is null or (rating_avg >= 1 and rating_avg <= 5)),
  rating_count int not null default 0 check (rating_count >= 0),
  updated_at   timestamptz not null default now()
);

comment on table public.listing_review_stats is
  'Promedio y cantidad de reseñas por aviso, MANTENIDO POR TRIGGER (patrón creator_profiles.rating_avg, 0024). Existe para que el listado de Negocios lea N promedios con un solo `in (…)` de claves primarias en vez de agregar sobre listing_reviews en cada render. Ningún JWT de usuario la escribe: insert/update/delete están en false y el trigger corre como definer.';
comment on column public.listing_review_stats.rating_avg is
  'null cuando no hay reseñas publicadas. null es "todavía nadie opinó", que NO es lo mismo que 0 — y en la UI se muestra como ausencia, jamás como cero estrellas.';

create index listing_review_stats_tenant_idx
  on public.listing_review_stats (tenant_id, rating_avg desc nulls last);

create or replace function app.refresh_listing_review_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing uuid := coalesce(new.listing_id, old.listing_id);
  v_tenant  uuid := coalesce(new.tenant_id, old.tenant_id);
  v_avg     numeric(3,2);
  v_count   int;
begin
  select round(avg(r.rating)::numeric, 2), count(*)::int
    into v_avg, v_count
    from public.listing_reviews r
   where r.listing_id = v_listing
     and r.status = 'published';

  insert into public.listing_review_stats as s (listing_id, tenant_id, rating_avg, rating_count, updated_at)
  values (v_listing, v_tenant, v_avg, coalesce(v_count, 0), now())
  on conflict (listing_id) do update
    set rating_avg   = excluded.rating_avg,
        rating_count = excluded.rating_count,
        updated_at   = excluded.updated_at;

  return null;
end;
$$;

comment on function app.refresh_listing_review_stats() is
  'Recalcula listing_review_stats del aviso afectado después de cada alta, edición, ocultamiento o baja de reseña. Sólo cuentan las published: ocultar una reseña la saca del promedio sin borrarla.';

create trigger listing_reviews_refresh_stats
after insert or update or delete on public.listing_reviews
for each row execute function app.refresh_listing_review_stats();

-- ---------------------------------------------------------------------------
-- RLS de reseñas
-- ---------------------------------------------------------------------------
alter table public.listing_reviews enable row level security;
alter table public.listing_reviews force row level security;

/**
 * LECTURA — "quien ve el negocio, ve sus reseñas".
 *
 * El `exists` sobre `listings` NO lleva un chequeo de tenant escrito a mano a
 * propósito: la RLS de `listings` se evalúa dentro de esa subconsulta, así que
 * el alcance de las reseñas queda atado, por construcción, al alcance del aviso.
 * Si mañana cambia qué avisos ve quién, las reseñas siguen la misma regla sin
 * que haya que acordarse de tocar dos lugares.
 */
create policy listing_reviews_select on public.listing_reviews
for select to anon, authenticated
using (
  status = 'published'
  and exists (select 1 from public.listings l where l.id = listing_reviews.listing_id)
);

-- Y su propia reseña se ve siempre, aunque la moderación la haya ocultado:
-- que desaparezca sin decir nada es peor que decir que está en revisión.
create policy listing_reviews_select_propia on public.listing_reviews
for select to authenticated
using (
  (tenant_id = (select app.current_tenant_id()) and author_id = (select auth.uid()))
  or (select app.is_staff())
  or (select app.is_global_admin())
);

create policy listing_reviews_insert on public.listing_reviews
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status = 'published'
  and owner_reply is null
  and owner_reply_by is null
  and owner_reply_at is null
  and app.can_review_listing(listing_id, (select auth.uid()))
);

-- El autor edita SU reseña. Qué columnas puede tocar lo cierra el trigger.
create policy listing_reviews_update_autor on public.listing_reviews
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
);

-- El negocio responde. Misma fila, otras columnas, otro trigger de guarda.
create policy listing_reviews_update_negocio on public.listing_reviews
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and app.can_manage_listing(listing_id, (select auth.uid()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and app.can_manage_listing(listing_id, (select auth.uid()))
);

create policy listing_reviews_update_staff on public.listing_reviews
for update to authenticated
using ((select app.is_staff()) or (select app.is_global_admin()))
with check ((select app.is_staff()) or (select app.is_global_admin()));

-- Borrar: SÓLO la propia (o staff). El negocio jamás borra una reseña que no le
-- gustó — puede responderla, que es otra cosa.
create policy listing_reviews_delete on public.listing_reviews
for delete to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (author_id = (select auth.uid()) or (select app.is_staff()))
  )
  or (select app.is_global_admin())
);

alter table public.listing_review_stats enable row level security;
alter table public.listing_review_stats force row level security;

-- El agregado es público como las estrellas de cualquier directorio.
create policy listing_review_stats_select on public.listing_review_stats
for select to anon, authenticated
using (true);

-- Nadie lo escribe desde la app: lo escribe el trigger, que corre como definer.
create policy listing_review_stats_insert on public.listing_review_stats
for insert to authenticated with check (false);
create policy listing_review_stats_update on public.listing_review_stats
for update to authenticated using (false) with check (false);
create policy listing_review_stats_delete on public.listing_review_stats
for delete to authenticated using (false);

-- GRANTS (0085): sin esto la policy ni se evalúa y la sección se ve vacía.
revoke all on table public.listing_reviews from anon, authenticated;
grant select                         on table public.listing_reviews to anon;
grant select, insert, update, delete on table public.listing_reviews to authenticated;
grant all                            on table public.listing_reviews to service_role;

revoke all on table public.listing_review_stats from anon, authenticated;
grant select on table public.listing_review_stats to anon, authenticated;
grant all    on table public.listing_review_stats to service_role;

-- ---------------------------------------------------------------------------
-- Reportar una reseña — sobre scam_reports (0005), no una cola nueva
-- ---------------------------------------------------------------------------

/**
 * `scam_reports.target_kind` nació con tres valores. Se le suma 'review' en vez
 * de crear `listing_review_reports`: la cola de moderación, el peso derivado del
 * Trust Score del reportante (`app.scam_report_set_weight`), la purga a 365 días
 * (0013) y los contadores del panel de dominio ya existen y funcionan. Una
 * segunda tabla sería una segunda cola que nadie mira.
 *
 * El CHECK es anónimo en 0005, así que se busca por catálogo — el mismo
 * procedimiento que usó la 0024 con `listings.kind`.
 */
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.scam_reports'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%target_kind%';
  if v_name is not null then
    execute format('alter table public.scam_reports drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.scam_reports
  add constraint scam_reports_target_kind_check
  check (target_kind in ('listing', 'profile', 'message', 'review'));

comment on column public.scam_reports.target_kind is
  'listing | profile | message | review. "review" (0093) apunta a listing_reviews.id y entra por public.report_listing_review(); el resto sigue entrando por public.report_scam().';

/**
 * Por qué una RPC nueva y no una rama más en `report_scam` (0014): esa función
 * la usan hoy el Escudo y Mensajes. Reescribirla entera para sumar un `elsif`
 * es tocar dos flujos en producción para agregar un tercero. Esta escribe en la
 * MISMA tabla, así que hereda el trigger de peso y la cola de moderación sin
 * pedirle nada al código existente.
 */
create or replace function public.report_listing_review(
  p_review_id uuid,
  p_reason    text,
  p_details   text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid := app.current_tenant_id();
  v_report_id uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para reportar.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: contanos brevemente qué pasó.';
  end if;

  if not exists (
    select 1 from public.listing_reviews r
     where r.id = p_review_id
       and r.tenant_id = v_tenant
  ) then
    raise exception 'TARGET_NOT_FOUND: esa reseña no existe en tu comunidad.';
  end if;

  -- weight lo fija app.scam_report_set_weight() según el Trust Score de quien
  -- reporta: acá no se acepta peso del cliente, igual que en report_scam.
  insert into public.scam_reports (tenant_id, reporter_id, target_kind, target_id, reason, details)
  values (v_tenant, v_uid, 'review', p_review_id, btrim(p_reason), nullif(btrim(p_details), ''))
  returning id into v_report_id;

  return v_report_id;
end;
$$;

comment on function public.report_listing_review(uuid, text, text) is
  'Reporta una reseña de aviso hacia scam_reports (0005). Existe en vez de una tabla propia para no abrir una segunda cola de moderación; existe aparte de report_scam() para no reescribir una función que hoy usan el Escudo y Mensajes.';

revoke all    on function public.report_listing_review(uuid, text, text) from public, anon;
grant execute on function public.report_listing_review(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Business Score — la pieza queda lista, el cable NO se conecta acá
-- ---------------------------------------------------------------------------
create or replace function app.listing_reviews_score_factor(p_business uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- 0 a 20 puntos: promedio normalizado (1→0, 5→20) y sólo con evidencia
  -- suficiente. Menos de 3 reseñas no es una reputación, es una anécdota.
  select coalesce((
    select greatest(0, least(20, round((s.rating_avg - 1) * 5)::int))
      from public.business_accounts ba
      join public.listing_review_stats s on s.listing_id = ba.listing_id
     where ba.id = p_business
       and s.rating_count >= 3
       and s.rating_avg is not null
  ), 0);
$$;

comment on function app.listing_reviews_score_factor(uuid) is
  'Factor 0–20 de reseñas para el Business Score. DELIBERADAMENTE NO ENGANCHADA: app.recalc_business_score() (0037) sigue con verified_reviews en 0. Conectarla mueve los scores vigentes de todos los negocios y eso necesita su propia migración, con backfill y aviso — no un efecto colateral de la migración que crea las reseñas.';

revoke execute on function app.listing_reviews_score_factor(uuid) from public, anon;
grant execute on function app.listing_reviews_score_factor(uuid) to authenticated, service_role;

-- ===========================================================================
-- B. HORARIO DE ATENCIÓN
-- ===========================================================================

create table public.listing_hours (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id),
  time_zone  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Capa 1 de validación de zona: forma. Inmutable y barata. Es literalmente
  -- el mismo CHECK que la 0067 le puso a profiles.timezone.
  constraint listing_hours_time_zone_formato check (
    time_zone in ('UTC', 'GMT')
    or time_zone ~ '^[A-Za-z]+(?:[_-][A-Za-z]+)*/[A-Za-z0-9]+(?:[_+-][A-Za-z0-9]+)*(?:/[A-Za-z0-9]+(?:[_+-][A-Za-z0-9]+)*)?$'
  )
);

comment on table public.listing_hours is
  'Cabecera del horario de atención de un aviso: existe la fila = el negocio publicó horarios. time_zone es la zona del NEGOCIO y es obligatoria — "abrimos a las 9" son las 9 en la vereda del local, no las 9 de quien mira desde otra costa (la 0067 resuelve el problema inverso: una FECHA se lee con el reloj de quien lee). Los tramos cuelgan de acá por FK, así que nunca puede haber horario sin zona que lo interprete.';

create index listing_hours_tenant_idx on public.listing_hours (tenant_id);

create trigger listing_hours_set_updated_at
before update on public.listing_hours
for each row execute function extensions.moddatetime(updated_at);

-- Capa 2: existencia real contra la base de zonas del motor. Mismo razonamiento
-- que app.validate_profile_timezone() (0067): un CHECK no admite subconsultas y
-- pg_timezone_names no es inmutable ni barata.
create or replace function app.validate_listing_hours_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_probe timestamp;
begin
  if tg_op = 'UPDATE' and new.time_zone is not distinct from old.time_zone then
    return new;
  end if;

  begin
    v_probe := now() at time zone new.time_zone;
  exception when others then
    raise exception 'ZONA_HORARIA_INVALIDA: % no es una zona horaria conocida', new.time_zone
      using hint = 'Usá un identificador IANA, por ejemplo America/New_York.';
  end;

  return new;
end;
$$;

comment on function app.validate_listing_hours_time_zone() is
  'Resuelve `now() at time zone <valor>` para verificar que la zona del negocio exista de verdad. O(1), y usa la misma base de zonas que después usa el formateo. Espejo de app.validate_profile_timezone() (0067).';

create trigger listing_hours_validate_time_zone
before insert or update of time_zone on public.listing_hours
for each row execute function app.validate_listing_hours_time_zone();

create table public.listing_hours_slots (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants(id),
  listing_id uuid not null references public.listing_hours(listing_id) on delete cascade,
  -- 0 = domingo … 6 = sábado. Es la numeración de `Date#getDay()` de JavaScript,
  -- elegida para que el TypeScript que responde "¿está abierto ahora?" no tenga
  -- que convertir nada: cada conversión de índice de día es un bug esperando.
  weekday    smallint not null check (weekday between 0 and 6),
  opens_at   time not null check (opens_at < time '24:00:00'),
  closes_at  time not null check (closes_at <= time '24:00:00'),
  created_at timestamptz not null default now(),

  -- opens_at = closes_at sería ambiguo entre "cero minutos" y "veinticuatro
  -- horas". Las 24 h se escriben 00:00 → 24:00, y punto.
  constraint listing_hours_slots_tramo_valido check (opens_at <> closes_at),
  constraint listing_hours_slots_sin_duplicados unique (listing_id, weekday, opens_at)
);

comment on table public.listing_hours_slots is
  'Un TRAMO de atención. Cerrado = el día no tiene filas (la ausencia es el dato, no un booleano más). Corte de mediodía = dos filas del mismo día. Cruce de medianoche = closes_at < opens_at (20:00 → 02:00 del día siguiente). Abierto 24 h = 00:00 → 24:00. weekday usa 0=domingo, la numeración de Date#getDay().';
comment on column public.listing_hours_slots.closes_at is
  'Si es MENOR que opens_at, el tramo cruza la medianoche y termina al día siguiente. Es una convención y no una inferencia: el CHECK prohíbe el caso ambiguo (opens_at = closes_at).';

create index listing_hours_slots_listing_idx
  on public.listing_hours_slots (listing_id, weekday, opens_at);

/**
 * Techo de tramos por día. No hay solapamiento chequeado en la base a propósito:
 * con el cruce de medianoche un tramo NO es un rango simple —parte del día y
 * parte del siguiente—, así que un `exclude` con `timerange` daría falsos
 * negativos justo en el caso que motiva la convención. El solapamiento lo valida
 * la capa pura y testeada (`src/lib/horarios`), que sí sabe desarmar el cruce.
 * Lo que sí ataja la base es lo que ninguna validación de formulario ataja: que
 * alguien cargue mil filas por día contra el endpoint directo.
 */
create or replace function app.listing_hours_slots_limite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  select count(*) into v_n
    from public.listing_hours_slots s
   where s.listing_id = new.listing_id
     and s.weekday = new.weekday;

  if v_n >= 3 then
    raise exception 'DEMASIADOS_TRAMOS: un día admite hasta 3 tramos de atención';
  end if;

  return new;
end;
$$;

comment on function app.listing_hours_slots_limite() is
  'Máximo 3 tramos por día. Techo de abuso contra el INSERT fila por fila del endpoint directo. NO cubre un INSERT masivo de una sola sentencia: un trigger BEFORE ROW no ve las filas que la misma sentencia acaba de insertar. Ese camino —la RPC guardar_horario_de_aviso— cuenta los tramos por día ANTES de escribir. El solapamiento lo valida src/lib/horarios, que sabe desarmar el cruce de medianoche que un rango de Postgres no modela.';

create trigger listing_hours_slots_limite
before insert on public.listing_hours_slots
for each row execute function app.listing_hours_slots_limite();

-- ---------------------------------------------------------------------------
-- RLS del horario
-- ---------------------------------------------------------------------------
alter table public.listing_hours enable row level security;
alter table public.listing_hours force row level security;

create policy listing_hours_select on public.listing_hours
for select to anon, authenticated
using (exists (select 1 from public.listings l where l.id = listing_hours.listing_id));

create policy listing_hours_insert on public.listing_hours
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and app.can_manage_listing(listing_id, (select auth.uid()))
);

create policy listing_hours_update on public.listing_hours
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (app.can_manage_listing(listing_id, (select auth.uid())) or (select app.is_staff()))
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (app.can_manage_listing(listing_id, (select auth.uid())) or (select app.is_staff()))
  )
  or (select app.is_global_admin())
);

create policy listing_hours_delete on public.listing_hours
for delete to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (app.can_manage_listing(listing_id, (select auth.uid())) or (select app.is_staff()))
  )
  or (select app.is_global_admin())
);

alter table public.listing_hours_slots enable row level security;
alter table public.listing_hours_slots force row level security;

create policy listing_hours_slots_select on public.listing_hours_slots
for select to anon, authenticated
using (exists (select 1 from public.listing_hours h where h.listing_id = listing_hours_slots.listing_id));

create policy listing_hours_slots_insert on public.listing_hours_slots
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and app.can_manage_listing(listing_id, (select auth.uid()))
);

create policy listing_hours_slots_update on public.listing_hours_slots
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (app.can_manage_listing(listing_id, (select auth.uid())) or (select app.is_staff()))
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (app.can_manage_listing(listing_id, (select auth.uid())) or (select app.is_staff()))
  )
  or (select app.is_global_admin())
);

create policy listing_hours_slots_delete on public.listing_hours_slots
for delete to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (app.can_manage_listing(listing_id, (select auth.uid())) or (select app.is_staff()))
  )
  or (select app.is_global_admin())
);

revoke all on table public.listing_hours from anon, authenticated;
grant select                         on table public.listing_hours to anon;
grant select, insert, update, delete on table public.listing_hours to authenticated;
grant all                            on table public.listing_hours to service_role;

revoke all on table public.listing_hours_slots from anon, authenticated;
grant select                         on table public.listing_hours_slots to anon;
grant select, insert, update, delete on table public.listing_hours_slots to authenticated;
grant all                            on table public.listing_hours_slots to service_role;

-- ---------------------------------------------------------------------------
-- Guardar el horario completo, de una
-- ---------------------------------------------------------------------------

/**
 * Publicar un horario es reemplazar la semana entera, y eso desde la app son
 * tres viajes: upsert de la zona, borrado de los tramos viejos, alta de los
 * nuevos. Si el segundo sale y el tercero no, el negocio queda con la persiana
 * baja para siempre y sin enterarse.
 *
 * Adentro de una función es UNA transacción: o queda la semana nueva o queda la
 * vieja. Nunca el hueco del medio.
 *
 * El permiso se verifica ACÁ y no se delega en la RLS: la función es definer, y
 * una función definer sin su propio chequeo es una policy desactivada.
 */
create or replace function public.guardar_horario_de_aviso(
  p_listing   uuid,
  p_time_zone text,
  p_tramos    jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_listing_tenant uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para editar los horarios.';
  end if;

  select l.tenant_id into v_listing_tenant
    from public.listings l
   where l.id = p_listing;

  if v_listing_tenant is null or v_listing_tenant <> v_tenant then
    raise exception 'TARGET_NOT_FOUND: ese negocio no existe en tu comunidad.';
  end if;

  if not app.can_manage_listing(p_listing, v_uid) then
    raise exception 'SIN_PERMISO: sólo el dueño del negocio o su equipo editan los horarios.';
  end if;

  -- El techo por día se verifica ACÁ y no se delega en el trigger: un BEFORE ROW
  -- no ve las filas que la misma sentencia acaba de insertar, así que el INSERT
  -- masivo de más abajo lo esquivaría sin querer.
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_tramos, '[]'::jsonb)) as tramo
     group by (tramo ->> 'weekday')
    having count(*) > 3
  ) then
    raise exception 'DEMASIADOS_TRAMOS: un día admite hasta 3 tramos de atención';
  end if;

  insert into public.listing_hours (listing_id, tenant_id, time_zone)
  values (p_listing, v_tenant, p_time_zone)
  on conflict (listing_id) do update set time_zone = excluded.time_zone;

  delete from public.listing_hours_slots where listing_id = p_listing;

  insert into public.listing_hours_slots (tenant_id, listing_id, weekday, opens_at, closes_at)
  select v_tenant,
         p_listing,
         (tramo ->> 'weekday')::smallint,
         (tramo ->> 'opensAt')::time,
         (tramo ->> 'closesAt')::time
    from jsonb_array_elements(coalesce(p_tramos, '[]'::jsonb)) as tramo;

  -- Semana vacía = el negocio decidió despublicar sus horarios. Se borra
  -- también la cabecera para que la ficha vuelva al vacío honesto en vez de
  -- quedar con una zona horaria que no interpreta nada.
  if not exists (select 1 from public.listing_hours_slots s where s.listing_id = p_listing) then
    delete from public.listing_hours where listing_id = p_listing;
  end if;
end;
$$;

comment on function public.guardar_horario_de_aviso(uuid, text, jsonb) is
  'Reemplaza la semana completa de horarios de un aviso en UNA transacción (zona + tramos). Verifica el permiso adentro con app.can_manage_listing: una función security definer sin su propio chequeo es una policy desactivada. Los CHECK de listing_hours_slots siguen validando cada tramo. Semana vacía borra también la cabecera y la ficha vuelve al vacío honesto.';

revoke all    on function public.guardar_horario_de_aviso(uuid, text, jsonb) from public, anon;
grant execute on function public.guardar_horario_de_aviso(uuid, text, jsonb) to authenticated, service_role;

commit;
