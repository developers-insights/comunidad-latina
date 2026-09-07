-- =============================================================================
-- 0136_mensajes_que_no_son_solo_texto.sql — Comunidad Latina
--
-- Un mensaje deja de ser una cadena de texto: puede ser una foto, un video, un
-- audio con su onda dibujada, un archivo, una ubicación, una tarjeta de perfil
-- o la tarjeta de algo publicado en la comunidad. Y se puede responder citando
-- otro mensaje, corregir un dedazo, o bajar lo que se mandó por error.
--
-- LAS DOS TABLAS SE TOCAN IGUAL. `messages` (0006, chat 1-a-1) y
-- `chat_group_messages` (0133, grupos) reciben exactamente las mismas columnas
-- con los mismos nombres, los mismos CHECK y los mismos triggers. No es
-- prolijidad: la pantalla de chat es UNA sola para los dos casos y el día que
-- las formas se separen —`adjunto` acá, `attachment` allá— cada componente que
-- pinta un mensaje necesita saber en cuál de los dos está parado.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POR QUÉ SE AFLOJA LA INMUTABILIDAD (y qué NO se afloja)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La 0006 dejó `messages_update using(false)` y la escribió como contrato:
-- «Sin edición de mensajes: inmutables por contrato». La 0133 dijo lo mismo
-- para grupos («un mensaje se baja, no se reescribe») y la 0135 lo hizo cumplir
-- por columna con app.proteger_columnas_del_mensaje_de_grupo().
--
-- Eso se afloja acá, y conviene ser preciso sobre QUÉ era esa regla, porque hay
-- dos cosas distintas encimadas:
--
--   · El TTL de 90 días y la minimización de datos (§5.4) — eso NO se toca.
--     `expires_at` sigue pinneado por los triggers de la 0006/0133 en el INSERT
--     y ahora también en el UPDATE. Editar un mensaje no le corre el
--     vencimiento ni un segundo. Sigue valiendo entero: lo que se borra rápido
--     no es subpoenable después.
--
--   · «Un mensaje no se edita» — eso era una decisión de PRODUCTO, no una
--     obligación de cumplimiento, y el cliente la cambió. Lo que se abre es una
--     ventana de 15 minutos para el AUTOR, que es el tiempo de un dedazo, no la
--     capacidad de reescribir la historia. Pasados los 15 minutos el cuerpo
--     vuelve a ser inmutable para siempre.
--
-- Y la edición queda VISIBLE: `editado_at` lo pone la base (no el cliente) en
-- el mismo UPDATE que cambia el cuerpo. Sin esa marca, editar sería poder
-- cambiar lo que la otra persona ya leyó sin que se entere — que es la razón
-- real por la que la 0006 no quería edición. Con la marca, no.
--
-- El resto sigue congelado y ahora por trigger en las DOS tablas: quién lo
-- mandó, en qué conversación, de qué comunidad, cuándo, y de qué tipo es.
-- Una policy autoriza FILAS, no COLUMNAS; el candado por columna va en el
-- trigger (mismo criterio que la 0135 §3).
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. `body` VACÍO SÍ, NULLABLE NO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Una foto sin epígrafe es un mensaje con cuerpo vacío. Hay dos formas de
-- representarlo y sólo una es barata:
--
--   · NULLABLE: hay que revisar cada policy, cada trigger y cada lectura del
--     repo que hoy asume `body not null`. `messages.body` es `text not null`
--     desde la 0006 y arriba de eso hay policies vivas en producción.
--     Un `null` que se cuela en una comparación no da error: da NULL, que en un
--     `check`/`using` se lee como "no pasa" y el mensaje desaparece sin ruido.
--
--   · CADENA VACÍA: `''` ya pasa el `not null`. En `messages` no hay que tocar
--     nada (esa tabla no tenía NINGÚN check sobre `body`); en
--     `chat_group_messages` alcanza con correr el piso del check de longitud
--     de 1 a 0 y sólo cuando el mensaje NO es de texto.
--
-- Se elige la segunda. Y el check no queda "cualquier cosa puede ser vacía":
-- un mensaje de tipo `texto` sigue obligado a traer texto. Vacío sólo lo puede
-- estar el que trae otra cosa adentro.
--
-- CONTRATO PARA QUIEN LEE: `body` nunca es null. Un mensaje sin epígrafe trae
-- `''`. No hace falta `?? ''` en ningún lado.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. `compartido_*` NO LLEVA FK, A PROPÓSITO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Los destinos que se comparten viven en tablas distintas (`posts`, `listings`,
-- `profiles`, `chat_groups`…), así que una FK real necesitaría una columna por
-- destino. Y sobre todo: borrar el original NO puede borrar el mensaje. Si
-- alguien baja su publicación, la conversación donde la compartimos tiene que
-- seguir existiendo — la tarjeta pasa a decir "ya no está disponible" y eso lo
-- resuelve la UI, no la base. Es el mismo criterio que `reactions` (0007), que
-- tampoco tiene FK física al sujeto.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Las columnas nuevas, iguales en las dos tablas
-- ---------------------------------------------------------------------------

