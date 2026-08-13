-- =============================================================================
-- 0097_menu_de_publicacion.sql — Comunidad Latina
--
-- El menú ⋯ de una publicación hoy ofrece cuatro cosas (promocionar, editar,
-- reportar, eliminar) y el cliente pidió el juego completo, con Facebook como
-- referencia: fijar, ocultar del timeline, desactivar comentarios, abrir en otra
-- pestaña, guardar. De esa lista, TRES necesitan que la base sepa algo que hoy
-- no sabe. El resto ya existe o es puro cliente.
--
-- Esta migración agrega esas tres cosas, habilita borrar un comentario ajeno
-- cuando la publicación es tuya, y hace posible quitar UNA foto de una
-- publicación ya publicada sin romper el libro de procedencia.
--
-- ── POR QUÉ SON COLUMNAS DE `posts` Y NO TABLAS NUEVAS ───────────────────────
-- Las tres son propiedades de UNA publicación, con cardinalidad 1:1, sin
-- historial y sin actores además del autor. Una tabla aparte por cada una
-- costaría tres joins en el camino más caliente de la app (el feed), tres juegos
-- de policies que mantener sincronizadas con las de `posts`, y tres formas de
-- que una fila quede huérfana. La regla que usa este repo para decidir es la que
-- escribió la 0096 al elegir `listings` para "perdido y encontrado": tabla nueva
-- SÓLO cuando el dato tiene forma propia. Acá no la tiene — son tres marcas de
-- tiempo.
--
-- Son `timestamptz` y no `boolean` por el mismo motivo que `edited_at` (0094):
-- un booleano dice QUÉ pasa, una fecha dice además CUÁNDO empezó. El día que
-- alguien pregunte "¿desde cuándo están cerrados los comentarios de este post?"
-- —soporte, moderación, una disputa— la respuesta ya está guardada. NULL
-- significa siempre "no pasó", que es el estado de todo lo publicado hasta hoy.
--
-- ── LAS TRES MARCAS, UNA POR UNA ─────────────────────────────────────────────
--
-- 1 · `pinned_at` — FIJAR. Una publicación fijada encabeza el grid del perfil de
--     quien la publicó. Es UNA POR PERSONA Y POR COMUNIDAD, y eso no lo garantiza
--     la app: lo garantiza un índice único parcial. Si fueran varias, "fijada"
--     dejaría de significar algo — el sentido de fijar es que haya UNA cosa
--     arriba. La invariante en la base y no en el código es lo que hace que un
--     camino futuro (un panel, un script, otra action) no pueda romperla sin
--     enterarse.
--
-- 2 · `hidden_at` — OCULTAR DEL TIMELINE. NO es eliminar y no puede parecerlo:
--     la publicación sigue existiendo, su autor la sigue viendo, los comentarios
--     y los me gusta siguen ahí, y el link directo sigue abriendo. Lo único que
--     cambia es que deja de aparecer en las superficies de DESCUBRIMIENTO (el
--     feed de la comunidad, el scroll de Videos Cortos, el grid del perfil).
--
--     Eso la vuelve una regla de DISTRIBUCIÓN, no de seguridad — la misma
--     distinción que ya gobierna "solo seguidores" en `feed/queries.ts`: «un post
--     published sigue siendo PÚBLICO en su detalle; la query del feed solo decide
--     a quién se lo MUESTRA proactivamente». Por eso NO se toca `posts_select`:
--     esconder una publicación por RLS la haría desaparecer también para quien ya
--     la tenía abierta, para quien la compartió por WhatsApp y para el buscador,
--     y "ocultar del timeline" no promete nada de eso. Prometer menos y cumplirlo
--     entero es mejor que prometer un borrado que no es un borrado.
--
--     No lleva índice propio a propósito. El feed ya entra por `posts_feed_idx`
--     (tenant + orden, parcial sobre published) y `hidden_at is null` filtra un
--     puñado de filas de un conjunto ya acotado. Un índice para una condición que
--     casi siempre es verdadera no acelera nada y sí encarece cada escritura.
--
-- 3 · `comments_locked_at` — COMENTARIOS DESACTIVADOS. Esta es la única de las
--     tres que SÍ es una frontera y por eso vive en la policy de INSERT de
--     `comments`. Si sólo escondiéramos el campo de escribir, cerrar los
--     comentarios sería una sugerencia: cualquiera con la consola abierta seguiría
--     comentando. Con la policy, el candado lo pone Postgres.
--
--     Cierra para TODOS, incluido el autor. Dejarlo comentar en su propio hilo
--     cerrado se lee como un privilegio (y desde afuera, como un bug: "¿por qué
--     él sí?"). Los comentarios que ya estaban NO se borran ni se esconden:
--     cerrar la puerta no es quemar la conversación que ya ocurrió.
--
-- ── BORRAR UN COMENTARIO: QUIÉN ─────────────────────────────────────────────
-- `comments_delete` (0007) ya existía y ya permitía al AUTOR DEL COMENTARIO y al
-- staff, pero ninguna server action la usaba: era letra muerta. Esta migración
-- suma un tercer actor, el AUTOR DE LA PUBLICACIÓN, y el motivo es que hoy su
-- única salida frente a un comentario que no quiere en su publicación es
-- eliminar la publicación entera — llevándose puestos los comentarios de todas
-- las demás personas. Es la desproporción al revés.
--
-- Es la norma de la industria (Facebook, Instagram y YouTube dan esa potestad a
-- quien publica) y tiene un límite claro: alcanza SÓLO a los comentarios de su
-- publicación. No es un permiso sobre personas, es un permiso sobre un hilo.
--
-- ── QUITAR UNA FOTO Y EL LIBRO DE PROCEDENCIA ───────────────────────────────
-- `lib/social/post-editing.ts` prohíbe CAMBIAR los archivos de una publicación
-- ya publicada, y hay que leer con cuidado por qué: porque un archivo NUEVO
-- necesitaría rehacer el pipeline entero (subida, SHA-256, huella perceptual,
-- escaneo de similitud, declaración de licencia, moderación de imagen), y porque
-- la fila vieja de `content_assets` quedaría describiendo un contenido que ya no
-- es.
--
-- QUITAR no es CAMBIAR, y la diferencia es toda la que importa: no entra ningún
-- archivo nuevo, así que no hay pipeline que rehacer. Y la fila de procedencia
-- del archivo que sale sigue siendo VERDADERA palabra por palabra — dice quién
-- subió ese archivo, cuándo por primera vez y desde qué dominio. Nada de eso
-- deja de haber pasado porque la foto ya no se muestre. Tan es así que esa fila
-- ya sobrevive hoy al borrado completo de la publicación (0061: «NO se borra al
-- borrar el post»), o sea que un asset cuyo post ya no lo muestra es un estado
-- que este sistema contempla desde el día uno.
--
-- Lo que sí faltaba es DEJARLO ANOTADO. Sin eso, quien mire una alerta de
-- integridad dentro de seis meses abre la publicación, no encuentra la foto
-- reclamada, y no puede distinguir "nunca estuvo" de "la sacaron". Por eso la
-- columna `retired_from_subject_at`: no borra nada, no oculta nada, AGREGA un
-- hecho fechado. El libro de procedencia sólo crece.
--
-- El objeto del bucket TAMPOCO se borra, por la razón que ya está escrita en
-- `feed/post-edit-actions.ts`: el hash apunta a ese archivo y borrarlo vaciaría
-- la evidencia que la fila promete conservar.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ──────────────────────────────
--   · No permite quitar un VIDEO. `video_type`, `duration_seconds`,
--     `video_category` y `eligible_for_short_feed` describen un video que
--     dejaría de existir, y el CHECK `posts_video_declaration` sólo mira si HAY
--     video, no si las columnas quedaron colgadas: la publicación sobreviviría
--     como un fantasma del scroll de Videos Cortos. Quitar el video es publicar
--     de nuevo.
--   · No permite quitar la ÚLTIMA foto. Una publicación sin ningún medio no es
--     una publicación con menos fotos: es otra cosa (y el trigger
--     `posts_require_media` la habría rechazado al nacer). El vaciado por la
--     puerta de atrás no existe.
--   · No agrega borrado blando de comentarios. `comments.status='removed'` ya
--     significa "lo retiró la moderación"; usarlo para "lo borró el autor del
--     post" le diría al comentarista que lo sancionaron. El DELETE es real, y el
--     trigger `comments_bump_post_count` ya deja el contador en su lugar.
--   · No toca `posts_select`. Ver el punto 2 de arriba.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Las tres marcas del menú
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists pinned_at          timestamptz,
  add column if not exists hidden_at          timestamptz,
  add column if not exists comments_locked_at timestamptz;

comment on column public.posts.pinned_at is
  'Cuándo su autor la fijó. NULL = no está fijada. Una fijada por persona y por comunidad — lo garantiza posts_pin_unico_por_autor_idx, no la app. La fijada encabeza el grid del perfil de quien publicó.';
comment on column public.posts.hidden_at is
  'Cuándo su autor la ocultó del timeline. NULL = visible. NO es un borrado ni una moderación: la publicación existe, su autor la ve, el link directo abre y los comentarios siguen. Sólo sale de las superficies de descubrimiento (feed, Videos Cortos, grid del perfil), que es una regla de DISTRIBUCIÓN de la capa de queries — por eso posts_select no la mira.';
comment on column public.posts.comments_locked_at is
  'Cuándo su autor cerró los comentarios. NULL = abiertos. Lo hace cumplir comments_insert, no la UI: sin la policy, esconder el campo de escribir sería una sugerencia. Cierra para todos, incluido el autor. Los comentarios ya publicados no se tocan.';

-- UNA fijada por persona y por comunidad. Índice único PARCIAL: las filas con
-- pinned_at null ni entran, así que no cuesta nada sobre las 41 mil que no están
-- fijadas. Sirve además como el índice de lectura de "¿cuál fijó esta persona?".
create unique index if not exists posts_pin_unico_por_autor_idx
  on public.posts (tenant_id, author_id)
  where pinned_at is not null;

-- Fijar y ocultar son contradictorios: fijar es poner algo arriba de todo y
-- ocultar es sacarlo de la vista. El CHECK no es un cinturón de más — es la
-- definición del estado imposible, escrita donde no se puede saltear. Los dos
-- caminos de la app ya lo respetan (ocultar desfija en la MISMA sentencia; fijar
-- rechaza una publicación oculta con un motivo legible), así que este constraint
-- nunca debería dispararse: existe para el camino que todavía no se escribió.
alter table public.posts
  drop constraint if exists posts_pin_no_convive_con_oculto;
alter table public.posts
  add constraint posts_pin_no_convive_con_oculto
  check (pinned_at is null or hidden_at is null);

-- ---------------------------------------------------------------------------
-- 2. Quitar una foto TAMBIÉN es editar
--
-- La 0094 marca `edited_at` cuando cambia el texto, y su razón vale igual acá:
-- «una publicación editada en silencio es una trampa para quien la comentó». Si
-- alguien comentó "la tercera foto es genial" y la tercera foto desaparece, el
-- comentario queda hablando de algo que ya no está. Sacar una foto es una
-- edición y tiene que verse como tal.
--
-- El trigger pasa a escuchar `media` además de `body`. La condición sigue siendo
-- `is distinct from` en las dos: guardar lo mismo no es editar.
-- ---------------------------------------------------------------------------
create or replace function app.posts_set_edited_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Cambios del AUTOR sobre el contenido: el texto y qué archivos se muestran.
  -- Un cambio de `status` (lo hace la moderación) o de cualquier contador sigue
  -- sin contar como edición — que es exactamente lo que la 0094 vino a arreglar.
  if new.body is distinct from old.body or new.media is distinct from old.media then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

comment on function app.posts_set_edited_at() is
  'Marca edited_at cuando cambia el body O el media de una publicación (0094 + 0097). Vive en un trigger y no en la app para que ningún camino de edición futuro pueda olvidarse de ponerla.';

drop trigger if exists posts_set_edited_at on public.posts;
create trigger posts_set_edited_at
  before update of body, media on public.posts
  for each row
  execute function app.posts_set_edited_at();

-- ---------------------------------------------------------------------------
-- 3. content_assets.retired_from_subject_at — el archivo dejó de mostrarse
--
-- Ver la cabecera. Esta columna NO da de baja nada: la fila entera —uploader,
-- first_uploaded_at, sha256, huellas, declaración de licencia— queda intacta y
-- sigue matcheando en cada escaneo futuro, que es justamente para lo que existe.
-- Lo único que suma es la fecha en que ese archivo salió de la publicación donde
-- se cargó, para que quien resuelva una reclamación pueda distinguir "esa foto
-- nunca estuvo acá" de "esa foto estuvo y la sacaron el 13 de agosto".
-- ---------------------------------------------------------------------------
alter table public.content_assets
  add column if not exists retired_from_subject_at timestamptz;

comment on column public.content_assets.retired_from_subject_at is
  'Cuándo este archivo dejó de mostrarse en el sujeto donde se cargó (hoy: una foto quitada de su publicación). NULL = sigue mostrándose, o nadie lo anotó. NO es una baja: la fila, sus huellas y su fecha de primera carga quedan intactas y siguen siendo evidencia — el libro de procedencia sólo crece. Existe para que una reclamación posterior pueda distinguir "nunca estuvo" de "estuvo y lo sacaron".';

-- ---------------------------------------------------------------------------
-- 4. comments_insert — la puerta que cierra "desactivar comentarios"
--
-- Misma policy de la 0007 con UNA condición más. Se reescribe entera y no se
-- suma una segunda policy porque el enumerador (`npm run check:rls`) exige
-- exactamente cuatro por tabla, y la 0095 ya explicó por qué esa regla no es
-- burocracia: con una policy por actor, el permiso de una tabla se lee sumando
-- expresiones repartidas en varias filas de pg_policies, y ahí es donde se cuela
-- el agujero que nadie ve.
-- ---------------------------------------------------------------------------
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status = 'published'
  and exists (
    select 1 from public.posts p
    where p.id = comments.post_id
      and p.tenant_id = comments.tenant_id
      and p.status = 'published'
      -- 0097: comentarios cerrados por su autor. Sin rama de excepción: el
      -- propio autor tampoco comenta en un hilo que él mismo cerró.
      and p.comments_locked_at is null
  )
);

