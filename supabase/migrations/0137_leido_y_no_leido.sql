-- =============================================================================
-- 0137_leido_y_no_leido.sql — Comunidad Latina
--
-- El globito con el número de mensajes sin leer, en la bandeja y en cada hilo.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. UNA MARCA DE TIEMPO POR PERSONA, NO UN ESTADO POR MENSAJE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La otra forma de resolver esto es una fila por (mensaje, persona) con su
-- `leido`. En un grupo de 40 personas eso son 40 filas por cada mensaje que
-- alguien manda, y hay que escribirlas TODAS en el momento de enviar. Con una
-- marca por (hilo, persona), enviar un mensaje escribe una sola fila —la del
-- mensaje— y leer escribe una sola más, la propia.
--
-- El precio es que no se puede saber "quién leyó exactamente este mensaje",
-- sólo "hasta dónde llegó cada quien". Para el globito de no leídos y para el
-- doble tilde de la bandeja alcanza y sobra, y es la diferencia entre un
-- módulo que aguanta un grupo grande y uno que no.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LA MARCA SÓLO AVANZA, Y NUNCA MÁS ALLÁ DE AHORA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `last_read_at` la manda el cliente, así que hay dos formas de romperla y las
-- dos las cierra el trigger de §4:
--
--   · HACIA ATRÁS. Dos pestañas abiertas: la vieja termina de cargar después y
--     manda una marca anterior, y los mensajes que ya leíste vuelven a
--     aparecer como nuevos. El globito parpadea solo.
--   · HACIA ADELANTE. Una marca en el año 2099 deja el contador en cero para
--     siempre: todos los mensajes que lleguen ya nacen "leídos" y la persona
--     deja de enterarse de que le escribieron.
--
-- Lo segundo es lo grave, y no hace falta mala intención: alcanza con un reloj
-- de sistema mal puesto, que es de las cosas más comunes que hay.
--
-- CONSECUENCIA A TENER PRESENTE: mientras la marca sólo avance, NO existe
-- "marcar como no leído". Si algún día se pide, lo que hay que cambiar es este
-- trigger, no la tabla — y hay que reemplazarlo por otra defensa contra el
-- reloj adelantado, no por nada.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Las dos tablas
-- ---------------------------------------------------------------------------
create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id)      on delete cascade,

  -- DENORMALIZADO como en todo el repo: toda policy lo compara contra
  -- app.current_tenant_id(), así que una fila con el tenant forjado no la ve
  -- nadie y no marca nada como leído.
  tenant_id       uuid not null references public.tenants(id)       on delete cascade,

  last_read_at    timestamptz not null default now(),

  primary key (conversation_id, profile_id)
);

comment on table public.conversation_reads is
  'Hasta dónde leyó cada persona en un chat 1-a-1 (0137). UNA marca por (conversación, persona) en vez de un estado por mensaje: lo segundo son N filas por cada mensaje enviado en un grupo grande (§1 de la migración). Con esto no se puede saber quién leyó UN mensaje puntual, sólo hasta dónde llegó cada quien — que es lo que necesitan el globito de no leídos y la bandeja.';
comment on column public.conversation_reads.last_read_at is
  'Sólo avanza, y nunca más allá de now(): lo fuerza app.avanzar_marca_de_lectura(). Una marca hacia atrás hace parpadear el globito; una hacia adelante (un reloj mal puesto alcanza) deja el contador en cero PARA SIEMPRE y la persona deja de enterarse de que le escribieron.';

create table public.chat_group_reads (
  group_id     uuid not null references public.chat_groups(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id)    on delete cascade,
  tenant_id    uuid not null references public.tenants(id)     on delete cascade,

  last_read_at timestamptz not null default now(),

  primary key (group_id, profile_id)
);

comment on table public.chat_group_reads is
  'Gemela EXACTA de conversation_reads para los grupos de chat (0133). Mismas columnas, mismo trigger de monotonía, mismas policies mutatis mutandis.';