alter table public.messages
  add column kind            text not null default 'texto',
  add column adjunto         jsonb,
  add column ubicacion       jsonb,
  add column compartido_kind text,
  add column compartido_id   uuid,
  add column reply_to        uuid references public.messages(id) on delete set null,
  add column editado_at      timestamptz,
  add column deleted_at      timestamptz;

alter table public.chat_group_messages
  add column kind            text not null default 'texto',
  add column adjunto         jsonb,
  add column ubicacion       jsonb,
  add column compartido_kind text,
  add column compartido_id   uuid,
  add column reply_to        uuid references public.chat_group_messages(id) on delete set null,
  add column editado_at      timestamptz;
-- `chat_group_messages.deleted_at` ya existe desde la 0133.

comment on column public.messages.kind is
  'Qué ES este mensaje: texto | imagen | video | audio | archivo | ubicacion | perfil | contenido. "contenido" es la tarjeta de algo publicado en la comunidad (una publicación, un aviso, un empleo, un negocio, un video); "perfil" es la tarjeta de una persona. El tipo decide qué columna de las de abajo tiene que venir llena, y los CHECK de §2 lo hacen cumplir.';
comment on column public.messages.adjunto is
  'El archivo, cuando kind es imagen/video/audio/archivo: {path, mime, bytes, nombre, ancho, alto, duracion_ms, onda}. `path` es la ruta DENTRO del bucket privado chat-media (0140) y es lo único que el CHECK exige — tiene que coincidir EXACTA con storage.objects.name o la policy de lectura del bucket no encuentra el mensaje y el archivo no se ve. `onda` es un arreglo corto de enteros 0-100 para dibujar la forma del audio sin bajarlo.';
comment on column public.messages.ubicacion is
  '{lat, lng, etiqueta} y sólo cuando kind = ubicacion. Se guarda el punto que la persona decidió mandar, no su posición: acá no hay rastreo, hay un mensaje.';
comment on column public.messages.compartido_kind is
  'Qué tipo de cosa se compartió: post | listing | job | business | video | profile | group. Sin FK a propósito (§3 de la migración): borrar el original no puede borrar el mensaje.';
comment on column public.messages.reply_to is
  'El mensaje que se está citando. ON DELETE SET NULL: si el citado se borra, la respuesta sobrevive y pierde la cita — nunca al revés. Que el citado sea de la MISMA conversación lo verifica app.validar_respuesta_de_mensaje_directo(): un CHECK no puede consultar otra fila.';
comment on column public.messages.editado_at is
  'Cuándo se corrigió el cuerpo. Lo escribe la BASE en el trigger, nunca el cliente. Es lo que hace que editar sea aceptable: sin esta marca, editar es cambiar lo que la otra persona ya leyó sin que se entere.';
comment on column public.messages.deleted_at is
  'Borrado suave, gemelo del de chat_group_messages (0133). La policy de SELECT esconde la fila desde ese instante y el TTL de 90 días la termina de barrer. Una vez puesto no se saca: el trigger lo repone (un mensaje bajado no se resucita).';

