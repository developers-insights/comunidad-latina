-- =============================================================================
-- 0139_llamadas_de_audio_y_video.sql — Comunidad Latina
--
-- Llamadas de audio y video, de a dos o hasta diez, desde un chat o desde un
-- grupo. El medio lo pone Agora; lo que vive acá es QUIÉN puede entrar a qué
-- llamada, que es lo que Agora no sabe.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. `canal` ES UN SECRETO, Y POR ESO NO LO ELIGE EL CLIENTE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El `canal` es el nombre que se le pasa a Agora para juntar a las personas en
-- la misma sala. La tentación evidente es derivarlo de los ids —`${a}-${b}`, o
-- el id de la conversación— y es exactamente lo que no se puede hacer: si el
-- nombre del canal se puede CALCULAR, cualquiera que conozca los dos ids de
-- perfil (que viajan en la URL de un perfil público) puede pedirle a Agora
-- entrar a esa sala, y se sienta adentro de una llamada a la que nadie lo
-- invitó.
--
-- Así que es un uuid v4 —aleatorio— y NO el `app.uuid_v7()` que usa el resto
-- del repo para las claves primarias: v7 lleva el timestamp adentro y es
-- parcialmente adivinable, que es justo la propiedad que acá no queremos. Lo
-- pone un trigger y no el DEFAULT, por el mismo motivo que el TTL de la 0006:
-- un DEFAULT sólo actúa si el cliente no manda la columna, y un INSERT vía
-- PostgREST con el `canal` puesto a mano lo pisaría.
--
-- ⚠️ ESTO NO ALCANZA SOLO. Un canal impredecible es la segunda cerradura, no la
-- primera: el token de Agora se tiene que emitir en el SERVIDOR, por persona y
-- por llamada, después de comprobar contra `call_participants` que esa persona
-- está invitada. Si el token se emitiera para cualquiera que traiga el nombre
-- del canal, esta tabla sería decoración.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LAS DOS POLICIES SE MIRAN, ASÍ QUE HAY UNA FUNCIÓN DEFINER EN EL MEDIO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "Ver una llamada" es "estar en `call_participants`", y "ver un participante"
-- es "estar en la misma llamada". Escrito con dos `exists` cruzados, cada
-- policy dispara la otra y Postgres aborta con «infinite recursion detected in
-- policy». Es el mismo choque que la 0133 §4 resolvió con
-- app.es_miembro_de_grupo(), y se resuelve igual: una sola función SECURITY
-- DEFINER que las dos policies preguntan.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LA LLAMADA TAMBIÉN VENCE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La 0006 dejó escrito por qué las conversaciones se purgan aunque los mensajes
-- tengan su propio TTL: «el grafo quién-contactó-a-quién NO es indefinido».
-- Una llamada es ese mismo grafo con hora y duración, así que hereda el mismo
-- trato — 90 días y pg_cron, como todo lo demás del módulo. Guardar para
-- siempre "el 4 de marzo a las 23:10 estas dos personas hablaron 42 minutos"
-- sería justamente lo que §5.4 evita.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · calls
-- ---------------------------------------------------------------------------
create table public.calls (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  -- El nombre de la sala en Agora. Aleatorio y no derivable (§1).
  canal        text not null unique default pg_catalog.gen_random_uuid()::text,

  iniciada_por uuid not null references public.profiles(id) on delete cascade,

  kind         text not null check (kind in ('audio', 'video')),

  -- Con valor = llamada de grupo; null = llamada entre personas. `set null` y
  -- no `cascade`: si el grupo se borra, el registro de que la llamada existió
  -- no tiene por qué desaparecer antes de tiempo — ya vence solo a los 90 días.
  group_id     uuid references public.chat_groups(id) on delete set null,

  status       text not null default 'sonando'
                 check (status in ('sonando', 'en_curso', 'terminada', 'perdida', 'rechazada')),

  -- Nulos hasta que pasen: `started_at` cuando alguien atiende, `ended_at`
  -- cuando se corta. La duración es la resta, no una columna: una columna de
  -- duración se puede desincronizar de las puntas, la resta no.
  started_at   timestamptz,
  ended_at     timestamptz,

  -- Cuándo EMPEZÓ A SONAR. Distinto de started_at, que es cuándo la atendieron:
  -- una llamada perdida no tiene started_at y sin esto no tendría ninguna fecha
  -- con la que ordenarse en el historial ni con la que vencer.
  created_at   timestamptz not null default now(),

  constraint calls_fechas_coherentes check (
    (ended_at is null or started_at is null or ended_at >= started_at)
    and (started_at is null or started_at >= created_at)
  )
);

