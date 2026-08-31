-- =============================================================================
-- 0121_ofrecer_y_pedir_ayuda.sql — Comunidad Latina
--
-- "Ayuda entre vecinos": el tablón donde la gente OFRECE su tiempo, su oficio
-- o una donación, y donde una organización (o una persona) DICE QUE NECESITA
-- una mano. Pedido textual del cliente, por WhatsApp:
--
--   «Falta un botón en la parte de comunidad / en casi todas las opciones para
--    que la gente pueda aplicar a bancos de comida si quiere ofrecer servicios
--    - voluntarios si quieren ofrecer sus servicios - centro de acopio lo
--    mismo. Tanto de parte de la persona que quiere prestar sus servicios o el
--    lugar donde necesita prestar los servicios»
--   «Y todo esto se verifica vía Geovanny con la cuenta de admin»
--   «En la parte de pedir ayuda, es una opción para ayudar a las personas con
--    drogas, alcohol, medicinas, etc»
--   «También ayuda comunitaria como iglesias, personal, o algo específico»
--   «Conseguir trabajos»
--   «Monetariamente no se ayuda»
--
-- ── POR QUÉ UNA TABLA NUEVA Y NO UN TEMA MÁS DE `community_resources` ────────
-- Las migraciones 0099 (voluntariado) y 0105 (acopio) resolvieron sus pedidos
-- SIN tabla nueva, y con razón: eran DIRECTORIOS —fichas de organizaciones,
-- curadas por admins, con fuente obligatoria—. Este pedido es la otra cosa.
--
--   · `community_resources` es de LECTURA para el usuario. Su RLS de escritura
--     (0096) sólo admite domain_admin/global_admin, y su procedencia es NOT
--     NULL: cada ficha tiene un tercero identificable que la publica y una URL
--     donde verificarla. Un vecino que dice "tengo camioneta los sábados" no
--     tiene fuente que citar, y obligarlo a inventar una rompería la promesa
--     que sostiene TODO el directorio (que nada de lo que se lee ahí lo dice
--     la plataforma).
--   · Lo que pide el cliente es CONTENIDO DE USUARIO con aprobación previa:
--     nace pendiente, lo mira un admin, recién ahí se ve. `community_resources`
--     no tiene ese ciclo ni podría tenerlo sin cambiarle el sentido a la tabla.
--
-- Tampoco es un `listings`. Perdido y encontrado sí lo es (0096) porque reusa
-- fotos, boosts, FTS y `area_label`. Acá no hay foto, no hay precio, no hay
-- boost y no puede haberlo: lo único que se publica es texto y una intención.
-- Colgarlo de `listings` habría metido una fila sin precio ni fotos en la
-- tabla que alimenta seis módulos comerciales, con el riesgo permanente de que
-- un listado se olvide de filtrar por `kind` y termine ofreciendo "necesito
-- ayuda con el alcohol" entre departamentos en alquiler.
--
-- ── TAXONOMÍA: SEIS TEMAS, TRES DE ELLOS COMPARTIDOS CON EL DIRECTORIO ───────
-- El usuario ve UNA taxonomía, no dos. Por eso los tres temas que el cliente
-- nombra explícitamente (bancos de comida, voluntarios, centro de acopio)
-- usan LOS MISMOS SLUGS que `community_resources`: `comida`, `voluntariado`,
-- `acopio`. Nada de "food_bank" acá y "comida" allá.
--
-- Los otros tres son exclusivos de este tablón, y NO se agregaron al CHECK del
-- directorio a propósito:
--   · `adicciones`  (drogas, alcohol, medicinas — el pedido B3)
--   · `comunitaria` (iglesias, apoyo personal, un pedido puntual — B4)
--   · `trabajo`     (conseguir trabajo — B5)
--
-- Sumarlos como temas de `community_resources` habría creado tres secciones de
-- directorio VACÍAS: la pantalla de recursos agrupa por tema y muestra lo que
-- hay publicado, así que "Adicciones" aparecería como una puerta que promete
-- clínicas y no tiene ninguna adentro. Para el tema donde el error se paga más
-- caro —alguien buscando ayuda con una adicción a las tres de la mañana— una
-- puerta vacía es peor que ninguna puerta. Cuando existan fichas reales de
-- tratamiento, `adicciones` se suma al directorio en su propia migración, con
-- su fuente obligatoria, y este tablón le queda al lado como lo que es: gente.
--
-- El espejo TypeScript vive en `src/lib/comunidad/types.ts` (`HELP_TOPICS`), y
-- ahí los tres slugs compartidos están verificados EN COMPILACIÓN contra
-- `ResourceTopic` con `satisfies`: si alguien renombra `acopio` en el
-- directorio, el proyecto deja de compilar en vez de quedar con dos
-- vocabularios distintos que nadie nota.
--
-- ── LA APROBACIÓN POR ADMIN ES DE LA BASE, NO DE LA APP (pedido B2) ──────────
-- `status` nace en 'pending' Y LA POLICY DE INSERT LO EXIGE
-- (`status = 'pending'` en el `with check`). No alcanza con que la server
-- action escriba 'pending': quien mande un POST a mano contra PostgREST con su
-- propio token se topa con la misma regla. Y la policy de UPDATE del dueño
-- permite 'pending' o 'closed' —nunca 'published'—, así que nadie se
-- autopublica ni editando una fila propia.
--
-- Quien publica es el staff del tenant, desde /admin/moderacion, y el ítem
-- llega ahí por `moderation_queue` con `subject_kind = 'help_request'`, que
-- esta misma migración agrega al CHECK de la 0009.
--
-- ── "MONETARIAMENTE NO SE AYUDA" (B6) NO VIVE ACÁ, Y ESO ES DELIBERADO ───────
-- No hay CHECK de dinero en esta tabla. Un regex de moneda dentro de un
-- CHECK de Postgres es una promesa que no se puede mantener: no se puede
-- iterar sin migración, no se puede testear con casos, no puede explicar por
-- qué rechaza, y el día que dé un falso positivo va a fallar el INSERT con un
-- error de constraint crudo delante de una persona que estaba pidiendo ayuda.
--
-- El guardrail vive en `src/lib/moderation/money-block.ts`, corre en la server
-- action (siempre, sin excepción — un gate de UI no cuenta) y devuelve un
-- mensaje que explica el porqué. Tiene tests con casos positivos y negativos:
-- "banco de comida" y "dono medicinas" NO pueden bloquearse.
--
-- ── SIN DATOS DE CONTACTO EN LA TABLA, A PROPÓSITO ──────────────────────────
-- No hay columna `phone`, `email` ni `website`. El contacto pasa por el perfil
-- de quien publica y por los mensajes de la plataforma, igual que en Perdido y
-- encontrado: un teléfono publicado en un tablón de ayuda es exactamente el
-- dato que un estafador cosecha. `community_resources` SÍ tiene teléfono
-- porque ahí el teléfono es de una organización con fuente citada; acá sería
-- el de un vecino.
--
-- ── VISIBILIDAD: SÓLO PARA GENTE CON CUENTA, DE ESTA COMUNIDAD ──────────────
-- La policy de SELECT es `to authenticated`, sin rama para `anon`. Es la
-- diferencia más grande respecto de `community_resources` (que sí es público,
-- porque una clínica quiere que la encuentren en Google) y no es un olvido:
-- acá lo publicado puede ser "necesito ayuda con el alcohol" firmado con
-- nombre y apellido. Eso no va a la web abierta.
--
-- Y no se cruza de comunidad: el `tenant_id` sale del JWT
-- (`app.current_tenant_id()`), NUNCA de un parámetro del cliente.
--
-- ── GRANTS EXPLÍCITOS (la 0085 lo dejó escrito con sangre) ───────────────────
-- Este schema está compartido con otro producto y sus default privileges no
-- alcanzan a nuestros roles: una tabla nueva NACE sin acceso. Sin GRANT,
-- Postgres ni llega a evaluar la policy — la pantalla se ve vacía, sin un solo
-- error. Van explícitos abajo.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table public.community_help_requests (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants(id),
  created_by  uuid not null references public.profiles(id),

  -- Los DOS lados del pedido del cliente, en una sola tabla y no en dos.
  -- Es la misma pantalla, el mismo tema y el mismo flujo de aprobación; lo
  -- único que cambia es la dirección de la ayuda. Dos tablas habrían
  -- duplicado seis policies para no ahorrar una sola línea de lógica.
  --   'ofrezco'  → una persona pone su tiempo, su oficio o una donación.
  --   'necesito' → una persona u organización pide una mano.
  kind        text not null check (kind in ('ofrezco', 'necesito')),

  -- Espeja HELP_TOPICS en src/lib/comunidad/types.ts. Los tres primeros son
  -- LITERALMENTE los slugs del directorio curado (0096/0099/0105).
  topic       text not null check (topic in (
                'comida', 'voluntariado', 'acopio',
                'adicciones', 'comunitaria', 'trabajo'
              )),

  title       text not null check (char_length(btrim(title)) between 6 and 100),
  body        text not null check (char_length(btrim(body)) between 20 and 1200),

  -- Zona OPCIONAL. En Perdido y encontrado es obligatoria porque sin zona el
  -- aviso no sirve para nada; acá no: alguien que pide ayuda con una adicción
  -- puede no querer decir en qué esquina vive, y forzarlo sólo produciría
  -- zonas falsas o —peor— que no publique. Quien sí la pone aparece en las
  -- búsquedas por barrio; el resto aparece igual.
  area_label  text check (area_label is null or char_length(btrim(area_label)) between 3 and 80),

  -- Sólo tiene sentido en 'necesito': el nombre del lugar que pide la mano
  -- (la parroquia, el comedor, el centro vecinal). Es TEXTO DECLARADO por
  -- quien publica, no una verificación — por eso la UI lo muestra como "dice
  -- representar a", nunca con un sello. Quien verifica es el admin, mirando.
  organization_name text check (
    organization_name is null or char_length(btrim(organization_name)) between 2 and 120
  ),

  -- "Sábados a la mañana", "de lunes a jueves después de las 6". Texto humano
  -- por el mismo motivo que `cost_note` en la 0096: la disponibilidad real de
  -- una persona no entra en un rango horario estructurado.
  availability_note text check (
    availability_note is null or char_length(btrim(availability_note)) <= 160
  ),

  -- pending  → recién publicado, INVISIBLE para todos menos su autor y el staff.
  -- published→ lo aprobó un admin (B2). Es el ÚNICO estado que se ve en el tablón.
  -- rejected → lo bajó un admin. Estado final: ni el autor lo reabre.
  -- closed   → el autor dijo "ya está resuelto". Deja de ofrecerse, no se borra.
  status      text not null default 'pending'
                check (status in ('pending', 'published', 'rejected', 'closed')),

  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- El nombre de la organización es del lado que pide, no del que ofrece.
  -- Sin esto, un "ofrezco" podría firmarse como "Cruz Roja" y la card lo
  -- mostraría igual: es una suplantación gratis, y la frena el modelo.
  constraint community_help_requests_org_solo_necesito check (
    organization_name is null or kind = 'necesito'
  )
);