comment on column public.chat_group_reads.last_read_at is
  'Mismo contrato que conversation_reads.last_read_at: sólo avanza y nunca pasa de now().';


-- ---------------------------------------------------------------------------
-- 2 · Índices
--
-- La PK (hilo, persona) ya resuelve "mi marca en ESTE hilo", que es la lectura
-- del chat abierto. El índice de abajo cubre la otra, que es la que se hace más
-- veces: la BANDEJA, que necesita TODAS mis marcas de una. Lleva las tres
-- columnas para que sea un index-only scan y no toque la tabla.
-- ---------------------------------------------------------------------------
create index conversation_reads_bandeja_idx
  on public.conversation_reads (profile_id, conversation_id, last_read_at);

create index chat_group_reads_bandeja_idx
  on public.chat_group_reads (profile_id, group_id, last_read_at);

create index conversation_reads_tenant_idx on public.conversation_reads (tenant_id);
create index chat_group_reads_tenant_idx   on public.chat_group_reads (tenant_id);

-- Contar los no leídos es "mensajes de este hilo posteriores a mi marca". Del
-- lado de los mensajes eso ya lo cubren los índices que existen —
-- messages_conversation_idx (conversation_id, created_at desc, id desc) y
-- chat_group_messages_hilo_idx (group_id, created_at desc, id desc)— porque el
-- hilo va primero y la fecha después, que es exactamente la forma de la
-- consulta. No hace falta índice nuevo del lado de los mensajes.


-- ---------------------------------------------------------------------------
-- 3 · RLS — cada quien ve y escribe SÓLO su propia fila
--
-- `profile_id = auth.uid()` va en las cuatro policies, no sólo en las de
-- escritura. Si la de SELECT dejara ver las marcas de los demás, la bandeja
-- pasaría a ser un lector de recibos: "a qué hora abriste mi mensaje" es
-- justamente el dato que nadie pidió publicar.
-- ---------------------------------------------------------------------------
alter table public.conversation_reads enable row level security;
alter table public.conversation_reads force  row level security;
alter table public.chat_group_reads   enable row level security;
alter table public.chat_group_reads   force  row level security;

create policy conversation_reads_select on public.conversation_reads
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- Marcar como leído exige SER participante, no sólo decir que sí. Sin el
-- exists, cualquiera podría sembrar filas contra ids de conversaciones ajenas
-- y confirmar por diferencia —entra o falla— cuáles existen.
create policy conversation_reads_insert on public.conversation_reads
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c
     where c.id = conversation_reads.conversation_id
       and c.tenant_id = conversation_reads.tenant_id
       and (
         c.created_by = (select auth.uid())
         or c.counterpart_id = (select auth.uid())
       )
  )
);

-- El `with check` repite el predicado del `using` a propósito: el `using` dice
-- qué filas puedo tocar y el `with check`, cómo pueden quedar. Sin repetirlo,
-- el mismo UPDATE que avanza mi marca podría cambiarle el dueño a la fila.
create policy conversation_reads_update on public.conversation_reads
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- Borrar la propia marca = "volver a marcar todo como no leído desde cero".
-- Es la única forma que hay de deshacer, dado que la marca sólo avanza (§2).
create policy conversation_reads_delete on public.conversation_reads
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

create policy chat_group_reads_select on public.chat_group_reads
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- app.es_miembro_de_grupo() y no un exists directo: es la regla de la 0133 §4
-- para todo lo que pregunte por pertenencia a un grupo desde una policy.
create policy chat_group_reads_insert on public.chat_group_reads
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and app.es_miembro_de_grupo(chat_group_reads.group_id)
);

create policy chat_group_reads_update on public.chat_group_reads
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

create policy chat_group_reads_delete on public.chat_group_reads
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);


