-- =============================================================================
-- 0130_pedir_ayuda.sql — Comunidad Latina
--
-- «Tiene que ser como un blog: la gente pone lo que necesita y la gente le
--  contesta; hay mucha gente que tiene información y mucha que no.»
--  (Cliente, call del 2026-09-03, 30:58–41:00.)
--
-- Lo contó con dos historias y las dos son la misma: el primo que necesitaba
-- pasaporte y consiguió turno porque alguien en un grupo de WhatsApp le pasó el
-- número del consulado; la silla de ruedas, la computadora para los hijos, la
-- clase de OSHA gratis, el abogado de inmigración barato. Lo que circula en esas
-- historias es INFORMACIÓN, y lo dijo con todas las letras: no es mano de obra
-- («no vas a decir "me estoy mudando, vengan a cargar muebles"»).
--
-- Esa frase mata el módulo tal como estaba. «Necesito manos» para una mudanza es
-- responsabilidad legal de Comunidad Latina si alguien se lastima, así que
-- "Ayuda mutua" se saca: la tarjeta, el encuadre y el flujo «Quiero ayudar →
-- ¿sobre qué tema?» desaparecen de la app en esta misma tanda.
--
-- El MOTOR no. La 0120 ya había construido, con nombre distinto, casi todo lo
-- que este tablón necesita: filas de una comunidad con título, cuerpo, zona,
-- tema, RLS por tenant, moderación, cupo por persona, "me gusta" (0124) y
-- contacto privado sin publicar teléfonos. Tirarlo para escribir lo mismo con
-- otros nombres habría sido tirar también su capa de seguridad, que es la parte
-- cara. Esta migración lo reencuadra y le agrega lo único que le faltaba para
-- ser lo que el cliente describió: **que la gente pueda contestar**.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LAS CUATRO COSAS QUE HACE
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. `direction` pasa a tener DEFAULT 'need' y los avisos vivos de tipo
--      'offer' se archivan. El tablón queda de pedidos; la columna sobrevive
--      porque es la que documenta por qué las filas viejas están archivadas.
--   2. `topic` suma CUATRO temas (`tramites`, `salud`, `vivienda`, `otro`) que
--      la 0120 había excluido EXPLÍCITAMENTE — y se explica abajo por qué
--      excluirlos era correcto entonces y es incorrecto ahora.
--   3. `community_help_replies`: las respuestas. Es la tabla nueva.
--   4. El guardián se re-crea: un pedido se publica AL TOQUE. Se acabó la cola
--      previa de una persona (§4).
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. POR QUÉ AHORA SÍ ENTRAN salud, vivienda Y trámites
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La 0120 dejó ocho temas afuera del tablón y escribió el motivo de cada uno.
-- El argumento entero era sobre OFRECIMIENTOS, no sobre pedidos. Textual de
-- aquella migración sobre `vivienda`: «"Te presto un cuarto" es una oferta de
-- alojamiento a una persona sin techo hecha por un desconocido: es el escenario
-- de trata y de abuso». Sobre `salud`: «Un ofrecimiento de "desintoxicación en
-- mi casa" no es ayuda, es un peligro».
--
-- Las dos frases siguen siendo verdad, palabra por palabra. Lo que cambió es
-- que en este tablón YA NO SE PUEDE OFRECER NADA: sólo se pide. Y preguntar
-- «¿alguien sabe dónde consiguen sillas de ruedas usadas?» o «¿cómo hacen para
-- encontrar cuarto sin crédito?» no es ninguno de esos dos escenarios — es
-- exactamente lo que el cliente contó que pasa hoy por WhatsApp.
--
-- Para que esto no dependa de que la app se porte bien, la regla queda en la
-- BASE: los cuatro temas nuevos son válidos SÓLO con `direction = 'need'`
-- (constraint `community_help_notices_temas_nuevos_solo_de_pedido`). Si alguna
-- vez vuelve a existir un camino para ofrecer, la lista de temas que puede usar
-- vuelve sola a ser la de la 0120.
--
-- ── LOS QUE SIGUEN AFUERA, Y SIGUE SIN SER UNA LISTA DE PENDIENTES ──────────
-- `migracion` y `legal` NO entran, ni siquiera como pedido. La diferencia con
-- `salud` es real y no es timidez: un tema rotulado "Migración" no invita a
-- pedir un dato, invita a que un desconocido conteste qué hacer con un caso de
-- asilo, y eso es ejercicio ilegal de la abogacía con la marca de la plataforma
-- abajo. Es la línea del §11 que el módulo entero existe para no cruzar.
--
-- El caso que el cliente nombró —el turno en el consulado, el pasaporte— entra
-- por `tramites`, que es lo que de verdad describió: PAPELES Y TURNOS, no
-- estrategia migratoria. Y el abogado barato entra por `otro`, que es donde va
-- lo que no encaja en ninguna caja.
--
-- `emergencias` y `consulados` tampoco entran como TEMA: quien tiene una
-- emergencia necesita un número que atienda ahora, no vecinos escribiendo. Esos
-- dos siguen siendo fichas del directorio (`community_resources`), que es donde
-- la información tiene fuente citada.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LAS RESPUESTAS: POR QUÉ TABLA PROPIA Y NO `comments`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `public.comments` (0007) existe y comenta publicaciones del feed. Se descartó
-- por tres razones concretas, no por gusto:
--
--   · Su `post_id` es NOT NULL y referencia `posts`. Colgar respuestas de ahí
--     pedía o una columna polimórfica (y reescribir sus cuatro policies) o un
--     `post` fantasma por cada pedido.
--   · Su moderación es la del feed, con su propio contador y su propia pausa
--     por denuncias (0118). Un pedido de ayuda no se modera como un posteo:
--     acá "ocultar" tiene que dejar la fila para poder mirarla, y el autor del
--     PEDIDO no manda sobre las respuestas ajenas.
--   · La RLS de este módulo es más estricta que la del feed —sin `anon`, por lo
--     que dice §5.4— y mezclarlas habría obligado a que una de las dos cediera.
--
-- La tabla nueva es deliberadamente MÁS CHICA que su vecina: sin fotos, sin
-- respuestas anidadas, sin edición. Ver §6.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4. POR QUÉ UN PEDIDO SE PUBLICA AL TOQUE (y la 0120 exigía revisión)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ésta es la decisión más grande de esta migración y hay que poder defenderla.
--
-- La 0120 hizo que NADA se publicara solo, y citó al cliente: «todo esto se
-- verifica vía geovanny con la cuenta de admin». Esa regla la dijo sobre
-- OFRECIMIENTOS DE SERVICIO — gente proponiéndose para ir a un lugar físico— y
-- ahí una revisión previa es proporcional: del otro lado hay una organización
-- que va a dejar entrar a un desconocido.
--
-- Un pedido no tiene esa forma. Y tres cosas lo vuelven imposible de sostener:
--
--   1. LO QUE PIDE EL CLIENTE ES VELOCIDAD. «La gente pone lo que necesita y la
--      gente le contesta.» Un pedido escrito un viernes a la noche que aparece
--      el lunes no es un tablón: es un formulario de contacto con demora.
--   2. LA COLA ES UNA SOLA PERSONA. La 0120 lo escribió: «la cola humana es UNA
--      persona: es el recurso escaso de todo este diseño». Un tablón vivo la
--      desborda, y una cola desbordada termina aprobando por cansancio, que es
--      peor que no moderar.
--   3. EL FEED YA ES ABIERTO. Cualquiera publica texto a toda la comunidad, sin
--      revisión previa, desde la 0007. Exigirle revisión previa a «necesito una
--      silla de ruedas» mientras el mismo texto se publica libre en el feed no
--      protege a nadie: sólo empuja el pedido al lugar donde nadie lo va a
--      encontrar después.
--
-- Lo que reemplaza a la revisión previa NO es nada. Es una cadena de cuatro
-- controles que ya existen y siguen puestos:
--
--   a. El detector de datos de contacto de la app corre ANTES del insert sobre
--      el texto del pedido (`src/lib/comunidad/pedir-ayuda.ts`): un teléfono
--      propio publicado al lado de un barrio es el padrón que §5.4 evita.
--   b. `moderateText` (OpenAI) ahora sí es un GATE, no una cortesía: si vuelve
--      `flagged`, no hay fila.
--   c. Cupo de 5 pedidos abiertos por persona, en la base (§5). Antes contaba
--      borradores y pendientes; ahora cuenta lo PUBLICADO, que es lo único que
--      queda abierto en el flujo nuevo. Sin este cambio el cupo pasaba a ser
--      decorativo el mismo día.
--   d. Moderación POSTERIOR: el equipo oculta (`rejected`) y restaura
--      (`approved`) pedidos y respuestas desde `/admin/comunidad/pedir-ayuda`,
--      y cualquiera reporta desde la pantalla.
--
-- `pending` no se borra del CHECK: hay filas vivas en ese estado y borrar un
-- valor del enum las dejaría sin nombre. Queda como estado LEGADO y el panel lo
-- sigue sabiendo resolver.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LOS CINCO ESTADOS, DESPUÉS DE ESTA MIGRACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
--
--   approved  · publicado. Es donde NACE un pedido.
--   archived  · resuelto o dado de baja por su autor («ya conseguí lo que
--               necesitaba»). De acá no sale ninguna flecha, igual que antes.
--   rejected  · OCULTO POR EL EQUIPO, con motivo que su autor lee. El staff lo
--               puede devolver a approved (restaurar) si se equivocó.
--   draft     · LEGADO. Ya no se crea ninguno. Su autor lo puede archivar.
--   pending   · LEGADO. Lo que quedó en la cola vieja; el panel lo resuelve.
--
-- Transiciones (las escribe el guardián y las espeja `pedir-ayuda.ts`):
--   autor: approved→archived · draft→archived · pending→archived · pending→draft
--   staff: approved→rejected · rejected→approved · approved→archived
--          · pending→approved · pending→rejected   (las dos últimas, legado)
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 6. LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO
-- ═══════════════════════════════════════════════════════════════════════════
--   · NO permite EDITAR una respuesta. Se borra y se escribe otra. Una
--     respuesta editable es una respuesta que puede cambiar después de que
--     alguien la leyó y actuó sobre ella — y acá lo que se lee es un dato con
--     el que la persona se mueve (un número, una dirección, un horario).
--   · NO permite responder una respuesta. Sin hilos anidados: el cliente pidió
--     un tablón, no un foro. Una conversación larga entre dos ya tiene lugar
--     (`conversations`, contacto privado desde el pedido).
--   · NO guarda fotos en respuestas. Mismo motivo que la 0120: una cara
--     identificable de esta población al lado de un barrio y un tema, no.
--   · NO borra el detector de datos de contacto del PEDIDO, pero tampoco lo
--     aplica a las RESPUESTAS. Es una asimetría deliberada y es LA decisión de
--     producto de este módulo: el valor entero de lo que describió el cliente
--     es que alguien pase «el número del consulado». Un detector que bloquea
--     siete dígitos seguidos bloquea justamente eso. En el pedido el número que
--     aparece es el TUYO (dato personal, se bloquea); en la respuesta es el de
--     una oficina (información, se publica). Lo que cubre el riesgo del vivo que
--     contesta «llamame al mío» es la moderación posterior y el reporte, no un
--     regex — y la pantalla lo dice con todas las letras: quienes responden no
--     son Comunidad Latina.
--   · NO crea categoría de notificación nueva. La respuesta avisa al autor del
--     pedido con `public.emit_social_notification` (0070), kind `comment` y
--     `subject_kind = 'help_notice'` — misma agrupación por `group_key` que ya
--     usan los comentarios del feed, sin tocar el CHECK de `notifications`.
--   · NO toca `public.contactar_aviso_de_ayuda` (0120): el contacto privado
--     desde un pedido sigue funcionando igual y con el mismo nombre.
-- =============================================================================

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · EL TABLÓN PASA A SER DE PEDIDOS
-- ═══════════════════════════════════════════════════════════════════════════

