-- =============================================================================
-- 0041_polls_and_module_soon.sql — Comunidad Latina
-- Call con el cliente 2026-07-27. Pidió tres cosas; DOS ya existían en el
-- esquema y solo les faltaba un estado. Lo que se hace acá:
--
--   1. ENCUESTAS Sí/No en posts kind='question' — GENUINAMENTE NUEVO.
--      posts.poll_kind + public.post_poll_votes + counters poll_yes_count /
--      poll_no_count mantenidos por trigger (patrón 0007/0038: el cliente NO
--      escribe counters). El voto es SECRETO: nadie —ni staff— lee la fila de
--      otra persona; lo público es el agregado.
--
--   2. "Alertas comunitarias" (persona desaparecida, centro de acopio por un
--      terremoto) — YA EXISTE como `broadcasts` (0010): global sin tenant_id
--      BY DESIGN, alcance por broadcast_targets, ventana starts_at/ends_at,
--      CTA (cta_url) y modelo PULL con receipts. NO se crea ninguna tabla.
--      Lo único que faltaba era distinguir un aviso normal de una EMERGENCIA
--      (el cliente lo mostró destacado en su demo): se suma broadcasts.severity.
--
--   3. "Apagar/prender módulos, o dejarlos en Muy pronto" — el on/off YA EXISTE
--      como `tenants.modules` (0002, jsonb Record<string,boolean>, escrito
--      desde /admin/dominio → updateTenantModules). Faltaba el TERCER estado:
--      se suma `tenants.modules_soon`. `modules` NO cambia de tipo ni de forma
--      (hay consumidores tipados en src/lib/tenant/resolve.ts y en el admin).
--
-- Sin tablas nuevas fuera de post_poll_votes ⇒ el enumerador RLS (§5.2.1) solo
-- tiene una superficie más que auditar, y viene con tenant_id + FORCE + 4/4.
-- =============================================================================


-- =============================================================================
-- 1 · ENCUESTAS Sí/No sobre posts kind='question'
-- =============================================================================

-- ---------------------------------------------------------------------------
-- posts.poll_kind + counters
-- ---------------------------------------------------------------------------
alter table public.posts
  add column poll_kind      text check (poll_kind in ('yes_no')),
  add column poll_yes_count int not null default 0 check (poll_yes_count >= 0),
  add column poll_no_count  int not null default 0 check (poll_no_count >= 0);

-- `text` y no `boolean` A PROPÓSITO: el día que el cliente pida opciones
-- múltiples ("¿qué día te queda mejor?") se suma un valor al CHECK y una tabla
-- de opciones — sin migrar una columna booleana ya escrita en producción.
comment on column public.posts.poll_kind is
  'NULL = pregunta sin encuesta (el caso normal). ''yes_no'' = la pregunta lleva encuesta Sí/No. Es text y no boolean a propósito: deja lugar a opciones múltiples sin migrar la columna. Solo puede ser no-null en posts kind=''question'' (constraint posts_poll_only_on_question).';
comment on column public.posts.poll_yes_count is
  'Votos "Sí". Mantenido por app.post_poll_votes_bump_counters(); update directo bloqueado por app.protect_post_counters().';
comment on column public.posts.poll_no_count is
  'Votos "No". Mantenido por app.post_poll_votes_bump_counters(); update directo bloqueado por app.protect_post_counters().';

-- Una encuesta colgada de un post normal no tendría dónde renderizarse y
-- volvería ambiguo el contrato con la UI: se prohíbe en la capa de datos, no
-- en la app. De paso cierra la fuga inversa: un post con encuesta no puede
-- "dejar de ser pregunta" por un UPDATE.
alter table public.posts
  add constraint posts_poll_only_on_question
    check (poll_kind is null or kind = 'question');

