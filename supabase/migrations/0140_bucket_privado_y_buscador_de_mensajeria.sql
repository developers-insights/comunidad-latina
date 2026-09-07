-- =============================================================================
-- 0140_bucket_privado_y_buscador_de_mensajeria.sql — Comunidad Latina
--
-- Lo que le falta al módulo para funcionar: dónde viven los archivos que se
-- mandan por chat, y la barrita de búsqueda que cruza chats, grupos y llamadas.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. `chat-media` ES PRIVADO, Y ESO CAMBIA CÓMO SE LEE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Todos los buckets del repo hasta hoy son públicos (`avatars`, `post-media`,
-- `listing-photos`, `music-tracks`, `community-emojis`) y la app arma las URLs
-- contra `/storage/v1/object/public/…`, un endpoint que NO consulta RLS. Eso
-- está bien para una foto de perfil y está mal para una foto que alguien mandó
-- a un chat: en un bucket público, quien tenga la URL la ve, y una URL se
-- reenvía. El único bucket privado que existía era `job-cvs` (0032).
--
-- LA LECTURA SE PUDO RESOLVER CON POLICY, y conviene decir por qué, porque la
-- opción de rendirse y dejar todo a URLs firmadas desde el servidor estaba
-- sobre la mesa: el problema es que el path (`{tenant}/{uid}/archivo`) NO dice
-- a qué conversación pertenece el archivo, así que la policy tiene que buscar
-- el mensaje que lo referencia — y eso, sin más, es un scan de `messages`
-- entera por CADA archivo que alguien abre.
--
-- Lo que lo vuelve viable son los dos índices de expresión de §2 sobre
-- `adjunto->>'path'`: con ellos la búsqueda es un salto de índice. Y la
-- comprobación no duplica ninguna lógica de permisos, que era el otro riesgo:
-- el `exists` corre con los permisos de quien pregunta, así que quien decide es
-- la RLS de `messages` / `chat_group_messages`. La MISMA que decide si podés
-- leer el mensaje. Si el mensaje venció, lo bajaron, o es de un chat ajeno, el
-- `exists` no encuentra nada y el archivo no se abre.
--
-- `job-cvs` ya había hecho exactamente esto (su policy de SELECT consulta
-- `job_applications` y `listings`), así que además es el precedente del repo.
--
-- ⚠️ DOS CONSECUENCIAS QUE HAY QUE TENER PRESENTES:
--
--   · El archivo se sube ANTES de que exista el mensaje que lo referencia. En
--     esa ventana el único que puede leerlo es quien lo subió, y por eso la
--     policy conserva la rama del prefijo propio. Si se sube y nunca se manda
--     el mensaje, queda un archivo que sólo ve su dueño.
--   · Cuando el mensaje se borra o lo barre el TTL de 90 días, el archivo deja
--     de ser legible para la otra persona pero el objeto SIGUE en el bucket.
--     Limpiar eso no se puede hacer bien desde SQL —borrar la fila de
--     `storage.objects` no libera los bytes, eso lo hace la API de Storage— así
--     que queda PENDIENTE y explícito, no resuelto a medias.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. EL FILTRO "AMIGOS" NO ESTRENA SISTEMA DE AMISTAD
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Decisión de producto ya tomada, escrita acá para que no se re-discuta: en
-- esta app "amigo" significa SEGUIMIENTO MUTUO sobre `follows`, que ya existe.
-- No hay tabla de amistad, ni solicitudes, ni estados de aceptación.
--
-- El motivo no es ahorrarse una tabla: un sistema de amistad de verdad trae
-- pedido, aceptación, rechazo, notificación y una pantalla para administrarlo,
-- y nada de eso se pidió. El seguimiento mutuo ya expresa "nos conocemos los
-- dos" y ya está poblado con datos reales.
--
-- Y el índice recíproco ya existía a medias: `follows_one_per_target` (unique
-- sobre follower_id, target_kind, target_id) resuelve cada una de las dos
-- puntas de un salto. Lo que se agrega en §4 es la versión angosta y parcial
-- para que listar TODOS mis amigos sea un index-only scan.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · El bucket
--
-- 25 MB por archivo: un video corto de teléfono entra, una película no. Y la
-- lista de tipos es corta A PROPÓSITO — cada formato que se suma es una cosa
-- más que un navegador ajeno va a abrir:
--
--   · SVG queda AFUERA, igual que en la 0125: un SVG se abre como documento y
--     ejecuta el script que traiga adentro, en el dominio del proyecto de
--     Supabase. Que el bucket sea privado no cambia nada — la URL firmada
--     apunta al mismo origen.
--   · Los ejecutables y comprimidos (.zip, .exe, .apk) quedan AFUERA. Un chat
--     privado es el mejor lugar del mundo para pasar un archivo infectado, y
--     acá no hay nada que lo escanee.
--   · GIF SÍ entra, al revés que en la 0125: allá el problema era que
--     `ctx.drawImage` congela la animación al pegarla en una foto, y en un chat
--     el GIF se muestra tal cual.
--
-- Ampliar esta lista es una decisión de producto con un costo de seguridad, no
-- un ajuste de configuración.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  26214400, -- 25 MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
    'application/pdf'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- 2 · Los índices que hacen viable la policy de lectura (§1)
