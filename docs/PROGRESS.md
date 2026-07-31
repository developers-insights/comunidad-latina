# PROGRESS — Comunidad Latina

## Feedback consolidado del 30/7 — 7 specs escritas + call de 85 min (✅ 2026-07-31)

Fuente y criterio: **`docs/feedback/2026-07-30-feedback-consolidado.md`**. Ahí
están los **3 conflictos entre las dos fuentes** ya resueltos con su
fundamento, y todo lo que quedó afuera **con su razón**. Leer eso antes de
tocar nada de este bloque.

Ejecutado por 9 agentes en tres olas con fronteras de archivo estrictas, más
una ronda de integración (las costuras entre frentes no las hace ningún
frente). Commits `e8412a8` y `ce614ed`.

**Esquema — migraciones 0044–0052, aplicadas y verificadas contra la base:**
- **0044** búsqueda global por RPC `security invoker` (RLS decide qué se ve, y
  así ninguna superficie tiene que acordarse de filtrar), con el `href` saliendo
  de la RPC para que nadie re-invente el ruteo.
- **0045** notificaciones con categoría (13), prioridad, agrupación por
  `group_key` y preferencias por canal. Seguridad, pagos y cuenta **no se
  pueden silenciar** — lo impone un CHECK, no la UI.
- **0046** `short_video` vs `advertising_video`. La regla cuelga de
  `eligible_for_short_feed` y **no** del tipo: si colgara del tipo, bastaba
  dejarlo en NULL para meter 10 minutos en el reel.
- **0047** reclutamiento: embudo monótono por trigger, CV en bucket privado con
  la ruta atada por CHECK, y la nota del empleador en **tabla aparte** porque
  candidato y empleador llegan los dos como `authenticated` y RLS filtra filas,
  no columnas.
- **0048** tier `free`/`premium`, CTAs como columnas con un CHECK atómico,
  campañas y membresías de tienda.
- **0049** arregla un CHECK de 0046 que quedaba **dormido** por su fecha de
  corte. Lo destapó la prueba negativa, no la revisión.
- **0050** vistas y compartidos de aviso (las métricas que el panel declaraba
  como hueco en vez de mostrar un cero que parece dato).
- **0051** cierra la deuda que la propia 0044 se había anotado:
  `video_post_href` mandaba **todo** video al reel, publicitarios incluidos.
- **0052** búsqueda insensible a tildes (ver abajo).

**App:**
- **Búsqueda global** mientras se escribe, agrupada por tipo, con historial y
  sugerencias de datos reales; más buscador propio en Eventos, Negocios y
  Colaboraciones, que no tenían.
- **Notificaciones** con pestañas, contadores, agrupación por tiempo, acciones
  por fila y pantalla de preferencias.
- **Videos Cortos**: tope de 90 s validado en el navegador **y** en el
  servidor, menú de categorías al entrar, y los cuatro topes de duración
  (90/59/300/600) en un solo módulo con tests, para que no se separen.
- **Empleos** end-to-end: aplicar con CV y portafolio, "Mis aplicaciones", y
  panel de candidatos del **dueño del aviso** — que no es lo mismo que la vista
  de staff de `/admin/empleos`, que tiene su propia barrera auditada y no se
  tocó.
- **Monetización**: gratis vs premium en un solo módulo, botones por módulo,
  "Impulsar"/"Crear campaña" al publicar, estadísticas en dos niveles.
- **Tiendas** de USD 10/mes con apagado automático al vencer, y **política de
  productos prohibidos** como página legal propia.
- **Colaboraciones** (era "Contratos"), con 308 desde la ruta vieja.
- **Lienzo crema con la tarjeta blanca** — el pedido era *"blanco con blanco no
  notamos nada"*. La escala está anclada por **luminancia**, así que ningún par
  de contraste bajó: el peor del tema claro mejoró de 4.51:1 a 4.55:1.

**Defectos encontrados probando, no leyendo (los que valen):**
- **`current_period_end` ya no existe en la raíz de `Subscription`** en
  stripe-node 22 — se movió a `SubscriptionItem`. Leerlo como enseñan los
  ejemplos viejos dejaba la fecha en NULL, el cron nunca vencía la fila y **la
  tienda quedaba prendida para siempre**.
- **"Ver perfil" estaba construido y llegaba a 0 de sus 9 puntos de montaje.**
  Un frente construyó el componente, otro tenía las páginas: nadie lo cableó.
  Es el modo de falla típico de trabajar en paralelo y por eso existe la ronda
  de integración.
- **El chat sin sesión mandaba a `/propiedades/<id>` desde cualquier módulo** —
  un 404 justo después de que la persona se molestara en entrar.
- **El anuncio con la campaña vencida volvía a comportarse como orgánico**: la
  tarjeta sólo miraba `post_promotions`, que caduca. El hueco no estaba en el
  reel sino en el feed.
- **La búsqueda fallaba con las palabras más comunes escritas sin tilde**, que
  es como se escribe desde el teléfono. Medido: el stemmer español convierte
  `Habitación` en `habit`, pero `habitacion` queda entera y no matchea — dos
  avisos de habitación invisibles para quien no pone la tilde. Cerrado en 0052.
- Dos migraciones nacieron con el prefijo `0050`; la del orquestador se
  renumeró a `0051`.

**Gates:** `tsc` 0 · `lint` 0 errores · **1911 tests** (eran 1450) · `build`
verde con todas las rutas nuevas · enumerador RLS verde con **69 superficies**
(eran 59). Las garantías de la base se probaron **en vivo con rollback**, no
por lectura: un video de 600 s no entra al reel, un aviso gratis no guarda un
botón externo, nadie silencia las notificaciones de pagos, nadie lee el CV de
otro, y bajar de premium a gratis **falla** si no se limpian los CTAs en la
misma sentencia.

## Feedback de la call del 27/7 (85 min) — 8 frentes en paralelo (✅ 2026-07-27)

Fuente y criterio: **`docs/feedback/2026-07-27-call-85min.md`** — las citas
textuales de Geovanny, su traducción a producto, y lo que quedó fuera con su
razón. Leer eso antes de tocar nada de este bloque.

**Construido** (63 archivos modificados, 44 nuevos; nada commiteado todavía):

- **Comentarios que no tapan el video** — sobre video la hoja ocupa ~46% del
  alto, fondo de vidrio (scrim + blur) en vez de panel opaco, el video **sigue
  reproduciéndose**, y los comentarios avanzan solos hasta que la persona toca,
  scrollea o va a escribir (nunca con `prefers-reduced-motion`). Con el teclado
  abierto la hoja baja a 34dvh para no dejar el video en 3% de pantalla.
  Contraste medido contra el peor caso (video blanco tras el vidrio): 7.58:1.
- **Carrusel de medios** (`media-carousel.tsx`) — swipe horizontal con
  scroll-snap, puntitos, foto y video mezclados en el mismo post, `snap-stop:
  always`. Un solo medio ⇒ sin puntitos. Los puntitos son indicador
  (`aria-hidden`), no botones: a 44px cada uno taparían el área del doble toque.
  Navegación accesible por ←/→, flechas visibles sólo con puntero fino, y
  `aria-live` anunciando "Foto 2 de 3".
- **Scope del reel, agujero cerrado** — el detalle `/feed/[id]` renderizaba
  `PostCard` sin scope y caía al default "para-ti", que **no filtra**: tocar el
  video ahí abría el reel infinito sin acotar. Se llega a esa pantalla desde el
  perfil de alguien y desde las novedades de un evento — literalmente el «te
  sale de la propiedad» del cliente. Además `videoScope` pasó de `string` a un
  tipo cerrado, así que montar una card con un scope inventado ya no compila.