comment on column public.chat_group_messages.kind is
  'Gemela EXACTA de messages.kind (0136). La pantalla de chat es una sola para el 1-a-1 y para el grupo: si las formas se separan, cada componente que pinta un mensaje necesita saber en cuál de las dos tablas está parado.';
comment on column public.chat_group_messages.adjunto is
  'Gemela EXACTA de messages.adjunto (0136). Misma forma, mismo bucket privado chat-media, mismo contrato de que `path` coincide con storage.objects.name.';
comment on column public.chat_group_messages.ubicacion is
  'Gemela EXACTA de messages.ubicacion (0136).';
comment on column public.chat_group_messages.compartido_kind is
  'Gemela EXACTA de messages.compartido_kind (0136).';
comment on column public.chat_group_messages.reply_to is
  'Gemela de messages.reply_to (0136), acotada al MISMO grupo por app.validar_respuesta_de_mensaje_de_grupo().';
comment on column public.chat_group_messages.editado_at is
  'Gemela EXACTA de messages.editado_at (0136).';


-- ---------------------------------------------------------------------------
-- 2 · Los CHECK: que el tipo y el contenido no se contradigan
--
-- Van como constraints con nombre y no como una sola expresión gigante porque
-- el nombre del constraint es lo ÚNICO que ve el cliente cuando falla: con
-- `messages_adjunto_segun_kind` se sabe qué mandó mal, con un check anónimo se
-- sabe que "algo" del mensaje no cerró.
-- ---------------------------------------------------------------------------

alter table public.messages
  add constraint messages_kind_check
    check (kind in ('texto', 'imagen', 'video', 'audio', 'archivo', 'ubicacion', 'perfil', 'contenido'));

alter table public.chat_group_messages
  add constraint chat_group_messages_kind_check
    check (kind in ('texto', 'imagen', 'video', 'audio', 'archivo', 'ubicacion', 'perfil', 'contenido'));

-- 2.1 · El cuerpo. Vacío SÓLO si el mensaje trae otra cosa adentro (§2).
--
-- `messages` no tenía NINGÚN check sobre `body` desde la 0006: hoy un cuerpo de
-- 10 MB entra sin que nada lo pare. Se le pone el mismo techo de 2000 que
-- `chat_group_messages` de paso, porque el tope es lo que impide que un pegado
-- accidental convierta una conversación en algo que la pantalla no puede pintar.
alter table public.messages
  add constraint messages_body_check
    check (
      char_length(btrim(body)) <= 2000
      and (char_length(btrim(body)) >= 1 or kind <> 'texto')
    );

alter table public.chat_group_messages drop constraint chat_group_messages_body_check;
alter table public.chat_group_messages
  add constraint chat_group_messages_body_check
    check (
      char_length(btrim(body)) <= 2000
      and (char_length(btrim(body)) >= 1 or kind <> 'texto')
    );

-- 2.2 · El adjunto va si y sólo si el tipo lo pide, y trae ruta.
--
-- La rama `else adjunto is null` es la mitad que importa: sin ella se puede
-- mandar un mensaje de texto con un adjunto colgado que ninguna pantalla pinta
-- y que ningún borrado limpia — un archivo huérfano en un bucket privado.
alter table public.messages
  add constraint messages_adjunto_segun_kind
    check (
      case
        when kind in ('imagen', 'video', 'audio', 'archivo')
          then adjunto is not null and coalesce(adjunto ->> 'path', '') <> ''
        else adjunto is null
      end
    );

alter table public.chat_group_messages
  add constraint chat_group_messages_adjunto_segun_kind
    check (
      case
        when kind in ('imagen', 'video', 'audio', 'archivo')
          then adjunto is not null and coalesce(adjunto ->> 'path', '') <> ''
        else adjunto is null
      end
    );

