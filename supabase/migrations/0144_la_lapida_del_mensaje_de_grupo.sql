-- =============================================================================
-- 0144_la_lapida_del_mensaje_de_grupo.sql — Comunidad Latina
--
-- La 0142 le puso lápida al mensaje borrado del chat 1-a-1 y dejó a los grupos
-- afuera. Esto es el gemelo, y no es cosmético: la pantalla de chat es UNA sola
-- para el 1-a-1 y para el grupo (0136 §1), así que un mismo componente pinta
-- hoy una lápida en un lado y un hueco en el otro.
--
-- El hueco además miente distinto en un grupo. En un 1-a-1 la charla es de dos
-- y una fila que desaparece se nota; adentro de un grupo, donde el hilo salta
-- de una persona a otra, un mensaje que se esfuma deja las respuestas que lo
-- citaban colgando de la nada y a nadie le queda claro si alguien borró algo o
-- si nunca lo dijo.
--
-- Lo que la 0135 §1 había resuelto era otra cosa: que el borrado NO rompiera el
-- UPDATE (el `using` de un SELECT se aplica también a la fila nueva de un
-- update), y por eso dejó ver la fila borrada a su autor y a quien administra.
-- Los demás miembros la seguían perdiendo de la vista.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · El contenido se destruye al bajar el mensaje.
--
--     Mismo razonamiento que la 0142 §1: vaciar y no maquillar. Una vista que
--     esconda el cuerpo sólo lo tapa para UNA ruta de lectura y lo deja
--     retenido en la fila; en un grupo eso es peor todavía, porque la fila
--     queda al alcance de cualquiera de los N miembros y de la rama de staff
--     de la 0135 §1 durante los 90 días del TTL.
--
--     Se conservan `kind`, `created_at` y `sender_id`: los dos últimos ubican
--     y atribuyen la lápida, el primero no contiene el payload. Los CHECK de
--     §2 admiten la forma vacía únicamente cuando `deleted_at` ya está puesto.
--
--     Las columnas congeladas son las de la tabla de grupos, que NO son las
--     mismas del 1-a-1: acá el hilo es `group_id` y no existe
--     `cipher_envelope`. Se escribe la lista a mano, como las dos versiones
--     anteriores, porque un candado de seguridad se audita leyéndolo.
-- ---------------------------------------------------------------------------
create or replace function app.proteger_columnas_del_mensaje_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sin JWT: service_role, cron, seed y migraciones. Pasan enteros, PERO el
  -- vaciado sí les corre: un borrado suave hecho por un script de moderación
  -- tiene que destruir el contenido igual que el que hace la persona, o el
  -- camino administrativo sería la forma de dejar la lápida con el texto
  -- adentro.
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

  -- La identidad del mensaje no se mueve nunca. `expires_at` incluido: si se
  -- pudiera correr desde un UPDATE, el trigger que lo fuerza en el INSERT
  -- (0133 §5, app.forzar_ttl_de_mensaje_de_grupo) no serviría de nada.
  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.group_id   := old.group_id;
  new.sender_id  := old.sender_id;
  new.created_at := old.created_at;
  new.expires_at := old.expires_at;

  -- Lo que ES el mensaje tampoco. Editar es corregir el texto: una foto no se
  -- convierte en una ubicación, y un adjunto no se cambia por otro dejando el
  -- grupo con un archivo que nadie subió en ese momento.
  new.kind            := old.kind;
  new.adjunto         := old.adjunto;
  new.ubicacion       := old.ubicacion;
  new.compartido_kind := old.compartido_kind;
  new.compartido_id   := old.compartido_id;
  new.reply_to        := old.reply_to;

  -- Bajar un mensaje es para siempre. Sin esto, quien lo bajó podría
  -- devolverlo a la vista después de que el grupo creyera que no está.
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  -- El borrado, que en un grupo también lo puede hacer quien administra y el
  -- equipo de la comunidad sobre un mensaje reportado (0133 §6, 0135 §2). Por
  -- eso esta rama NO pregunta por la autoría: quién puede bajar qué lo decide
  -- chat_group_messages_update, que es una policy y sí autoriza filas. Acá lo
  -- único que se garantiza es que el payload no sobreviva al borrado.
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
    -- Quien administra el grupo y el equipo pueden BAJAR un mensaje, nunca
    -- reescribirlo: moderar es sacar algo de la vista, no poner palabras en la
    -- boca de otro.
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

comment on function app.proteger_columnas_del_mensaje_de_grupo() is
  'BEFORE UPDATE en chat_group_messages: de un mensaje de grupo sólo se pueden cambiar `body` (su autor, dentro de 15 minutos desde created_at) y `deleted_at` (ponerlo, nunca sacarlo). Al bajarlo vacía body, adjunto, ubicación y compartido_* para que la lápida no conserve el contenido que RLS ya no puede enmascarar por columnas — gemela de app.proteger_columnas_del_mensaje_directo() (0142), con las columnas de esta tabla (`group_id` en lugar de `conversation_id`, sin `cipher_envelope`). Todo lo demás se pisa con el valor viejo: una policy autoriza filas, no columnas. `editado_at` lo escribe esta función, no el cliente. Sin JWT (service_role / cron / migraciones) no se congela nada, pero el vaciado corre igual: el camino administrativo no puede ser la forma de dejar una lápida con el texto adentro.';

