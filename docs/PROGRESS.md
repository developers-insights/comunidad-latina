# PROGRESS — Comunidad Latina

**Última actualización:** 2026-07-08 (guard de divergencia de tenant).
**Estado:** ✅ **R0 + R1 + R2 + R3 CONSTRUIDOS + REVISIÓN INTEGRAL + POLISH PREMIUM + EMBLEMAS 3D + GUARD DE TENANT.** Producto completo listo para los gates humanos. 47 rutas.

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
- **Sin push a GitHub:** el remote `INSIGHTSAPPS/comunidad-latina` pide credenciales interactivas. El deploy sube
  archivos locales, no depende de Git. Commit local: `e26a406`.
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