-- 2.3 · La ubicación, igual. `jsonb_typeof` antes que el rango: un lat que
--       llega como la cadena "-34.6" no es un número y no entra — si entrara,
--       la comparación de rango sería un cast que revienta en tiempo de
--       consulta, mucho más lejos de donde está el error.
alter table public.messages
  add constraint messages_ubicacion_segun_kind
    check (
      case
        when kind = 'ubicacion' then
          ubicacion is not null
          and jsonb_typeof(ubicacion -> 'lat') = 'number'
          and jsonb_typeof(ubicacion -> 'lng') = 'number'
          and (ubicacion ->> 'lat')::numeric between -90 and 90
          and (ubicacion ->> 'lng')::numeric between -180 and 180
        else ubicacion is null
      end
    );

alter table public.chat_group_messages
  add constraint chat_group_messages_ubicacion_segun_kind
    check (
      case
        when kind = 'ubicacion' then
          ubicacion is not null
          and jsonb_typeof(ubicacion -> 'lat') = 'number'
          and jsonb_typeof(ubicacion -> 'lng') = 'number'
          and (ubicacion ->> 'lat')::numeric between -90 and 90
          and (ubicacion ->> 'lng')::numeric between -180 and 180
        else ubicacion is null
      end
    );

-- 2.4 · Lo compartido. Las dos columnas viajan juntas o no viajan, y
--       `kind = 'perfil'` no puede apuntar a otra cosa que a una persona:
--       sin esa última línea, una "tarjeta de perfil" podría llevar adentro el
--       id de un grupo privado y la UI lo pintaría igual.
alter table public.messages
  add constraint messages_compartido_segun_kind
    check (
      case
        when kind in ('contenido', 'perfil')
          then compartido_kind is not null and compartido_id is not null
        else compartido_kind is null and compartido_id is null
      end
      and (compartido_kind is null or compartido_kind in
           ('post', 'listing', 'job', 'business', 'video', 'profile', 'group'))
      and (kind <> 'perfil' or compartido_kind = 'profile')
    );

alter table public.chat_group_messages
  add constraint chat_group_messages_compartido_segun_kind
    check (
      case
        when kind in ('contenido', 'perfil')
          then compartido_kind is not null and compartido_id is not null
        else compartido_kind is null and compartido_id is null
      end
      and (compartido_kind is null or compartido_kind in
           ('post', 'listing', 'job', 'business', 'video', 'profile', 'group'))
      and (kind <> 'perfil' or compartido_kind = 'profile')
    );


-- ---------------------------------------------------------------------------
-- 3 · Índices de las columnas nuevas
--
-- `reply_to` NO es opcional indexarlo. Postgres no indexa las FK solo, y con
-- `on delete set null` cada borrado de un mensaje tiene que buscar quién lo
-- citaba: sin índice eso es un scan de la tabla entera por cada mensaje que
-- alguien baja, en la tabla que más crece de todo el módulo.
-- ---------------------------------------------------------------------------
create index messages_reply_to_idx
  on public.messages (reply_to) where reply_to is not null;

create index chat_group_messages_reply_to_idx
  on public.chat_group_messages (reply_to) where reply_to is not null;

-- "¿Dónde se compartió esto?" — lo necesita el contador de veces compartido y
-- la limpieza del día que un destino se borre de verdad.
create index messages_compartido_idx
  on public.messages (compartido_kind, compartido_id) where compartido_id is not null;

create index chat_group_messages_compartido_idx
  on public.chat_group_messages (compartido_kind, compartido_id) where compartido_id is not null;


