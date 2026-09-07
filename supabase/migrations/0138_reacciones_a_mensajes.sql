-- =============================================================================
-- 0138_reacciones_a_mensajes.sql — Comunidad Latina
--
-- Reaccionar a un mensaje con los emojis propios de la comunidad (0125), en el
-- chat 1-a-1 y en los grupos.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. NO SE AGREGA `emoji_slug`. YA HAY UNA FORMA Y ESTÁ EN PRODUCCIÓN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La pregunta era cómo referenciar un emoji de la comunidad desde una reacción.
-- La respuesta ya estaba decidida y escrita, en `src/lib/emojis/catalog.ts`:
--
--     «REACCIONES — `reactions.kind` es texto sin CHECK, así que la reacción se
--      guarda como el mismo `:slug:`. Nada que migrar del lado de la base.»
--
-- O sea que `kind` ya es el lugar, y ya tiene tres formas conviviendo:
--
--     'like'      → el corazón histórico (las 60 filas que hay hoy)
--     '❤'         → un emoji unicode, tal cual
--     ':klk:'     → un emoji de la comunidad, por su community_emojis.slug
--
-- Agregar una columna `emoji_slug` al lado crearía una SEGUNDA forma de decir
-- lo mismo, y la pregunta "¿cuál gana si vienen las dos?" no tiene respuesta
-- buena. Peor: `catalog.ts` ya lee `kind` y resuelve `:slug:` contra el
-- catálogo, así que una reacción guardada en la columna nueva sería invisible
-- para el código que hoy pinta reacciones. La columna que "faltaba" habría
-- roto lo que ya funciona.
--
-- Lo único que se le agrega a `kind` es un techo de longitud: hoy no tiene
-- NINGÚN check, así que un `kind` de 10 MB entra sin que nada lo pare.
--
-- QUÉ NO VALIDA LA BASE, a propósito: que el `:slug:` exista y esté activo en
-- `community_emojis`. Un trigger que lo verifique tendría que correr en CADA
-- inserción de reacción —incluidas las de publicaciones, que están vivas en
-- producción— para atajar un caso que del lado del lector ya está resuelto:
-- `indexBySlug` deja como texto el slug que no resuelve. Se prefiere no meter
-- una consulta extra y un modo de fallo nuevo en un camino caliente.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. UNA REACCIÓN POR PERSONA Y POR MENSAJE — Y NO HAY QUE HACER NADA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El diseño del cliente muestra UNA reacción destacada por persona. Resulta que
-- `reactions` ya lo garantiza desde la 0007:
--
--     constraint reactions_one_per_subject unique (subject_kind, subject_id, profile_id)
--
-- Como los mensajes entran por `subject_kind` nuevos, heredan la restricción
-- tal cual: cambiar de reacción es un upsert sobre esa clave, no una segunda
-- fila. No hay índice nuevo que crear.
--
-- Y la alternativa —varias reacciones distintas por persona— habría exigido
-- BAJAR ese unique, que es la clave del `on conflict` con el que el feed
-- escribe los "me gusta" en producción. Un cambio invisible en la pantalla de
-- chat que rompe la del feed.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. QUIÉN VE UNA REACCIÓN A UN MENSAJE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `reactions_select` hoy dice, entero: «tenant_id = mi comunidad OR soy global
-- admin». Para publicaciones está bien —son contenido de la comunidad— pero si
-- los mensajes entraran ahí sin más, CUALQUIER persona de la comunidad podría
-- leer las reacciones de un chat privado: no el texto, pero sí que Ana le puso
-- un corazón al mensaje tal. Con el id del mensaje se arma el resto.
--
-- Así que las ramas se separan: las tres clases viejas se comportan EXACTAMENTE
-- igual que antes (misma expresión, palabra por palabra) y las dos nuevas
-- exigen poder ver el mensaje. Lo verifica un `exists` común contra las tablas
-- de mensajes, no una función DEFINER: un `exists` corre con los permisos de
-- quien pregunta, así que la RLS de `messages` / `chat_group_messages` decide —
-- la MISMA que decide si podés leer el mensaje. Imposible que se desincronice
-- con las policies, porque ES las policies.
--
-- El global admin queda AFUERA de las dos ramas nuevas. Es la línea que la 0006
-- ya había trazado —«Ni staff ni global_admin leen mensajes privados por policy
-- (§5.4 — no somos un honeypot de chats)»— y no tendría sentido cerrarles el
-- texto del mensaje y abrirles quién reaccionó a él.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Los dos sujetos nuevos
--
-- El CHECK se busca por catálogo y no por nombre escrito a mano: es el mismo
-- patrón con el que la 0133 §9 amplió scam_reports.target_kind. Los tres
-- valores viejos se repiten enteros — esto AGREGA, no reemplaza.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.reactions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%subject_kind%';
  if v_name is not null then
    execute format('alter table public.reactions drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.reactions
  add constraint reactions_subject_kind_check
  check (subject_kind in ('post', 'comment', 'listing', 'message', 'group_message'));

comment on column public.reactions.subject_kind is
  'post | comment | listing | message | group_message. Las tres primeras son contenido de la comunidad y se ven dentro del tenant; las dos últimas (0138) son mensajes y sólo las ve quien puede ver el mensaje — ni siquiera un global admin (§3 de la 0138).';

-- El techo de longitud que `kind` nunca tuvo. 64 alcanza de sobra para un
-- emoji unicode compuesto o para el `:slug:` más largo que permite la 0125
-- (40 caracteres + los dos dos-puntos).
alter table public.reactions
  add constraint reactions_kind_check
  check (char_length(btrim(kind)) between 1 and 64);

comment on column public.reactions.kind is
  'QUÉ reacción es, en texto, con tres formas que conviven: `like` (el corazón histórico), un emoji unicode tal cual, o `:slug:` para un emoji de la comunidad (0125) — la forma que ya usa src/lib/emojis/catalog.ts. NO hay columna emoji_slug a propósito (§1 de la 0138): sería una segunda manera de decir lo mismo, invisible para el código que hoy pinta reacciones. Que el slug exista y esté activo lo resuelve quien lee, no la base.';


-- ---------------------------------------------------------------------------
-- 2 · Quién puede reaccionar a un mensaje
--
-- La expresión de las tres clases viejas se copia ENTERA de la policy que está
-- viva, incluida la rama de `entity_listing_id` que agregó la 0124 (reaccionar
-- con la cara de un negocio propio). Reescribir esta policy desde la versión de
-- la 0007 —que no la tiene— habría apagado esa función sin que nada avisara.
--
-- Y `entity_listing_id` queda PROHIBIDO en las dos clases nuevas: reaccionar
-- "como negocio" adentro de un chat privado no significa nada y metería la
-- identidad comercial en un contexto donde nadie la pidió.
-- ---------------------------------------------------------------------------
alter policy reactions_insert on public.reactions
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and (
    (subject_kind = 'post' and exists (
      select 1 from public.posts p
      where p.id = reactions.subject_id
        and p.tenant_id = reactions.tenant_id
        and p.status = 'published'
    ))
    or (subject_kind = 'comment' and exists (
      select 1 from public.comments c
      where c.id = reactions.subject_id
        and c.tenant_id = reactions.tenant_id
        and c.status = 'published'
    ))
    or (subject_kind = 'listing' and exists (
      select 1 from public.listings l
      where l.id = reactions.subject_id
        and l.tenant_id = reactions.tenant_id
        and l.status = 'published'
    ))
    -- Las dos nuevas: la RLS de la tabla de mensajes es la que autoriza. Si el
    -- mensaje está vencido, bajado, o es de un chat/grupo ajeno, el exists no
    -- lo encuentra y la reacción no entra.
    or (subject_kind = 'message' and exists (
      select 1 from public.messages m
      where m.id = reactions.subject_id
        and m.tenant_id = reactions.tenant_id
    ))
    or (subject_kind = 'group_message' and exists (
      select 1 from public.chat_group_messages gm
      where gm.id = reactions.subject_id
        and gm.tenant_id = reactions.tenant_id
    ))
  )
  and (
    entity_listing_id is null
    or exists (
      select 1 from public.listings f
      where f.id = reactions.entity_listing_id
        and f.tenant_id = reactions.tenant_id
        and f.created_by = (select auth.uid())
        and f.status = 'published'
    )
  )
  -- Reaccionar con la cara de un negocio es cosa del contenido público.
  and (entity_listing_id is null or subject_kind in ('post', 'comment', 'listing'))
);