- **Composer unificado** — se fueron los botones sueltos de foto/video y la
  plancha blanca; queda el campo rápido más un único «¿Qué querés publicar?».
  Elegir foto/video lleva a un paso con el medio a la vista y el texto debajo.
  Publicar sin medio abre una hoja que ofrece los dos caminos (sumar foto, o
  publicarlo como pregunta) llevándose el texto ya escrito, en vez de un botón
  muerto: el trigger `MEDIA_REQUIRED` de 0023 sigue vivo y sólo exime a
  `kind='question'`.
- **Preguntas: marca de agua + encuesta Sí/No** — la marca va en tinta oscura y
  no clara (una marca clara sobre el campo tricolor bajaba el peor stop a
  ~3.9:1; así el delta de contraste es 0.000). El reparto de votos aparece
  **al votar**, no antes, para no sesgar; el autor es la excepción.
- **Buscar en el bottom nav** — reemplaza «Propiedades», y es una ruta propia
  (`/buscar`) y no un modal: una pestaña necesita back del sistema, link
  compartible y `aria-current`. Muestra las categorías en cápsulas; el buscador
  con filtros sigue viviendo dentro de cada una, como pidió el cliente.
- **Lenguaje de cápsulas** (`ui/bubble.tsx`) — tres intensidades donde la
  diferencia significa algo: `soft` informa, `accent` acompaña, `strong` se
  toca. Relleno mezclado contra `--color-surface` para que se lea elevada en
  ambos temas. Aplicado a menú, `/buscar`, y cabecera + filtros de 7 secciones.
- **CTA «publicá tu…»** en las 7 secciones, con copy propio por sección y
  `?kind=` preseleccionado (antes todas iban a `/publicar` pelado).
- **`/admin/empleos`** — listado con conteo real de postulaciones y detalle con
  una barrera de dos niveles **por dueño del aviso, no por rol**: aviso de la
  plataforma ⇒ el staff ve todo y puede responder; aviso de un miembro ⇒ sólo
  metadatos, y las columnas privadas ni se seleccionan. Un `global_admin`
  tampoco sube de nivel. Cada apertura se audita, y **sin auditoría no hay
  divulgación**.
- **Módulos en tres estados** (Activo · Muy pronto · Oculto) — y, sobre todo, el
  cableado que faltaba: hasta ahora el admin guardaba la configuración y **la
  app la ignoraba**. Ahora gobierna el menú, `/buscar`, el bottom nav y las
  rutas (guard por `layout.tsx` en 8 secciones: oculto ⇒ 404, muy pronto ⇒
  pantalla propia con URL propia). `feed` y `mensajes` quedaron marcados como no
  apagables en el panel en vez de ofrecer un interruptor inerte, y `escudo`
  salió: está apagado en el build y fuera del menú.
- **`/perfil/guardados`** — ruta propia, sólo la dueña ve lo suyo (probado en
  vivo con dos cuentas, no por lectura de código).
- **Alerta urgente en el feed** — sólo `severity='urgent'` sube al feed; los
  `info` se quedan en notificaciones. Reusa `broadcast_receipts`, así cerrarla
  en un lado la cierra en el otro. Registro ámbar de cartel de ruta, sin
  animación ni sirena.

**Migraciones (aplicadas y verificadas contra la base, 32/32 checks):**
- **0041** — `posts.poll_kind` + counters por trigger, `post_poll_votes` (voto
  secreto: ni un moderador ve quién votó qué), `tenants.modules_soon`,
  `broadcasts.severity`.
- **0042** — cierra dos agujeros reales encontrados durante el trabajo:
  `job_applications_select/_update` tenían una rama `or app.is_staff()` que
  dejaba a **cualquier** staff (incluido `moderator`) leer `message`, `answers`
  y `applicant_id` de postulaciones a avisos ajenos por PostgREST, salteando el
  panel; y `listings.created_by` era reescribible, así que un `PATCH
  {created_by: null}` convertía un aviso ajeno en «de la plataforma» y
  destrababa la divulgación de forma legítima. Ambos probados **antes y
  después** con un token real de staff. Se sumó la RPC `job_application_tally`
  para que el panel siga contando sin poder leer.

**Fixes de seguridad y accesibilidad que aparecieron de paso:**
- Los formularios de auth eran `<form onSubmit>` **sin `method`**: un envío
  antes de hidratar (teléfono lento, que es medio público de esta app) hacía un
  GET nativo y dejaba la **contraseña en la URL y en el historial**. Ahora
  `method="post"`.
- `buttonVariants` dejaba `primary` y `danger` **sin anillo de foco** en ~40
  call sites: `shadow-xs` es una utility y le ganaba al `box-shadow` del
  `:focus-visible` global. El anillo ahora vive en la base del cva.
- `/notificaciones` leía `broadcast_receipts` sin filtrar por dueño; a un
  `global_admin` la policy le devuelve los de todos, así que un broadcast que
  otro ya cerró le desaparecía sin haberlo visto.
- El `z.url()` del panel admin aceptaba `javascript:` y eso llegaba a un `href`
  → `safeCtaHref()`.
- Contrato de impresión: la hoja de comentarios, la del composer y el carrusel
  escribían tinta clara sin nada que la salvara en papel (1.00:1). Cerrado con
  los hooks reales, no ajustando el inventario.
- Datos demo: los niveles de confianza contradecían su puntaje (score 35 con
  etiqueta «verificado»). Corregidos en el seed y **verificados en la base**:
  17/17 consistentes.

**Hallazgos de la ronda de review (code-reviewer + security-auditor en paralelo),
todos cerrados:**
- **Los defaults del panel y de la app eran opuestos.** Clave ausente ⇒ el panel
  decía "Activo" y la app escondía. Con una base recién sembrada —o sirviendo el
  tenant `comunidadlatina`, que arrastraba las claves de módulo **en inglés**
  mientras la app las lee en español— desaparecían el menú, `/buscar`, la
  pestaña de Videos y las 8 rutas, sin que el operador tuviera cómo verlo.
  Unificado en un solo lugar (`moduleAvailability`, ausente = activo, porque
  apagar es un acto deliberado), seed alineado, fila de la base corregida, y tres
  tests de sincronía nuevos (app ↔ panel ↔ seed) para que no se vuelva a separar.
- **La hoja de comentarios miraba el primer medio, no el que se está viendo.** En
  un post `[foto, video]` —el ejemplo textual del cliente— deslizar hasta el
  video y comentar abría la hoja vieja y opaca. El índice del carrusel se subió a
  un `CardMediaProvider` propio; `PostActions.hasVideo` desapareció, así que la
  superficie ya no se puede pasar mal desde afuera.