comment on table public.community_help_requests is
  'Tablón "Ayuda entre vecinos" (0121): contenido DE USUARIO con aprobación previa de admin, los dos lados (ofrezco / necesito). NO es community_resources —eso es el directorio curado de organizaciones con fuente obligatoria y sin escritura de usuarios (0096)—. Nace en pending por RLS, no por confianza en la app. Sin datos de contacto por diseño: se habla por el perfil y los mensajes de la plataforma. Sólo lo lee gente con cuenta de ESTA comunidad: lo publicado puede ser "necesito ayuda con el alcohol" firmado con nombre, y eso no va a la web abierta.';
comment on column public.community_help_requests.kind is
  'ofrezco = pone tiempo/oficio/donación · necesito = pide una mano. Los dos lados que pidió el cliente ("tanto de parte de la persona que quiere prestar sus servicios o el lugar donde necesita prestar los servicios").';
comment on column public.community_help_requests.topic is
  'Espeja HELP_TOPICS (src/lib/comunidad/types.ts). comida/voluntariado/acopio son LOS MISMOS slugs del directorio curado — el usuario ve una sola taxonomía. adicciones/comunitaria/trabajo son exclusivos de este tablón y NO se agregaron a community_resources para no crear secciones de directorio vacías (ver cabecera).';