--
-- Sin estos dos, `chat_media_select` es un scan de la tabla de mensajes por
-- cada archivo que alguien abre. Con ellos es un salto de índice.
--
-- Parciales sobre `adjunto is not null` porque la enorme mayoría de los
-- mensajes son texto: el índice queda del tamaño de los mensajes con archivo,
-- no del de la tabla. La policy repite `adjunto is not null` en el `exists`
-- justamente para que el planificador pueda usar la versión parcial.
-- ---------------------------------------------------------------------------
create index messages_adjunto_path_idx
  on public.messages ((adjunto ->> 'path')) where adjunto is not null;

create index chat_group_messages_adjunto_path_idx
  on public.chat_group_messages ((adjunto ->> 'path')) where adjunto is not null;


-- ---------------------------------------------------------------------------
-- 3 · Las policies de Storage
--
-- Subir / reemplazar / borrar: SÓLO bajo el prefijo propio
-- `{tenant_id}/{auth.uid()}/…`, calcado de la 0025 (post-media) y de la 0032
-- (job-cvs). El prefijo se revalida contra el JWT en cada operación: el cliente
-- elige el nombre del archivo, así que sin esto elegiría también la carpeta.
-- ---------------------------------------------------------------------------
drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists chat_media_update on storage.objects;
create policy chat_media_update on storage.objects
for update to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists chat_media_delete on storage.objects;
create policy chat_media_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

-- LEER: el prefijo propio, o que haya un mensaje VISIBLE que apunte a este
-- archivo. Quién decide lo segundo es la RLS de las tablas de mensajes, no esta
-- policy (§1).
--
-- ⚠️ CONTRATO CON QUIEN SUBE: `adjunto->>'path'` tiene que ser EXACTAMENTE
-- `storage.objects.name` — la ruta dentro del bucket, sin el nombre del bucket
-- adelante y sin barra inicial. Si no coinciden carácter por carácter, el
-- `exists` no encuentra nada: quien mandó el archivo lo ve (por la rama del
-- prefijo propio) y el que lo recibe no. Es el modo de falla más confuso de
-- todo este archivo, porque del lado de quien prueba parece que funciona.
drop policy if exists chat_media_select on storage.objects;
create policy chat_media_select on storage.objects
for select to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or exists (
      select 1 from public.messages m
       where m.adjunto is not null
         and m.adjunto ->> 'path' = objects.name
    )
    or exists (
      select 1 from public.chat_group_messages gm
       where gm.adjunto is not null
         and gm.adjunto ->> 'path' = objects.name
    )
  )
);


-- ---------------------------------------------------------------------------
-- 4 · "Amigos" = seguimiento mutuo (§2)
-- ---------------------------------------------------------------------------

-- Angosto y parcial: sólo las dos columnas del salto recíproco y sólo las filas
-- de personas. Así listar todos mis amigos se resuelve sin tocar la tabla.
create index follows_amigos_idx
  on public.follows (follower_id, target_id) where target_kind = 'profile';