-- Un aviso nuevo es un PEDIDO salvo que alguien diga lo contrario, y hoy no hay
-- forma de decir lo contrario. El default no es cosmético: es lo que hace que
-- una fila insertada por un script o por PostgREST sin `direction` caiga del
-- lado seguro en vez de fallar o inventar un ofrecimiento.
alter table public.community_help_notices
  alter column direction set default 'need';

comment on column public.community_help_notices.direction is
  'need = alguien PIDE (información, orientación, una ayuda puntual). offer = LEGADO: alguien se ofrecía a dar una mano. La 0130 archivó los offer vivos y sacó el camino para crear nuevos — el cliente lo pidió el 2026-09-03: "necesito manos" para una mudanza es responsabilidad legal de la plataforma si alguien se lastima. La columna se queda porque es lo que explica por qué esas filas están archivadas, y porque el CHECK de temas nuevos se apoya en ella.';

-- ---------------------------------------------------------------------------
-- Los cuatro temas nuevos. Ver §2 de la cabecera para el porqué de cada uno y
-- para los dos que siguen afuera (`migracion` y `legal`).
--
-- El do-block busca la constraint por su DEFINICIÓN y no por su nombre: mismo
-- patrón defensivo y re-corrible que usaron 0096, 0099, 0105 y la propia 0120.
-- Excluye por nombre a la constraint que agrega esta misma migración: su
-- definición también contiene `topic = ANY`, así que en una segunda corrida el
-- do-block se llevaría puesta la regla que acaba de escribir.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.community_help_notices'::regclass
     and contype = 'c'
     and conname <> 'community_help_notices_temas_nuevos_solo_de_pedido'
     and pg_get_constraintdef(oid) like '%topic = ANY%';
  if v_name is not null then
    execute format('alter table public.community_help_notices drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.community_help_notices
  add constraint community_help_notices_topic_check
  check (topic in (
    -- Los seis de la 0120.
    'comida', 'voluntariado', 'acopio', 'educacion', 'fe', 'trabajo',
    -- Los cuatro que trae la 0130.
    'tramites', 'salud', 'vivienda', 'otro'
  ));

-- La regla de §2 escrita donde no se puede olvidar: los cuatro temas nuevos son
-- de PEDIDO. Si algún día vuelve a existir un camino para ofrecer, su lista de
-- temas vuelve sola a ser la de la 0120 sin que nadie tenga que acordarse.
alter table public.community_help_notices
  drop constraint if exists community_help_notices_temas_nuevos_solo_de_pedido;

alter table public.community_help_notices
  add constraint community_help_notices_temas_nuevos_solo_de_pedido
  check (
    direction = 'need'
    or topic in ('comida', 'voluntariado', 'acopio', 'educacion', 'fe', 'trabajo')
  );

comment on column public.community_help_notices.topic is
  'DIEZ temas. Los seis de la 0120 (comida, voluntariado, acopio, educacion, fe, trabajo) más los cuatro que la 0130 habilita para PEDIDOS: tramites (papeles y turnos — el caso del consulado que contó el cliente), salud, vivienda y otro. Los cuatro nuevos exigen direction=need por constraint: el argumento de la 0120 para excluirlos era sobre OFRECIMIENTOS ("te presto un cuarto"), no sobre pedidos. migracion y legal siguen afuera incluso como pedido: un tema con ese nombre invita a que un desconocido conteste qué hacer con un caso, y eso es la línea del §11. src/lib/comunidad/types.ts espeja esta lista.';

-- ---------------------------------------------------------------------------
-- El contador de respuestas
--
-- COLUMNA CON TRIGGER, y no un `count(*)` agregado en la consulta. Es la misma
-- decisión que `posts.comment_count` (0007) y `listings.comment_count` (0038),
-- por la misma razón: el tablón lista doce pedidos por página y cada tarjeta
-- muestra cuántas respuestas tiene. Con un agregado, esa pantalla hace un
-- subselect por fila —el N+1 que este repo evita en todos lados— y el índice
-- del keyset deja de alcanzar. Con la columna, el número viaja en la MISMA
-- lectura que ya se hacía y cuesta cero consultas más.
--
-- El precio es el de siempre: un contador se puede desincronizar. Se paga con
-- lo mismo que sus dos hermanos — el trigger es la ÚNICA vía de escritura, y el
-- guardián bloquea cualquier otro update (§4 de esta sección).
-- ---------------------------------------------------------------------------
alter table public.community_help_notices
  add column reply_count int not null default 0 check (reply_count >= 0);

comment on column public.community_help_notices.reply_count is
  'Respuestas VISIBLES del pedido. Espejo exacto de posts.comment_count (0007). Lo mantiene app.help_replies_bump_count() en insert, delete y en cada cambio de status de una respuesta (ocultar resta, restaurar suma). Un update directo por un cliente autenticado lo bloquea app.community_help_notices_guard().';

-- El tablón nuevo: los PEDIDOS de una comunidad, lo más nuevo arriba. El índice
-- de la 0120 arranca por `topic`, así que no sirve para la lista SIN filtro de
-- tema, que es la vista por defecto y la más pedida. Cubre también el ORDER BY
-- del keyset (created_at desc, id desc), igual que su hermano.
create index community_help_notices_pedidos_idx
  on public.community_help_notices (tenant_id, created_at desc, id desc)
  where status = 'approved' and direction = 'need';

-- ---------------------------------------------------------------------------
-- Los ofrecimientos vivos se archivan
--
-- `archived` y no `rejected`: no hubo ningún veredicto sobre lo que esa gente
-- escribió. Se ofrecieron a ayudar y la plataforma decidió que ese camino no va
-- más. Marcarlos "rechazados" les diría, a cada uno en su pantalla de "Mis
-- pedidos", que hicieron algo mal.
--
-- Corre sin JWT (`auth.uid()` null), así que el guardián lo toma por la rama de
-- service_role y no le exige que la transición esté en la tabla del §5.
-- Los `draft` también entran: son invisibles para todos, ya no existe el
-- formulario que los abría, y si quedaran ocupan cupo para siempre.
-- ---------------------------------------------------------------------------
update public.community_help_notices
   set status = 'archived'
 where direction = 'offer'
   and status in ('draft', 'pending', 'approved');


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · community_help_replies — LAS RESPUESTAS
-- ═══════════════════════════════════════════════════════════════════════════

create table public.community_help_replies (
  id           uuid primary key default app.uuid_v7(),

  -- DENORMALIZADO igual que su tabla madre y que reactions/saves/follows: toda
  -- policy exige que coincida con app.current_tenant_id(), así que una fila con
  -- el tenant forjado no la ve nadie. El trigger además verifica que sea el
  -- MISMO tenant que el del pedido — dos filas de comunidades distintas atadas
  -- por una FK serían un cruce silencioso entre comunidades.
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  -- `on delete cascade`: si el pedido se borra (sólo lo puede borrar un admin),
  -- sus respuestas no tienen dónde leerse. No hay respuesta huérfana que
  -- conservar: fuera de su pedido, "probá en la 82 con Roosevelt" no significa
  -- nada.
  notice_id    uuid not null references public.community_help_notices(id) on delete cascade,
  created_by   uuid not null references public.profiles(id) on delete cascade,

  -- 2 caracteres de piso, no 20 como el cuerpo de un pedido. Es a propósito:
  -- la respuesta más valiosa que describió el cliente es un número de teléfono
  -- o el nombre de una oficina, y un piso alto obliga a rellenar con palabras
  -- que nadie necesita leer. El techo sí es el mismo (1000): pasado eso no es
  -- una respuesta, es un artículo.
  body         text not null check (char_length(btrim(body)) between 2 and 1000),

  -- visible → lo ve la comunidad.
  -- hidden  → lo ocultó el equipo. La fila SE QUEDA: es la evidencia de por qué
  --           se ocultó y lo que permite restaurar si fue un error.
  -- deleted → lo borró su autor. Tampoco se borra la fila, por lo mismo que
  --           `job_applications` archiva en vez de borrar: si desapareciera,
  --           alguien podría dejar una respuesta dañina, esperar el reporte y
  --           borrarla justo antes de que el equipo la mire.
  status       text not null default 'visible'
                 check (status in ('visible', 'hidden', 'deleted')),

  -- Quién del equipo la ocultó (o la restauró) y cuándo. Los escribe el
  -- trigger, jamás la app — misma regla que reviewed_by/reviewed_at en la 0120.
  -- Un borrado del AUTOR no estampa nada acá: no hubo decisión del equipo.
  moderated_by uuid references public.profiles(id) on delete set null,
  moderated_at timestamptz,
  -- Motivo, para el registro del equipo. A diferencia de review_note (0120)
  -- este texto NO se le muestra a quien escribió: una respuesta ocultada no
  -- tiene "corregir y volver a enviar", así que un reproche sin acción posible
  -- sería sólo un reproche.
  moderation_note text check (moderation_note is null
                              or char_length(btrim(moderation_note)) between 10 and 400),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Moderado a medias no existe: o hay firma y fecha, o no hubo decisión del
  -- equipo. Espeja community_help_notices_revision_completa.
  constraint community_help_replies_moderacion_completa check (
    (moderated_by is null) = (moderated_at is null)
  )
);

comment on table public.community_help_replies is
  'Respuestas públicas a un pedido del tablón "Pedir ayuda" (0130). Es lo que el cliente describió el 2026-09-03: "la gente pone lo que necesita y la gente le contesta". SIN edición, SIN anidamiento y SIN fotos, cada una por su motivo (§6 de la migración). Tabla propia y no public.comments (0007): aquélla cuelga de posts con post_id NOT NULL, se modera con las reglas del feed y su RLS deja entrar a anon — las tres cosas incompatibles acá. El detector de datos de contacto NO corre sobre este texto, a propósito: pasar el número de un consulado ES el producto (§6).';

comment on column public.community_help_replies.status is
  'visible → la ve la comunidad. hidden → la ocultó el equipo (con firma y motivo). deleted → la borró su autor. Las tres conservan la fila: una respuesta que desaparece de la base es una respuesta que no se puede auditar después de un reporte. Sólo `visible` suma a community_help_notices.reply_count.';
comment on column public.community_help_replies.moderation_note is
  'Motivo interno del equipo. A diferencia de community_help_notices.review_note, NO se le muestra a quien escribió: una respuesta ocultada no tiene camino de corrección, así que mostrarle el reproche sería sólo un reproche.';

-- El hilo de UN pedido, en orden de conversación (lo más viejo primero: una
-- respuesta contesta a lo de arriba). Sin `where status = 'visible'` a
-- propósito: el panel lista por pedido incluyendo lo oculto, y su autor ve las
-- propias borradas. Un índice parcial obligaría a un segundo índice para eso.
create index community_help_replies_hilo_idx
  on public.community_help_replies (notice_id, created_at);

-- "Lo que escribí yo" y el control de flood por persona dentro de la comunidad.
create index community_help_replies_autor_idx
  on public.community_help_replies (tenant_id, created_by, created_at desc);

-- La cola del panel: lo último que se respondió en la comunidad, lo más nuevo
-- primero. Es la pantalla de moderación de respuestas, que no tiene un pedido
-- de referencia por donde entrar.
create index community_help_replies_cola_idx
  on public.community_help_replies (tenant_id, created_at desc);

create trigger community_help_replies_set_updated_at
before update on public.community_help_replies
for each row execute function extensions.moddatetime(updated_at);


-- ---------------------------------------------------------------------------
-- 2.1 · El guardián de las respuestas
--
-- Lo mismo que en la 0120: una policy autoriza FILAS, no COLUMNAS ni
-- TRANSICIONES, y varias de estas reglas necesitan mirar OLD o consultar otra
-- tabla. Acá vive lo que un WITH CHECK no puede decir:
--
--   · se responde en primera persona y en la propia comunidad;
--   · el pedido tiene que existir, ser de esta comunidad y estar PUBLICADO —
--     responder un pedido oculto o archivado es escribirle a nadie;
--   · no se responde a quien te bloqueó (ni a quien bloqueaste);
--   · el texto es INMUTABLE: una respuesta no se edita (§6);
--   · sólo el staff oculta y restaura, y su firma la pone el trigger.
-- ---------------------------------------------------------------------------
create or replace function app.community_help_replies_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid    := auth.uid();
  v_staff  boolean := coalesce(app.is_staff(), false);
  v_pedido record;
begin
  -- ---- Alta -------------------------------------------------------------
  if tg_op = 'INSERT' then
    -- La firma del equipo no se siembra desde el alta ni por accidente.
    new.moderated_by    := null;
    new.moderated_at    := null;
    new.moderation_note := null;

    select n.id, n.tenant_id, n.created_by, n.status
      into v_pedido
      from public.community_help_notices n
     where n.id = new.notice_id;

    -- Mismo mensaje para "no existe", "es de otra comunidad" y "no está
    -- publicado": desde acá no se puede averiguar qué pedidos hay en otro lado
    -- ni cuáles ocultó el equipo. Mismo criterio que
    -- public.contactar_aviso_de_ayuda (0120).
    if not found
       or v_pedido.tenant_id is distinct from new.tenant_id
       or v_pedido.status <> 'approved' then
      raise exception 'NOTICE_NOT_FOUND: ese pedido no está disponible en tu comunidad.';
    end if;

    if v_uid is not null then
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: una respuesta se escribe en primera persona.';
      end if;
      if new.status <> 'visible' then
        raise exception 'FORBIDDEN: una respuesta nace visible.';
      end if;

      -- Bloqueo global (0020): corta en las dos direcciones y con el MISMO
      -- mensaje — quien fue bloqueado no puede deducir quién bloqueó a quién.
      if v_pedido.created_by <> v_uid
         and app.pair_blocked(v_uid, v_pedido.created_by) then
        raise exception 'USER_BLOCKED: no podés responder a esta persona.';
      end if;
    end if;

    return new;
  end if;

  -- ---- Edición ----------------------------------------------------------
  -- Identidad congelada: mover una respuesta de dueño, de pedido o de comunidad
  -- no es editar, es fabricar una ajena.
  if new.id <> old.id
     or new.tenant_id  <> old.tenant_id
     or new.notice_id  <> old.notice_id
     or new.created_by <> old.created_by then
    raise exception 'FORBIDDEN: no se puede mover una respuesta de dueño, de pedido ni de comunidad.';
  end if;

  -- El texto NUNCA cambia. Ni el autor ni el staff (§6): lo que se leyó es lo
  -- que quedó escrito. Quien se equivocó, borra y escribe otra.
  if new.body is distinct from old.body and v_uid is not null then
    raise exception 'CONTENT_FROZEN: una respuesta no se edita. Borrala y escribí otra.';
  end if;

  -- Transiciones de estado.
  if new.status is distinct from old.status then
    if v_uid is null then
      null; -- service_role: seed, cron, scripts auditados.
    elsif v_staff then
      -- Ocultar y restaurar. `deleted` no está: lo que borró su autor no lo
      -- resucita el equipo.
      if not (
        (old.status = 'visible' and new.status = 'hidden')
        or (old.status = 'hidden'  and new.status = 'visible')
      ) then
        raise exception 'BAD_TRANSITION: de % no se puede pasar a % desde moderación.', old.status, new.status;
      end if;
    else
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: no es tu respuesta.';
      end if;
      -- El autor sólo borra la suya, y sólo si está visible. De `hidden` no
      -- sale: borrar lo que el equipo ocultó sería borrar la evidencia.
      if not (old.status = 'visible' and new.status = 'deleted') then
        raise exception 'BAD_TRANSITION: de % no podés pasar a %.', old.status, new.status;
      end if;
    end if;
  end if;

  -- La firma y el motivo son del equipo, y los pone el trigger: así el motivo
  -- nunca queda pegado a una decisión que no se tomó.
  if v_uid is not null and not v_staff then
    new.moderated_by    := old.moderated_by;
    new.moderated_at    := old.moderated_at;
    new.moderation_note := old.moderation_note;
  end if;

  if v_staff and new.status is distinct from old.status then
    new.moderated_by := v_uid;
    new.moderated_at := now();
  end if;

  return new;
end;
$$;

comment on function app.community_help_replies_guard() is
  'Guardián de community_help_replies (0130): alta en primera persona, siempre visible, sólo sobre un pedido approved de la MISMA comunidad y sin bloqueo entre las partes; identidad y TEXTO congelados para siempre (una respuesta no se edita); transiciones por actor (el autor sólo visible→deleted, el staff sólo visible↔hidden) y firma de moderación escrita acá y no por la app. Con auth.uid() null (service_role/seed/cron) las reglas de autoría no aplican.';

revoke execute on function app.community_help_replies_guard() from public, anon;

create trigger community_help_replies_guard
before insert or update on public.community_help_replies
for each row execute function app.community_help_replies_guard();

-- Cuenta suspendida no responde — mismo par de triggers que job_applications
-- (0040), listing_comments (0038) y community_help_notices (0120).
create trigger community_help_replies_enforce_account_active
before insert on public.community_help_replies
for each row execute function app.enforce_account_active();

create trigger community_help_replies_update_enforce_account_active
before update on public.community_help_replies
for each row execute function app.enforce_account_active();


-- ---------------------------------------------------------------------------
-- 2.2 · El trigger que mantiene el contador
--
-- Calco de app.reactions_bump_counters() (0007/0124) con una rama más: acá el
-- contador no sólo sube y baja con la fila, también sigue los cambios de
-- `status` — ocultar una respuesta tiene que restarla del número que ve la
-- comunidad, o el tablón promete respuestas que no están.
--
-- SECURITY DEFINER para que el update no dependa de las policies del lector, y
-- al correr dentro de un trigger pasa el `pg_trigger_depth()` del guardián del
-- pedido.
-- ---------------------------------------------------------------------------
create or replace function app.help_replies_bump_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'visible' then
      update public.community_help_notices
         set reply_count = reply_count + 1
       where id = new.notice_id
         and tenant_id = new.tenant_id;
    end if;
    return new;

  elsif tg_op = 'UPDATE' then
    if old.status = 'visible' and new.status <> 'visible' then
      update public.community_help_notices
         set reply_count = greatest(reply_count - 1, 0)
       where id = new.notice_id
         and tenant_id = new.tenant_id;
    elsif old.status <> 'visible' and new.status = 'visible' then
      update public.community_help_notices
         set reply_count = reply_count + 1
       where id = new.notice_id
         and tenant_id = new.tenant_id;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if old.status = 'visible' then
      update public.community_help_notices
         set reply_count = greatest(reply_count - 1, 0)
       where id = old.notice_id
         and tenant_id = old.tenant_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

comment on function app.help_replies_bump_count() is
  'Mantiene community_help_notices.reply_count. Suma en INSERT visible, resta en DELETE visible, y sigue los cambios de status (ocultar resta, restaurar suma) — sin esa tercera rama el tablón anunciaría respuestas que la moderación ya bajó. Espejo de app.reactions_bump_counters (0007).';

revoke execute on function app.help_replies_bump_count() from public, anon;

create trigger community_help_replies_bump_count
after insert or update or delete on public.community_help_replies
for each row execute function app.help_replies_bump_count();


-- ---------------------------------------------------------------------------
-- 2.3 · RLS — las cuatro policies canónicas (gate `npm run check:rls`)
--
-- ⚠️ SIN `anon`, exactamente por lo que decidió la 0120 para su tabla madre y
-- con más razón todavía: una respuesta cuelga de un pedido que ya expone
-- persona + barrio + necesidad. Abrirla a internet sería publicar ese cruce,
-- indexable y para siempre. Pedir cuenta no es fricción, es la medida.
-- ---------------------------------------------------------------------------
alter table public.community_help_replies enable row level security;
alter table public.community_help_replies force row level security;

-- Lo visible de la comunidad, más lo propio (incluido lo que uno mismo borró:
-- verlo tachado es lo que hace que "borrar" se entienda como que funcionó), más
-- todo para el equipo, que es quien tiene que poder mirar lo oculto.
create policy community_help_replies_select on public.community_help_replies
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      status = 'visible'
      or created_by = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- Se responde en primera persona, en la propia comunidad y siempre visible. El
-- trigger vuelve a exigirlo, y agrega lo que la policy no puede: que el pedido
-- exista, esté publicado y no haya bloqueo entre las partes.
create policy community_help_replies_insert on public.community_help_replies
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and status = 'visible'
);