-- ---------------------------------------------------------------------------
-- post_poll_votes — un voto por persona, cambiable
--
-- Sin columna `id`: la PK ES la deduplicación (post, persona) — mismo criterio
-- que post_views (0038), donde el id sintético no aportaba nada.
-- ---------------------------------------------------------------------------
create table public.post_poll_votes (
  -- DEFAULT app.current_tenant_id() — único lugar del esquema donde tenant_id
  -- tiene default, y es deliberado: el voto se manda por PostgREST desde una
  -- server action con `upsert({post_id, voter_id, choice})`, y un tenant_id
  -- olvidado ahí no es una fuga (la RLS igual exige que sea el mío) sino un
  -- 23502 que rompe la feature entera. El default lo toma del JWT — el mismo
  -- valor que la policy va a exigir— así que no relaja nada: si alguien manda
  -- otro tenant, post_poll_votes_insert lo rechaza igual. Sin JWT
  -- (service_role/seed) el default es null y el not null salta fuerte, que es
  -- lo que queremos: el seed manda el tenant a mano.
  tenant_id  uuid not null default app.current_tenant_id() references public.tenants(id),
  post_id    uuid not null references public.posts(id) on delete cascade,
  -- on delete cascade (no set null como posts.author_id en 0015): un voto
  -- anónimo no es contenido comunitario que valga la pena conservar, y dejarlo
  -- huérfano rompería el "un voto por persona". El cascade dispara la rama
  -- DELETE del trigger de counters, así que el agregado queda consistente.
  voter_id   uuid not null references public.profiles(id) on delete cascade,
  choice     boolean not null,
  created_at timestamptz not null default now(),
  constraint post_poll_votes_one_per_person primary key (post_id, voter_id)
);

comment on table public.post_poll_votes is
  'Voto Sí/No de una persona en una pregunta con encuesta. VOTO SECRETO: la fila la lee SOLO su dueño — sin rama de staff ni de global_admin (criterio de saves 0038 y user_blocks 0020). Lo público es el agregado (posts.poll_yes_count/poll_no_count), que jamás permite deducir quién votó qué. Un voto por persona (PK), cambiable (UPDATE de choice) y retirable (DELETE).';
comment on column public.post_poll_votes.choice is
  'true = Sí, false = No. Es la ÚNICA columna que se puede modificar después del INSERT (app.post_poll_votes_freeze).';
comment on column public.post_poll_votes.tenant_id is
  'Comunidad del POST votado (no la del votante). El trigger app.post_poll_votes_validate() exige que coincida con posts.tenant_id: sin eso, un voto podría "pertenecer" a un tenant y sumar en el counter de otro.';

-- La lectura por lote (¿ya voté este post?) la sirve la PK. Este índice existe
-- por el ON DELETE CASCADE desde profiles: sin él, borrar una cuenta (§5.4,
-- derecho a borrarse) escanea la tabla entera por cada FK.
create index post_poll_votes_voter_idx on public.post_poll_votes (voter_id);

alter table public.post_poll_votes enable row level security;
alter table public.post_poll_votes force row level security;

-- Solo mi propia fila, en mi tenant. Sin rama de staff ni de global_admin: si
-- el moderador pudiera leer votos ajenos, la encuesta dejaría de ser secreta y
-- el número agregado dejaría de ser el único dato público.
create policy post_poll_votes_select on public.post_poll_votes
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and voter_id = (select auth.uid())
);

-- Voto en primera persona, en mi tenant, sobre una PREGUNTA published del
-- MISMO tenant que efectivamente tiene encuesta (mismos checks que
-- reactions_insert rama 'post', + kind + poll_kind).
create policy post_poll_votes_insert on public.post_poll_votes
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and voter_id = (select auth.uid())
  and exists (
    select 1 from public.posts p
    where p.id = post_poll_votes.post_id
      and p.tenant_id = post_poll_votes.tenant_id
      and p.kind = 'question'
      and p.poll_kind is not null
      and p.status = 'published'
  )
);