comment on column public.community_help_requests.status is
  'pending por default Y por policy de INSERT: la aprobación del admin (pedido B2) es una regla de la base, no una cortesía de la app. El dueño nunca puede llegar a published — ni editando su propia fila.';
comment on column public.community_help_requests.organization_name is
  'Nombre DECLARADO del lugar que pide la mano. No es una verificación y la UI no le pone sello. Sólo puede existir en kind = necesito (constraint community_help_requests_org_solo_necesito): un "ofrezco" firmado como una ONG sería suplantación.';
comment on column public.community_help_requests.area_label is
  'Opcional a propósito, al revés que en Perdido y encontrado: quien pide ayuda por una adicción puede no querer decir dónde vive, y exigirlo produce zonas falsas o silencio.';

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------

-- El tablón: publicadas de un tenant, por tema y lado, más nuevas primero.
-- Parcial sobre `published` porque es el 99% de las lecturas y deja el índice
-- chico (las pending son unas pocas y las mira el staff con su propio filtro).
create index community_help_requests_board_idx
  on public.community_help_requests (tenant_id, topic, kind, created_at desc)
  where status = 'published';

-- La cola del admin y "mis publicaciones": las dos leen por estado.
create index community_help_requests_status_idx
  on public.community_help_requests (tenant_id, status, created_at desc);

-- "Lo que publiqué yo", sin escanear el tablón entero.
create index community_help_requests_author_idx
  on public.community_help_requests (created_by, created_at desc);