- **Dos redirecciones abiertas**, ambas confirmadas navegando a otro origen desde
  una tarjeta firmada como mensaje oficial de la plataforma — o sea, el escalón
  para un login clonado contra un público de migrantes. Una estaba en
  `broadcast-card.tsx` (`startsWith("/")` deja pasar `//evil.com`), la otra en el
  `safeCtaHref` que este mismo lote agregó (tapaba `//` pero no `/\`, y el parser
  de URL trata `\` como `/`). Se reemplazaron por `src/lib/url/safe-href.ts`, que
  clasifica por **origen resuelto** en vez de por prefijo de string y sólo admite
  http(s) — `zod.url()` acepta `javascript:` y `data:`, así que la allowlist tenía
  que estar ahí.
- Andamiaje de "la migración puede no estar aplicada" cuadruplicado y ya
  inalcanzable, comentarios que describían código borrado, y copy huérfano que
  este lote dejó al reescribir el composer: todo removido.

**Bump de Next 16.2.10 → 16.2.12** (patch). Cierra las advisories del framework,
incluida la fuga de IDs de Server Function que el auditor usó como escalón, y la
confusión de caché de respuestas —que importa en una app con respuestas por
usuario. Las 12 advisories que quedan son cadenas de build/dev (`postcss` y
`sharp` anidados en next, `minimatch` vía eslint), no superficie de runtime.

**Gates:** `tsc --noEmit` limpio · `npm run lint` 0 errores · **1399 tests**
(eran 1317) · `npm run build` verde con todas las rutas nuevas · enumerador RLS
verde, 59 superficies (corre con `RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1`; el
certificado de la conexión directa falla en este entorno) · ingreso con
contraseña verificado contra la build de producción después de tocar los forms
de auth: entra, la URL queda sin credenciales, consola sin errores.

**Pendiente:** push + deploy (decisión de Manuel) · el 500-en-vez-de-404 con ids
inválidos en varias rutas de detalle (preexistente, anotado aparte) · lo que se
dejó fuera de alcance a propósito está listado con su razón en el doc de
feedback.

## Semana 3-4 del plan + hardening — ejecución autónoma (✅ 2026-07-22)

Diagnóstico (5 agentes en paralelo) + ejecución de todo lo automatizable, con
revisión adversarial multi-dimensión al cierre (Workflow: correctness,
seguridad, a11y, copy legal, convenciones → **0 findings confirmados**; los 4
que se levantaron fueron refutados por verificadores adversariales). **Ver
`docs/HANDOFF.md`** para el plan completo y los gates humanos.

**Construido y commiteado (9 commits, `e391035`→`88394cc`):**
- **Legal (`ee1c5c5`)**: 3 páginas públicas `/legal/{terminos,privacidad,normas}`
  redactadas sobre las prácticas REALES de datos (minimización, TTL 90d,
  verificación = indicador no garantía), footer con links reales (antes "Muy
  pronto"). **BORRADOR — requiere revisión de abogado + placeholders `[correo
  de contacto legal — completar]`.**
- **Consentimiento de registro (`60fe8fc`)**: casillas obligatorias 18+ y
  aceptación de Términos/Privacidad/Normas, revalidadas server-side
  (`z.literal`), persistidas en `profiles` (mig **0027 aplicada a la base**:
  `age_confirmed_at`/`terms_accepted_at`/`terms_version` — sin fecha de
  nacimiento, minimización).
- **Recuperación de contraseña (`60fe8fc`)**: flujo completo `/recuperar` →
  email de Supabase Auth (SMTP propio, no depende de Resend) → `/callback` →
  `/recuperar/actualizar`. Rate-limit + mensaje genérico anti-enumeración.
- **CSP enforcing (`d4f9282`)**: report-only → **`Content-Security-Policy`**,
  validado en vivo con Playwright sobre build de prod. Se agregó `media-src`
  (los videos de Storage se bloqueaban en enforcing) y allowlist de
  `images.pexels.com` (DEUDA de demo — quitar al migrar seed a Storage).
- **Fix React #418 (`c835ad3`)**: `/admin/moderacion` — fecha determinista
  (locale `es-US` + `timeZone America/New_York`) server=cliente.
- **Tests webhook Stripe (`4e3d858`)**: 10 casos (firma, idempotencia,
  correlación de monto/session). Antes: 0 cobertura sobre el flujo de dinero.
- **Hardening `post-media` (`4e3d858`)**: 4ª policy en
  `supabase/manual/harden-storage-listing.sql` (cierra enumeración de user_ids;
  el bucket 0025 quedó fuera del fix original). **Aplicación MANUAL en Dashboard.**
- **Limpieza (`33cbef9`)**: BrandMark (código muerto) eliminado, `.env.example`
  trackeado (verificado sin secretos), `npm audit fix` (fast-uri 3.1.4).

**Verificado en vivo (no solo lectura de código):**
- Guard de escalada: un member (`maria@demo`) es **rechazado** por
  `admin_ban_user`/`admin_suspend_user`/`admin_reactivate_user` (FORBIDDEN);
  `block_user` (acción de member) sí le está permitida. El guard por rol-JWT
  funciona.
- Advisors de Supabase post-DDL: sin hallazgos nuevos (los WARN son los ya
  conocidos: listado de buckets — que el SQL manual resuelve —, funciones
  SECURITY DEFINER por diseño, leaked-password toggle).
- Deploy: **`comunidad-latina-sigma.vercel.app` = build actual** (auto-deploy de
  main); `comunidad-latina.vercel.app` = build vieja (otro team, sin Marketplace).
  Las rutas nuevas dan 404 en sigma **porque se commiteó pero NO se pusheó**
  (push/deploy = decisión de Manuel).

**Gates:** tsc 0 · lint 0 errores · **947 tests** (eran 930) · `next build
--webpack` verde · enumerador RLS verde (37 superficies).

**Falta (manual, ver HANDOFF):** push+deploy · aplicar `harden-storage-listing.sql`
en Dashboard · toggle leaked-password · pentest + firma senior · credenciales
reales (Stripe/Resend/Vision/Sentry) · revisión legal de las 3 páginas.

## Feed red social v2 — auditoría UI/UX del cliente (✅ 2026-07-21)

Sprint P1+P2 del documento "Auditoría UI/UX – Mejoras Prioritarias del News
Feed" (Geovanny, llamada 21/7), implementado por 6 agentes en paralelo con
fronteras de archivos + contratos (stubs de `MediaViewerProvider` y
`CommentsSheetProvider` montados en el layout ANTES de lanzar la flota):

- **Cards foto-protagonista** — `PostCard` con media 4:5 full-bleed
  (`card-post-media.tsx`), doble-tap = like con corazón central (motor
  optimista compartido `card-like-context.tsx`: el doble-tap y el botón mueven
  el MISMO contador), single-tap abre el visor, botones de acción 22px con
  animación. Listings con título/precio/zona en `overlayBottom` sobre la foto y
  "Ver detalles" como píldora con el acento del módulo (16:9 a propósito: el
  4:5 es de posts; las fotos de propiedades son apaisadas).
- **Video end-to-end (sin migración)** — `posts.media` ya era `text[]` y el
  bucket post-media no restringe mime: el kind se infiere por extensión
  (`mediaKindOf`). Composer: hasta 4 fotos + 1 video ≤60MB con subida DIRECTA
  navegador→bucket (XHR con progreso; el prefijo `{tenant}/{user}` lo entrega
  `prepareMediaUploadAction` y la action re-valida pertenencia al persistir).
  Autoplay muted en el feed (IntersectionObserver ≥60% + ~2s, pedido del
  cliente) con toggle de sonido.
- **Visor fullscreen + Reels `/videos`** — swipe horizontal con snap nativo,
  cierre por gesto atrás (pushState), sonido ON al abrir (hubo gesto; fallback
  a mudo si el navegador lo rechaza). `/videos`: scroll vertical un-video-por-
  pantalla, scope por módulo (`?scope=` filtra por kind del listing asociado)
  respetando la MISMA visibilidad del feed, `?start=` posiciona. Ítem "Videos"
  en el bottom nav. **GOTCHA descubierto:** `.cl-page-transition` tenía
  `will-change: transform` + fill `both` → containing block PERMANENTE que
  rompía cualquier `position: fixed` dentro de una página (los reels medían
  358×0). Fix doble: CSS pasa a `backwards` sin will-change + los reels
  portalean a `<body>` (mismo patrón que MediaViewer).
- **Comentarios tipo Instagram** — `CommentsSheetProvider` sobre `BottomSheet`
  (extendido aditivo: `size="tall"`, `keyboardAware` con visualViewport),
  fetch client-side espejo de la lógica del detalle, composer inline optimista
  ("Enviando…" → "recién"), el detalle `/feed/[id]` conserva su hilo SSR para
  deep links. `CommentItem` compartido entre sheet y detalle.
- **Perfil red social + Trust Score card** — header con avatar grande, país ·
  ciudad, contadores honestos (Publicaciones + Siguiendo; "Seguidores" omitido:
  ningún perfil general tiene follow hoy — agregar luego es un head-count),
  `TrustScoreCard` (NN/100 grande, barra animada por nivel, señales como
  chips, "¿Cómo funciona?" → sheet existente) y grid 3-col de publicaciones
  (thumbnail de video via `preload="metadata"` + glifo Play).
- **Fluidez** — scroll infinito real en todos los tabs (`load-more.ts` server
  action + `feed-list.tsx` acumulador con sentinel; "Cargar más" queda como
  fallback accesible; `?cursor=` legacy sigue SSR), pull-to-refresh
  conservador, skeletons con la silueta nueva 4:5, saludo rotativo del
  composer por franja horaria.
- **Marketplace** — barra de búsqueda (FTS `websearch` español sobre
  `listings.search`, mismo índice que propiedades) arriba de las categorías.
  El "bug de campos de vivienda" que el cliente vio NO estaba en Marketplace:
  era `/publicar` mostrando SIEMPRE la frecuencia (por mes/semana) — ahora
  solo vivienda y empleo la ven; negocio/profesional/evento publican precio
  único.
- **Seed de videos demo** — `scripts/seed-videos.mjs` (ffmpeg, 6 clips 9:16)
  ya ejecutado contra la DB: posts de María/Luis/Carlos + 2 de entidad
  (Panadería La Altagracia, Festival Sabor Quisqueya) para demostrar scopes.
- **Verificación** — typecheck ✅ · lint 0 errores ✅ · **930/930 tests** ✅
  (inventario de tintas `on-*` actualizado con coberturas de impresión) ·
  build de producción ✅ · Playwright sobre `npm start`: feed, autoplay,
  sheet de comentarios (comentario real publicado), reels, perfil y búsqueda
  del marketplace — 0 errores de consola.
- **Pendientes (P3 + llamada)** — algoritmo/recomendaciones, restructura del
  menú inferior (§13 era "ejemplo"; falta decisión de IA), íconos de colores
  (esperando ejemplos del cliente), guardar/bookmarks (necesita tabla),
  Marketplace Comunidad vs Tiendas verificadas con Stripe, mensaje directo en
  tiendas + reviews comprador↔vendedor, historias (pospuesto por el cliente
  hasta firmar contrato), menú de tipos de publicación del composer.

## Ajustes de UX pedidos por el cliente (✅ 2026-07-20)

Segunda tanda del mismo día, sobre la app ya desplegada:

- **Menú en un botón** — el rail de cápsulas salió del header y los 8 módulos
  (hoy 7, ver Escudo) viven en un drawer lateral que además absorbió el toggle
  de tema y la campana. `shell/app-menu.tsx` + `shell/modules.ts` (registro puro
  con `isModuleActive`, testeado). Se borraron `module-rail.tsx` y
  `notification-bell.tsx` (código muerto). El punto del botón conserva la señal
  de no leídas. **Ojo:** los links del panel van con `prefetch={false}` — abrirlo
  disparaba **39 peticiones RSC** (Next precargaba los 12 destinos, todos rutas
  dinámicas con queries) y saturaba el server; ahora 0.
- **Cards del Marketplace** — el chip de categoría envolvía en 3 líneas y tapaba
  media foto. `categoryShortLabel` (etiquetas cortas) + chip de vidrio oscuro
  (`bg-media-scrim` + blur, el idioma que ya usaban gig-card/creator-card) +
  precio/título rebalanceados.
- **Bandeja de mensajes vacía sin CTA** — empujaba a "Buscar propiedades", que
  manda a otro módulo por un vacío que se llena solo.
- **Barra de contacto sólida** — era un degradado `from-canvas` que dejaba ver la
  card de abajo y se leía como un solapamiento sucio. Ahora es una barra con
  hairline + `bg-surface/92` + blur (mismo tratamiento que el bottom nav).
  `profesionales/[id]` pasó de `pb-24` a `pb-40`: con 24 la última card quedaba
  TAPADA por la barra.
- **Copy de contacto: una sola mención y concreta** — "Contactar (protegido)" +
  "Tu contacto queda protegido dentro de la app" decía lo mismo dos veces y
  "protegido" no dice QUÉ se protege. Quedó **"Contactar"** + "Tu teléfono no se
  comparte".
- **Foco del composer de comentarios** — tenía `focus:outline-none` SIN
  reemplazo: no había ningún indicador de foco propio (hueco de accesibilidad) y
  el navegador dibujaba el suyo, rectangular, que no empalmaba con la píldora.
  El anillo ahora vive en el `<form>` (`focus-within`) y sigue el radio.
- **Escudo OCULTO por completo** y **guías fuera del feed y del menú** — patrón
  del repo (`ASSISTANT_ENABLED`): flag `boolean` + `notFound()` en las rutas +
  sin entry points. `ScamShieldNotice` sigue existiendo pero desmontado de
  propiedades/[id] y profesionales/[id]. **Pendiente al reactivar:** volver a
  montar esas cards, el módulo en `shell/modules.ts` y los links que sacó el
  barrido. El toggle "Escudo Anti-Estafa" del panel de admin se dejó A PROPÓSITO
  (es staff-only y es por donde se reactiva).


**Última actualización:** 2026-07-19 (Feedback del cliente → Marketplace + Creator Marketplace + reglas de alcance del feed + restyle foto-grande + rail de módulos).
**Estado:** ✅ **R0–R3 + BLINDAJE + FEEDBACK CLIENTE 2026-07-19 implementado completo.** 60+ rutas. Gates verdes: `tsc` 0 · lint 0 errores · **831 tests** · `next build --webpack` verde · enumerador RLS verde (37 superficies).

## Feedback del cliente (WhatsApp 19/7) — implementado completo (✅ 2026-07-19)

Orquestado con 5 agentes en paralelo (ownership de archivos estricto) + curador de imágenes.
Migraciones **0023–0025 aplicadas a la base real**. Todo el pedido de Geovanny quedó funcionando:

- **Estética "Propiedades" en todos los módulos** — eventos/negocios/profesionales con foto hero
  16:9 (`CardMedia` nuevo en `ui/`), acentos de color por módulo (`--accent-*` en globals, fijos
  como la marca tricolor; texto siempre con tokens `-ink`). Negocios NO tiene ruta de detalle por
  diseño (BottomSheet); su follow vive en la tienda del Marketplace.
- **Marketplace** (`/marketplace`) — productos = `listings kind='product'` con
  `attrs.store_listing_id` → negocio dueño. Grid 2-col, categorías canónicas
  (`PRODUCT_CATEGORIES` en `components/marketplace/helpers.ts` — el seed DEBE usar esas claves),
  tienda (`/marketplace/tienda/[id]`) con FollowButton, publicar con moderación real.
- **Creator Marketplace** (`/creadores`) — avisos = `kind='creator_gig'` (presupuesto en
  `price_amount`); `creator_profiles` (reputación por triggers, JAMÁS escribible por el cliente),
  `gig_applications`, `gig_contracts` (código `CL-YYYY-NNNN` por secuencia, fee 20% en columnas
  GENERADAS por la DB, escrituras SOLO service_role vía actions con guard optimista de transición
  — máquina de estados pura en `components/creators/contract-machine.ts`, la misma tabla autoriza
  server y pinta botones), `gig_reviews` (solo partes de contrato `released`, inmutables, refresh
  de rating por trigger). **Pagos en modo demo etiquetado** (`payment_mode='demo'`): Stripe
  Connect es fase siguiente; columnas `stripe_*` listas.
- **Reglas del feed** — `posts.entity_listing_id` (publicar como tu negocio/evento; ownership por
  policy). Orgánico de entidad → SOLO seguidores (`follows`, 0023) · promocionado
  (`post_promotions`, espejo de boosts, chip **"Publicidad"**) → todos · personales → todos.
  **Es regla de DISTRIBUCIÓN en la query (`feed/queries.ts`), NO frontera RLS** (el post published
  sigue público en su detalle y en la página de la entidad — documentado en el archivo).
  Campañas: `/impulsar-post/[postId]` (paquetes 7/14/30, audiencia all/zonas persistida; sin
  Stripe → activación demo etiquetada; con Stripe → checkout + webhook ya discriminado).
- **Foto obligatoria en posts** — 3 capas: trigger DB `MEDIA_REQUIRED` (INSERT de `kind='post'`,
  service_role exento), server action, y composer con CTA deshabilitado + hint. `kind='question'`
  exento. **Decisión de producto: publicación instantánea + moderación a posteriori** (sin Vision
  el post nace `published` y se encola `TIER_HUMAN`; la red de seguridad ya existía: reporte 2
  taps + bloqueos + sanciones). Con Vision configurado vuelve el screening síncrono.
  Subida migrada al bucket **`post-media`** (0025, path `{tenant}/{user}/…`) con cliente del
  usuario — **eliminado el desvío admin de `listing-photos`** documentado en feed/actions.
- **Rail de módulos** — cápsulas de color scrolleables bajo el header (sticky compartido con el
  header a propósito: dos sticky hermanos no apilan bien), 8 módulos con acento propio; bottom
  nav sigue en 4 tabs. Toggles de admin sincronizados en los 3 espejos (`MODULE_KEYS` en
  admin/dominio/actions, `DEFAULT_MODULES` en tenant/resolve, `MODULES` en module-toggles) +
  `tenants.modules` del tenant real con `marketplace`/`creadores` en true.
- **Grafo social** — `follows` (0023): polimórfico listing|profile, respeta `pair_blocked` (0020)
  y sanciones (0021); `FollowButton` compartido (`components/social/`) + action
  (`app/(app)/social/actions.ts`). Cleanup de huérfanos por trigger.

**Seed demo (`scripts/seed-demo-content.mjs` + `seed-images.json`)** — la demo dejó de ser 100%
texto: 44 fotos Pexels VERIFICADAS (curador con WebFetch, solo 200), 23 listings viejos
fotografiados, 6 personas nuevas (María recreada — la habían borrado en pruebas de baja — +
Altagracia/panadería, Ramón/barbería, Yesenia y Luis creadores, Marisol), 2 tiendas con 8
productos (claves de categoría canónicas), 2 avisos de creadores, 3 aplicaciones, contrato
**CL-2026-0001 liberado** ($450 → $360 + $90 con transiciones REALES para ejercitar triggers:
Yesenia quedó ★5.0 · 1 trabajo) + CL-2026-0002 en curso, reviews mutuas, follows para las cuentas
demo (geovanny/carlos/manuelnavarro/María; `reycamila04` ajena, NO se toca) y el post de la
barbería con campaña activa (María no la sigue → lo ve SOLO por "Publicidad": la regla completa
en una pantalla). Listings nuevos backdateados a propósito (la 1ª página del feed es gente, no
catálogo). Password nueva en `SEED_DEMO_PASSWORD` (.env.local, fuera del repo).

**Verificación:** gates arriba + e2e Playwright contra `next start` real (build de prod, puerto
3377) con login real: feed con las 3 visibilidades + chip Publicidad, eventos/marketplace/
creadores/buscar con foto grande, contrato CL-2026-0001 con stepper/desglose/reseñas. Capturas
en la raíz del repo (`demo-*.png`, sin commitear). OJO: los `<img loading="lazy">` no cargan en
screenshots fullPage sin scrollear antes (helper en la sesión). La caché de webpack se corrompió
con el churn paralelo (`TypeError … reading 'length'` sin stack): `rm -rf .next` lo cura —
turbopack compilaba, era solo la caché.

**Pendientes que dejó esta tanda:**
1. `get_advisors` (Supabase MCP) → "You do not have permission" sobre `ktmbtpuhqqofdkisqseq`:
   el conector claude.ai no alcanza este proyecto. Correrlos desde el dashboard o re-autorizar.
2. Tipos de `database.types.ts` de 0023–0025 escritos A MANO (MCP sin permiso, CLI pide Docker) —
   una regeneración futura los pisa sin drama (nota en el header del archivo).
3. Stripe real para contratos de creadores y campañas de posts (schema listo, modo demo activo).
4. Fotos de posts/portfolios viven en URLs de Pexels (demo) — para producción real, migrar a
   Storage propio.
5. Preexistentes: React #418 en `/admin/moderacion` (Intl.DateTimeFormat server vs browser) y
   `finalizeListing` de `/publicar` no encola moderación (el flujo nuevo de productos SÍ lo hace
   — patrón a copiar). El fix del redirect `/publicar` → `/entrar` (`?redirect=` vs `?next=`)
   corre en tarea aparte.
6. **Deploy en Vercel sigue BLOQUEADO a nivel team** (ver Pendientes #0 de la sección Blindaje).

## Blindaje · Semana 2 — bloqueo, sanciones y reporte simple (✅ 2026-07-17)

`main` = `1ae2b44` (commits `6ae9590` + `1ae2b44`), pusheado. **⚠️ Deploy en Vercel BLOQUEADO a nivel team**
(ver Pendientes #0). Migraciones **0020–0022 ya aplicadas a la base real** (compatibles con el prod viejo:
sin bloqueos/sanciones registrados, los triggers son no-op).

- **Bloqueo global (0020):** `user_blocks` (RLS solo-dueño: quién te bloqueó jamás es consultable), RPCs
  `block_user`/`unblock_user`, `request_contact` con `USER_BLOCKED` (mismo copy en ambas direcciones), hilos
  existentes → `blocked` (desbloquear NO los revive), feed sin posts ni avisos de bloqueados, "Bloquear a esta
  persona" en menú de perfil y de hilo, `/perfil/bloqueados` para deshacer.
- **Sanciones (0021):** `profiles.account_status` (`active|suspended|banned`) + `suspended_until` (vencida =
  activa, sin cron), historial `account_sanctions` (solo staff lee; escribe solo RPC/service_role), RPCs
  `admin_suspend_user` (moderator+, 1–90 días) / `admin_ban_user` (domain_admin+, + ban de login vía Auth
  best-effort) / `admin_reactivate_user`; triggers `enforce_account_active` en la capa de datos; panel
  `/admin/miembros` (búsqueda, reportes abiertos por **denunciante único**, sanciones a un tap con motivo
  obligatorio); `AccountGate` reemplaza la app entera para suspendidos/baja. Staff no es sancionable
  (`CANNOT_SANCTION_STAFF`); nadie se auto-reactiva (guarda en `protect_profile_columns`).
- **Reporte en 2 taps:** `ReportSheet` unificado (motivo preseleccionado + enviar; éxito con autocierre 1.5s)
  en perfil, posts, mensajes y avisos → `reportTargetAction` → RPC `report_scam`.
- **Endurecimiento post-review adversarial (0022):** un reviewer (lente seguridad) encontró que
  `conversations_insert` (0006) permitía "conversaciones directas" sin RPC → un bloqueado podía abrir un hilo
  nuevo y escribir. Cerrado con trigger `enforce_pair_not_blocked` BEFORE INSERT. También: suspendidos ya no
  pueden likear (`reactions`) ni "publicar por edición" (UPDATE de posts/comments/listings).
- **Fix crítico preexistente (`6ae9590`):** `MotionProvider` (4231887) activó `LazyMotion strict` pero 7
  componentes seguían con `motion.*` → error boundary al montar cualquiera (dev). Convertidos a `m.*`.
  **Regla desde ahora: componentes nuevos usan `m.` de `motion/react`, nunca `motion.`.**

**Verificación:** 39 sondeos en vivo contra la base real (anon/member/staff: RLS, RPCs, triggers, guardas,
con filas sembradas — sin ambigüedad `200 []`) + e2e de UI con **Playwright** (reportar 2 taps → fila en
`scam_reports`; bloquear/desbloquear; suspender desde `/admin/miembros`; `AccountGate`; reactivar) + `tsc` 0 ·
lint 0 errores · **759 tests** · `next build` verde. OJO: el Browser pane de Claude no renderiza el streaming
SSR de esta app (contenido queda en `div hidden id="S:*"`, pasa igual con la prod vieja) — para e2e de UI usar
el MCP de Playwright.

## Merge integral + push + deploy (✅ 2026-07-08)

`main` = `b5a7493`, pusheado a `INSIGHTSAPPS/comunidad-latina` (privado) y desplegado a
https://comunidad-latina-taupe.vercel.app. Gates: `tsc` 0 · `lint` 0 errores · **760 tests** · `build` verde.

**2ª tanda (`agents/print-y-a11y`, `b5a7493`)** — 30 archivos, +2686/−254. Los agentes siguieron trabajando
~10 min después del primer deploy, otra vez sin commitear. Hoja de impresión (12 bloques `@media print` +
`cl-print-hide` en 13 superficies de chrome), 53 atributos `aria-*` nuevos, `theme-toggle.tsx`, y cuatro suites
de tests (contraste WCAG de tokens, invariantes de tema, contrato de impresión, toggle). Tests: 272 → **760**.
Verificado en prod: el toggle voltea el `--color-focus-ring` de `#9c3104` (light) a un tinte casi blanco de la
marca (dark), sobre canvas `#17150f`.

Se unieron dos líneas de trabajo paralelas:

- **`agents/design-tokens-y-theme` (`e9efcf1`)** — 95 archivos, +2672/−448. Cinco agentes trabajaron sobre el
  working tree de `main` **sin commitear**, así que llegó todo entreverado: no hay atribución por agente ni forma
  de separarlo retroactivamente. Tokens semánticos nuevos (`bg-media-scrim`, `text-on-media`, `focus-ring`,
  `bg-brand-hover`) en ~60 componentes, `src/components/theme/` con tests, hero mobile con art direction
  (`<picture>` + `getImageProps`), y `vitest.config.ts`.
- **`claude/wizardly-albattani-90d934` (`a5df7e5`)** — guard de divergencia de tenant (ver más abajo).

**Único conflicto real:** `vitest.config.ts` (add/add). Resuelto como unión — el alias de `server-only` y el
`exclude` de `.claude/worktrees/**` son ambos necesarios.

**Bug de a11y cerrado en el merge:** `tenant-mismatch-banner.tsx` era el último componente con
`ring-[var(--color-brand-200)]`. Ese token es un tono casi blanco por construcción (lightness 0.885 en el brand
pipeline, para cualquier tenant) → **1.38:1 contra el canvas claro: el anillo de foco no existía en light mode**
(§2.8, "nunca un borde que desaparece en un tema"). Verificado en prod: ahora resuelve a `#9c3104` vía
`--color-focus-ring`, que voltea con el tema.

**`npm run lint` desde la raíz daba 3365 errores** — todos de `.claude/worktrees/<rama>/.next/` (bundles
minificados de otra rama), ninguno de código. `.next/**` a secas solo matchea en la raíz. Arreglado en
`eslint.config.mjs` con `**/.claude/worktrees/**` + `**/.next/**`. Mismo motivo que el `exclude` de vitest.

**🐛 Bug abierto (preexistente, NO del merge):** `/admin/moderacion` tira **React #418** (mismatch de hidratación,
`args[]=text`) en prod. La página funciona: React re-renderiza y Aprobar/Rechazar andan. Sospechoso:
`new Intl.DateTimeFormat("es", …)` en `components/admin/moderation-item.tsx:56` y `scam-report-item.tsx:42`,
que formatea distinto en el server (UTC) que en el browser.