-- A DIFERENCIA de reactions/saves (que se quitan y se ponen), acá el UPDATE SÍ
-- existe: cambiar de opinión debe conservar el created_at y no puede pasar por
-- un delete+insert que, entre las dos operaciones, deja el voto sin dueño y
-- permite re-postular la PK. Lo único que se mueve es `choice`
-- (app.post_poll_votes_freeze congela el resto).
create policy post_poll_votes_update on public.post_poll_votes
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and voter_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and voter_id = (select auth.uid())
);

create policy post_poll_votes_delete on public.post_poll_votes
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and voter_id = (select auth.uid())
);

-- Cuentas suspendidas no acumulan engagement (paridad con reactions 0022,
-- follows 0023, saves 0038). También en UPDATE: cambiar el voto es participar.
create trigger post_poll_votes_enforce_account_active
before insert on public.post_poll_votes
for each row execute function app.enforce_account_active();

create trigger post_poll_votes_update_enforce_account_active
before update on public.post_poll_votes
for each row execute function app.enforce_account_active();

-- ---------------------------------------------------------------------------
-- Validación del sujeto — SIN bypass de service_role
--
-- La policy de INSERT ya exige "pregunta published con encuesta del mismo
-- tenant", pero solo corre para el rol authenticated. Los counters solo
-- significan algo si TODA fila apunta a una encuesta real: un seed o una RPC
-- con service_role que inserte un voto sobre un post cualquiera dejaría un
-- poll_yes_count colgado de un post que no muestra encuesta.
-- ---------------------------------------------------------------------------
create or replace function app.post_poll_votes_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.posts p
    where p.id = new.post_id
      and p.tenant_id = new.tenant_id
      and p.kind = 'question'
      and p.poll_kind is not null
      and p.status = 'published'
  ) then
    raise exception 'INVALID_POLL_TARGET: solo se vota en preguntas publicadas con encuesta, del mismo tenant';
  end if;
  return new;
end;
$$;

comment on function app.post_poll_votes_validate() is
  'BEFORE INSERT en post_poll_votes: el post votado debe ser una pregunta published CON encuesta y del MISMO tenant que la fila. Sin bypass de service_role a propósito — es integridad del contador, no autorización.';

create trigger post_poll_votes_validate
before insert on public.post_poll_votes
for each row execute function app.post_poll_votes_validate();

-- ---------------------------------------------------------------------------
-- Freeze: después de votar, lo único que se mueve es `choice`
--
-- La policy de UPDATE autoriza FILAS, no COLUMNAS: sin esta guarda, quien votó
-- podría mandar `update ... set post_id = <otro post>` por PostgREST y mover su
-- voto (con su counter) a una encuesta ajena, o reescribir created_at.
-- SIN bypass de service_role (a diferencia de app.job_applications_freeze):
-- acá lo que se protege es la coherencia del counter — mover un voto por
-- service_role tampoco lo recalcularía bien. Si hiciera falta reubicar un voto,
-- se borra y se re-inserta (esas dos operaciones SÍ pasan por los counters).
-- ---------------------------------------------------------------------------
create or replace function app.post_poll_votes_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.post_id is distinct from old.post_id then
    raise exception 'PROTECTED_COLUMNS: post_id no se puede modificar (borrá el voto y volvé a votar)';
  end if;
  if new.voter_id is distinct from old.voter_id then
    raise exception 'PROTECTED_COLUMNS: voter_id no se puede modificar';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'PROTECTED_COLUMNS: tenant_id no se puede modificar';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'PROTECTED_COLUMNS: created_at no se puede modificar';
  end if;
  return new;
end;
$$;

comment on function app.post_poll_votes_freeze() is
  'Congela post_id / voter_id / tenant_id / created_at después del INSERT. El UPDATE de post_poll_votes existe SOLO para cambiar `choice`.';

create trigger post_poll_votes_freeze
before update on public.post_poll_votes
for each row execute function app.post_poll_votes_freeze();