create trigger community_help_requests_set_updated_at
before update on public.community_help_requests
for each row execute function extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 3. RLS — las CUATRO policies canónicas, ni una más (gate `npm run check:rls`)
-- ---------------------------------------------------------------------------
alter table public.community_help_requests enable row level security;
alter table public.community_help_requests force row level security;

-- SELECT — `to authenticated` y NUNCA `anon`: ver la cabecera. Tres ramas:
--   1. lo publicado de MI comunidad (el tablón);
--   2. lo mío, en cualquier estado (para que vea que está en revisión);
--   3. el staff de mi comunidad, en cualquier estado (para poder aprobarlo).
create policy community_help_requests_select on public.community_help_requests
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      status = 'published'
      or created_by = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- INSERT — la regla de oro de esta migración. El tenant sale del JWT, el autor
-- es quien escribe, y el estado inicial NO ES NEGOCIABLE: 'pending'. Cualquier
-- otro valor rebota, venga de la app o de un POST hecho a mano.
create policy community_help_requests_insert on public.community_help_requests
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and status = 'pending'
);

-- UPDATE — dos ramas bien distintas:
--   · El AUTOR puede corregir lo suyo mientras está 'pending' o ya 'published',
--     y sólo puede dejarlo en 'pending' o 'closed'. O sea: si edita algo que ya
--     estaba publicado, vuelve a revisión. Es intencional — sin eso, publicar
--     "busco voluntarios" y después editarlo a otra cosa sería el bypass
--     completo de la aprobación del admin. Una fila 'rejected' es final: no
--     entra ni en el `using`.
--   · El STAFF del tenant resuelve (aprueba/rechaza) y, si firma la revisión,
--     firma como él mismo — mismo criterio que `moderation_queue_update` (0009).
create policy community_help_requests_update on public.community_help_requests
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and created_by = (select auth.uid())
    and status in ('pending', 'published')
  )
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_staff())
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and created_by = (select auth.uid())
    and status in ('pending', 'closed')
  )
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_staff())
    and (reviewed_by is null or reviewed_by = (select auth.uid()))
  )
  or (select app.is_global_admin())
);

-- DELETE — el autor puede borrar lo suyo (es su pedido de ayuda: retirarlo es
-- un derecho, no un favor) y el admin del dominio puede limpiar. El staff
-- moderador NO borra: su herramienta es 'rejected', que deja rastro.
create policy community_help_requests_delete on public.community_help_requests
for delete to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and created_by = (select auth.uid())
  )
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

-- GRANTS EXPLÍCITOS — ver la cabecera. Sin esto la app se ve vacía y sin un
-- solo error. `anon` NO recibe select: la lectura pública de este tablón está
-- cerrada por diseño, y dejar el grant "por las dudas" sería dejar abierta la
-- puerta que la policy justo cierra.
revoke all on table public.community_help_requests from anon, authenticated;
grant select, insert, update, delete on table public.community_help_requests to authenticated;
grant all                            on table public.community_help_requests to service_role;

-- ---------------------------------------------------------------------------
-- 4. La cola de moderación ya existente aprende un sujeto nuevo
--
-- `moderation_queue.subject_kind` (0009) tiene un CHECK cerrado con seis
-- valores. Una solicitud no es ninguno de ellos: no es un `listing` (no vive
-- en `listings`, y el efecto de aprobar es un UPDATE sobre OTRA tabla), ni un
-- `post`, ni un `profile`. Sin este valor, el ítem entraría con un kind
-- prestado y quien resuelve la cola actualizaría la fila equivocada.
--
-- El do-block busca la constraint por su DEFINICIÓN y no por nombre — mismo
-- motivo que ya explicaron 0096, 0099 y 0105: defensivo ante un nombre
-- autogenerado distinto entre entornos, y de paso deja el archivo re-corrible.
--
-- El espejo TypeScript (`SubjectKind` en src/lib/moderation/index.ts) queda
-- FUERA de esta migración a propósito: ese archivo no es de este frente. El
-- diff exacto va reportado como punto de integración pendiente.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.moderation_queue'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%subject_kind%';
  if v_name is not null then
    execute format('alter table public.moderation_queue drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.moderation_queue
  add constraint moderation_queue_subject_kind_check
  check (subject_kind in (
    'post', 'comment', 'listing', 'message', 'profile', 'photo', 'help_request'
  ));

comment on column public.moderation_queue.subject_kind is
  'Qué se está moderando. 0121 suma "help_request" (public.community_help_requests): a diferencia de los otros seis, aprobar uno de estos NO publica una fila de posts/comments/listings sino de su propia tabla — el efecto vive en src/app/admin/moderacion/actions.ts. Espeja SubjectKind en src/lib/moderation/index.ts.';

commit;