## Deploy de demo en producción (⚠️ 2026-07-08)

**URL:** https://comunidad-latina-taupe.vercel.app · proyecto Vercel `comunidad-latina` (team `manuels-projects-66819a23`).
`comunidad-latina.vercel.app` estaba tomado por otra cuenta.

> ⚠️ **Los gates humanos del pendiente #1 SIGUEN ABIERTOS.** Esto es una URL de demo, decidida a conciencia,
> apuntando a la base REAL (`ktmbtpuhqqofdkisqseq`). No es un go-live. No cargar datos de personas reales.

- **URL pública, sin protección de deployment.** Se desactivó `ssoProtection` (venía en `all_except_custom_domains`,
  que dejaba todo detrás del SSO de Vercel y el cliente no podía abrirlo). Para volver a cerrarla:
  `PATCH /v9/projects/<id> {"ssoProtection":{"deploymentType":"all_except_custom_domains"}}`.
- **`framework` era `null`** (el proyecto se creó con `vercel project add`, sin preset) → Vercel no aplicaba el
  routing de Next y **todo daba 404** aunque el build fuera verde. Corregido a `nextjs`.
- **Env de producción: solo 7 vars reales.** Stripe/Resend/Vision/Sentry quedan **sin setear** a propósito → los
  flags de `lib/config/services.ts` dan `false` y la degradación elegante funciona (verificado: el botón de plan
  abre "Muy pronto — Estamos terminando de configurar los pagos").
  ⚠️ En `.env.local` esas llaves son comentarios (`STRIPE_SECRET_KEY=  # sk_test_…`) y `@next/env` los recorta a `""`.
  **Si se pegan literales en el dashboard de Vercel, `Boolean()` da `true` y la degradación muere.**