comment on table public.calls is
  'Llamadas de audio y video (0139). Acá vive QUIÉN puede entrar a qué llamada; el medio lo pone Agora. Vence a los 90 días como el resto del módulo: una llamada es el grafo quién-habló-con-quién con hora y duración, y §5.4 no lo quiere indefinido.';
comment on column public.calls.canal is
  'El nombre de la sala en Agora. uuid v4 ALEATORIO —no app.uuid_v7(), que lleva el timestamp adentro y es parcialmente adivinable— y lo fuerza app.forzar_canal_de_llamada() en cada INSERT, ignorando lo que mande el cliente. Si el canal se pudiera calcular a partir de los ids de perfil, cualquiera podría sentarse adentro de una llamada ajena. NO es la única cerradura: el token de Agora se emite en el servidor por persona, comprobando call_participants (§1 de la 0139).';
comment on column public.calls.group_id is
  'Con valor = llamada de un grupo de chat; null = llamada entre personas. ON DELETE SET NULL para que borrar el grupo no borre el registro antes de que venza solo.';
comment on column public.calls.status is
  'sonando → en_curso → terminada, o bien perdida / rechazada. Lo mueven los participantes; app.proteger_columnas_de_la_llamada() impide que en el mismo UPDATE se cambie otra cosa.';
comment on column public.calls.created_at is
  'Cuándo empezó a sonar. NO es started_at (cuándo la atendieron): una llamada perdida no tiene started_at, y sin esta columna no tendría fecha con la que ordenarse en el historial ni con la que vencer.';

create index calls_tenant_idx        on public.calls (tenant_id, created_at desc, id desc);
create index calls_iniciada_por_idx  on public.calls (iniciada_por, created_at desc);
create index calls_group_idx         on public.calls (group_id) where group_id is not null;
-- La purga de §7.
create index calls_created_at_idx    on public.calls (created_at);


-- ---------------------------------------------------------------------------
-- 2 · call_participants
-- ---------------------------------------------------------------------------
create table public.call_participants (
  call_id    uuid not null references public.calls(id)    on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id)  on delete cascade,

  -- NULL = está invitada y todavía no entró (le está sonando). Se llena cuando
  -- se conecta de verdad. Que la fila exista antes de entrar es lo que permite
  -- que la llamada le suene: sin fila, la RLS no le deja ver la llamada.
  joined_at  timestamptz,
  left_at    timestamptz,

  primary key (call_id, profile_id),

  constraint call_participants_fechas_coherentes check (
    left_at is null or (joined_at is not null and left_at >= joined_at)
  )
);

comment on table public.call_participants is
  'Quién está invitado a una llamada (0139). Es LA TABLA DE AUTORIZACIÓN: la RLS de calls se resuelve mirando acá, siempre a través de app.estoy_en_la_llamada() — nunca con un exists directo, que haría recursión entre las dos policies (§2). También es contra esta tabla que el servidor tiene que comprobar antes de emitir un token de Agora.';
comment on column public.call_participants.joined_at is
  'NULL = invitada, le está sonando, todavía no entró. La fila existe ANTES de que entre porque es lo que le permite ver la llamada: sin fila, la RLS no se la muestra y no le puede sonar.';

create index call_participants_persona_idx on public.call_participants (profile_id, call_id);
create index call_participants_tenant_idx  on public.call_participants (tenant_id);


-- ---------------------------------------------------------------------------
-- 3 · Las dos preguntas de autorización, como funciones DEFINER (§2)
-- ---------------------------------------------------------------------------
create or replace function app.estoy_en_la_llamada(p_call uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.call_participants p
     where p.call_id = p_call
       and p.profile_id = auth.uid()
  );
$$;

comment on function app.estoy_en_la_llamada(uuid) is
  '¿auth.uid() está invitado a esta llamada? SECURITY DEFINER a propósito: es lo único que rompe la recursión entre las policies de calls y call_participants, que si no se preguntan la una a la otra (§2 de la 0139). Gemela de app.es_miembro_de_grupo() (0133 §4). Devuelve false sin sesión.';

create or replace function app.inicie_la_llamada(p_call uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.calls c
     where c.id = p_call
       and c.iniciada_por = auth.uid()
  );
$$;

comment on function app.inicie_la_llamada(uuid) is
  '¿auth.uid() es quien inició esta llamada? Se pregunta desde la policy de INSERT de call_participants: invitar es cosa de quien llama. DEFINER por lo mismo que app.estoy_en_la_llamada().';