-- El autor borra la suya; el staff oculta y restaura. Qué transición es válida
-- lo decide el trigger: acá sólo se dice QUIÉN puede tocar la fila.
create policy community_help_replies_update on public.community_help_replies
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (created_by = (select auth.uid()) or (select app.is_staff()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    (created_by = (select auth.uid()) and status in ('visible', 'deleted'))
    or (select app.is_staff())
  )
);

-- Sólo admins borran de verdad. El autor pasa a `deleted`, que deja la fila:
-- ver el comentario de la columna `status`.
create policy community_help_replies_delete on public.community_help_replies
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- GRANTS EXPLÍCITOS. La 0085 lo dejó escrito con sangre y la 0120 lo repitió:
-- los default privileges de este esquema —compartido con otro producto— no
-- alcanzan a `anon` ni garantizan nada para `authenticated`, así que una tabla
-- nueva NACE sin acceso y sin un solo error visible: la app se ve vacía y no
-- falla nada. `anon` no recibe NADA a propósito; el grant que falta y la policy
-- que falta dicen lo mismo, y que lo digan las dos es deliberado.
revoke all on table public.community_help_replies from anon, authenticated;
grant select, insert, update, delete on table public.community_help_replies to authenticated;
grant all                            on table public.community_help_replies to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · EL GUARDIÁN DEL PEDIDO, RE-CREADO ENTERO
--
-- Base: 0120. Se re-crea COMPLETO y no por diff — contrato de este repo: quien
-- lea esta migración tiene que ver el cuerpo final, no un parche.
--
-- Cambia en cuatro cosas y ninguna más:
--   a. Un pedido puede NACER `approved` (§4). Sigue sin poder nacer `rejected`.
--   b. El cupo de 5 abiertos cuenta también lo PUBLICADO. Antes contaba draft y
--      pending, que en el flujo nuevo no existen: sin este cambio el cupo se
--      volvía decorativo el mismo día que se apagó la cola previa.
--   c. `reply_count` no lo escribe ningún cliente: lo fuerza a 0 en el alta y
--      bloquea cualquier update que no venga de un trigger.
--   d. Transiciones nuevas del autor (draft→archived, pending→archived) para
--      que las filas legadas de la cola vieja se puedan cerrar.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.community_help_notices_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid    := auth.uid();
  v_staff    boolean := coalesce(app.is_staff(), false);
  v_abiertos int;