comment on policy comments_insert on public.comments is
  'Comentar exige: ser uno mismo, en la propia comunidad, sobre un post PUBLICADO del MISMO tenant (anti FK cross-tenant) y con los comentarios abiertos. El candado de comments_locked_at vive acá y no en la UI: esconder el campo de escribir sería una sugerencia, no un cierre.';

-- ---------------------------------------------------------------------------
-- 5. comments_delete — suma al autor de la publicación
--
-- El `exists` compara TAMBIÉN el tenant del post contra el del comentario, no
-- sólo el id: sin eso, el dueño de un post de otra comunidad entraría por esta
-- rama. Es el mismo cuidado que ya tiene comments_insert.
-- ---------------------------------------------------------------------------
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.posts p
      where p.id = comments.post_id
        and p.tenant_id = comments.tenant_id
        and p.author_id = (select auth.uid())
    )
    or (select app.is_staff())
  )
);

comment on policy comments_delete on public.comments is
  'Borran: el autor del comentario, el AUTOR DE LA PUBLICACIÓN donde está (0097 — su alternativa era borrar el post entero y llevarse puestos los comentarios de todos los demás) y el staff de esa comunidad. La rama del dueño compara post + tenant: el dueño de un post de otra comunidad no entra.';

-- ---------------------------------------------------------------------------
-- 6. public.fijar_publicacion — fijar/desfijar en UNA transacción
--
-- POR QUÉ UNA FUNCIÓN Y NO DOS UPDATE DESDE LA APP. Fijar son dos escrituras:
-- desfijar la anterior y fijar ésta. Hechas de a una desde el server hay un
-- instante sin nada fijado, y dos pestañas fijando a la vez chocan contra el
-- índice único con un error que no le dice nada a nadie. Adentro de una función
-- son una sola transacción: o quedan las dos o no queda ninguna.
--
-- POR QUÉ `security invoker` Y NO `definer`. La RLS ya permite exactamente esto:
-- `posts_update` (0007) deja al autor escribir su propia publicación mientras no
-- esté removed. No hay ningún permiso que falte, así que no hay nada que saltear
-- — y saltear la RLS "para que ande" es la forma más silenciosa de quedarse sin
-- control de acceso. Acá la RLS sigue siendo la frontera; la función sólo aporta
-- la transacción. (La 0096 usó `definer` en marcar_caso_resuelto porque ahí la
-- policy REALMENTE prohibía la escritura que hacía falta. No es el caso.)
--
-- Devuelve un CÓDIGO y no un booleano: "no se pudo" tiene tres motivos
-- distintos y la persona merece saber cuál. Traducirlos a copy es tarea de la
-- app; acá viajan como etiquetas.
-- ---------------------------------------------------------------------------
create or replace function public.fijar_publicacion(
  p_post  uuid,
  p_fijar boolean default true
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_tenant uuid := (select app.current_tenant_id());
  v_oculta boolean;
  v_filas  int;
begin
  if v_uid is null or v_tenant is null then
    return 'sin_sesion';
  end if;

  -- La lectura pasa por `posts_select`: si no la ve, para esta persona no
  -- existe. Y el filtro de autor/tenant se repite explícito porque leer un post
  -- ajeno SÍ está permitido (es contenido público) — no alcanza con que la
  -- consulta devuelva algo.
  select hidden_at is not null
    into v_oculta
    from public.posts
   where id        = p_post
     and tenant_id = v_tenant
     and author_id = v_uid
     and status    = 'published';

  if not found then
    return 'no_disponible';
  end if;

  if p_fijar and v_oculta then
    -- Fijar algo oculto es pedir dos cosas opuestas. Se dice, no se arregla
    -- solo: desocultar por nuestra cuenta sería devolver al feed algo que la
    -- persona sacó a propósito.
    return 'esta_oculta';
  end if;

  if p_fijar then
    -- Primero baja la que estuviera fijada (puede ser esta misma: es idempotente).
    update public.posts
       set pinned_at = null
     where tenant_id = v_tenant
       and author_id = v_uid
       and pinned_at is not null;
  end if;

  update public.posts
     set pinned_at = case when p_fijar then now() else null end
   where id        = p_post
     and tenant_id = v_tenant
     and author_id = v_uid
     and status    = 'published';

  get diagnostics v_filas = row_count;
  -- Cero filas con la lectura ya hecha significa que la RLS rechazó la
  -- ESCRITURA (cuenta suspendida por app.enforce_account_active, por ejemplo).
  return case when v_filas = 1 then 'ok' else 'no_disponible' end;
end;
$$;

comment on function public.fijar_publicacion(uuid, boolean) is
  'Fija o desfija una publicación PROPIA, garantizando una sola fijada por persona y comunidad: desfijar la anterior y fijar ésta ocurren en la misma transacción. security INVOKER — la RLS de posts_update ya autoriza esto y sigue siendo la frontera; la función sólo aporta atomicidad. Devuelve ok | sin_sesion | no_disponible | esta_oculta.';

revoke all    on function public.fijar_publicacion(uuid, boolean) from public, anon;
grant execute on function public.fijar_publicacion(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. public.quitar_foto_de_publicacion — sacar UNA foto, sin vaciar nada
--
-- Otra vez atomicidad: leer el array, sacarle un elemento y volver a escribirlo
-- desde la app es una carrera de libro (dos pestañas quitando fotos distintas y
-- una pisa a la otra). Acá el array se modifica con `array_remove` DENTRO del
-- UPDATE, así que la lectura y la escritura son la misma sentencia.
--
-- Las tres reglas viven en el WHERE y no en un `if` de TypeScript, que es lo que
-- las vuelve infranqueables:
--   · la foto tiene que estar en la publicación;
--   · tiene que quedar al menos un medio (no se vacía una publicación);
--   · no puede ser un video (ver la cabecera).
--
-- `security invoker` por el mismo motivo que la anterior: `posts_update` ya
-- autoriza a su autor a escribir `media`.
-- ---------------------------------------------------------------------------
create or replace function public.quitar_foto_de_publicacion(
  p_post uuid,
  p_path text
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_tenant uuid := (select app.current_tenant_id());
  v_media  text[];
  v_filas  int;
begin
  if v_uid is null or v_tenant is null then
    return 'sin_sesion';
  end if;

  select media
    into v_media
    from public.posts
   where id        = p_post
     and tenant_id = v_tenant
     and author_id = v_uid
     and status    = 'published';

  if not found then
    return 'no_disponible';
  end if;

  -- Los tres motivos, cada uno con su nombre. Se calculan sobre la lectura para
  -- poder DECIR cuál fue; el UPDATE de abajo los vuelve a exigir igual, porque
  -- entre esta lectura y esa escritura puede pasar cualquier cosa.
  if not (p_path = any(v_media)) then
    return 'no_esta';
  end if;
  if app.media_has_video(array[p_path]) then
    return 'es_video';
  end if;
  if coalesce(array_length(array_remove(v_media, p_path), 1), 0) = 0 then
    return 'es_la_unica';
  end if;

  update public.posts
     set media = array_remove(media, p_path)
   where id        = p_post
     and tenant_id = v_tenant
     and author_id = v_uid
     and status    = 'published'
     and p_path = any(media)
     and not app.media_has_video(array[p_path])
     and coalesce(array_length(array_remove(media, p_path), 1), 0) > 0;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    return 'no_disponible';
  end if;

  -- El libro de procedencia: se ANOTA que ese archivo salió, no se da de baja
  -- nada. Va sin `where uploader_id = v_uid` a propósito — lo que identifica al
  -- asset es el sujeto y la ruta del archivo, y quien lo subió puede ser otra
  -- persona (una publicación de entidad). El filtro de tenant + sujeto ya acota
  -- al post que esta misma función acaba de verificar como propio.
  --
  -- `content_assets` no es escribible por usuarios (todas sus policies de
  -- escritura están en false, 0061), así que este UPDATE no toca ninguna fila
  -- cuando lo llama una persona: la anotación la hace el server con el admin
  -- client (`lib/integrity/retire.ts`). Se deja acá igual para que el día que la
  -- función se llame con service_role la anotación viaje en la MISMA transacción
  -- que sacó la foto, que es donde tiene que estar.
  update public.content_assets
     set retired_from_subject_at = coalesce(retired_from_subject_at, now())
   where tenant_id    = v_tenant
     and subject_kind = 'post'
     and subject_id   = p_post
     and storage_path = p_path;

  return 'ok';
end;
$$;

comment on function public.quitar_foto_de_publicacion(uuid, text) is
  'Saca UNA foto de una publicación propia y publicada, con las tres reglas en el WHERE (la foto está, queda al menos un medio, no es un video). Lectura y escritura del array en la misma sentencia: sin carrera entre dos pestañas. NO borra el objeto del bucket ni la fila de content_assets — anota retired_from_subject_at, porque el libro de procedencia sólo crece. Devuelve ok | sin_sesion | no_disponible | no_esta | es_video | es_la_unica.';

revoke all    on function public.quitar_foto_de_publicacion(uuid, text) from public, anon;
grant execute on function public.quitar_foto_de_publicacion(uuid, text) to authenticated, service_role;

commit;
