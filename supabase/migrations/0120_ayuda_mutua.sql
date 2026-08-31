-- =============================================================================
-- 0120_ayuda_mutua.sql — Comunidad Latina
--
-- Hasta acá el módulo Comunidad era SÓLO-LECTURA en su parte de ayuda: alguien
-- podía LEER dónde hay un banco de comida y no podía OFRECERSE a trabajar en
-- él. El pedido del cliente lo dice con todas las letras:
--
--   «Falta un botón en la parte de comunidad, en casi todas las opciones, para
--    que la gente pueda aplicar a bancos de comida si quiere ofrecer sus
--    servicios — voluntarios si quieren ofrecer sus servicios — centro de
--    acopio lo mismo. Tanto de parte de la persona que quiere prestar sus
--    servicios o el lugar donde necesita prestar los servicios.
--    Y todo esto se verifica vía geovanny con la cuenta de admin.»
--
-- Y suma los temas de ayuda que faltaban: drogas y alcohol, medicinas,
-- iglesias / ayuda comunitaria, y ayuda para conseguir trabajo.
--
-- Esta migración hace DOS cosas y las mantiene separadas a propósito:
--
--   1. AMPLÍA el CHECK de temas de `community_resources` con cuatro temas
--      nuevos. Sigue siendo el directorio CURADO de siempre: fichas con
--      procedencia NOT NULL, cargadas por admins. Nada de esto cambia.
--   2. CREA `public.community_help_notices`, que es la capa NUEVA: el tablón
--      donde una persona se ofrece y donde un lugar pide manos. Se apoya
--      ENCIMA del directorio (un aviso puede apuntar a una ficha), no lo
--      reemplaza.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POR QUÉ UNA TABLA NUEVA Y NO LO QUE YA HABÍA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se descartaron, en este orden, tres modelos que ya existen en el repo:
--
-- ── (a) UN TEMA MÁS DE `community_resources` (lo que hicieron 0099 y 0105) ──
-- Imposible, y por la razón que esas dos migraciones dejaron escrita: esa
-- tabla exige `source_name`, `source_url` y `source_checked_at` NOT NULL
-- porque su contenido lo publica un TERCERO IDENTIFICABLE y la plataforma
-- sólo lo reproduce. Un vecino que se ofrece a cocinar los sábados no tiene
-- fuente que citar: la fuente es él. Meterlo ahí obligaría a aflojar el NOT
-- NULL que es la columna vertebral de todo el módulo — el mismo NOT NULL que
-- impide que la app parezca estar dando consejos de salud y de migración
-- propios. El precio de esa comodidad sería exactamente el riesgo que la 0096
-- se propuso eliminar.
--
-- Dicho de otra forma: una FICHA dice "esto lo publica NYC Health + Hospitals".
-- Un AVISO dice "esto lo dice Marta, de Corona". Son dos afirmaciones con
-- distinto peso y no pueden salir de la misma tabla sin que se confundan en
-- pantalla.
--
-- ── (b) UN `listings` CON `kind = 'help_offer'` (lo que hizo 0096 con
--        Perdido y encontrado) ────────────────────────────────────────────────
-- Es el que más cerca estuvo, y se descartó por tres cosas concretas:
--   · `listings` arrastra precio, boosts, campañas, premium, vencimiento,
--     reseñas y estadísticas de clics. Acá NO PUEDE HABER PLATA (ver §3) y no
--     puede haber posición comprada: no se le vende el primer lugar a alguien
--     que ofrece ayuda. Habría que apagar media tabla con reglas nuevas.
--   · `listings_select` (0004) es PÚBLICO para lo `published` — anon incluido,
--     por SEO. Un tablón donde dice "Fulano, Corona, se ofrece para tal cosa"
--     indexado por Google es justo lo que §5.4 prohíbe construir. Acá el
--     SELECT es sólo para `authenticated` (§2).
--   · El vencimiento automático (0098) y el auto-pausado por denuncias (0118)
--     asumen un aviso comercial con dueño que responde. Un ofrecimiento de
--     ayuda que se despausa solo tiene otra semántica.
--
-- ── (c) `job_applications` (0040) ──────────────────────────────────────────
-- Es una POSTULACIÓN a un aviso concreto y necesita que el aviso exista.
-- La mitad del pedido —«el lugar donde necesita prestar los servicios»— no
-- tiene aviso al cual postularse: es el lugar el que publica. Y la otra mitad
-- tampoco: alguien puede ofrecerse "para lo que haga falta en el barrio" sin
-- apuntar a ninguna ficha. Por eso `resource_id` acá es NULLABLE: apuntar a
-- una ficha es un caso, no el modelo.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LAS DOS DIRECCIONES SON UNA COLUMNA, NO DOS TABLAS
-- ═══════════════════════════════════════════════════════════════════════════
--
--     direction = 'offer'  → una persona OFRECE (tiempo, manos, un oficio)
--     direction = 'need'   → un lugar PIDE manos (comedor, parroquia, acopio)
--
-- Son dos tablas candidatas colapsadas en una porque comparten TODO: el mismo
-- texto, la misma zona, la misma cola de moderación, la misma RLS, la misma
-- pantalla y —sobre todo— la misma búsqueda. Quien entra al tablón quiere ver
-- las dos caras del mismo tema junto: "en Corona hay tres que se ofrecen y un
-- comedor que pide". Con dos tablas eso son dos consultas y dos paginados que
-- hay que intercalar a mano.
--
-- `org_name` es la única columna que NO aplica a las dos, y está resuelta con
-- un CHECK (`..._org_solo_si_pide`) en vez de con una tabla satélite: es un
-- campo de texto opcional, no una entidad.
--
-- ── ANTI-HONEYPOT: NO HAY NI UNA COLUMNA DE CONTACTO ────────────────────────
-- Ni teléfono, ni email, ni "escribime a". Es la decisión más importante de
-- este archivo y no es un olvido (§5.4 del PLAN_MAESTRO).
--
-- `community_resources` SÍ tiene teléfono, y eso no es una contradicción: ese
-- teléfono es el de una ORGANIZACIÓN, publicado por su propia fuente oficial,
-- que ya es público en internet. Acá del otro lado hay una PERSONA de una
-- población perseguible, diciendo en qué barrio está y en qué tema se mueve.
-- Un tablón con nombre + zona + teléfono + tema sensible es, literalmente, un
-- padrón — y una RLS no protege contra una citación judicial: la única defensa
-- es que el dato no exista.
--
-- El contacto pasa por donde ya pasa todo en esta app: `conversations` +
-- `messages` (contacto protegido, TTL 90 días, §9.2). La app lo dice en
-- pantalla con esas palabras, no como letra chica.
--
-- Y si una organización necesita publicar su teléfono, el camino es el que ya
-- existe: ser una FICHA del directorio, con su fuente citada. El aviso apunta
-- a la ficha (`resource_id`) y el teléfono sale de ahí, verificado, con fecha
-- de última revisión. Nadie pierde nada; lo que se pierde es el padrón.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ACÁ NO SE MUEVE PLATA. NUNCA.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pedido textual del cliente: «Monetariamente no se ayuda».
--
-- No hay `amount_cents`, ni `currency`, ni `goal`, ni `donation_url`, ni
-- `payment_*`. No es que estén en null: no existen, y esta línea está acá para
-- que quien venga a agregarlas lea primero por qué no están.
--
-- El motivo es de riesgo, no de alcance. En el momento en que la plataforma
-- deja publicar "necesito $200 para el alquiler", pasan tres cosas a la vez:
-- (1) se convierte en el mejor canal de estafa que puede existir sobre gente
-- desesperada; (2) el Escudo Anti-Estafa (0005) queda peleando contra el
-- producto en vez de contra los estafadores; y (3) aparece un deber de cuidado
-- —y una discusión de money transmission— que este proyecto no puede sostener
-- (§11). Lo que se ofrece y se pide acá es TIEMPO, MANOS y COSAS.
--
-- La app lo dice en la pantalla del alta, escrito como habla una persona, y no
-- escondido en un modal de términos: es la misma doctrina que el aviso de
-- procedencia de la 0096.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4. NADA SE PUBLICA SOLO — Y LA MÁQUINA DE ESTADOS ES EXPLÍCITA
-- ═══════════════════════════════════════════════════════════════════════════
--
--     draft ──enviar──> pending ──staff──> approved ──autor/staff──> archived
--       ^                  |                  |
--       |                  └──staff──> rejected
--       └──── autor: retirar / corregir ──────┘
--
-- La diferencia con Perdido y encontrado (0096) es deliberada y viene del
-- pedido: allá un caso limpio se publica SOLO (la moderación automática
-- decide) porque el costo de esperar es que alguien no encuentre su mochila;
-- acá «todo esto se verifica vía geovanny». `approved` NO lo puede escribir
-- nadie que no sea staff — lo bloquean la policy de UPDATE y, otra vez, el
-- trigger. Dos candados para la misma regla, porque es la regla del cliente.
--
-- ── EL CONTENIDO SE CONGELA AL SALIR DE `draft` ─────────────────────────────
-- Mientras el aviso está en borrador su autor lo edita libremente. Desde que
-- lo envía, el texto es inmutable para todos —autor Y staff—: lo único que se
-- mueve es `status`, `review_note` y los sellos de revisión. Es la misma
-- defensa que `listings_update` (0004) monta contra el bait-and-switch: sin
-- esto, alguien pasa la revisión con "ayudo con las bolsas los sábados" y al
-- día siguiente reescribe la fila con otra cosa, conservando el sello de
-- aprobado. Que el STAFF tampoco pueda editar el texto es a propósito: un
-- moderador que corrige la redacción de otro termina firmando palabras
-- ajenas.
--
-- ── CUPO DE 5 ABIERTOS POR PERSONA ──────────────────────────────────────────
-- En la base y no sólo en la app. El rate limit de la server action vive en
-- memoria del proceso y no sobrevive a un deploy ni a un segundo lambda; esto
-- sí. Cinco es holgado para cualquier uso real y corta el flood que llenaría
-- la cola de Geovanny —que es el recurso escaso de todo este diseño—.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 5. QUÉ TEMAS ACEPTAN AVISOS (y por qué NO todos)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El CHECK de `topic` de esta tabla enumera SEIS temas, no los catorce del
-- directorio: comida, voluntariado, acopio, educacion, fe y trabajo.
--
-- La regla es una sola: **el tablón acepta lo que se da con el cuerpo —tiempo,
-- manos, cosas— y NUNCA criterio profesional.**
--
-- Quedan afuera, con nombre y motivo:
--   · `migracion` y `legal` — es exactamente la línea del §11 que el módulo
--     entero existe para no cruzar. "Te ayudo con tu caso de asilo" publicado
--     por un desconocido es ejercicio ilegal de la abogacía con la firma de la
--     plataforma abajo, y el daño cae sobre quien menos margen tiene.
--   · `salud`, `medicinas` y `adicciones` — mismo argumento en versión médica.
--     Un ofrecimiento de "desintoxicación en mi casa" no es ayuda, es un
--     peligro; y quien busca ayuda en esos temas necesita la ficha de una
--     organización real, que es justo lo que el directorio le da.
--   · `emergencias` y `consulados` — una línea de emergencia y un consulado no
--     reclutan voluntarios por una app comunitaria. Un aviso ahí sólo puede
--     ser ruido o suplantación.
--   · `vivienda` — el que más costó dejar afuera. "Te presto un cuarto" es una
--     oferta de alojamiento a una persona sin techo hecha por un desconocido:
--     es el escenario de trata y de abuso, textual. La vivienda tiene su
--     propio vertical, con verificación e identidad; no entra por esta puerta.
--
-- Los ocho temas excluidos siguen existiendo como FICHAS: lo que no tienen es
-- tablón. `src/lib/comunidad/ayuda-mutua.ts` espeja esta lista y la pantalla
-- simplemente no dibuja el botón — no hay ningún cartel explicándole a la
-- gente lo que no puede hacer.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 6. LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO
-- ═══════════════════════════════════════════════════════════════════════════
--   · NO siembra filas de ejemplo. La 0105 dejó escrito por qué un dato
--     inventado en este módulo es peor que una pantalla vacía, y acá es aún
--     más claro: un ofrecimiento de ayuda falso manda a una persona a una
--     puerta que no existe. Las tres fichas `draft` de la 0105 ya sirven de
--     plantilla para quien administra; no hace falta una cuarta mentira.
--   · NO toca `public.global_search` (0052) ni ningún feed: un aviso de ayuda
--     mutua no se descubre por buscador global, se descubre entrando al tema.
--   · NO crea bucket de storage: acá no hay fotos. Una foto en este tablón
--     sería una cara identificable de alguien de una población perseguible,
--     junto a su barrio. No.
--   · NO agrega notificaciones: el aviso de "te lo aprobaron" se ve al entrar
--     a "Mis avisos". Sumar una categoría a `notifications` es una migración
--     propia y una decisión de producto que nadie pidió todavía.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Los cuatro temas nuevos del DIRECTORIO
--
-- El do-block busca la constraint por su DEFINICIÓN y no por su nombre: mismo
-- patrón defensivo (y re-corrible) que ya usaron 0096, 0099 y 0105.
--
--   · `adicciones` — drogas y alcohol. Es su propio tema y no un subconjunto
--     de `salud` porque quien lo busca no busca "un médico": busca un grupo,
--     una línea que atienda a las 3 de la mañana, un centro que reciba sin
--     seguro. Mezclarlo con clínicas generales lo entierra.
--   · `medicinas` — acceso al medicamento en sí: farmacias comunitarias,
--     programas de asistencia, bancos de insumos. También distinto de `salud`:
--     ahí se busca quién te atiende, acá quién te da el remedio que ya sabés
--     que necesitás.
--   · `fe` — iglesias, parroquias y organizaciones de fe que dan ayuda
--     comunitaria y acompañamiento personal. En esta población la parroquia es
--     con frecuencia la PRIMERA puerta a la que se golpea, antes que cualquier
--     organismo. Que no tuviera lugar en el directorio era un agujero.
--   · `trabajo` — quién te AYUDA A BUSCAR trabajo: centros de trabajadores,
--     talleres de currículum, bolsas comunitarias. NO es el módulo /empleos,
--     que es donde se publican y se postulan las vacantes. Acá no hay
--     vacantes: hay quién te acompaña a conseguir una.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.community_resources'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%topic = ANY%';
  if v_name is not null then
    execute format('alter table public.community_resources drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.community_resources
  add constraint community_resources_topic_check
  check (topic in (
    'emergencias', 'migracion', 'salud', 'adicciones', 'medicinas', 'comida',
    'consulados', 'legal', 'vivienda', 'trabajo', 'educacion', 'fe',
    'voluntariado', 'acopio'
  ));

comment on column public.community_resources.topic is
  'Agrupador de la pantalla (espeja RESOURCE_TOPICS en src/lib/comunidad/types.ts, cuyo ORDEN es el orden en pantalla y no es alfabético). 0099 sumó "voluntariado" (dar tiempo); 0105 sumó "acopio" (dar bienes materiales — DISTINTO de "comida", donde se los recibe); 0120 suma cuatro de "necesito ayuda": "adicciones" (drogas y alcohol), "medicinas" (acceso al remedio, distinto de "salud" que es quién te atiende), "fe" (iglesias y ayuda comunitaria religiosa o personal) y "trabajo" (quién te ayuda a BUSCAR trabajo — no es el módulo /empleos, donde se publican las vacantes). Todos son el mismo modelo curado y con fuente obligatoria: nunca convocatorias publicadas por usuarios — para eso está community_help_notices (0120).';


-- ---------------------------------------------------------------------------
-- 2 · community_help_notices — el tablón de ayuda mutua
--
-- tenant_id NOT NULL, al revés que `community_resources`. Y es la decisión
-- correcta para esta tabla: un consulado le sirve a todas las comunidades
-- (por eso allá `null` = global), pero "me ofrezco los sábados en Corona" es
-- de UNA comunidad y de un barrio. Un aviso global sería un aviso sin
-- moderador responsable — y la moderación acá es de una persona concreta de
-- una comunidad concreta.
-- ---------------------------------------------------------------------------
create table public.community_help_notices (
  id             uuid primary key default app.uuid_v7(),

  -- DENORMALIZADO igual que reactions/saves/follows/post_tags: toda policy
  -- exige que coincida con app.current_tenant_id(), así que una fila con el
  -- tenant forjado no la ve nadie.
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  created_by     uuid not null references public.profiles(id) on delete cascade,

  -- Las dos caras del pedido del cliente. Ver §2 de la cabecera.
  direction      text not null check (direction in ('offer', 'need')),

  -- SEIS temas, no los catorce del directorio. Ver §5 de la cabecera: el que
  -- agregue uno acá tiene que poder contestar "¿esto es tiempo/manos/cosas, o
  -- es criterio profesional?".
  topic          text not null check (topic in (
                   'comida', 'voluntariado', 'acopio', 'educacion', 'fe', 'trabajo'
                 )),

  -- A qué ficha del directorio apunta, si apunta a alguna. NULLABLE: mucha
  -- gente se ofrece "para lo que haga falta en el barrio" sin tener en mente
  -- un lugar. `on delete set null` y no cascade: si la ficha se borra porque
  -- cambió de nombre, el ofrecimiento de la persona sigue valiendo.
  resource_id    uuid references public.community_resources(id) on delete set null,

  title          text not null check (char_length(btrim(title)) between 6 and 100),
  body           text not null check (char_length(btrim(body)) between 20 and 1000),

  -- Zona, NOT NULL. Es lo único que hace útil a un aviso de ayuda: "puedo
  -- cocinar" sin barrio no le sirve a nadie. Barrio o parada, nunca dirección
  -- exacta — la app lo pide con esas palabras y §5.4 lo exige.
  area_label     text not null check (char_length(btrim(area_label)) between 3 and 80),

  -- "Sábados por la mañana", "dos tardes por semana". Texto humano y no un
  -- calendario estructurado por lo mismo que `cost_note` de la 0096 no es un
  -- numeric: la disponibilidad real de alguien que trabaja doce horas no entra
  -- en una grilla.
  availability   text check (availability is null
                             or char_length(btrim(availability)) between 3 and 160),

  -- Nombre del lugar que pide manos. Sólo para direction='need' (CHECK abajo):
  -- una persona que se ofrece no representa a ninguna organización, y dejarla
  -- escribir una la convertiría en un aval que la plataforma no dio.
  org_name       text check (org_name is null
                             or char_length(btrim(org_name)) between 2 and 140),

  -- En qué idiomas puede ayudar / atiende. Mismo tipo y mismo trato que
  -- community_resources.languages.
  languages      text[] not null default '{}'::text[]
                   check (app.short_text_array_ok(languages, 6, 40)),

  -- Ver §4. `archived` es "ya no hace falta" (lo baja el autor o el staff) y
  -- NO es lo mismo que `rejected`, que es un veredicto sobre el contenido.
  status         text not null default 'draft'
                   check (status in ('draft', 'pending', 'approved', 'rejected', 'archived')),

  -- Quién revisó y cuándo. Los escribe el trigger, jamás la app.
  reviewed_by    uuid references public.profiles(id) on delete set null,
  reviewed_at    timestamptz,
  -- Motivo del rechazo, para que la persona sepa qué corregir. Lo LEE su
  -- autor (a diferencia de la nota interna de una postulación de empleo,
  -- 0042): un rechazo sin motivo es una puerta cerrada sin explicación.
  -- Mínimo 10 caracteres: "no" no es un motivo. Mismo piso que la nota de una
  -- solicitud de creador (src/app/admin/creadores/solicitudes/decisiones.ts).
  review_note    text check (review_note is null
                             or char_length(btrim(review_note)) between 10 and 400),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint community_help_notices_org_solo_si_pide check (
    org_name is null or direction = 'need'
  ),
  -- Revisado a medias no existe: o hay firma y fecha, o no hubo revisión.
  constraint community_help_notices_revision_completa check (
    (reviewed_by is null) = (reviewed_at is null)
  )
);

comment on table public.community_help_notices is
  'Tablón de AYUDA MUTUA del módulo Comunidad (0120): una persona se ofrece (direction=offer) o un lugar pide manos (direction=need). Es la capa de POSTULACIÓN que va ENCIMA del directorio curado de community_resources (0096), no su reemplazo: acá el que habla es un vecino, allá el que habla es un organismo con fuente citada. NADA se publica solo — approved sólo lo escribe staff (pedido textual del cliente: "todo esto se verifica vía geovanny"). SIN NINGUNA COLUMNA DE CONTACTO ni de dinero, las dos por decisión de riesgo y no por alcance: el contacto va por conversations (§9.2) y la plataforma nunca intermedia plata de ayuda. Ver la cabecera de la migración para los tres modelos descartados.';

comment on column public.community_help_notices.direction is
  'offer = una persona ofrece tiempo/manos/cosas. need = un lugar pide manos. Las dos caras del pedido del cliente en UNA columna y no en dos tablas: comparten texto, zona, moderación, RLS y —sobre todo— la misma búsqueda, que es lo que hace que el tablón se lea de un vistazo.';
comment on column public.community_help_notices.topic is
  'SEIS temas, no los catorce de community_resources. La regla: el tablón acepta lo que se da con el cuerpo (tiempo, manos, cosas) y nunca criterio profesional — por eso quedan afuera migracion, legal, salud, medicinas, adicciones, emergencias, consulados y vivienda. El motivo de cada exclusión está en §5 de la migración; src/lib/comunidad/ayuda-mutua.ts espeja esta lista.';
comment on column public.community_help_notices.resource_id is
  'Ficha del directorio a la que apunta el aviso, si apunta a alguna. NULLABLE porque la mitad de los avisos reales no tienen un lugar en mente. El trigger verifica que la ficha esté publicada y sea de esta comunidad o global: sin eso, un id de otro tenant filtraría por rebote qué fichas existen allá.';
comment on column public.community_help_notices.area_label is
  'Barrio o parada. NOT NULL porque un ofrecimiento sin zona no le sirve a nadie. NUNCA la dirección exacta de una persona (§5.4) — la app lo pide con esas palabras.';
comment on column public.community_help_notices.org_name is
  'Nombre del lugar que pide manos. Sólo con direction=need. Una persona que se ofrece no puede escribir una organización: sería un aval que la plataforma no dio.';
comment on column public.community_help_notices.status is
  'draft (sólo lo ve su autor) → pending (cola de Geovanny) → approved | rejected. archived es "ya no hace falta", lo baja el autor o el staff, y NO es un veredicto sobre el contenido. approved es inescribible para el autor: lo bloquean la policy de UPDATE y el trigger, dos candados para la regla que puso el cliente.';
comment on column public.community_help_notices.review_note is
  'Motivo del rechazo, escrito por quien modera y LEÍDO POR SU AUTOR — al revés que job_application_notes (0042), que es privada del evaluador. Un rechazo sin motivo es una puerta cerrada sin explicación, y acá del otro lado hay alguien que quiso ayudar.';

-- El tablón: (comunidad, tema) ordenado por fecha. El índice cubre también el
-- ORDER BY del keyset (created_at desc, id desc), igual que
-- listings_lost_found_idx.
create index community_help_notices_tablon_idx
  on public.community_help_notices (tenant_id, topic, created_at desc, id desc)
  where status = 'approved';

-- La cola de Geovanny: lo pendiente de una comunidad, lo más viejo primero
-- (quien más esperó, primero).
create index community_help_notices_cola_idx
  on public.community_help_notices (tenant_id, created_at)
  where status = 'pending';

-- "Mis avisos", en todos sus estados. Sin `where` a propósito: la pantalla del
-- autor muestra también lo rechazado y lo archivado.
create index community_help_notices_mias_idx
  on public.community_help_notices (created_by, created_at desc);

-- Cuántas manos hay ofrecidas sobre UNA ficha (el contador de la card).
create index community_help_notices_recurso_idx
  on public.community_help_notices (resource_id)
  where resource_id is not null and status = 'approved';

create trigger community_help_notices_set_updated_at
before update on public.community_help_notices
for each row execute function extensions.moddatetime(updated_at);


-- ---------------------------------------------------------------------------
-- 3 · El guardián: máquina de estados, congelamiento y cupo
--
-- Una policy autoriza FILAS, no COLUMNAS ni TRANSICIONES. Todo lo que sigue no
-- se puede expresar en un WITH CHECK sin volverlo ilegible, y varias de estas
-- reglas necesitan mirar el estado ANTERIOR (OLD), que la policy no tiene a
-- mano de forma cómoda:
--
--   · el contenido se congela al salir de `draft` (anti bait-and-switch);
--   · sólo staff escribe approved/rejected y los sellos de revisión;
--   · las transiciones válidas son las de §4 y no cualquier par;
--   · la ficha apuntada tiene que ser de esta comunidad (o global) y estar
--     publicada;
--   · cupo de 5 avisos abiertos por persona.
--
-- SECURITY DEFINER con `search_path = ''` como todo trigger de este repo que
-- consulta otra tabla. Con `auth.uid()` null (service_role, seed, cron) las
-- reglas de autoría no aplican: mismo criterio que app.enforce_account_active().
-- ---------------------------------------------------------------------------
-- La ficha apuntada tiene que existir, estar PUBLICADA, ser de esta comunidad
-- (o global) y ser DEL MISMO TEMA que el aviso. Lo último no es cosmético:
-- sin eso, un ofrecimiento de "voluntariado" podría colgarse de la ficha de
-- una clínica y aparecer en su tarjeta como si la clínica reclutara gente.
create or replace function app.exigir_ficha_de_ayuda_valida(
  p_resource uuid,
  p_tenant   uuid,
  p_topic    text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_resource is null then
    return;
  end if;
  if not exists (
    select 1
      from public.community_resources r
     where r.id = p_resource
       and r.status = 'published'
       and r.topic = p_topic
       and (r.tenant_id is null or r.tenant_id = p_tenant)
  ) then
    raise exception 'BAD_RESOURCE: ese lugar no está disponible para este tema.';
  end if;
end;
$$;

comment on function app.exigir_ficha_de_ayuda_valida(uuid, uuid, text) is
  'Verifica que la ficha a la que apunta un aviso de ayuda (0120) exista, esté publicada, sea de esa comunidad o global, y sea DEL MISMO TEMA. Lo del tema evita que un ofrecimiento se cuelgue de una ficha ajena y parezca que esa organización lo respalda. Devuelve void o levanta BAD_RESOURCE — se llama con perform desde el guardián.';

revoke execute on function app.exigir_ficha_de_ayuda_valida(uuid, uuid, text) from public, anon;


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
    -- Los sellos de revisión no se siembran desde el alta ni por accidente.
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;

    if v_uid is not null then
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: un aviso de ayuda se publica en primera persona.';
      end if;
      if new.status <> 'draft' then
        raise exception 'FORBIDDEN: un aviso de ayuda nace como borrador y lo aprueba el equipo.';
      end if;

      select count(*) into v_abiertos
        from public.community_help_notices n
       where n.created_by = v_uid
         and n.status in ('draft', 'pending');
      if v_abiertos >= 5 then
        raise exception 'TOO_MANY_OPEN: ya tenés 5 avisos esperando revisión.';
      end if;
    end if;

    perform app.exigir_ficha_de_ayuda_valida(new.resource_id, new.tenant_id, new.topic);
    return new;
  end if;

  -- ---- Edición ----------------------------------------------------------
  -- Identidad congelada: mover un aviso de dueño o de comunidad no es editar,
  -- es fabricar uno ajeno.
  if new.id <> old.id
     or new.tenant_id <> old.tenant_id
     or new.created_by <> old.created_by then
    raise exception 'FORBIDDEN: no se puede mover un aviso de ayuda de dueño ni de comunidad.';
  end if;

  -- El CONTENIDO sólo se toca mientras es borrador, y sólo lo toca su autor.
  -- Ver §4: es la defensa contra pasar la revisión con un texto y publicar
  -- otro. Vale para el staff también — un moderador que reescribe el texto de
  -- otro termina firmando palabras ajenas.
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
        raise exception 'CONTENT_FROZEN: un aviso ya enviado no se edita. Retiralo, corregilo y volvé a enviarlo.';
      end if;
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: sólo quien lo escribió puede editar su aviso.';
      end if;
      perform app.exigir_ficha_de_ayuda_valida(new.resource_id, new.tenant_id, new.topic);
    end if;
  end if;

  -- Transiciones. La tabla de verdad está en §4 de la cabecera.
  if new.status is distinct from old.status then
    if v_uid is null then
      -- service_role: se confía (seed, cron, scripts auditados).
      null;
    elsif v_staff then
      if not (
        (old.status = 'pending'  and new.status in ('approved', 'rejected'))
        or (old.status = 'approved' and new.status in ('rejected', 'archived'))
        or (old.status = 'rejected' and new.status = 'approved')
      ) then
        raise exception 'BAD_TRANSITION: de % no se puede pasar a % desde moderación.', old.status, new.status;
      end if;
    else
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: no es tu aviso.';
      end if;
      if not (
        (old.status = 'draft'    and new.status = 'pending')
        or (old.status = 'pending'  and new.status = 'draft')
        or (old.status = 'rejected' and new.status = 'draft')
        or (old.status = 'approved' and new.status = 'archived')
        or (old.status = 'pending'  and new.status = 'archived')
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
    -- Volver a borrador limpia el motivo viejo: si no, el aviso corregido
    -- arrastraría el reproche del anterior.
    new.review_note := case when new.status = 'draft' then null else old.review_note end;
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
  'Guardián de community_help_notices (0120): alta en primera persona y siempre como borrador, cupo de 5 abiertos por persona, identidad congelada, CONTENIDO congelado al salir de draft (anti bait-and-switch, mismo criterio que listings_update 0004), transiciones de estado explícitas por actor (autor vs staff) y sellos de revisión escritos acá y no por la app. Con auth.uid() null (service_role/seed/cron) las reglas de autoría no aplican.';

revoke execute on function app.community_help_notices_guard() from public, anon;


create trigger community_help_notices_guard
before insert or update on public.community_help_notices
for each row execute function app.community_help_notices_guard();

-- Cuenta suspendida no publica ni resuelve — mismo par de triggers que
-- job_applications (0040) y listing_comments (0038).
create trigger community_help_notices_enforce_account_active
before insert on public.community_help_notices
for each row execute function app.enforce_account_active();

create trigger community_help_notices_update_enforce_account_active
before update on public.community_help_notices
for each row execute function app.enforce_account_active();


-- ---------------------------------------------------------------------------
-- 4 · RLS — las cuatro policies canónicas (gate `npm run check:rls`)
--
-- ⚠️ SIN `anon`, y es LA decisión de esta sección. `community_resources` sí
-- deja leer sin cuenta, porque ahí el contenido es información pública de
-- organismos. Acá cada fila lleva a una PERSONA de una población perseguible
-- pegada a un barrio y a un tema. Abrirlo a anon sería publicar ese cruce en
-- internet, indexable, para siempre: exactamente el padrón que §5.4 existe
-- para que no exista. Pedir cuenta no es fricción, es la medida.
-- ---------------------------------------------------------------------------
alter table public.community_help_notices enable row level security;
alter table public.community_help_notices force row level security;

-- ⚠️ EL BORRADOR ES PRIVADO DE SU AUTOR, TAMBIÉN FRENTE AL STAFF.
-- Las ramas de staff y de global_admin llevan `status <> 'draft'` pegado, y no
-- es una formalidad: un borrador es alguien escribiendo, todavía decidiendo qué
-- va a contar de su vida. El panel no tiene NADA que decidir sobre algo que no
-- le mandaron, así que no hay ninguna razón para poder leerlo — y "no hay
-- razón para leerlo" es exactamente el criterio de minimización del §5.4.
-- (Es más estricto que `community_resources_select`, donde el admin sí ve los
-- borradores: allá el borrador lo escribe el propio equipo.)
create policy community_help_notices_select on public.community_help_notices
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      status = 'approved'
      or created_by = (select auth.uid())
      or (status <> 'draft' and (select app.is_staff()))
    )
  )
  or (status <> 'draft' and (select app.is_global_admin()))
);

