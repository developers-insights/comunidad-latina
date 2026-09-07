-- =============================================================================
-- 0148_esta_escribiendo_en_vivo.sql — Comunidad Latina
--
-- Quién puede avisar "estoy escribiendo…" y quién puede escucharlo.
--
-- El cartel viaja por Supabase Realtime BROADCAST, no por una tabla y no por
-- `postgres_changes`. Que alguien esté tecleando dura segundos y no le importa
-- a nadie un minuto después: guardarlo en Postgres sería una fila por pulsación
-- —con su WAL, su replicación y su limpieza— para un dato que nace vencido.
-- `postgres_changes`, que es lo que usa la señalización de llamadas de la 0143,
-- escucha CAMBIOS DE FILAS, así que exige primero la fila. Es el mismo problema
-- con un paso más.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POR QUÉ ESTO NECESITA UNA MIGRACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Un canal de broadcast, por default, es PÚBLICO: cualquiera que sepa el nombre
-- entra, emite y escucha. Para una conversación privada eso es inaceptable —
-- alcanzaría con adivinar un uuid para saber cuándo dos personas se están
-- escribiendo, y para hacerles aparecer un cartel falso.
--
-- La respuesta de Supabase son los canales PRIVADOS (`config.private = true` en
-- el cliente), que hacen que Realtime consulte las policies de RLS de
-- `realtime.messages` antes de dejar entrar. Sin policy no hay permiso: un canal
-- privado sin nada que lo autorice queda mudo. O sea que este archivo NO es un
-- endurecimiento opcional — sin él la función no anda.
--
-- ⚠️ ESTO NO TOCA LOS CANALES DE LLAMADAS DE LA 0143. Aquéllos son canales
-- públicos de `postgres_changes`, que resuelven permisos por la RLS de `calls` y
-- `call_participants` y ni miran esta tabla. No hace falta apagar "Allow public
-- access" en la configuración de Realtime, y no hay que hacerlo: apagarlo
-- dejaría sin timbre a las llamadas.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. EL NOMBRE DEL TÓPICO ES EL PERMISO
-- ═══════════════════════════════════════════════════════════════════════════
--
--     escribiendo-directo:<conversation_id>
--     escribiendo-grupo:<group_id>
--
-- Los dos prefijos están escritos, letra por letra, en
-- `src/lib/messaging/escribiendo.ts` (`PREFIJO_DIRECTO`, `PREFIJO_GRUPO`).
--
-- ⚠️ SI ALLÁ CAMBIA UN PREFIJO, CAMBIA ACÁ. El modo de falla no es ruidoso: un
-- tópico que no matchea ninguna policy simplemente no autoriza a nadie, y desde
-- la app se ve igual que "nadie está escribiendo".
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. EL AISLAMIENTO SE APOYA EN LAS TABLAS QUE YA DECIDEN ESTO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ni una de las cuatro policies pregunta por `tenant_id`, y es a propósito: el
-- `exists` corre con los permisos de QUIEN PREGUNTA, así que `conversations` y
-- `chat_group_members` aplican su propia RLS —que ya incluye el tenant— antes de
-- contestar. Es el mismo razonamiento de `chat_media_select` en la 0140: no se
-- reimplementa la regla, se le pregunta a la que ya existe. Repetirla acá sería
-- una segunda verdad, que es lo que la 0044 dejó escrito que no hay que hacer.
--
-- Lo que SÍ se agrega, arriba de eso:
--
--   · `status = 'accepted'` en el chat 1-a-1. No es cosmética: en una
--     conversación BLOQUEADA, poder emitir sería dejar que alguien a quien
--     bloquearon te haga aparecer un cartel; y poder escuchar sería enterarse de
--     cuándo está frente al teléfono la persona que te bloqueó. Los mensajes ya
--     no pasan; el aviso de tecleo tampoco.
--   · Membresía en el grupo. Es toda la frontera que hace falta ahí: quien no
--     está adentro no emite ni escucha. Que el grupo esté CERRADO no se
--     comprueba acá — un grupo cerrado es de sólo lectura por regla de producto
--     (la app no monta el canal) y un aviso de tecleo entre miembros del mismo
--     grupo cerrado no filtra nada que no vean ya.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · El uuid que lleva adentro un tópico, o NULL
--
--     `split_part(topic, ':', 2)::uuid` —que es lo que muestran los ejemplos de
--     Supabase— no sirve tal cual acá: si el tópico no trae un uuid, el cast
--     LANZA, y una excepción adentro de una policy no la niega prolijamente
--     sino que rompe la consulta. Y no alcanza con poner el regex al lado con
--     un `and`: el planner puede evaluar los dos términos en cualquier orden.
--
--     El `case` sí garantiza el orden, y por eso el cast vive adentro de uno.
--
--     El prefijo se compara con `left()` y se recorta con `substr()`, nunca
--     interpolándolo en un regex: así el argumento no puede cambiar el patrón.
-- ---------------------------------------------------------------------------
create or replace function app.hilo_de_topico(topico text, prefijo text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when topico is not null
            and prefijo is not null
            and left(topico, length(prefijo) + 1) = prefijo || ':'
            and substr(topico, length(prefijo) + 2) ~
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then substr(topico, length(prefijo) + 2)::uuid
         end
$$;

comment on function app.hilo_de_topico(text, text) is
  'El uuid que un tópico de Realtime lleva después de su prefijo, o NULL si no lo lleva. El cast va adentro de un CASE porque un ::uuid que falla LANZA, y una excepción adentro de una policy rompe la consulta en vez de negarla. Ver 0148.';

revoke all    on function app.hilo_de_topico(text, text) from public, anon;
grant execute on function app.hilo_de_topico(text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2 · Chat 1-a-1 — escuchar y emitir
--
--     Las dos policies preguntan exactamente lo mismo; cambia el verbo. Se
--     escriben separadas y no con una sola `for all` porque un SELECT y un
--     INSERT sobre `realtime.messages` son dos permisos distintos (recibir y
--     mandar) y el día que uno tenga que aflojarse, el otro no tiene por qué.
-- ---------------------------------------------------------------------------
drop policy if exists escribiendo_directo_recibir on realtime.messages;
create policy escribiendo_directo_recibir
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
      from public.conversations c
     where c.id = app.hilo_de_topico((select realtime.topic()), 'escribiendo-directo')
       and c.status = 'accepted'
       and (select auth.uid()) in (c.created_by, c.counterpart_id)
  )
);