- **`robots.txt` → `Disallow: /`** en cualquier host que no sea un dominio real (ver `src/app/robots.ts`).
- **Limitación de la demo:** en producción `isProduction` mata `MODERATION_DEV_AUTO_APPROVE` y Vision no está
  configurado → **todo listing nace `pending_review`**. Para que aparezca hay que aprobarlo en `/admin/moderacion`
  (entrar como `carlos` o `geovanny`). Los posts de texto del feed sí se publican al toque.
- **Push a GitHub: ✅ resuelto.** El remote `INSIGHTSAPPS/comunidad-latina` es privado y **solo lo ve la cuenta
  `gh` INSIGHTSAPPS**, no `manu-180`. Con esa cuenta activa, `git push` autentica sin pedir password. El deploy
  igual sube archivos locales y **no depende de Git** (el proyecto Vercel no tiene conexión con el repo, así que
  un push NO dispara build: hay que correr `vercel deploy --prod`).
- Credenciales demo: rotadas, fuera del repo (ver "Datos demo").

## Guard de divergencia de tenant (✅ 2026-07-08)

El tenant del REQUEST (header `x-tenant-slug`, del Host o de `?t=`) y el del USUARIO (JWT
`app_metadata.tenant_id`, lo único que gobierna la RLS) podían divergir sin que nada lo verificara.
**En producción es inalcanzable** (dominios registrables distintos → las cookies de sesión no cruzan);
afectaba dev y previews de Vercel, donde `?t=` es el único modo de cambiar de comunidad.