revoke execute on function app.estoy_en_la_llamada(uuid) from public, anon;
revoke execute on function app.inicie_la_llamada(uuid)   from public, anon;
grant execute on function app.estoy_en_la_llamada(uuid) to authenticated, service_role;
grant execute on function app.inicie_la_llamada(uuid)   to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4 · Triggers
-- ---------------------------------------------------------------------------

-- 4.1 · El canal lo pone la base, siempre (§1).
create or replace function app.forzar_canal_de_llamada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.canal := pg_catalog.gen_random_uuid()::text;
  return new;
end;
$$;

comment on function app.forzar_canal_de_llamada() is
  'BEFORE INSERT en calls: pisa `canal` con un uuid v4 aleatorio, ignorando lo que mande el cliente. Sin JWT tampoco se exceptúa —al revés que los triggers de TTL— porque acá no hay ningún caso legítimo de canal elegido a mano: un canal predecible deja entrar a una llamada ajena a quien pueda calcularlo.';

revoke execute on function app.forzar_canal_de_llamada() from public, anon;

create trigger calls_forzar_canal
before insert on public.calls
for each row execute function app.forzar_canal_de_llamada();


-- 4.2 · Quien llama queda adentro, en la misma transacción.
--
-- Mismo motivo que app.grupo_nace_con_su_dueno() (0133 §5.1): sin esto hay una
-- ventana en la que la llamada existe y no tiene participantes, y como la RLS
-- de `calls` se resuelve mirando `call_participants`, en esa ventana ni quien
-- la creó puede verla — una llamada huérfana que nadie puede ni cortar.
create or replace function app.la_llamada_nace_con_quien_llama()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.call_participants (call_id, profile_id, tenant_id, joined_at)
  values (new.id, new.iniciada_por, new.tenant_id, now())
  on conflict (call_id, profile_id) do nothing;
  return new;
end;
$$;

comment on function app.la_llamada_nace_con_quien_llama() is
  'AFTER INSERT en calls: mete a quien llama en call_participants en la MISMA transacción, ya con joined_at. Sin esto la llamada existe sin participantes, y como la RLS de calls se resuelve mirando esa tabla, ni su creador la vería.';

revoke execute on function app.la_llamada_nace_con_quien_llama() from public, anon;

create trigger calls_nace_con_quien_llama
after insert on public.calls
for each row execute function app.la_llamada_nace_con_quien_llama();


-- 4.3 · El tope de diez.
--
-- El `for update` sobre la fila de `calls` NO es decorativo: sin él, diez
-- personas que entran a la vez leen todas "hay 9" y entran todas. Bloquear la
-- llamada serializa las altas de esa llamada y sólo de esa. Es la diferencia
-- entre un tope y una sugerencia.
create or replace function app.tope_de_participantes_en_llamada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cuantos integer;
begin
  perform 1 from public.calls c where c.id = new.call_id for update;

  select count(*) into v_cuantos
    from public.call_participants p
   where p.call_id = new.call_id;

  if v_cuantos >= 10 then
    raise exception 'CALL_FULL: una llamada admite hasta 10 personas.';
  end if;

  return new;
end;
$$;

comment on function app.tope_de_participantes_en_llamada() is
  'BEFORE INSERT en call_participants: no más de 10 por llamada. El `for update` sobre la fila de calls serializa las altas de esa llamada — sin él, diez altas simultáneas leen todas el mismo conteo viejo y entran todas, y el tope pasa a ser una sugerencia.';

revoke execute on function app.tope_de_participantes_en_llamada() from public, anon;

create trigger call_participants_tope
before insert on public.call_participants
for each row execute function app.tope_de_participantes_en_llamada();


-- 4.4 · De una llamada se mueve el estado y las fechas, nada más.
create or replace function app.proteger_columnas_de_la_llamada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  new.id           := old.id;
  new.tenant_id    := old.tenant_id;
  new.canal        := old.canal;
  new.iniciada_por := old.iniciada_por;
  new.kind         := old.kind;
  new.group_id     := old.group_id;
  new.created_at   := old.created_at;

  return new;
end;
$$;

comment on function app.proteger_columnas_de_la_llamada() is
  'BEFORE UPDATE en calls: sólo se mueven status, started_at y ended_at. `canal` incluido en el congelamiento — si se pudiera cambiar desde un UPDATE, el trigger que lo aleatoriza en el INSERT no serviría de nada y alguien podría mudar una llamada viva a un canal elegido. Mismo criterio que la 0135 §3: una policy autoriza filas, no columnas.';

revoke execute on function app.proteger_columnas_de_la_llamada() from public, anon;

create trigger calls_proteger_columnas
before update on public.calls
for each row execute function app.proteger_columnas_de_la_llamada();