create or replace function app.son_amigos(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.follows f
     where f.follower_id = a and f.target_kind = 'profile' and f.target_id = b
  ) and exists (
    select 1 from public.follows f
     where f.follower_id = b and f.target_kind = 'profile' and f.target_id = a
  );
$$;

comment on function app.son_amigos(uuid, uuid) is
  '¿Se siguen mutuamente? En esta app eso ES la amistad: no hay tabla de amistad ni solicitudes, y es una decisión de producto, no una simplificación pendiente (§2 de la 0140). SECURITY DEFINER para que la respuesta no dependa de cómo esté escrita la RLS de follows — se pregunta por dos personas cualesquiera, no por auth.uid().';

revoke execute on function app.son_amigos(uuid, uuid) from public, anon;
grant execute on function app.son_amigos(uuid, uuid) to authenticated, service_role;


-- El filtro "Amigos" de la bandeja necesita el CONJUNTO, no la pregunta de a
-- una: preguntar por cada fila del inbox es el N+1 que el resto del repo evita.
create or replace function public.mis_amigos()
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select f.target_id
    from public.follows f
   where f.follower_id = auth.uid()
     and f.tenant_id = app.current_tenant_id()
     and f.target_kind = 'profile'
     and exists (
       select 1 from public.follows v
        where v.follower_id = f.target_id
          and v.target_kind = 'profile'
          and v.target_id = f.follower_id
     );
$$;

comment on function public.mis_amigos() is
  'Los ids de quienes me siguen y a quienes sigo (0140). Para el filtro "Amigos" de la bandeja. Devuelve el CONJUNTO y no una pregunta por fila a propósito: preguntar de a uno por cada chat del inbox es el N+1 de siempre. SECURITY DEFINER pero acotada a auth.uid() y a su tenant: nunca contesta por otra persona.';

revoke all    on function public.mis_amigos() from public, anon;
grant execute on function public.mis_amigos() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5 · Los índices de búsqueda
--
-- `pg_trgm` YA está instalado en el esquema `extensions` (verificado contra la
-- base antes de escribir esto), así que no hay `create extension`: correrlo
-- igual habría sido ruido, y en una base compartida con otro producto, ruido
-- con permisos.
--
-- Trigramas y no tsvector, por lo mismo que `listings_title_trgm_idx`: la
-- búsqueda de la bandeja es por subcadena mientras se escribe ("ram" tiene que
-- encontrar "Ramón"), y un tsvector busca palabras enteras.
--
-- `profiles.display_name` NO lleva índice nuevo: ya tiene dos
-- (profiles_display_name_trgm_idx y el de app.unaccent_immutable).
-- ---------------------------------------------------------------------------
create index messages_body_trgm_idx
  on public.messages using gin (body gin_trgm_ops);

create index chat_group_messages_body_trgm_idx
  on public.chat_group_messages using gin (body gin_trgm_ops);