-- ---------------------------------------------------------------------------
-- 4 · La marca sólo avanza (§2)
--
-- Un solo trigger para las dos tablas: toca únicamente `last_read_at`, que se
-- llama igual en las dos, así que acá sí conviene una función compartida —al
-- revés que los protectores de columnas de la 0136, que nombran columnas
-- distintas y por eso van duplicados.
-- ---------------------------------------------------------------------------
create or replace function app.avanzar_marca_de_lectura()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- EL ORDEN DE ESTAS DOS LÍNEAS IMPORTA Y NO ES INTERCAMBIABLE.
  --
  -- Primero la monotonía —nunca hacia atrás: dos pestañas abiertas harían
  -- reaparecer como nuevos los mensajes ya leídos— y DESPUÉS el techo.
  --
  -- Al revés (techo y después monotonía) el `greatest` deshace el techo: si la
  -- fila guardada quedó en el futuro por cualquier motivo —un write con
  -- service_role, un seed, una fila migrada— `greatest(now(), futuro)` devuelve
  -- el futuro y la marca queda clavada ahí PARA SIEMPRE, que es exactamente el
  -- modo de falla que este trigger existe para evitar. Con este orden, en
  -- cambio, cada escritura la trae de vuelta a now(): se cura sola.
  if tg_op = 'UPDATE' then
    new.last_read_at := greatest(coalesce(new.last_read_at, now()), old.last_read_at);
  end if;

  new.last_read_at := least(coalesce(new.last_read_at, now()), now());

  return new;
end;
$$;

comment on function app.avanzar_marca_de_lectura() is
  'BEFORE INSERT OR UPDATE en conversation_reads y chat_group_reads: la marca de lectura sólo avanza y nunca pasa de now(). Las dos direcciones rompen algo distinto (§2 de la 0137): hacia atrás hace parpadear el globito, hacia adelante lo apaga PARA SIEMPRE. El ORDEN de las dos correcciones no es intercambiable —monotonía primero, techo después— o el greatest deshace el techo y una fila que quedó en el futuro se clava ahí; ver el comentario adentro de la función. Es también el motivo por el que hoy no existe "marcar como no leído": si se pide, se cambia esta función, no la tabla.';

revoke execute on function app.avanzar_marca_de_lectura() from public, anon;

create trigger conversation_reads_avanzar
before insert or update on public.conversation_reads
for each row execute function app.avanzar_marca_de_lectura();

create trigger chat_group_reads_avanzar
before insert or update on public.chat_group_reads
for each row execute function app.avanzar_marca_de_lectura();


-- ---------------------------------------------------------------------------
-- 5 · GRANTS EXPLÍCITOS
--
-- Sin esto la app se ve como si nadie hubiera leído nada, y SIN UN SOLO ERROR:
-- sin GRANT de tabla la policy ni llega a evaluarse (la lección de la 0114 y
-- de la 0133 §7). `anon` no recibe nada: sin sesión no hay nada que leer.
-- ---------------------------------------------------------------------------
revoke all on table public.conversation_reads from anon, authenticated;
revoke all on table public.chat_group_reads   from anon, authenticated;

grant select, insert, update, delete on table public.conversation_reads to authenticated;
grant select, insert, update, delete on table public.chat_group_reads   to authenticated;

grant all on table public.conversation_reads to service_role;
grant all on table public.chat_group_reads   to service_role;


-- ---------------------------------------------------------------------------
-- 6 · Marcar leído
--
-- SECURITY INVOKER: alcanza. La RLS de §3 ya exige ser participante y ser uno
-- mismo, así que la función no necesita más permisos que quien la llama — y una
-- función DEFINER que escribe una tabla es siempre una superficie más para
-- revisar. La fecha NO es parámetro: la pone la base (§2).
-- ---------------------------------------------------------------------------
create or replace function public.marcar_leido_en_conversacion(p_conversation_id uuid)
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
  v_marca  timestamptz;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  insert into public.conversation_reads (conversation_id, profile_id, tenant_id, last_read_at)
  values (p_conversation_id, v_uid, v_tenant, now())
  on conflict (conversation_id, profile_id)
  do update set last_read_at = now()
  returning last_read_at into v_marca;

  return v_marca;
end;
$$;