-- ---------------------------------------------------------------------------
-- Counters por trigger (INSERT / UPDATE / DELETE)
--
-- A diferencia de app.reactions_bump_counters (0007) acá SÍ hay rama UPDATE:
-- cambiar el voto mueve UNA unidad de un contador al otro en la misma
-- sentencia, para que la suma nunca quede inconsistente entre las dos filas.
-- ---------------------------------------------------------------------------
create or replace function app.post_poll_votes_bump_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.choice then
      update public.posts
         set poll_yes_count = poll_yes_count + 1
       where id = new.post_id
         and tenant_id = new.tenant_id;
    else
      update public.posts
         set poll_no_count = poll_no_count + 1
       where id = new.post_id
         and tenant_id = new.tenant_id;
    end if;
    return new;

  elsif tg_op = 'UPDATE' then
    if new.choice is distinct from old.choice then
      if new.choice then
        update public.posts
           set poll_yes_count = poll_yes_count + 1,
               poll_no_count  = greatest(poll_no_count - 1, 0)
         where id = new.post_id
           and tenant_id = new.tenant_id;
      else
        update public.posts
           set poll_no_count  = poll_no_count + 1,
               poll_yes_count = greatest(poll_yes_count - 1, 0)
         where id = new.post_id
           and tenant_id = new.tenant_id;
      end if;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if old.choice then
      update public.posts
         set poll_yes_count = greatest(poll_yes_count - 1, 0)
       where id = old.post_id
         and tenant_id = old.tenant_id;
    else
      update public.posts
         set poll_no_count = greatest(poll_no_count - 1, 0)
       where id = old.post_id
         and tenant_id = old.tenant_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

comment on function app.post_poll_votes_bump_counters() is
  'Mantiene posts.poll_yes_count / poll_no_count en INSERT/UPDATE/DELETE de post_poll_votes. La rama UPDATE mueve una unidad de un contador al otro en la misma sentencia (cambiar el voto). SECURITY DEFINER: el update del counter no depende de las policies del votante, y al correr dentro de un trigger pasa el gate pg_trigger_depth() de app.protect_post_counters().';

create trigger post_poll_votes_bump_counters
after insert or update or delete on public.post_poll_votes
for each row execute function app.post_poll_votes_bump_counters();

-- ---------------------------------------------------------------------------
-- Re-creación COMPLETA de la guarda de counters de posts (base: 0038) sumando
-- poll_yes_count / poll_no_count: si quedaran fuera, cualquier cliente
-- autenticado podría escribirlos por PostgREST y la encuesta dejaría de
-- significar algo (que es todo lo que una encuesta tiene).
--
-- Suma además una regla NUEVA: no se cambia la encuesta de un post que ya
-- tiene votos. Sin eso, quien preguntó "¿organizamos la feria?" podría
-- reescribir la encuesta después de 200 votos y quedarse con los números de
-- otra pregunta (o borrar la encuesta dejando los counters colgados).
-- ---------------------------------------------------------------------------
create or replace function app.protect_post_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno de counters (trigger sobre trigger)
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.like_count is distinct from old.like_count
     or new.comment_count is distinct from old.comment_count
     or new.view_count is distinct from old.view_count
     or new.poll_yes_count is distinct from old.poll_yes_count
     or new.poll_no_count is distinct from old.poll_no_count then
    raise exception 'PROTECTED_COLUMNS: like_count/comment_count/view_count/poll_yes_count/poll_no_count solo se actualizan por triggers';
  end if;
  if new.poll_kind is distinct from old.poll_kind
     and (old.poll_yes_count > 0 or old.poll_no_count > 0) then
    raise exception 'PROTECTED_TRANSITION: no se puede cambiar ni quitar la encuesta de una pregunta que ya tiene votos';
  end if;
  return new;
end;
$$;

comment on function app.protect_post_counters() is
  'Bloquea manipulación directa de counters de posts (like_count, comment_count, view_count, poll_yes_count, poll_no_count) por clientes autenticados, y congela poll_kind una vez que la encuesta tiene votos.';