revoke execute on function app.proteger_columnas_del_mensaje_de_grupo() from public, anon;


-- ---------------------------------------------------------------------------
-- 2 · Los CHECK conocen la única excepción: la lápida ya vacía.
--
--     Los cuatro se reescriben, no sólo el de `body`. El de `body` es el que
--     habilita la cadena vacía, pero los otros tres son los que hacen que el
--     vaciado de §1 pueda siquiera guardarse: un mensaje con `kind = 'imagen'`
--     al que el trigger le puso `adjunto = null` viola
--     `chat_group_messages_adjunto_segun_kind` tal como quedó en la 0136, y el
--     borrado falla con un error de constraint en vez de bajar el mensaje.
--
--     La excepción no vuelve opcionales los payloads: cuando está borrado
--     EXIGE que ya no quede ninguno, incluso si su `kind` original era imagen,
--     ubicación o una tarjeta compartida.
-- ---------------------------------------------------------------------------
alter table public.chat_group_messages drop constraint if exists chat_group_messages_body_check;
alter table public.chat_group_messages
  add constraint chat_group_messages_body_check
    check (
      (deleted_at is not null and body = '')
      or (
        char_length(btrim(body)) <= 2000
        and (char_length(btrim(body)) >= 1 or kind <> 'texto')
      )
    );

alter table public.chat_group_messages drop constraint if exists chat_group_messages_adjunto_segun_kind;
alter table public.chat_group_messages
  add constraint chat_group_messages_adjunto_segun_kind
    check (
      case
        when deleted_at is not null
          then adjunto is null
        when kind in ('imagen', 'video', 'audio', 'archivo')
          then adjunto is not null and coalesce(adjunto ->> 'path', '') <> ''
        else adjunto is null
      end
    );

alter table public.chat_group_messages drop constraint if exists chat_group_messages_ubicacion_segun_kind;
alter table public.chat_group_messages
  add constraint chat_group_messages_ubicacion_segun_kind
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

alter table public.chat_group_messages drop constraint if exists chat_group_messages_compartido_segun_kind;
alter table public.chat_group_messages
  add constraint chat_group_messages_compartido_segun_kind
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
-- 3 · El grupo entero sigue recibiendo la fila borrada.
--
--     La 0135 §1 dejó pasar la fila borrada sólo a su autor y a quien
--     administra, que era lo mínimo para que el UPDATE no se abortara contra su
--     propio `using`. Ahora que el trigger de §1 destruye el payload, esa
--     distinción ya no protege nada: lo que viaja es una lápida, y limitarla a
--     dos roles es exactamente lo que deja el hueco en la pantalla de los
--     demás miembros.
--
--     Efecto lateral bueno: el camino del 99,9% de las lecturas deja de llamar
--     a app.rol_en_grupo() —un segundo definer contra chat_group_members por
--     cada fila del hilo— y queda con la sola pregunta de pertenencia.
--
--     La segunda rama (staff sobre lo reportado, H-2 de la 0135) se conserva
--     ENTERA y no se toca: un grupo es semipúblico, no de lectura libre para
--     el equipo.
--
--     `alter policy` y no drop/create a propósito: mantiene intacto el `to
--     authenticated` de la 0133 §6 y el contrato de exactamente 4 policies por
--     tabla que verifica `npm run check:rls`.
-- ---------------------------------------------------------------------------
alter policy chat_group_messages_select on public.chat_group_messages
using (
  (
    tenant_id = (select app.current_tenant_id())
    and expires_at > now()
    and app.es_miembro_de_grupo(group_id)
  )
  or (
    -- El equipo de la comunidad, y SÓLO sobre un mensaje que alguien reportó.
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
    and exists (
      select 1
        from public.scam_reports r
       where r.target_kind = 'group_message'
         and r.target_id   = chat_group_messages.id
         and r.tenant_id   = chat_group_messages.tenant_id
    )
  )
);

comment on policy chat_group_messages_select on public.chat_group_messages is
  'Leen los miembros del grupo (0133). Desde la 0144 un mensaje BORRADO le llega al grupo ENTERO para que todos vean la lápida en su lugar: una policy decide filas y app.proteger_columnas_del_mensaje_de_grupo() vacía el payload al bajarlo, así que la fila que viaja ya no tiene contenido que esconder. Esto reemplaza la excepción de la 0135 §1 (sólo el autor y quien administra veían lo borrado), que existía para que el USING no abortara el propio UPDATE y de paso dejaba un hueco en la pantalla del resto. La segunda rama es del equipo de la comunidad y llega SÓLO al mensaje que alguien reportó (H-2 de la 0135): un grupo es semipúblico, no de lectura libre para el staff.';

comment on column public.chat_group_messages.deleted_at is
  'Borrado suave: la fila sigue llegando a TODO el grupo para pintar la lápida (0144), pero app.proteger_columnas_del_mensaje_de_grupo() elimina body, adjunto, ubicación y compartido_* en el mismo UPDATE. Lo escribe su autor, quien administra el grupo o el equipo al resolver un reporte; una vez puesto no se saca. `created_at` y `sender_id` sobreviven para ubicar y atribuir la lápida, y el TTL de 90 días termina de barrer la fila.';

commit;