comment on function public.marcar_leido_en_conversacion(uuid) is
  'Marca un chat 1-a-1 como leído hasta ahora (0137). Idempotente. SECURITY INVOKER: la RLS de conversation_reads ya exige ser participante y ser uno mismo, así que no hace falta elevar. La fecha no se recibe por parámetro — la pone la base, y el trigger app.avanzar_marca_de_lectura() la deja igual porque ya es now().';

revoke all    on function public.marcar_leido_en_conversacion(uuid) from public, anon;
grant execute on function public.marcar_leido_en_conversacion(uuid) to authenticated, service_role;


create or replace function public.marcar_leido_en_grupo(p_group_id uuid)
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
  v_marca  timestamptz;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  insert into public.chat_group_reads (group_id, profile_id, tenant_id, last_read_at)
  values (p_group_id, v_uid, v_tenant, now())
  on conflict (group_id, profile_id)
  do update set last_read_at = now()
  returning last_read_at into v_marca;

  return v_marca;
end;
$$;

comment on function public.marcar_leido_en_grupo(uuid) is
  'Gemela de marcar_leido_en_conversacion() para grupos de chat (0137).';

revoke all    on function public.marcar_leido_en_grupo(uuid) from public, anon;
grant execute on function public.marcar_leido_en_grupo(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7 · Los no leídos de TODA la bandeja, en una sola consulta
--
-- Existe para que la bandeja no haga un `count()` por fila. Con veinte chats
-- abiertos eso son veinte viajes a la base para pintar veinte globitos, que es
-- exactamente el N+1 que el resto del repo viene evitando.
--
-- SECURITY INVOKER a propósito: así los no leídos los filtra la MISMA RLS que
-- decide qué mensajes se ven. Un mensaje vencido, bajado, o de un grupo del que
-- me echaron no se cuenta sin que esta función tenga que acordarse de
-- descontarlo — no puede desincronizarse con las policies porque ES las
-- policies.
--
-- Los míos no cuentan: `sender_id <> v_uid`. Un globito que se prende con lo
-- que uno mismo acaba de escribir es el clásico de esta pantalla.
-- ---------------------------------------------------------------------------
create or replace function public.contar_no_leidos()
returns table (
  tipo      text,
  id        uuid,
  no_leidos integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
begin
  if v_uid is null or v_tenant is null then
    return;
  end if;

  return query
  select 'conversacion'::text,
         c.id,
         count(m.id)::integer
    from public.conversations c
    left join public.conversation_reads r
           on r.conversation_id = c.id
          and r.profile_id = v_uid
    left join public.messages m
           on m.conversation_id = c.id
          and m.sender_id <> v_uid
          and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
   where c.tenant_id = v_tenant
     and (c.created_by = v_uid or c.counterpart_id = v_uid)
   group by c.id

  union all

  select 'grupo'::text,
         g.id,
         count(m.id)::integer
    from public.chat_groups g
    join public.chat_group_members mi
      on mi.group_id = g.id
     and mi.profile_id = v_uid
    left join public.chat_group_reads r
           on r.group_id = g.id
          and r.profile_id = v_uid
    left join public.chat_group_messages m
           on m.group_id = g.id
          and m.sender_id <> v_uid
          and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
   where g.tenant_id = v_tenant
   group by g.id;
end;
$$;

comment on function public.contar_no_leidos() is
  'Los no leídos de toda la bandeja —chats 1-a-1 y grupos— en UNA consulta (0137). Existe para que la bandeja no haga un count() por fila: con veinte chats eso son veinte viajes a la base para pintar veinte globitos. SECURITY INVOKER a propósito: los mensajes los filtra la MISMA RLS que decide qué se ve, así que un mensaje vencido, bajado, o de un grupo del que me echaron deja de contarse sin que esta función tenga que acordarse. Los mensajes propios no cuentan. Devuelve también los hilos en cero, para que la bandeja no tenga que adivinar la diferencia entre "cero" y "no vino".';

revoke all    on function public.contar_no_leidos() from public, anon;
grant execute on function public.contar_no_leidos() to authenticated, service_role;

commit;