-- Se publica en primera persona, en la propia comunidad, y SIEMPRE como
-- borrador. El trigger lo vuelve a exigir.
create policy community_help_notices_insert on public.community_help_notices
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and status = 'draft'
);

-- El autor edita su borrador, lo envía, lo retira y lo archiva. El staff
-- resuelve. `approved` y `rejected` NO están en la rama del autor: es la regla
-- del cliente escrita en la policy, además de en el trigger.
create policy community_help_notices_update on public.community_help_notices
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (created_by = (select auth.uid()) or (select app.is_staff()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    (created_by = (select auth.uid()) and status in ('draft', 'pending', 'archived'))
    or (select app.is_staff())
  )
);

-- Sólo admins borran. El autor ARCHIVA (igual que job_applications 0040): si
-- pudiera borrar la fila se saltearía el cupo de 5 y, peor, desaparecería la
-- constancia de un aviso que el equipo ya había rechazado.
create policy community_help_notices_delete on public.community_help_notices
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- GRANTS EXPLÍCITOS. La 0085 lo dejó escrito con sangre: los default
-- privileges de este schema (compartido con otro producto) no incluyen a
-- `anon`, así que una tabla nueva NACE sin acceso y sin un solo error visible.
-- Acá `anon` no recibe NADA a propósito (ver §4 de esta sección): el grant que
-- falta y la policy que falta dicen lo mismo, y que lo digan las dos es
-- deliberado.
revoke all on table public.community_help_notices from anon, authenticated;
grant select, insert, update, delete on table public.community_help_notices to authenticated;
grant all                            on table public.community_help_notices to service_role;