- **Regla pura** en [`src/lib/tenant/match.ts`](../src/lib/tenant/match.ts) (`classifyTenantMatch`) + **cableado**
  en [`src/lib/tenant/guard.ts`](../src/lib/tenant/guard.ts) (`requireTenantMatch`, `server-only`, espejo de
  `app/admin/guard.ts`). 27 tests nuevos (39 en total).
- **Trampa del fallback:** `getTenant()` degrada a un `id` PLACEHOLDER cuando la DB no responde o el slug no
  existe. Compararlo contra el JWT convertía un hipo de infra —o un `?t=` mal tipeado— en "estás en la comunidad
  equivocada". Nuevo campo `Tenant.isFallback` → estado `tenant-unavailable` con el copy genérico de §7.
  **Nunca afirmar de más.**
- **La lectura NO se bloquea** (cross-tenant a propósito por SEO, policy `listings_select`): solo escrituras.
  Aviso no-bloqueante `<TenantMismatchBanner>` en el shell de `(app)/`, con vuelta en un click.
  **Se muestra a todos los roles**, incluido `global_admin`: `listings_insert` no tiene escape para staff
  (solo `listings_update`), así que en otro tenant tampoco puede publicar — el aviso también es cierto para él.
- **8 paths cubiertos.** Además de las 6 escrituras (listings, listing_private_details, posts, comments,
  reactions, business_accounts), dos que **mentían** bajo divergencia: `impulsar` decía *"Solo el dueño puede
  impulsarlo"* sobre un aviso propio, y el **verificador del Escudo** decía *"registro no conectado"* sobre una
  matrícula sí verificada (contradecía §11: nunca inventar ni negar un resultado).