-- ---------------------------------------------------------------------------
-- 4 · La cita tiene que ser del MISMO hilo
--
-- Un CHECK no puede mirar otra fila, así que esto es un trigger. Y no es una
-- formalidad: `reply_to` es un uuid que manda el cliente. Sin esta validación,
-- responder "citando" el id de un mensaje de OTRA conversación haría que la
-- pantalla del hilo pidiera ese mensaje para pintar la cita. La RLS de
-- `messages` no lo devolvería —así que no se filtraría el texto— pero el
-- INSERT contestaría distinto según el id existiera o no, y eso solo ya
-- confirma qué ids son mensajes reales.
--
-- Se valida sólo en el INSERT: en el UPDATE, `reply_to` queda pinneado por los
-- triggers de §5, así que no hay forma de moverlo después.
-- ---------------------------------------------------------------------------
create or replace function app.validar_respuesta_de_mensaje_directo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reply_to is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.messages m
     where m.id = new.reply_to
       and m.conversation_id = new.conversation_id
       and m.tenant_id = new.tenant_id
  ) then
    raise exception 'REPLY_OUT_OF_THREAD: sólo se puede citar un mensaje de esta misma conversación.';
  end if;

  return new;
end;
$$;

comment on function app.validar_respuesta_de_mensaje_directo() is
  'BEFORE INSERT en messages: el mensaje citado tiene que ser de la MISMA conversación y del mismo tenant. Es un trigger y no un CHECK porque un CHECK no puede consultar otra fila. SECURITY DEFINER a propósito: la comprobación no puede depender de que la fila citada sea visible para quien escribe — si dependiera, citar un id ajeno y citar un id inexistente contestarían distinto.';

revoke execute on function app.validar_respuesta_de_mensaje_directo() from public, anon;

create trigger messages_validar_respuesta
before insert on public.messages
for each row execute function app.validar_respuesta_de_mensaje_directo();


create or replace function app.validar_respuesta_de_mensaje_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reply_to is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.chat_group_messages m
     where m.id = new.reply_to
       and m.group_id = new.group_id
       and m.tenant_id = new.tenant_id
  ) then
    raise exception 'REPLY_OUT_OF_THREAD: sólo se puede citar un mensaje de este mismo grupo.';
  end if;

  return new;
end;
$$;

comment on function app.validar_respuesta_de_mensaje_de_grupo() is
  'Gemela de app.validar_respuesta_de_mensaje_directo() para grupos: el mensaje citado tiene que ser del MISMO grupo.';

revoke execute on function app.validar_respuesta_de_mensaje_de_grupo() from public, anon;

create trigger chat_group_messages_validar_respuesta
before insert on public.chat_group_messages
for each row execute function app.validar_respuesta_de_mensaje_de_grupo();


-- ---------------------------------------------------------------------------
-- 5 · Qué se puede cambiar de un mensaje ya mandado
--
-- LA VENTANA SON 15 MINUTOS Y LA MIDE LA BASE contra `created_at`, no el
-- cliente. Un reloj de navegador se cambia desde Configuración.
--
-- Las dos funciones son la misma con distinto nombre de columna de hilo. Se
-- escriben duplicadas y no genéricas porque una función que recibe el nombre de
-- la tabla por `tg_argv` y arma SQL dinámico para pinnear columnas es más
-- difícil de auditar que dos copias de veinte líneas — y esto es un candado de
-- seguridad, no lógica de negocio.
-- ---------------------------------------------------------------------------
create or replace function app.proteger_columnas_del_mensaje_directo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sin JWT: service_role, cron, seed y migraciones. Mismo criterio que
  -- app.proteger_columnas_del_mensaje_de_grupo() (0135 §3).
  if auth.uid() is null then
    return new;
  end if;

  -- La identidad del mensaje no se mueve nunca. `expires_at` incluido: si se
  -- pudiera correr desde un UPDATE, el trigger que lo fuerza en el INSERT
  -- (0006, app.messages_force_ttl) no serviría de nada.
  new.id              := old.id;
  new.tenant_id       := old.tenant_id;
  new.conversation_id := old.conversation_id;
  new.sender_id       := old.sender_id;
  new.created_at      := old.created_at;
  new.expires_at      := old.expires_at;
  new.cipher_envelope := old.cipher_envelope;

  -- Lo que ES el mensaje tampoco. Editar es corregir el texto: una foto no se
  -- convierte en una ubicación, y un adjunto no se cambia por otro dejando la
  -- conversación con un archivo que nadie subió en ese momento.
  new.kind            := old.kind;
  new.adjunto         := old.adjunto;
  new.ubicacion       := old.ubicacion;
  new.compartido_kind := old.compartido_kind;
  new.compartido_id   := old.compartido_id;
  new.reply_to        := old.reply_to;

  -- Bajar un mensaje es para siempre. Sin esto, quien lo bajó podría
  -- devolverlo a la vista después de que la otra persona creyera que no está.
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  if new.body is distinct from old.body then
    if auth.uid() <> old.sender_id then
      raise exception 'NOT_MESSAGE_AUTHOR: sólo quien lo escribió puede corregir un mensaje.';
    end if;
    if old.deleted_at is not null then
      raise exception 'MESSAGE_DELETED: este mensaje ya no está; no se puede editar.';
    end if;
    if old.created_at < now() - interval '15 minutes' then
      raise exception 'EDIT_WINDOW_CLOSED: los mensajes se pueden corregir hasta 15 minutos después de enviarlos.';
    end if;
    new.editado_at := now();
  else
    -- `editado_at` la escribe la base o no se escribe. Un cliente que la mande
    -- podría marcar como editado algo que nunca cambió, o —peor— dejar sin
    -- marca una corrección real.
    new.editado_at := old.editado_at;
  end if;

  return new;