create index chat_groups_name_trgm_idx
  on public.chat_groups using gin (name gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- 6 · buscar_en_mensajeria — una barra que cruza las tres cosas
--
-- SECURITY INVOKER, como buscar_personas_de_la_comunidad() (0134): la RLS de
-- cada tabla sigue decidiendo qué se ve. Es lo que hace que esta función no
-- pueda convertirse en una puerta lateral — no puede devolver un mensaje que
-- quien busca no podría abrir, porque no lo lee siquiera.
--
-- El filtro de tenant va igual escrito a mano, por el mismo motivo que allá:
-- `profiles_select` es `using(true)` (el perfil es contenido público por SEO) y
-- acá se busca DENTRO de la comunidad.
--
-- Devuelve vacío y no error con menos de 2 caracteres: la barra dispara sola
-- mientras se escribe y un 400 con dos letras se vería como "se rompió".
-- ---------------------------------------------------------------------------
create or replace function public.buscar_en_mensajeria(
  termino text,
  limite  int default 20
)
returns table (
  tipo      text,
  id        uuid,
  titulo    text,
  fragmento text,
  cuando    timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
  v_limit  int  := least(greatest(coalesce(limite, 20), 1), 50);
  v_q      text;
  v_like   text;
begin
  v_q := btrim(coalesce(termino, ''));
  if char_length(v_q) < 2 or v_tenant is null or v_uid is null then
    return;
  end if;
  v_q := left(v_q, 80);

  -- Comodines del usuario escapados: sin esto, buscar "100%" trae todo.
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with hallazgos as (
    -- Un chat 1-a-1 por el nombre de la otra persona.
    select 'conversacion'::text as h_tipo,
           c.id                 as h_id,
           p.display_name       as h_titulo,
           null::text           as h_fragmento,
           c.created_at         as h_cuando
      from public.conversations c
      join public.profiles p
        on p.id = case when c.created_by = v_uid then c.counterpart_id else c.created_by end
     where c.tenant_id = v_tenant
       and p.tenant_id = v_tenant
       and app.unaccent_immutable(p.display_name)
           ilike app.unaccent_immutable(v_like) escape '\'

    union all

    -- Un chat 1-a-1 por lo que se dijo adentro.
    select 'conversacion'::text,
           c.id,
           p.display_name,
           left(m.body, 140),
           m.created_at
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      join public.profiles p
        on p.id = case when c.created_by = v_uid then c.counterpart_id else c.created_by end
     where m.tenant_id = v_tenant
       and p.tenant_id = v_tenant
       and m.body ilike v_like escape '\'

    union all

    -- Un grupo por su ficha.
    select 'grupo'::text,
           g.id,
           g.name,
           g.description,
           g.created_at
      from public.chat_groups g
     where g.tenant_id = v_tenant
       and app.es_miembro_de_grupo(g.id)
       and (
         g.name ilike v_like escape '\'
         or g.description ilike v_like escape '\'
       )

    union all

    -- Un grupo por lo que se dijo adentro.
    select 'grupo'::text,
           g.id,
           g.name,
           left(m.body, 140),
           m.created_at
      from public.chat_group_messages m
      join public.chat_groups g on g.id = m.group_id
     where m.tenant_id = v_tenant
       and m.body ilike v_like escape '\'

    union all

    -- Una llamada, por el grupo o por con quién fue. No tiene texto propio:
    -- el fragmento dice qué fue, que es lo único que hay para mostrar.
    select 'llamada'::text,
           c.id,
           coalesce(g.name, otro.display_name),
           c.kind || ' · ' || c.status,
           c.created_at
      from public.calls c
      left join public.chat_groups g on g.id = c.group_id
      left join lateral (
        select pr.display_name
          from public.call_participants cp
          join public.profiles pr on pr.id = cp.profile_id
         where cp.call_id = c.id
           and cp.profile_id <> v_uid
         order by pr.display_name
         limit 1
      ) otro on true
     where c.tenant_id = v_tenant
       and (
         g.name ilike v_like escape '\'
         or app.unaccent_immutable(otro.display_name)
            ilike app.unaccent_immutable(v_like) escape '\'
       )
  )
  -- Un mismo chat puede aparecer por el nombre Y por tres mensajes distintos.
  -- Se queda el hallazgo más reciente de cada uno: la barra lista CHATS, no
  -- coincidencias, y quince filas del mismo grupo tapan a los otros catorce.
  select d.h_tipo, d.h_id, d.h_titulo, d.h_fragmento, d.h_cuando
    from (
      select distinct on (h.h_tipo, h.h_id) h.*
        from hallazgos h
       order by h.h_tipo, h.h_id, h.h_cuando desc
    ) d
   order by d.h_cuando desc
   limit v_limit;
end;
$$;

comment on function public.buscar_en_mensajeria(text, int) is
  'La barra de búsqueda de Mensajes (0140): cruza chats 1-a-1, grupos y llamadas en UNA consulta y devuelve (tipo, id, titulo, fragmento, cuando). Busca por nombre de la otra persona, ficha del grupo y contenido de los mensajes, con trigramas para que encuentre por subcadena mientras se escribe. SECURITY INVOKER a propósito: la RLS de cada tabla decide qué se ve, así que no puede devolver nada que quien busca no pudiera abrir. Devuelve VACÍO, no error, con menos de 2 caracteres o sin sesión. Deduplica por chat quedándose con lo más reciente: la barra lista chats, no coincidencias.';

revoke all    on function public.buscar_en_mensajeria(text, int) from public, anon;
grant execute on function public.buscar_en_mensajeria(text, int) to authenticated, service_role;

commit;