- **🐛 Bug real corregido (reproducido y verificado en vivo):** `createPostAction` subía la foto con el **admin
  client** (bypassea la RLS de storage) al prefijo `{tenant_id}` del **tenant equivocado**, y recién después la
  RLS rechazaba el insert de `posts` → **archivo huérfano, sin fila, sin audit_log**. Por eso el guard corre
  ANTES de todo efecto colateral (rate limit, storage, Stripe), y no como traducción del error de RLS.
  Medido con service-role: **sin guard 1 objeto huérfano; con guard 0.** Happy path intacto (posts 3 → 4).
- **Gotcha de testing:** se agregó [`vitest.config.ts`](../vitest.config.ts) (no existía) con el alias `@/*` y un
  stub de `server-only` (`src/test/`), que fuera de un render RSC lanza a propósito.

Gates: `tsc` 0 · `lint` 0 errores · **39 tests** · `build` verde (47 rutas) · smoke-test en vivo con
`maria@demo` (Dominicanos) navegando `?t=comunidadlatina`.

## Emblemas 3D premium (✅ 2026-07-08)

**8 emblemas 3D** generados con Meshy (REST; el MCP está roto en Windows — ver [MESHY-MCP-SETUP.md](MESHY-MCP-SETUP.md))
y cableados en las superficies de confianza. Pipeline reproducible en [`assets-source/emblems/`](../assets-source/emblems/).

- **Pipeline:** `text-to-image` (nano-banana-pro, concepto art-dirigido) → `image-to-3d` (meshy-6, malla+textura)
  → `alpha_thumbnail` (render 512² RGBA, fondo transparente) → sharp → **WebP 256², ~9 KB c/u (96 KB los 8)**.
  Nada de 3D en vivo: el 3D genera el modelo, se envía un raster. Público en 3G y gama baja (§3.4).
- **Cableado:** hero de `/escudo` (88px, `priority`) · `ScamShieldNotice` (40px, lazy) · `VerificationCard`
  (72px, sello verde/rojo) · `TrustScoreBadge` variante card (32px) · `TrustScoreSheet` (72px, momento "level-up").
- **Umbral `EMBLEM_MIN_SIZE = 28px`**: debajo de eso sigue el ícono Phosphor de línea (§2.6). El badge inline
  (14px) no cambió — un render 3D a esa escala es puré. El fallback de línea **no es degradación**: es la
  representación correcta en su tamaño. `AnimatedNumber` intacto.