end;
$$;

comment on function app.proteger_columnas_del_mensaje_directo() is
  'BEFORE UPDATE en messages: de un mensaje directo sólo se pueden cambiar `body` (su autor, dentro de 15 minutos desde created_at) y `deleted_at` (ponerlo, nunca sacarlo). Todo lo demás se pisa con el valor viejo — una policy autoriza filas, no columnas. `editado_at` lo escribe esta función, no el cliente: sin esa marca, editar sería cambiar lo que la otra persona ya leyó sin que se entere, que es el motivo real por el que la 0006 no quería edición. Sin JWT (service_role / cron / migraciones) no se toca nada.';

revoke execute on function app.proteger_columnas_del_mensaje_directo() from public, anon;

create trigger messages_proteger_columnas
before update on public.messages
for each row execute function app.proteger_columnas_del_mensaje_directo();


-- 5.1 · La de grupos: REEMPLAZA la de la 0135 §3, que pisaba `body` siempre.
--       Se conserva todo lo que aquella congelaba y se le suma la ventana de
--       edición y las columnas nuevas de §1.
create or replace function app.proteger_columnas_del_mensaje_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.group_id   := old.group_id;
  new.sender_id  := old.sender_id;
  new.created_at := old.created_at;
  new.expires_at := old.expires_at;

  new.kind            := old.kind;
  new.adjunto         := old.adjunto;
  new.ubicacion       := old.ubicacion;
  new.compartido_kind := old.compartido_kind;
  new.compartido_id   := old.compartido_id;
  new.reply_to        := old.reply_to;

  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  if new.body is distinct from old.body then
    -- Quien administra el grupo y el equipo de la comunidad pueden BAJAR un
    -- mensaje (0133 §6, 0135 §2), nunca reescribirlo: moderar es sacar algo de
    -- la vista, no poner palabras en la boca de otro.
    if auth.uid() <> old.sender_id then
      raise exception 'NOT_MESSAGE_AUTHOR: sólo quien lo escribió puede corregir un mensaje.';
    end if;
    if old.deleted_at is not null then
      raise exception 'MESSAGE_DELETED: este mensaje ya no está; no se puede editar.';
    end if;
    if old.created_at < now() - interval '15 minutes' then
      raise exception 'EDIT_WINDOW_CLOSED: los mensajes se pueden corregir hasta 15 minutos después de enviarlos.';
    end if;
    new.editado_at := now();
  else
    new.editado_at := old.editado_at;
  end if;

  return new;
end;
$$;

comment on function app.proteger_columnas_del_mensaje_de_grupo() is
  'BEFORE UPDATE en chat_group_messages. REEMPLAZA a la versión de la 0135 §3, que pisaba `body` en todos los casos: desde la 0136 su AUTOR puede corregirlo dentro de los 15 minutos y la base marca `editado_at`. Quien administra y el equipo siguen pudiendo BAJARLO y nada más — moderar es sacar de la vista, no reescribir lo que dijo otro. El resto de las columnas, `expires_at` incluida, se pisan con el valor viejo.';