comment on policy escribiendo_directo_recibir on realtime.messages is
  'Recibir "está escribiendo…" de una conversación 1-a-1: sólo sus dos participantes, y sólo si está aceptada. El tenant no se comprueba acá — lo comprueba la RLS de conversations, que es la que evalúa este exists. Ver 0148.';

drop policy if exists escribiendo_directo_emitir on realtime.messages;
create policy escribiendo_directo_emitir
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
      from public.conversations c
     where c.id = app.hilo_de_topico((select realtime.topic()), 'escribiendo-directo')
       and c.status = 'accepted'
       and (select auth.uid()) in (c.created_by, c.counterpart_id)
  )
);

comment on policy escribiendo_directo_emitir on realtime.messages is
  'Emitir "está escribiendo…" en una conversación 1-a-1: mismas dos personas y mismo estado que para recibirlo. Ver 0148.';


-- ---------------------------------------------------------------------------
-- 3 · Grupos — escuchar y emitir
--
--     La membresía es toda la frontera: `chat_group_members` ya resuelve tenant
--     y pertenencia, y es la MISMA tabla que decide si se ven los mensajes del
--     grupo. Un grupo privado ajeno no devuelve fila y el canal queda cerrado.
-- ---------------------------------------------------------------------------
drop policy if exists escribiendo_grupo_recibir on realtime.messages;
create policy escribiendo_grupo_recibir
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
      from public.chat_group_members m
     where m.group_id = app.hilo_de_topico((select realtime.topic()), 'escribiendo-grupo')
       and m.profile_id = (select auth.uid())
  )
);

comment on policy escribiendo_grupo_recibir on realtime.messages is
  'Recibir "está escribiendo…" de un grupo: sólo sus miembros. Se apoya en chat_group_members, la misma tabla que decide si se ven los mensajes del grupo. Ver 0148.';

drop policy if exists escribiendo_grupo_emitir on realtime.messages;
create policy escribiendo_grupo_emitir
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
      from public.chat_group_members m
     where m.group_id = app.hilo_de_topico((select realtime.topic()), 'escribiendo-grupo')
       and m.profile_id = (select auth.uid())
  )
);

comment on policy escribiendo_grupo_emitir on realtime.messages is
  'Emitir "está escribiendo…" en un grupo: sólo sus miembros. Ver 0148.';

commit;