-- ---------------------------------------------------------------------------
-- Re-creación de posts_insert (base: 0038) sumando `poll_yes_count = 0` y
-- `poll_no_count = 0`: la guarda de arriba es BEFORE UPDATE, así que sin esto
-- una pregunta podría NACER con 900 votos a favor por PostgREST. Mismo espíritu
-- que like_count/comment_count en 0007 y view_count en 0038. Todo lo demás
-- queda igual (poll_kind SÍ lo elige el autor al publicar: es contenido).
-- ---------------------------------------------------------------------------
drop policy posts_insert on public.posts;
create policy posts_insert on public.posts
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status in ('published', 'pending_review')
  and like_count = 0
  and comment_count = 0
  and view_count = 0
  and poll_yes_count = 0
  and poll_no_count = 0
  and (
    entity_listing_id is null
    or exists (
      select 1 from public.listings l
      where l.id = posts.entity_listing_id
        and l.tenant_id = posts.tenant_id
        and l.created_by = (select auth.uid())
        and l.status = 'published'
    )
  )
);


-- =============================================================================
-- 2 · broadcasts.severity — aviso normal vs. EMERGENCIA
--
-- El cliente pidió "alertas comunitarias" (persona desaparecida, centro de
-- acopio por un terremoto). El modelo ya estaba entero en 0010: broadcasts +
-- broadcast_targets (alcance por comunidad) + broadcast_receipts (visto), con
-- ventana starts_at/ends_at y CTA. Lo ÚNICO que no se podía expresar era la
-- diferencia entre "les cuento algo" y "esto es una emergencia".
--
-- No se tocan policies: broadcasts ya es escritura exclusiva de global_admin
-- (broadcasts_insert/update/delete) y lectura PULL por targets — el enumerador
-- lo whitelistea como global BY DESIGN y sigue con sus 4/4 policies intactas.
-- =============================================================================
alter table public.broadcasts
  add column severity text not null default 'info'
    check (severity in ('info', 'urgent'));

comment on column public.broadcasts.severity is
  'info = aviso normal (default: los broadcasts existentes NO se convierten en emergencias por esta migración). urgent = emergencia comunitaria (persona desaparecida, centro de acopio, redada) — la UI la destaca y no la deja pasar de largo. Es la única diferencia de tratamiento: el alcance sigue siendo broadcast_targets y la vigencia sigue siendo starts_at/ends_at.';


-- =============================================================================
-- 3 · tenants.modules_soon — el tercer estado de un módulo ("Muy pronto")
--
-- `tenants.modules` (0002) ya resuelve prendido/apagado y lo escribe el admin
-- (/admin/dominio → updateTenantModules). El cliente pidió poder además dejar
-- un módulo anunciado pero sin entrar. Se agrega una columna HERMANA en vez de
-- cambiarle la forma a `modules`, porque `modules` está tipada como
-- Record<string, boolean> en src/ (resolve.ts, admin) y un cambio de forma
-- rompería a todos sus consumidores de una.
-- =============================================================================
alter table public.tenants
  add column modules_soon jsonb not null default '{}'::jsonb
    check (jsonb_typeof(modules_soon) = 'object');

comment on column public.tenants.modules_soon is
  'Marcas "Muy pronto" por módulo, MISMA forma que tenants.modules: Record<string, boolean> con las claves reales del menú (feed, propiedades, negocios, profesionales, eventos, mensajes, escudo, marketplace, creadores). Semántica de la combinación, en este orden: (a) modules[k] = true ⇒ el módulo se ve y se usa, modules_soon se ignora; (b) modules[k] falso/ausente Y modules_soon[k] = true ⇒ el módulo SE VE en el menú con la etiqueta "Muy pronto", sin entrar; (c) falso/ausente en las dos ⇒ el módulo no aparece en ningún lado. Es decir: "Muy pronto" es un estado de lo APAGADO — por eso no se toca ni el tipo ni la forma de `modules`, que sigue siendo la única fuente de "¿está prendido?".';
