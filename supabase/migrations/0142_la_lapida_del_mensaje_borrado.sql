-- =============================================================================
-- 0142_la_lapida_del_mensaje_borrado.sql — Comunidad Latina
--
-- Un borrado suave no puede sacar un mensaje de la secuencia: los dos
-- participantes necesitan recibir la fila para pintar la lápida en su lugar.
-- Pero RLS decide filas, no columnas; dejar pasar una fila con su contenido
-- intacto sería seguir entregando aquello que la persona pidió eliminar.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · El contenido se destruye al bajar el mensaje.
--
--     Se elige vaciarlo y no una vista que lo maquille. La vista sólo escondería
--     los datos para una ruta de lectura y los dejaría retenidos en la fila;
--     un borrado tiene que dejar la lápida, no el texto, el archivo, la ubicación
--     ni la tarjeta recuperables por otra consulta.
--
--     `kind`, `created_at` y `sender_id` se conservan: los dos últimos ubican la
--     lápida y la atribuyen, y el primero no contiene el payload. Los CHECK de
--     §2 admiten la forma vacía únicamente cuando `deleted_at` ya está puesto.
-- ---------------------------------------------------------------------------
create or replace function app.proteger_columnas_del_mensaje_directo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if old.deleted_at is null and new.deleted_at is not null then
      new.body            := '';
      new.adjunto         := null;
      new.ubicacion       := null;
      new.compartido_kind := null;
      new.compartido_id   := null;
    end if;
    return new;
  end if;

  new.id              := old.id;
  new.tenant_id       := old.tenant_id;
  new.conversation_id := old.conversation_id;
  new.sender_id       := old.sender_id;
  new.created_at      := old.created_at;
  new.expires_at      := old.expires_at;
  new.cipher_envelope := old.cipher_envelope;

  new.kind            := old.kind;
  new.adjunto         := old.adjunto;
  new.ubicacion       := old.ubicacion;
  new.compartido_kind := old.compartido_kind;
  new.compartido_id   := old.compartido_id;
  new.reply_to        := old.reply_to;

  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    new.body            := '';
    new.adjunto         := null;
    new.ubicacion       := null;
    new.compartido_kind := null;
    new.compartido_id   := null;
    new.editado_at      := old.editado_at;
    return new;
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
    new.editado_at := old.editado_at;
  end if;

  return new;
end;
$$;

comment on function app.proteger_columnas_del_mensaje_directo() is
  'BEFORE UPDATE en messages: de un mensaje directo sólo se pueden cambiar `body` (su autor, dentro de 15 minutos desde created_at) y `deleted_at` (ponerlo, nunca sacarlo). Al bajarlo vacía body, adjunto, ubicación y compartido_* para que la lápida no conserve el contenido que RLS ya no puede enmascarar por columnas. Todo lo demás se pisa con el valor viejo — una policy autoriza filas, no columnas. `editado_at` lo escribe esta función, no el cliente.';

revoke execute on function app.proteger_columnas_del_mensaje_directo() from public, anon;


-- ---------------------------------------------------------------------------
-- 2 · Los CHECK conocen la única excepción: la lápida ya vacía.
--
--     Un mensaje vivo sigue validándose igual que desde la 0136. La excepción
--     no vuelve opcionales los payloads: cuando está borrado exige que ya no
--     quede ninguno, incluso si su `kind` original era imagen, ubicación o una
--     tarjeta compartida.
-- ---------------------------------------------------------------------------
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages
  add constraint messages_body_check
    check (
      (deleted_at is not null and body = '')
      or (
        char_length(btrim(body)) <= 2000
        and (char_length(btrim(body)) >= 1 or kind <> 'texto')
      )
    );

alter table public.messages drop constraint if exists messages_adjunto_segun_kind;
alter table public.messages
  add constraint messages_adjunto_segun_kind
    check (
      case
        when deleted_at is not null
          then adjunto is null
        when kind in ('imagen', 'video', 'audio', 'archivo')
          then adjunto is not null and coalesce(adjunto ->> 'path', '') <> ''
        else adjunto is null
      end
    );

alter table public.messages drop constraint if exists messages_ubicacion_segun_kind;
alter table public.messages
  add constraint messages_ubicacion_segun_kind
    check (
      case
        when deleted_at is not null
          then ubicacion is null
        when kind = 'ubicacion' then
          ubicacion is not null
          and jsonb_typeof(ubicacion -> 'lat') = 'number'
          and jsonb_typeof(ubicacion -> 'lng') = 'number'
          and (ubicacion ->> 'lat')::numeric between -90 and 90
          and (ubicacion ->> 'lng')::numeric between -180 and 180
        else ubicacion is null
      end
    );

alter table public.messages drop constraint if exists messages_compartido_segun_kind;
alter table public.messages
  add constraint messages_compartido_segun_kind
    check (
      case
        when deleted_at is not null
          then compartido_kind is null and compartido_id is null
        when kind in ('contenido', 'perfil')
          then compartido_kind is not null and compartido_id is not null
        else compartido_kind is null and compartido_id is null
      end
      and (compartido_kind is null or compartido_kind in
           ('post', 'listing', 'job', 'business', 'video', 'profile', 'group'))
      and (kind <> 'perfil' or compartido_kind = 'profile')
    );


-- ---------------------------------------------------------------------------
-- 3 · La conversación sigue recibiendo la fila borrada.
--
--     H-1 de la 0135 dejó el precedente: ocultarla a todos rompe el UPDATE y
--     deja una charla que salta de un mensaje al siguiente. En un 1-a-1 ambos
--     ya son participantes de la misma conversación; no se abre una rama de
--     staff ni de global_admin, porque la privacidad estricta de la 0006 sigue
--     siendo parte del contrato.
-- ---------------------------------------------------------------------------
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
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
);

comment on policy messages_select on public.messages is
  'Leen sólo los dos participantes de la conversación y sólo en su tenant. Desde la 0142 un mensaje BORRADO conserva esa fila para que ambos vean la lápida en su lugar: una policy decide filas y el trigger vacía el payload al bajarlo. No hay rama de staff ni de global_admin; el chat privado sigue sin ser un honeypot.';

comment on column public.messages.deleted_at is
  'Borrado suave: la fila sigue llegando sólo a los participantes para pintar la lápida, pero app.proteger_columnas_del_mensaje_directo() elimina body, adjunto, ubicación y compartido_* en el mismo UPDATE. `created_at` y `sender_id` sobreviven para ubicarla y atribuirla; el TTL de 90 días termina de barrer la fila.';

commit;