begin
  -- ---- Alta -------------------------------------------------------------
  if tg_op = 'INSERT' then
    -- Los sellos de revisión y el contador no se siembran desde el alta ni por
    -- accidente. Se FUERZAN en vez de rechazarse: no hay nada que decidir ni
    -- error que traducir a una pantalla (mismo criterio que
    -- app.listings_like_count_nace_en_cero, 0124).
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
    new.reply_count := 0;

    if v_uid is not null then
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: un pedido se publica en primera persona.';
      end if;
      -- `approved` desde el alta es lo que hace vivo al tablón (§4). `rejected`
      -- y `archived` siguen sin poder ser el estado de nacimiento: nacer
      -- rechazado no significa nada, y nacer archivado sería una fila que ocupa
      -- lugar sin haber existido.
      if new.status not in ('draft', 'approved') then
        raise exception 'FORBIDDEN: un pedido nace publicado.';
      end if;

      -- Cupo por persona, EN LA BASE. El rate limit de la server action vive en
      -- memoria del proceso y no sobrevive a un deploy ni a un segundo lambda;
      -- esto sí. Cuenta lo que todavía no se cerró: cinco pedidos abiertos es
      -- holgado para cualquier uso real y corta el flood.
      select count(*) into v_abiertos
        from public.community_help_notices n
       where n.created_by = v_uid
         and n.status in ('draft', 'pending', 'approved');
      if v_abiertos >= 5 then
        raise exception 'TOO_MANY_OPEN: ya tenés 5 pedidos abiertos.';
      end if;
    end if;

    perform app.exigir_ficha_de_ayuda_valida(new.resource_id, new.tenant_id, new.topic);
    return new;
  end if;

  -- ---- Edición ----------------------------------------------------------
  -- Update interno (el contador de respuestas): ya pasó por el guardián de la
  -- tabla que lo disparó. Sale antes que nada para no volver a correr la
  -- máquina de estados sobre una fila que no cambió de estado.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Identidad congelada: mover un pedido de dueño o de comunidad no es editar,
  -- es fabricar uno ajeno.
  if new.id <> old.id
     or new.tenant_id <> old.tenant_id
     or new.created_by <> old.created_by then
    raise exception 'FORBIDDEN: no se puede mover un pedido de dueño ni de comunidad.';
  end if;

  -- El contador sólo lo escribe su trigger. Sin esto, cualquier cliente
  -- autenticado le pone 900 por PostgREST y el número deja de significar algo —
  -- y éste, como view_count, se muestra en público.
  if new.reply_count is distinct from old.reply_count
     and coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' then
    raise exception 'PROTECTED_COLUMNS: reply_count solo se actualiza por triggers';
  end if;

  -- El CONTENIDO sólo se toca mientras es borrador (legado), y sólo lo toca su
  -- autor. Un pedido publicado NO se edita: es la defensa contra juntar
  -- respuestas con un texto y reescribirlo después con otro. Vale para el staff
  -- también — un moderador que reescribe el texto de otro termina firmando
  -- palabras ajenas.
  if (new.direction   is distinct from old.direction)
     or (new.topic        is distinct from old.topic)
     or (new.resource_id  is distinct from old.resource_id)
     or (new.title        is distinct from old.title)
     or (new.body         is distinct from old.body)
     or (new.area_label   is distinct from old.area_label)
     or (new.availability is distinct from old.availability)
     or (new.org_name     is distinct from old.org_name)
     or (new.languages    is distinct from old.languages) then
    if v_uid is not null then
      if old.status <> 'draft' then
        raise exception 'CONTENT_FROZEN: un pedido publicado no se edita. Dalo de baja y escribí otro.';
      end if;
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: sólo quien lo escribió puede editar su pedido.';
      end if;
      perform app.exigir_ficha_de_ayuda_valida(new.resource_id, new.tenant_id, new.topic);
    end if;
  end if;

  -- Transiciones. La tabla de verdad está en §5 de la cabecera de la 0130.
  if new.status is distinct from old.status then
    if v_uid is null then
      -- service_role: se confía (seed, cron, scripts auditados, esta migración).
      null;
    elsif v_staff then
      if not (
        (old.status = 'approved' and new.status in ('rejected', 'archived'))
        or (old.status = 'rejected' and new.status = 'approved')
        -- Legado de la cola previa: lo que quedó en `pending` se sigue
        -- pudiendo resolver.
        or (old.status = 'pending'  and new.status in ('approved', 'rejected'))
      ) then
        raise exception 'BAD_TRANSITION: de % no se puede pasar a % desde moderación.', old.status, new.status;
      end if;
    else
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: no es tu pedido.';
      end if;
      if not (
        (old.status = 'approved' and new.status = 'archived')
        -- Legado: cerrar lo que quedó de la cola vieja.
        or (old.status = 'draft'    and new.status = 'archived')
        or (old.status = 'pending'  and new.status in ('draft', 'archived'))
        or (old.status = 'rejected' and new.status = 'archived')
      ) then
        raise exception 'BAD_TRANSITION: de % no podés pasar a %.', old.status, new.status;
      end if;
    end if;
  end if;

  -- Los sellos de revisión y el motivo son del staff, y los pone el trigger:
  -- así el motivo nunca queda pegado a una decisión que no se tomó.
  if v_uid is not null and not v_staff then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_note := old.review_note;
  end if;

  if v_staff and new.status is distinct from old.status
     and new.status in ('approved', 'rejected', 'archived') then
    new.reviewed_by := v_uid;
    new.reviewed_at := now();
  end if;

  return new;