-- ---------------------------------------------------------------------------
-- 5 · Cómo se contacta a alguien que se ofreció
--
-- Esta sección existe porque la de arriba decidió NO guardar teléfonos: si el
-- aviso no trae forma de llegar a la persona, el tablón es una lista de gente
-- a la que no se le puede escribir, o sea nada.
--
-- El canal es el que ya existe: `conversations` (0006) + `messages`, con su
-- pedido→aceptación, su bloqueo global (0020) y su TTL de 90 días. Lo único
-- que faltaba era una puerta de entrada, porque `request_contact` exige un
-- `listing_id` y un aviso de ayuda no es un listing.
--
-- ── LA CONVERSACIÓN SIN AVISO YA ERA LEGAL ─────────────────────────────────
-- `conversations.listing_id` es NULLABLE desde la 0006 (`on delete set null`:
-- si se borra el aviso, el hilo sobrevive) y el único índice sobre esa columna
-- es PARCIAL, `where listing_id is not null`. O sea que una conversación
-- directa siempre fue una fila válida de esa tabla; simplemente nadie la
-- creaba. Y la UI de mensajes ya la dibuja: tipa `listing` como nullable y
-- todos sus renders van detrás de un `conversation.listing && …`.
--
-- Lo que se agrega es el único que faltaba: que dos personas no puedan tener
-- DOS hilos directos abiertos. Sin eso, el mismo par podría acumular una
-- conversación por cada vez que alguien toca "escribirle" en dos pestañas, y
-- los mensajes quedarían repartidos entre hilos gemelos. El índice es parcial
-- —sólo alcanza a las filas sin aviso— así que no toca en nada el
-- comportamiento de `request_contact`, donde el par SÍ puede tener un hilo por
-- cada aviso distinto. Hoy no hay una sola fila con `listing_id is null`, así
-- que crearlo no puede fallar por datos existentes.
--
-- La función es un calco de `request_contact` (0020) con el sujeto cambiado, y
-- eso es a propósito: mismas verificaciones, mismos nombres de error, misma
-- idempotencia con su rescate de `unique_violation` para la carrera entre dos
-- pestañas. Un segundo camino de contacto con reglas propias sería un segundo
-- lugar donde olvidarse del bloqueo entre usuarios.
-- ---------------------------------------------------------------------------
create unique index if not exists conversations_directa_uniq
  on public.conversations (created_by, counterpart_id)
  where listing_id is null;