-- ---------------------------------------------------------------------------
-- 6 · Las policies que la edición necesita
-- ---------------------------------------------------------------------------

-- 6.1 · Los mensajes bajados no se leen. `deleted_at is null` recién existe
--       acá, así que hasta esta migración no había nada que esconder.
alter policy messages_select on public.messages
using (
  tenant_id = (select app.current_tenant_id())
  and expires_at > now()
  and deleted_at is null
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and c.tenant_id = messages.tenant_id
      and (
        c.created_by = (select auth.uid())
        or c.counterpart_id = (select auth.uid())
      )
  )
);

-- 6.2 · UPDATE deja de ser `false`.
--
-- SIN RAMA DE MODERACIÓN, y es deliberado: la 0006 lo escribió con todas las
-- letras —«Ni staff ni global_admin leen mensajes privados por policy (§5.4 —
-- no somos un honeypot de chats)»— y darle al equipo la capacidad de bajar un
-- mensaje de un chat privado supone poder leerlo antes. En grupos sí existe esa
-- rama (0135) porque un grupo tiene moderación; una conversación de dos, no.
-- Un mensaje privado que molesta se reporta (report_scam) y se bloquea a la
-- persona; el contenido no lo toca nadie más que su autor.
alter policy messages_update on public.messages
using (
  tenant_id = (select app.current_tenant_id())
  and sender_id = (select auth.uid())
  and expires_at > now()
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and c.tenant_id = messages.tenant_id
      and (
        c.created_by = (select auth.uid())
        or c.counterpart_id = (select auth.uid())
      )
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and sender_id = (select auth.uid())
);

comment on policy messages_update on public.messages is
  'Desde la 0136 el AUTOR puede corregir su mensaje (15 minutos, ventana que mide el trigger) y bajarlo. Nadie más lo toca: no hay rama de staff ni de global_admin, por el mismo motivo que la 0006 no la puso en SELECT — no somos un honeypot de chats. Qué columnas se pueden mover lo decide app.proteger_columnas_del_mensaje_directo(), no esta policy: una policy autoriza filas.';

-- 6.3 · En grupos, el `with check` de la 0135 exigía `deleted_at is not null`:
--       o sea que TODO update tenía que ser un borrado. Con eso, editar era
--       imposible. Se abre la segunda rama y se conserva entera la primera.
alter policy chat_group_messages_update on public.chat_group_messages
using (
  tenant_id = (select app.current_tenant_id())
  and deleted_at is null
  and (
    sender_id = (select auth.uid())
    or app.rol_en_grupo(group_id) in ('owner', 'admin')
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    -- (a) bajarlo: su autor, quien administra, o el equipo (0133 §6 + 0135 §2)
    (
      deleted_at is not null
      and (
        sender_id = (select auth.uid())
        or app.rol_en_grupo(group_id) in ('owner', 'admin')
        or (select app.current_user_role()) in ('domain_admin', 'global_admin')
      )
    )
    -- (b) corregirlo: sólo su autor. La ventana de 15 minutos y el hecho de que
    --     lo único que cambie sea el cuerpo los cuida el trigger de §5.1.
    or (
      deleted_at is null
      and sender_id = (select auth.uid())
    )
  )
);

comment on policy chat_group_messages_update on public.chat_group_messages is
  'Dos operaciones distintas sobre la misma fila: BAJARLO (su autor, quien administra el grupo, o el equipo de la comunidad al resolver un reporte) y CORREGIRLO (sólo su autor, dentro de 15 minutos). Hasta la 0135 el with check exigía deleted_at is not null, lo que volvía imposible la segunda. Que corregir signifique sólo cambiar el cuerpo lo garantiza app.proteger_columnas_del_mensaje_de_grupo(), no esta policy.';

commit;