comment on policy reactions_insert on public.reactions is
  'Reaccionar. Las tres clases de contenido público exigen que el sujeto exista, sea del tenant y esté publicado; las dos de mensajes (0138) se apoyan en la RLS de messages / chat_group_messages — si no podés leer el mensaje, no podés reaccionarle. La rama de entity_listing_id (0124, reaccionar como negocio propio) se conserva intacta y queda vedada en los mensajes: una identidad comercial no tiene nada que hacer adentro de un chat privado.';


-- ---------------------------------------------------------------------------
-- 3 · Quién puede VER una reacción (§3 de la cabecera)
-- ---------------------------------------------------------------------------
alter policy reactions_select on public.reactions
using (
  -- Contenido público de la comunidad: EXACTAMENTE la expresión que había
  -- antes de la 0138, acotada a las tres clases que ya existían.
  (
    subject_kind in ('post', 'comment', 'listing')
    and (
      tenant_id = (select app.current_tenant_id())
      or (select app.is_global_admin())
    )
  )
  -- Mensajes: sólo quien puede ver el mensaje. Sin rama de global admin.
  or (
    subject_kind = 'message'
    and tenant_id = (select app.current_tenant_id())
    and exists (
      select 1 from public.messages m
      where m.id = reactions.subject_id
        and m.tenant_id = reactions.tenant_id
    )
  )
  or (
    subject_kind = 'group_message'
    and tenant_id = (select app.current_tenant_id())
    and exists (
      select 1 from public.chat_group_messages gm
      where gm.id = reactions.subject_id
        and gm.tenant_id = reactions.tenant_id
    )
  )
);