comment on index public.conversations_directa_uniq is
  'Una sola conversación DIRECTA (sin aviso) por par (quien la abre, quien la recibe). Parcial a propósito: no toca las conversaciones con listing_id, donde el mismo par puede tener un hilo por aviso. Es lo que hace idempotente a public.contactar_aviso_de_ayuda (0120).';

create or replace function public.contactar_aviso_de_ayuda(p_notice uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_notice record;
  v_conv   uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás tu cuenta para escribirle.';
  end if;

  select n.id, n.tenant_id, n.created_by, n.status
    into v_notice
    from public.community_help_notices n
   where n.id = p_notice;

  -- Mismo mensaje para "no existe", "es de otra comunidad" y "todavía no está
  -- aprobado": desde acá no se puede averiguar qué avisos hay en otro lado ni
  -- quién tiene algo esperando revisión.
  if not found
     or v_notice.tenant_id is distinct from v_tenant
     or v_notice.status <> 'approved' then
    raise exception 'NOTICE_NOT_FOUND: ese aviso no está disponible en tu comunidad.';
  end if;

  if v_notice.created_by = v_uid then
    raise exception 'CANNOT_CONTACT_SELF: es tu propio aviso.';
  end if;

  -- Bloqueo global (0020): corta en ambas direcciones y con el MISMO mensaje —
  -- quien fue bloqueado no puede deducir quién bloqueó a quién.
  if app.pair_blocked(v_uid, v_notice.created_by) then
    raise exception 'USER_BLOCKED: el contacto con esta persona no está disponible.';
  end if;

  select c.id into v_conv
    from public.conversations c
   where c.listing_id is null
     and c.created_by = v_uid
     and c.counterpart_id = v_notice.created_by;

  if v_conv is not null then
    return v_conv;
  end if;

  begin
    insert into public.conversations (tenant_id, listing_id, created_by, counterpart_id, status)
    values (v_tenant, null, v_uid, v_notice.created_by, 'pending')
    returning id into v_conv;
  exception
    when unique_violation then
      select c.id into v_conv
        from public.conversations c
       where c.listing_id is null
         and c.created_by = v_uid
         and c.counterpart_id = v_notice.created_by;
  end;

  return v_conv;
end;
$$;

comment on function public.contactar_aviso_de_ayuda(uuid) is
  'Contacto protegido desde el tablón de ayuda mutua (0120): crea (o devuelve) la conversación pending y SIN aviso entre auth.uid() y quien publicó un aviso approved de la misma comunidad. Calco de request_contact (0020) con el sujeto cambiado — mismas verificaciones, mismos nombres de error, misma idempotencia. Existe porque community_help_notices no guarda ningún dato de contacto a propósito (§2): la única forma de llegar a alguien es por acá.';

revoke execute on function public.contactar_aviso_de_ayuda(uuid) from public, anon;
grant execute on function public.contactar_aviso_de_ayuda(uuid) to authenticated, service_role;

commit;