end;
$$;

comment on function app.community_help_notices_guard() is
  'Guardián de community_help_notices (0120, re-creado entero por la 0130): alta en primera persona y ya PUBLICADA (el tablón de pedidos es vivo — ver §4 de la 0130), cupo de 5 pedidos abiertos por persona contando lo publicado, identidad congelada, contenido congelado salvo en los borradores legados, reply_count escribible sólo por trigger, transiciones explícitas por actor (autor vs staff) y sellos de revisión escritos acá y no por la app. Sale temprano con pg_trigger_depth() > 1: ese update viene del contador de respuestas. Con auth.uid() null (service_role/seed/cron) las reglas de autoría no aplican.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · LA POLICY DE ALTA DEL PEDIDO
--
-- Único cambio: `status` puede ser `approved` además de `draft`. Es la mitad
-- que le falta al guardián — sin esto la policy rechazaría la fila antes de que
-- el trigger llegue a mirarla. Los otros dos candados (primera persona, propia
-- comunidad) no se mueven.
--
-- Se re-crea con el MISMO nombre: `npm run check:rls` exige exactamente cuatro
-- policies por tabla, nombradas <tabla>_select|insert|update|delete.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists community_help_notices_insert on public.community_help_notices;

create policy community_help_notices_insert on public.community_help_notices
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and status in ('draft', 'approved')
);

commit;