comment on policy reactions_select on public.reactions is
  'Las reacciones a contenido público se ven dentro de la comunidad, igual que siempre. Las reacciones a un MENSAJE (0138) sólo las ve quien puede ver ese mensaje: sin esta separación, cualquiera de la comunidad podría leer que Ana le puso un corazón al mensaje tal de un chat privado. El global admin queda afuera de esas dos ramas por la misma razón por la que la 0006 lo dejó afuera del texto: no somos un honeypot de chats.';


-- ---------------------------------------------------------------------------
-- 4 · Que una reacción no sobreviva a su mensaje
--
-- `reactions` no tiene FK al sujeto (0007), así que el barrido lo hace
-- app.cleanup_reactions(), que ya existe y recibe la clase por argumento del
-- trigger. Sin esto, la purga nocturna del TTL de 90 días se llevaría los
-- mensajes y dejaría las reacciones huérfanas para siempre: filas que no se
-- pueden leer, no se pueden borrar y sólo crecen — y que además ocupan la clave
-- (subject_kind, subject_id, profile_id), así que el día que un uuid se repita
-- el upsert de una reacción nueva chocaría contra una fila fantasma.
-- ---------------------------------------------------------------------------
create trigger messages_cleanup_reactions
before delete on public.messages
for each row execute function app.cleanup_reactions('message');

create trigger chat_group_messages_cleanup_reactions
before delete on public.chat_group_messages
for each row execute function app.cleanup_reactions('group_message');


-- ---------------------------------------------------------------------------
-- 5 · Higiene de grants
--
-- `reactions` viene de antes de que esta base endureciera los default
-- privileges y hoy tiene TODOS los privilegios otorgados a `anon`. No es
-- explotable —las cuatro policies son `to authenticated`, y sin policy que
-- aplique la RLS deniega— pero PostgREST igual publica los endpoints de
-- escritura para el rol anónimo, y ahora esa tabla además guarda reacciones de
-- chats privados. Se le deja a `anon` el tamaño real de lo que necesita: nada.
-- Mismo movimiento que la 0125 §3.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on table public.reactions from anon;

commit;