- **Regla dura descubierta:** un raster **no puede llevar el color de marca** (varía por tenant: #1A5EDB vs
  #C2410C). Por eso ningún emblema lo usa — solo neutros + semánticos, fijos por guardrail (§6). El diamante
  es cristal incoloro por esa razón, aunque el nivel se tiña con `text-brand`.
- **Un objeto, un significado:** el nivel "Confiable" reutiliza el mismo escudo verde que el hero del Escudo
  Anti-Estafa. Un escudo verde es "protegido" en todo el producto.
- **Costo:** 585 cr (2340 → 1755). El diamante necesitó 5 iteraciones: `image-to-3d` no reconstruye gemas
  transparentes, y el `LOOK` compartido decía "collectible enamel pin", que convierte una gema en una placa
  con engaste. Se resolvió pidiendo un sólido facetado opaco.

**Decisiones de NO hacer** (documentadas en [`public/brand/MANIFEST.json`](../public/brand/MANIFEST.json)):
- **Splash sin tocar.** Es el primer paint y hoy no pide red (monograma + CSS). Un raster ahí arriesga un
  emblema en blanco en la primera impresión, con conexión pobre. Además su tile lleva el `brandHex` del tenant.
- **Ícono PWA sin tocar.** Se renderizaron ambos candidatos a 48px (tamaño real de launcher): el escudo 3D
  inclinado achica el "CL" hasta volverlo una mancha. El squircle plano actual gana. El emblema de marca 3D
  quedó archivado en `assets-source/brand-raster/brand-emblem-3d.png`.
- **🔎 Hallazgo:** `<BrandMark>` (`src/components/experience/brand-mark.tsx`) **no se usa en ningún lado** —
  es código muerto. El MANIFEST anterior afirmaba que vivía en el header y el splash; era falso. Decidir:
  darle un hogar o borrarlo.

Gates: `tsc` 0 · `build` verde · 12 tests · `lint` 0 errores · smoke-test visual a 375px (/escudo, aviso anti-estafa, hoja del Trust Score).

## Revisión integral + Polish premium (✅ 2026-07-07)
- **Revisión integral**: 6 fiscales adversariales en paralelo (correctness, seguridad+anti-honeypot, UX premium, performance, arquitectura, accesibilidad) → 23 findings únicos aplicados (5 críticos, 8 mayores, 10 menores).
- **Polish premium**: splash de entrada por tenant (overlay, no bloquea LCP, reduced-motion), transiciones de página, primitivos de motion (TapScale, AnimatedNumber en Trust Score, LikeBurst en feed, Celebration al publicar/verificar/onboarding, Reveal, Shimmer), detalles de lujo en landing, emblema/escudo generados (nanobanana) + brand-mark SVG.
- **Fix de correctitud (smoke-test en vivo)**: el Asistente RAG tenía `DEFAULT_MIN_SIMILARITY=0.75` (umbral de otra métrica) que rechazaba TODOS los matches — la guía de ITIN matcheaba 0.748, la de ICE 0.589, y el asistente respondía "no sé" sobre su propio contenido. Calibrado empíricamente a **0.42** (`scripts/diagnose-rag.mjs`); ahora responde citando la fuente correcta. Verificado en vivo.

## R3 — Moat de IA + producción (✅ 2026-07-07)
- **Asistente Comunitario RAG** (`/asistente`, wireframe §4.e): pgvector + `match_chunks` (definer, solo published), streaming, guardrails duros legal-safe (nunca consejo/plazos/elegibilidad; cita fuente+fecha; deriva a profesional verificado), rate limit (10/h auth, 3/sesión anon), telemetría mínima con hash (nunca la pregunta en claro, TTL 30d). **21 chunks ya embebidos** (guías+listings) — re-generar con `npm run rag:embed`.
- **Stripe Identity** (`/perfil/verificar`): sesión atada al usuario, webhook → flag booleano + trust +25 (el documento nunca toca la DB). **Boost** (`/impulsar/[id]`): checkout one-time, webhook activa, chip "Destacado · Publicidad" (FTC), datos de pago solo-service (0018).
- **Emails Resend** (bienvenida/lead/mensaje — sin contenido privado) + **Sentry** completo guarded (scrub PII) + **Matching "Para vos"** (determinístico, razón visible) + **Copiloto de Negocios** (`/negocios/copiloto`).
- **Producción**: sitemap/robots dinámicos, error pages premium, security headers (CSP report-only), rate limiting, README, migraciones 0016-0018 aplicadas (hardening por fiscal: retención extra en conversaciones/reportes/payment_events/receipts).
- Gates: tsc 0 · build verde (47 rutas) · 12 tests · lint OK · **RLS GATE VERDE (29 superficies)** · fiscal legal-IA (max) + seguridad: 11 findings corregidos.

## Qué está construido y verificado

### R0 — Cimientos (✅)
- **DB multi-tenant**: 15 migraciones aplicadas en Supabase (`ktmbtpuhqqofdkisqseq`), 23 tablas, RLS `FORCE` + 4 policies nombradas en TODAS, helpers `app.*` (tenancy por JWT `app_metadata`, uuid v7), storage con policies por tenant, pg_cron TTL (mensajes 90d, notificaciones 60d, audit 365d), pgmq, 4 RPCs security-definer.
- **Anti-honeypot §5.4 implementado**: sin teléfono, `profiles_private` (needs del onboarding solo-dueño), geo aproximada (`area_label`/`geo_zone`), trust sin grafo de avales, verificación = flag booleano, TTLs.
- **Gate**: `npm run check:rls` → **VERDE (26 superficies)**. Advisors Supabase: solo WARNs intencionales (ver "Pendientes").
- **Design system premium**: tokens completos del brief 13 (neutros cálidos, semánticos, Double-Bezel, motion), General Sans + Plus Jakarta Sans, componentes ui/ + trust/ (gramática fija de TrustScore).
- **Infra**: middleware multi-tenant (Host→tenant, dev `?t=`), brand pipeline OKLCH con validación WCAG (con test), clientes Supabase SSR, degradación elegante (`lib/config/services.ts` + `<ProximamentePremium>`).
- **Assets**: 6 imágenes premium generadas con nanobanana en `public/images/`.

### R1 — Wedge con moat (✅)
- **/propiedades**: búsqueda full-text español, filtros, keyset pagination, detalle según wireframe §4.d (banda de verificación SOLO con `verification_check found_active`, ScamShieldNotice siempre, ubicación aproximada, CTA sticky contacto protegido → RPC).
- **/escudo**: verificador notario/abogado (resultado binario con copy legal: registro + fecha + disclaimer; estado honesto si no hay registro conectado), reportes (RPC `report_scam`), educación anti-estafa.
- **/bienvenida**: onboarding "Recién Llegado" 5 pasos <60s, needs → `profiles_private`.
- **/mensajes**: conversaciones pending/accepted, moderación de texto OpenAI, aviso anti-estafa fijo, TTL comunicado como feature.
- **/negocios/presencia**: planes `[EJEMPLO]` §18, degradación premium sin Stripe; webhook Stripe production-ready (firma + idempotencia `payment_events`) **pendiente de firma senior**.
- **Landing premium** + /guias con fuentes oficiales + JSON-LD + PWA (Serwist en Next 16, manifest por tenant, InstallPrompt, offline).

### R2 — Red social + admin (✅)
- **/feed**: 5 pestañas, composer con moderación, 3 tipos de card estructuralmente distintos, likes optimistas (triggers de counters en DB), anti-scroll (botón "Ver más").
- **/profesionales, /eventos**: directorios con la misma regla estricta de verificación; /publicar soporta property|professional|event.
- **/notificaciones**: unificadas + **Broadcast Global pull-model** con receipts; campana en header.
- **/admin**: moderación (cola con score IA), dominio (stats, aprobaciones, reportes), global (crear tenant con preview del brand pipeline, broadcast) — todo gateado por `app_metadata.role` server-side + `audit_log`.

### Verificación (todo corrido en esta sesión)
`tsc` 0 errores · `next build` verde (33 rutas) · 12 tests vitest · lint 0 errores · enumerador RLS verde · smoke-test visual (landing, /propiedades, /feed) en 375px.

### Proceso (cómo se construyó)
5 workflows ultracode: esquema adversarial (autor max + 3 fiscales × 2 rondas + corrector), assets nanobanana, fundaciones (2 agentes paralelos + integrador), R1 (7 módulos paralelos + integrador + 2 fiscales + corrector, 14 findings), R2 (4 módulos + integrador + fiscal max + corrector, 4 findings). ~30 agentes, ~4.1M tokens de subagentes.

## Datos demo
- Tenants: `dominicanos` (#1A5EDB) y `comunidadlatina` (#C2410C). En dev: `http://localhost:3000/?t=dominicanos`.
- Usuarios: `maria@demo.comunidadlatina.com` (member) · `carlos@...` (domain_admin) · `geovanny@...` (global_admin).
  **La password NO se documenta acá** (2026-07-08): la vieja `Demo123!demo` estaba en el repo y uno de los tres
  es `global_admin` sobre la MISMA base que usa cualquier deploy → cualquiera con la URL entraba al panel global.
  Rotadas y fuera del repo. El seed ahora exige `SEED_DEMO_PASSWORD` en `.env.local` y aborta sin ella.
- 9 listings de Queens, 3 guías con fuentes oficiales, 5 posts + comentarios + reacciones, 1 verification_check.

## Pendientes (en orden)
0. **🟡 DEPLOY — resuelto el bloqueo de git-author, falta consolidar el dominio/team canónico.** El bloqueo
   original (team `manuelinsights`, plan Hobby + repo privado) se resolvió haciendo público el repo
   `developers-insights/comunidad-latina` (commit `50c76ea`, **confirmado público hoy** con `gh repo view`,
   2026-07-22) y fijando el remote por defecto (`d970b94`). Pero ningún archivo del repo documenta todavía CUÁL
   proyecto/team de Vercel es el que recibe el auto-deploy real — eso solo vivía en memoria de sesión. Acción
   pendiente de Manuel: confirmar en el dashboard de Vercel cuál team/dominio es el vigente (candidatos vistos
   en distintas sesiones: `insights3`/`comunidad-latina-sigma.vercel.app`, `insights-apps`, `manuelinsights`) y
   escribir la respuesta acá. Mientras tanto `comunidad-latina.vercel.app` (otro team) sirve una build vieja sin
   Marketplace/Creadores, y `comunidad-latina-taupe.vercel.app` es LEGACY congelado — no usar ninguno de los dos
   para demos. Detalle completo en `docs/HANDOFF.md`.
1. **🔴 GATES HUMANOS antes del primer dato real (§5.2/§14.4 — NO construibles por agentes):** pentest humano adversarial + **firma de ingeniero senior** sobre migraciones y webhook Stripe. Sin esto NO se expone a usuarios reales.
2. **Credenciales faltantes** (degradan con elegancia hoy): Stripe (test) → activa pagos reales del flujo ya construido · Resend → emails · Google Vision → moderación de imagen (hoy: pending_review) · Sentry → observabilidad (exigida antes de producción) · Vercel → deploy + dominios.
3. **Hardening menor (requiere Dashboard — `storage.objects` lo posee `supabase_storage_admin`, ni el MCP ni el rol `postgres` pueden tocarlo):** (a) **listado de buckets** — SQL listo en [`supabase/manual/harden-storage-listing.sql`](../supabase/manual/harden-storage-listing.sql), pegar en Dashboard → SQL Editor (scopea el SELECT/list al dueño; cierra la enumeración de user_ids vía `avatars`; el acceso público por URL no se ve afectado; hoy buckets vacíos → riesgo 0); (b) **Leaked Password Protection** (HaveIBeenPwned) en Dashboard → Auth → Providers → Password (toggle, 1 click). Ambos van en el mismo pase que el pentest/firma senior.
4. **Siguiente construcción:** **R4** (2º dominio real + Playbook de Nacimiento de Tenant) / **R5** (moonshots). Requiere decisiones de Geovanny §16. El "Asistente de Trámites" sigue vetado hasta abogado (UPL).
5. Deuda técnica menor: renombrar `middleware`→`proxy` (deprecación Next 16), E2E de mensajería (gate §5.4, hoy TTL 90d), CA cert para el enumerador en CI (`SUPABASE_DB_CA_CERT_PATH`). (Ya resueltos por la revisión integral: `metadataBase` en layout ✓, `lib/trust/signals` como fuente única ✓.)
6. **MCP de Meshy** — la key funciona, pero el server **no arranca en Windows**: `~/.claude.json` usa `"command": "npx"` y `npx` es un `.cmd` (`spawn ENOENT`). Fix de una línea (`cmd /c npx`) + reinicio, en [`docs/MESHY-MCP-SETUP.md`](MESHY-MCP-SETUP.md). Mientras tanto el pipeline de emblemas pega contra la REST API directo y es reproducible ([`assets-source/emblems/`](../assets-source/emblems/)).

## Cómo correr
```
npm run dev              # app en localhost:3000 (tenant dominicanos por default)
npm run build            # build producción (--webpack por Serwist)
npm run typecheck | test | lint
npm run check:rls        # gate RLS (RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1 en dev)
npm run db:migrate       # aplica migraciones nuevas de supabase/migrations/
npm run db:seed          # seed idempotente
```