-- 4.5 · Una cuenta suspendida no llama. Mismo trigger que ya cubre posts,
--       mensajes, conversaciones y grupos (0021).
create trigger calls_enforce_account_active
before insert on public.calls
for each row execute function app.enforce_account_active();


-- ---------------------------------------------------------------------------
-- 5 · RLS
-- ---------------------------------------------------------------------------
alter table public.calls              enable row level security;
alter table public.calls              force  row level security;
alter table public.call_participants  enable row level security;
alter table public.call_participants  force  row level security;

-- ── calls ───────────────────────────────────────────────────────────────────

-- Sólo quien está invitado. Sin rama de staff ni de global admin: una llamada
-- privada es lo mismo que un chat privado (0006 §5.4).
create policy calls_select on public.calls
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and app.estoy_en_la_llamada(id)
);

-- Llamar: yo, en mi comunidad, y nace sonando. Si es de grupo, tengo que ser
-- miembro — si no, cualquiera podría hacer sonar el teléfono de 40 personas de
-- un grupo al que no pertenece.
create policy calls_insert on public.calls
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and iniciada_por = (select auth.uid())
  and status = 'sonando'
  and started_at is null
  and ended_at is null
  and (
    group_id is null
    or app.es_miembro_de_grupo(group_id)
  )
);

-- Atender, rechazar, cortar: cualquiera de los invitados. Qué columnas se
-- pueden mover lo decide el trigger de §4.4.
create policy calls_update on public.calls
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and app.estoy_en_la_llamada(id)
)
with check (
  tenant_id = (select app.current_tenant_id())
  and app.estoy_en_la_llamada(id)
);

-- Sin DELETE para nadie: el historial de llamadas no se edita, vence (§3). La
-- purga de §7 corre como cron, que no pasa por RLS.

-- ── call_participants ───────────────────────────────────────────────────────

-- Los invitados se ven entre sí: es la lista que la pantalla de llamada pinta.
create policy call_participants_select on public.call_participants
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or app.estoy_en_la_llamada(call_id)
  )
);

-- Dos caminos y ninguno más:
--   (a) INVITA quien llamó, y no a alguien con quien haya bloqueo (0020).
--   (b) ME SUMO YO a una llamada de un grupo del que soy miembro — es "entrar a
--       la llamada del grupo", que en un grupo es una sala abierta, no una
--       invitación de a uno.
create policy call_participants_insert on public.call_participants
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.calls c
     where c.id = call_participants.call_id
       and c.tenant_id = call_participants.tenant_id
       and c.status in ('sonando', 'en_curso')
       and (
         (
           app.inicie_la_llamada(c.id)
           and not app.pair_blocked((select auth.uid()), call_participants.profile_id)
         )
         or (
           call_participants.profile_id = (select auth.uid())
           and c.group_id is not null
           and app.es_miembro_de_grupo(c.group_id)
         )
       )
  )
  and exists (
    select 1 from public.profiles p
     where p.id = call_participants.profile_id
       and p.tenant_id = call_participants.tenant_id
  )
);

-- Entrar y salir: cada quien marca SU propia fila. Que quien llamó pudiera
-- escribir el `joined_at` de otro sería poder registrar que alguien atendió una
-- llamada que nunca atendió.
create policy call_participants_update on public.call_participants
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- Sin DELETE: salir de una llamada es `left_at`, no borrar la fila. Borrarla
-- dejaría una llamada de la que no se puede saber quién estuvo.


-- ---------------------------------------------------------------------------
-- 6 · GRANTS EXPLÍCITOS
--
-- Sin esto no hay llamadas y no hay error: sin GRANT de tabla la policy ni
-- llega a evaluarse (la lección de la 0114 y de la 0133 §7). Ojo con lo que NO
-- se otorga: `delete` en ninguna de las dos, `insert` de terceros tampoco —
-- eso lo cierran las policies, pero el grant marca la intención.
-- ---------------------------------------------------------------------------
revoke all on table public.calls             from anon, authenticated;
revoke all on table public.call_participants from anon, authenticated;

grant select, insert, update on table public.calls             to authenticated;
grant select, insert, update on table public.call_participants to authenticated;

grant all on table public.calls             to service_role;
grant all on table public.call_participants to service_role;


-- ---------------------------------------------------------------------------
-- 7 · Retención (§3)
--
-- 04:15 UTC, después de las purgas de mensajes (03:15) y de grupos cerrados
-- (03:45) de la 0133 §10. Idempotente igual que allá: se desagenda y se vuelve
-- a agendar. `call_participants` se va sola por el ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('purge-expired-calls');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'purge-expired-calls',
  '15 4 * * *',
  $$delete from public.calls where created_at < now() - interval '90 days'$$
);

commit;
