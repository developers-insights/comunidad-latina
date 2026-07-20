# PROGRESS — Comunidad Latina

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
0. **🔴 DEPLOY BLOQUEADO EN VERCEL (team `manuelinsights`).** Desde `796ec57` todo push termina en
   *"Deployment was blocked"* (el último deploy exitoso fue `5e42330`). NO es el gate de git-author (autor =
   INSIGHTSAPPS en todos) — es un bloqueo del lado del team (pausa/billing/límite o desconexión de la cuenta
   GitHub en Vercel). Se resuelve SOLO desde el dashboard: abrir
   https://vercel.com/manuelinsights/comunidad-latina/2Nn8zzgUdYKFx6jqSAprhVY29dWX (deploy bloqueado de
   `1ae2b44`), leer el motivo del bloqueo, destrabar y hacer **Redeploy** del último commit. La CLI local solo
   accede al team `insights-apps` y `VERCEL_API_TOKEN` en `.env.local` está vacío, así que no hay vía
   programática desde esta máquina. Las migraciones 0020–0022 ya están aplicadas y son inofensivas para el
   prod viejo.
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
