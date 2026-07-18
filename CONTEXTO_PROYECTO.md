# Informe de Preparación para Tiendas — Comunidad Latina / NYLabel

> Documento de referencia permanente. Consolida 9 análisis paralelos (producto-negocio, arquitectura, datos-privacidad, UGC-moderación, assets-visuales, auth-cuentas-demo, legal, deploy-infra, empaquetado-nativo) sobre el estado del repo `comunidad_latina` de cara a publicar en **Google Play Console** y **App Store Connect**. No agrega hallazgos nuevos: organiza, deduplica y señala discrepancias entre los informes originales. Fecha de consolidación: 2026-07-08.

---

## 1. Resumen ejecutivo

**Qué es el producto.** Comunidad Latina (alias interno de repo/carpeta: "NYLabel") es una red social **white-label multi-tenant** que recibe, protege y conecta al inmigrante latino recién llegado a Estados Unidos. Su wedge de producto es la **vivienda verificada anti-estafa**: avisos con Trust Score, verificador determinístico de propiedad/matrícula contra fuentes oficiales fechadas, Escudo Anti-Estafa con reportes comunitarios ponderados, y contacto protegido dentro de la app. Alrededor de ese núcleo hay directorios de negocios y profesionales verificados, guías de trámites con fuentes oficiales, un Asistente Comunitario con IA (RAG, nunca asesoría legal) y paneles de administración por comunidad. El mismo motor de código sirve N comunidades por país de origen, cada una con su propio dominio y color de marca.

**En qué estado está.** Según la memoria del proyecto, las rebanadas R0–R3 más pulido y emblemas 3D están "todo verde" a nivel de código (build/lint/tests), pero **faltan gates humanos y credenciales reales** antes de exponer datos de usuarios reales. Hoy corre en producción como **PWA** en `https://comunidad-latina-taupe.vercel.app`, con exactamente **2 tenants reales en base de datos**: `dominicanos` (piloto activo, Queens NY, `#1A5EDB`) y `comunidadlatina` (marca insignia, `#C2410C`). No hay conexión Git→Vercel (deploys manuales), el proyecto corre en plan Hobby de Vercel (prohíbe uso comercial), y la protección SSO está desactivada a propósito, así que la demo pública apunta a la base de datos real sin capa de protección adicional.

**El hallazgo más importante para las tiendas — la brecha de empaquetado nativo.** El plan maestro vigente (V4, documento canon) define el producto explícitamente como **"instalable sin App Store (PWA)"** (`docs/PLAN_MAESTRO.md:62`). Las versiones anteriores del plan lo dicen aún con más fuerza: *"PWA-first... Apps nativas = backlog Fase 2+"* (`docs/versiones/PLAN_MAESTRO_v2.md:138`) y *"Apps nativas... son una Fase 2+ fuera del alcance de este plan"* (`docs/versiones/PLAN_MAESTRO_v1.md:83-85`). Ninguna rebanada del roadmap vigente (R0–R5) incluye "publicar en tiendas" como entregable. Confirmado por búsqueda exhaustiva en todo el repo: **hoy no existe un solo artefacto de empaquetado nativo** — cero Capacitor/Cordova/React Native/Expo, cero proyectos Gradle/Xcode, cero `assetlinks.json`, cero `.aab`/`.ipa`. Publicar en Google Play y App Store **no es "subir un ícono a una consola"**: es abrir un frente nuevo que toca simultáneamente:

- **Arquitectura**: el tenant se resuelve 1:1 por el header `Host` (no hay selector de comunidad en producción), y la app no admite export estático (middleware, RSC con `headers()` por request, Server Actions, RLS) — cualquier wrapper nativo tiene que ser "thin" (TWA/WebView) apuntando a una URL remota viva, nunca un bundle local.
- **Producto**: hay que decidir entre N apps nativas (una por tenant/dominio, con su propio bundle id/ícono/ficha) o 1 app con selector de comunidad (feature que no existe hoy) o descartar tiendas nativas y quedarse en PWA.
- **Assets**: faltan el ícono 1024×1024 sin alfa de App Store, el feature graphic 1024×500 de Google Play, y el **100% de los screenshots** de ambas tiendas (no hay ni una sola captura real de la interfaz en el repo).
- **Infraestructura**: hace falta dominio propio (no `*.vercel.app`) + plan Vercel Pro + keystore de firma Android + `Digital Asset Links` — nada de esto existe hoy.
- **Legal/negocio**: el nombre público que se elija para la app tiene una implicancia legal directa sobre el vencimiento de la marca "Comunidad Latina" en octubre 2026 (ver §2.4 y §8).

Es un **pivot deliberado respecto del plan canónico**, no una tarea de packaging que ya estuviera prevista — la próxima sesión debería tratarlo como tal.

**Dos bloqueantes adicionales, independientes del empaquetado, que impiden literalmente enviar cualquier ficha a revisión:**
1. **No existe página de Política de Privacidad publicada** (campo obligatorio en ambos formularios de tienda) — hoy solo hay un placeholder "Pronto" en el footer.
2. **No hay entidad legal confirmada** para las cuentas de developer — Apple Developer Program (cuenta Organization) exige D-U-N-S, Google Play Console exige datos fiscales/bancarios reales.

---

## 2. Qué es el producto (para las tiendas)

### 2.1 Descripción — borradores listos para adaptar

**Corta (~80 caracteres):**
> La infraestructura de confianza del inmigrante latino: vivienda verificada, sin estafas.

**Larga (2–3 párrafos, adaptable a Google Play / App Store):**

> Comunidad Latina es la red social que recibe, protege y conecta al inmigrante latino recién llegado a Estados Unidos. Resuelve tres dolores concretos del día 1: no saber en quién confiar (estafas de alquiler, notarios falsos), no encontrar a su gente ni sus servicios, y ser invisible para el sistema por no tener historial en el país nuevo. El corazón del producto es la vivienda verificada anti-estafa: avisos de alquiler con Trust Score, verificador determinístico de propiedad/matrícula profesional contra fuentes oficiales fechadas, Escudo Anti-Estafa con reportes comunitarios ponderados, y contacto protegido dentro de la app (nunca "pasate a WhatsApp").
>
> Alrededor de ese wedge vive una red social completa con 5 secciones (Principal, Propiedades, Negocios, Profesionales, Eventos), directorios de negocios y profesionales verificados, guías con fuentes oficiales para trámites (ITIN, licencia sin SSN, derechos ante ICE), un Asistente Comunitario con IA que cita fuentes oficiales y nunca da consejo legal, y paneles de administración por comunidad. Todo en español, mobile-first, diseño premium.
>
> Es una plataforma white-label multi-tenant: el mismo motor sirve N comunidades por país de origen (cada una con su dominio y color de marca), aisladas entre sí. Hoy el piloto activo es la comunidad dominicana en Queens, NY (`dominicanos.com`), con `comunidadlatina.com` como buque insignia de marca.

*Fuente: `docs/PLAN_MAESTRO.md` §1 "Visión del producto" (líneas 58-67), "Concepto unificador" (líneas 19-32), §3 "El Moat legal-safe" (líneas 103-118); `README.md` líneas 1-5.*

**Importante — disciplina de copy legal (ver también §8.4):** cualquier descripción de tienda debe seguir el mismo patrón que usa el resto del producto — nunca "vivienda 100% verificada" o "comunidad segura" sin matiz. Las frases que ya pasaron el filtro legal interno (`hero.trustSignals`, `src/components/marketing/copy.ts:28-32`) son un buen punto de partida: *"Verificado contra registros oficiales"*, *"Sin dirección exacta hasta el contacto real"*.

### 2.2 Tenants / dominios

**Actuales, con datos reales en la base de datos** (`scripts/seed.mjs:73-94`; `README.md:96-103`; `docs/PROGRESS.md:183`):

| Slug | Nombre (DB) | Dominio prod | Color de marca | Estado |
|---|---|---|---|---|
| `dominicanos` | "Dominicanos en USA" | dominicanos.com | `#1A5EDB` | Piloto activo — tenant por defecto en dev, seed con 9 listings de Queens NY, 3 guías, 5 posts |
| `comunidadlatina` | "Comunidad Latina" | comunidadlatina.com | `#C2410C` | Segundo tenant, prueba de white-label y sostén del uso de marca (ver §2.4) |

Cualquier ficha de tienda que se prepare ahora debe representar la experiencia de uno de estos dos — son los únicos con contenido real.

**Planeados / aspiracionales (no construidos, no en DB) — distinguir nivel de compromiso:**
- `docs/PLAN_MAESTRO.md` §16.6 (canon, pendiente de confirmar por Geovanny): *"Tenants iniciales: dominicanos.com (tracción) + comunidadlatina.com (marca)"* — el plan oficial **no compromete un tercer dominio** todavía.
- §1 y §13 (R4/R5) del plan: visión de largo plazo de N redes sociales independientes por país de origen (`colombianos.com`, etc.); R4 = "2º dominio real + Playbook de Nacimiento de Tenant"; R5 = "N dominios... i18n/Europa".
- `docs/investigacion/power-up/12-go-to-market-lanzamiento.md`: propone un rollout de **8 dominios en 16 semanas** (dominicanos → puertorriqueños → colombianos → mexicanos → cubanos → venezolanos → peruanos → salvadoreños). **Este es un documento de investigación de mercado/GTM, no una decisión tomada** — contradice en escala la ejecución real (R0–R3 solo construyeron 2 tenants demo). Tratar como visión aspiracional, no como roadmap comprometido.

### 2.3 Modelo de negocio y monetización

North Star: **cuentas de negocio pagas por tenant** (no MAU/ads) — modelo *supply-side*, el usuario común no paga. 4 flujos de monetización vía una sola cuenta Stripe de plataforma (`docs/PLAN_MAESTRO.md` §7, líneas 210-217):

1. Membresías / Presencia Verificada (Stripe Billing) — primero en activarse.
2. Boost geolocalizado (Stripe Checkout one-time).
3. Creator Marketplace (fase posterior, no construida).
4. Marketplace de Tiendas (fase posterior, no construida).

**Estado real de implementación** (`docs/PROGRESS.md:147,167,192`): Stripe Checkout + Identity + webhooks están construidos y "production-ready", pero **sin credenciales reales cargadas** — todo botón de pago hoy muestra el estado degradado `<ProximamentePremium>` ("Muy pronto"). El webhook de Stripe está pendiente de firma de ingeniero senior antes de activarse con dinero real.

**Dato para la planilla:** la app **no cobra al usuario final** — no hay ningún IAP consumible/suscripción de usuario final; todo el cobro es B2B vía Stripe Checkout web, no vía in-app purchase de la plataforma móvil.

**Bloqueante:** si se empaqueta como app nativa (Capacitor/TWA) con flujos de pago Stripe dentro de un WebView, Google Play y App Store tienen reglas estrictas sobre pagos que no sean su sistema de facturación in-app cuando el pago desbloquea contenido/funcionalidad digital dentro de la app — esto necesita revisión legal/compliance específica de las políticas de cada tienda antes de publicar; no está evaluado en ningún documento del repo.

### 2.4 El issue de la marca registrada "Comunidad Latina"

Hechos (`docs/PLAN_MAESTRO.md` §11.1 líneas 260-268; `docs/investigacion/power-up/12-go-to-market-lanzamiento.md` §4 líneas 228-253; confirmado abierto en `docs/HANDOFF.md:33`):

- La marca **vence en octubre 2026** si no hay prueba de uso genuino.
- **No está confirmado** si el deadline es una renovación de Sección 8 (declaración de uso continuado) o un umbral de abandono — esto cambia la estrategia legal y sigue sin resolver.
- El *specimen* que se presente ante USPTO debe ser uso genuino (usuarios reales pagando por un servicio real bajo el nombre exacto) — no una transacción manufacturada, porque eso es *sham use* y puede gatillar cancelación por fraude (USPTO expandió auditorías de specimens en 2025-26).
- `comunidadlatina.com` corre en paralelo específicamente para sostener la marca.

**Impacto directo sobre el nombre a publicar en las tiendas — dos ángulos, no contradictorios entre sí, ambos a tener presentes:**
- **Ángulo oportunidad (informe producto-negocio):** si la app se llama literalmente "Comunidad Latina" en las tiendas, esa publicación —con capturas, descripción y usuarios reales— **puede contar como parte del specimen de uso genuino** que salva la marca antes de octubre 2026. Convierte la publicación en tiendas de "nice to have" a palanca legal con fecha límite dura. Vale coordinar el timing con quien lleve el trámite USPTO.
- **Ángulo riesgo (informe legal):** si se publica bajo ese nombre y **de todos modos se termina perdiendo la marca**, hay que estar preparado para un rebrand forzado de ambas fichas (nombre, ícono, screenshots, developer name) en plena vida de la app — costo de reputación y de ranking (reviews, deep links) nada trivial.
- Si en cambio se publica como "Dominicanos en USA" (el tenant con datos reales hoy), esa publicación **no ayuda** a probar el uso de "Comunidad Latina" — son dos nombres corriendo en paralelo y hay que decidir cuál es "la app" en las tiendas, sabiendo que la elección tiene esta doble implicancia.
- El alias interno **"NYLabel"** (usado en encabezados de `docs/PLAN_MAESTRO.md` y `docs/investigacion/13-diseno-ux-premium.md`) no tiene uso público confirmado — aclarar con Geovanny si es puramente interno/legado antes de usarlo en cualquier ficha.

**Dato para la planilla:** el nombre público final de la app es una decisión de negocio con implicancia legal directa — debe decidirse ANTES de completar la ficha de tienda, comunicando explícitamente el vínculo con el deadline de octubre a quien apruebe el nombre.

### 2.5 Público objetivo

- **Perfil central:** inmigrante latino, foco en el recién llegado, sin historial de crédito/red social/reputación en el país nuevo (`docs/PLAN_MAESTRO.md` "Concepto unificador" líneas 21-29, §1 línea 62).
- **Geografía:** EE.UU. primero (Europa es moonshot de fase posterior, sin plan concreto); piloto/seed en Queens, NY; diáspora dominicana como foco específico del piloto (2.7M en EE.UU., 1M+ en área metro NYC).
- **Idioma:** español como idioma fuente de verdad (`lib/i18n/`, ES por defecto, EN puede quedar incompleto con fallback a ES). **Dato para la planilla:** el idioma principal de la ficha de tienda debe ser español, con inglés como secundario/incompleto si se agrega.
- **Rango de edad — bloqueante:** no hay un rango de edad de producto definido en los documentos rectores. El único dato de edad que aparece (`docs/investigacion/power-up/12-go-to-market-lanzamiento.md:21`) es táctico de GTM ("audiencia joven 18-34" para selección de creators de marketing), no una definición de público objetivo del producto. Falta un rango explícito para completar la clasificación de contenido/rating de edad de las tiendas — probablemente haya que inferirlo (adultos, dado que hay contacto entre desconocidos, transacciones de vivienda y verificación de identidad) o pedirlo a Geovanny. Ver también §5.5 (recomendación de rating desde la dimensión de UGC).

### Bloqueantes de esta sección
- Nombre público de la app sin decidir, con implicancia legal directa sobre el specimen de marca USPTO (deadline octubre 2026).
- Deadline de marca ambiguo (Sección 8 vs. abandono) — sigue sin confirmarse en TSDR.
- Rango de edad objetivo no definido — falta para la clasificación de contenido de las tiendas.
- Revisión de políticas de pago in-app de Google Play/App Store vs. los flujos Stripe existentes — no evaluado en ningún documento.
- No hay decisión fresca sobre qué tenant/dominio será la base de la primera publicación en tiendas (nombre, ícono, capturas dependen de esto).
- Estatus del alias interno "NYLabel" de cara al público sin aclarar.

---

## 3. Arquitectura y multi-tenancy

### 3.1 Cómo se resuelve el tenant hoy

**Middleware** (`src/middleware.ts:14-38`): en cada request, lee `?t=` del querystring y la cookie `cl-tenant`, llama a `resolveTenantSlug(host, tParam, cookieTenant)`, inyecta el slug resultante como header `x-tenant-slug` y refresca la sesión de Supabase.

**Resolución pura del slug** (`src/lib/tenant/resolve.ts:93-103`):
```
export function resolveTenantSlug(host, searchParamT, cookieT): string {
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  const fromDomain = DOMAIN_TENANTS[hostname];
  if (fromDomain) return fromDomain;
  return sanitizeSlug(searchParamT) ?? sanitizeSlug(cookieT) ?? DEFAULT_TENANT_SLUG;
}
```

- **Producción:** el header `Host` manda, contra un mapa **hardcodeado en código** `DOMAIN_TENANTS` (`resolve.ts:73-78`), hoy con exactamente 4 entradas (`dominicanos.com`, `www.dominicanos.com`, `comunidadlatina.com`, `www.comunidadlatina.com`).
- **Dev/preview:** `?t=<slug>` → cookie `cl-tenant` → default `"dominicanos"` — un atajo explícitamente de desarrollo, no un modo soportado en producción.
- `getTenant()` (`resolve.ts:140-172`) usa ese slug para buscar la fila real en la tabla `tenants` vía Supabase, con fallback a `DEFAULT_TENANTS` (placeholders hardcodeados) si la DB no responde.

### 3.2 Discrepancia documentada entre la documentación y el código (señalada explícitamente, no resuelta de oficio)

`docs/ARQUITECTURA.md:72` dice que el middleware "resuelve tenant vía RPC `get_tenant_by_domain` (con cache en memoria + fallback)". Esa RPC **existe de verdad** en la base (`supabase/migrations/0014_rpcs.sql:12-61`) y está diseñada exactamente para esto: resolver cualquier hostname contra la tabla `tenant_domains` (join a `tenants`), soportando N dominios sin tocar código. **Pero el middleware/`resolve.ts` no la llama en ningún lado** (confirmado por grep: cero referencias a `get_tenant_by_domain` fuera de la migración y de los tipos generados). El camino real de producción hoy es el mapa hardcodeado de 2 tenants.

**Consecuencia:** agregar un tercer dominio/tenant hoy requiere un cambio de código y redeploy (editar `DOMAIN_TENANTS` en `resolve.ts:73-78`, y también `INDEXABLE_HOSTS` en `src/app/robots.ts:22-27`, que duplica la misma lista a mano para SEO) — no un simple insert en `tenant_domains` como el diseño original (RPC) permitiría. Esto es lo contrario de "N tenants desde una sola base" que plantea la estrategia de producto, y es deuda técnica independiente del empaquetado nativo que conviene resolver antes de escalar a más comunidades.

### 3.3 Empaquetar como app nativa única (WebView/TWA/Capacitor) rompe el modelo "un dominio = un tenant"

- El tenant en producción se decide **exclusivamente** por el header `Host`. Un WebView/TWA/Capacitor que apunte a una URL fija solo puede resolver ese tenant — no hay ningún mecanismo de "elegir comunidad dentro de la app nativa" en producción.
- **TWA (Android)** exige *Digital Asset Links* (`assetlinks.json`) publicado en el dominio exacto que abre la Custom Tab, con SHA-256 del certificado de firma del APK — la verificación está atada 1:1 a un hostname.
- **Capacitor** apuntando a una URL remota tiene la misma limitación (un `server.url` fijo por build); WebView con assets embebidos es inviable porque el sitio no puede exportarse estático (ver §3.4).
- **Conclusión:** cada tenant/dominio necesitaría su propio build nativo (package name/bundle id, ícono, nombre distintos) y por lo tanto su propia ficha en cada consola — no hay forma de tener "una sola app" que sirva a `dominicanos.com` y `comunidadlatina.com` simultáneamente sin que el usuario elija manualmente la comunidad (diluye el branding white-label) o sin publicar N apps. Ver desarrollo completo de esta decisión en §10.

### 3.4 `next.config.ts` — build/output relevante

- **Sin `output: 'export'` ni `output: 'standalone'`** — Next corre en modo servidor default (SSR/RSC) en Vercel. Incompatible con un export estático para empaquetar en un WebView con assets embebidos; cualquier wrapper nativo debe apuntar a una URL remota viva.
- **Turbopack vs Webpack:** Next 16 usa Turbopack por default, pero Serwist (service worker de la PWA) solo inyecta vía plugin de Webpack. `package.json:8` fija `"build": "next build --webpack"` — el build de producción real NO usa el bundler default de Next 16. Cualquier pipeline de CI/CD futuro tiene que respetar ese flag.
- **Headers de seguridad** (`next.config.ts:118-134,142-149`): HSTS 2 años + subdominios, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` que **deniega cámara/micrófono/geolocalización** (`camera=(), microphone=(), geolocation=()`) y solo permite `payment=(self)`. CSP hoy en **Report-Only**, no enforcing.
  - **Bloqueante si se agrega una feature nativa de cámara** (p. ej. escanear documento para verificación de identidad, natural en un producto de Trust Score/KYC): la `Permissions-Policy` actual la bloquea explícitamente a nivel de header HTTP.
  - `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`: si el wrapper nativo cargara el sitio en un `<iframe>` (algunos wrappers low-end lo hacen), esto lo bloquea por diseño. Un TWA/Custom Tab o Capacitor WebView normal navegan top-level, así que no debería afectar, pero es un punto a verificar al elegir tecnología de wrapper.
- **Imágenes remotas:** `remotePatterns` solo permite `*.supabase.co/storage/v1/object/public/**` + patrón derivado de `NEXT_PUBLIC_SUPABASE_URL`.
- **Región de deploy:** no configurada en el repo (no hay `vercel.json`, `.vercel/project.json` solo trae `projectId`/`orgId`/`projectName`) — vive en el dashboard de Vercel, fuera del alcance de este análisis.
- **Sentry:** solo se activa si hay `NEXT_PUBLIC_SENTRY_DSN` en build — credenciales reales pendientes (ver §9).

### 3.5 `src/app/manifest.ts` — base del manifest PWA

Generado dinámicamente por tenant vía `getTenant()`:

| Campo | Valor | Notas |
|---|---|---|
| `name` | `tenant.name` | dinámico por tenant |
| `short_name` | primeras 12 char / primera palabra | función `shortName()` |
| `description` | fija, igual para todos los tenants | hardcodeada |
| `start_url` / `scope` | `/` | fijo |
| `display` | `standalone` | fijo — requisito clave para que una TWA tenga sentido |
| `background_color` | `#FCFCFB` | fijo, no por tenant (decisión deliberada) |
| `theme_color` | `tenant.brandHex` | dinámico por tenant — reutilizable directo como color de marca en la ficha |
| `categories` | `["social", "lifestyle", "news"]` | pista razonable para categoría de tienda, requiere mapeo manual a la taxonomía de cada consola |
| `icons` | `/icons/icon-192.png`, `icon-512.png` (any), `maskable-512.png` (maskable) | **rutas fijas, mismos archivos para TODOS los tenants** — ver bloqueante en §6 |

Como el manifest es dinámico por Host header, cada dominio de tenant genera su propio manifest automáticamente — no hay que mantenerlos a mano, y ya cumple los dos prerrequisitos de una TWA (manifest válido + Service Worker registrado, `src/app/sw.ts` vía Serwist). Detalle de empaquetado completo en §10.

### 3.6 Divergencia tenant JWT vs. Host — problema ya conocido en el código

`src/lib/tenant/match.ts` y `src/lib/tenant/guard.ts:14-32`: loguearse en un tenant y navegar a otro dominio genera un estado `"tenant-mismatch"` que bloquea escrituras — ya documentado por el propio equipo. Un wrapper nativo que combine "selector de comunidad in-app" con sesión persistida agravaría exactamente este caso; el guard tendría que extenderse/revisarse si se construye un selector nativo.

### Bloqueantes de esta sección
- Resolución de dominio hardcodeada en código (`resolve.ts` + `robots.ts`) en vez de usar la RPC `get_tenant_by_domain` ya diseñada para esto — deuda técnica a resolver antes de escalar tenants, independiente del empaquetado.
- `Permissions-Policy`/CSP bloquean cámara/micrófono/geo a nivel de header — requiere decisión explícita si cualquier feature nativa futura (KYC con cámara, geolocalización) entra al roadmap.
- Ningún mecanismo de selección de tenant en producción — el único selector fuera del `Host` header es de dev.
- Sin export estático posible — descarta cualquier wrapper que empaquete HTML/JS local; todo wrapper nativo depende de que el dominio esté online.
- Guard de `tenant-mismatch` necesitaría revisión si se construye un selector de comunidad nativo.

---

## 4. Datos, privacidad y seguridad

### 4.0 Diseño de base: minimización agresiva ("anti-honeypot")

`docs/PLAN_MAESTRO.md:334` llama al riesgo explícitamente "App = honeypot para ICE (riesgo humano)", y la mitigación documentada es "minimización agresiva de datos desde el 1er registro: login sin teléfono, geo aproximada, TTL corto, mensajería E2E (pendiente), verificación fuera de la DB". La mayoría de estas promesas están implementadas hoy en código; la mensajería E2E es un compromiso a futuro, no el estado actual (ver §4.4).

### 4.1 Datos de cuenta / Auth

- Registro real (`src/app/(auth)/actions.ts:36-48`): `registerSchema` pide solo `displayName`, `email`, `password`. **No hay campo de teléfono en ningún lado del flujo de registro** — confirma la promesa de `supabase/migrations/0003_profiles_trust.sql:5-8`.
- `public.profiles` (`0003_profiles_trust.sql:16-31`): `id`, `tenant_id`, `display_name`, `avatar_url`, `country_origin`, `area_label`, `bio`, `role`, `identity_verified`, `identity_verified_at`, `locale`. Es **pública** (`using(true)` para `anon, authenticated`) — diseñada para SEO.
- `public.profiles_private` (líneas 124-176): columna `needs` (jsonb) — respuestas del onboarding "Recién Llegado" (necesidad de ITIN, vivienda, ayuda legal). Comentario del propio código: "puede codificar estatus migratorio o necesidad de ayuda". RLS solo-dueño, ni siquiera staff/global_admin la lee.
- **Dato para la planilla:** en Play Data Safety y Apple Nutrition Label van a aparecer "Nombre", "Dirección de email", "ID de usuario". **NO** declarar "Número de teléfono" como recolectado.
- **Dato para la planilla:** `profiles_private.needs` es zona gris — declararlo conservadoramente como "Otros datos del usuario" recolectados pero NO compartidos con terceros ni usados para publicidad.

### 4.2 Datos de ubicación

- Confirmado por grep en todo `src/`: **no hay ninguna llamada a `navigator.geolocation`** ni columnas `latitude`/`longitude`. La ubicación es 100% ingresada a mano, nunca GPS del dispositivo.
- `public.listings.geo_zone` (`0004_listings.sql:24,45-46`): geohash **truncado a ≤5 caracteres** (~4.9 km de celda). Comentario explícito: "PROHIBIDO point exacto o dirección en columnas públicas".
- Dirección exacta opcional vive separada en `public.listing_private_details.exact_address` (`0004_listings.sql:139-151`), RLS solo-dueño (ni staff ni global_admin), revelada vía RPC `request_contact` sin persistir log de "quién vio qué dirección".
- **Dato para la planilla:** Location = **Approximate location only**, NO "Precise location". Google Play: recolectada, no compartida con terceros para ads. Apple: "Coarse Location", vinculada al usuario, no usada para tracking.

### 4.3 Datos financieros (Stripe)

- Checkout de membresía/boost manda `customer_email` a `stripe.checkout.sessions.create` (`src/app/(app)/impulsar/[listingId]/actions.ts:134`, `src/app/(app)/negocios/presencia/actions.ts:125`). El número de tarjeta lo maneja 100% Stripe Checkout (hosted); la app nunca toca PAN.
- `public.business_accounts` (`0008_monetization.sql:12-27`) guarda `stripe_customer_id`, `stripe_subscription_id`, `plan`, `plan_status` — nunca número de tarjeta ni datos bancarios. Escritura exclusiva por webhook/service_role.
- `public.payment_events` (`0008_monetization.sql:146-159`): `payload jsonb` contiene el payload crudo de Stripe (incluye `billing_details`). RLS todo en `false`: solo `service_role` la lee. TTL 90 días para eventos procesados (`0013_cron_ttl.sql:79-97`); los fallidos se conservan sin TTL.
- **Stripe Identity** (`src/app/(app)/perfil/verificar/actions.ts:104-110`): el documento de identidad **jamás toca la base de datos ni el servidor de la app** — viaja directo a Stripe (hosted flow), solo vuelve un booleano `identity_verified`.
- **Dato para la planilla:** Play "Financial info"/Payment info → recolectado, compartido con terceros (Stripe), cifrado en tránsito. Apple: "Financial Info" vinculada al usuario, propósito "App Functionality", no usada para tracking.
- **Dato para la planilla:** declarar a Stripe como subprocesador para pagos e identidad en la política de privacidad pública.
- **Bloqueante menor (higiene de datos):** `payment_events.payload` conservando `billing_details` completos por 90 días conviene documentarlo explícitamente en la privacy policy (motivo: idempotencia de webhook), no solo en el comentario SQL.

### 4.4 Datos enviados a terceros para procesamiento

**OpenAI (moderación + RAG):**
- `src/lib/moderation/index.ts:111-154` (`moderateText`) manda texto de posts/listings a `omni-moderation-latest`, truncado a 8000 chars.
- `src/app/(app)/mensajes/actions.ts:52-61` tiene su **propia** función `moderateText` (lógica duplicada, no reusa el helper compartido — nota de calidad, no bloqueante) que también llama a `omni-moderation-latest`: **el cuerpo de los mensajes privados (contacto protegido) también se envía a OpenAI** para moderación antes de guardarse.
- RAG del Asistente (`src/lib/rag/index.ts`, `supabase/migrations/0017_rag_assistant.sql`): el texto de la pregunta del usuario se manda a OpenAI para el embedding de búsqueda. En DB solo se guarda un HMAC-SHA256 (clave fuera de la base) de la pregunta normalizada, nunca el texto plano — pero el texto plano sí viajó a OpenAI en el momento de la consulta.
- **Dato para la planilla:** Apple "User Content" (mensajes, posts, preguntas al asistente) → compartido con terceros (OpenAI) para "App Functionality". Google Play: "App activity"/"User-generated content" compartido con terceros para procesamiento, NO para publicidad ni analítica de terceros.
- **Bloqueante:** verificar el Data Processing Agreement/política de retención de OpenAI para la API y documentarlo explícitamente en la política de privacidad pública — Apple pregunta directamente si el contenido de mensajes va a terceros.

**Google Vision (opcional, no activo por default):** `src/lib/config/services.ts:19-21` — si no está configurado, las fotos van directo a cola humana (tier 3), nunca se publican sin moderar. **Dato para la planilla (condicional):** si se activa en producción, declarar "Photos" compartidas con terceros para moderación de contenido.

**Resend (emails transaccionales):** `src/lib/email/index.ts:42-86` envía `to`/`subject`/`html`, explícitamente **nunca loguea el destinatario ni el contenido**. **Dato para la planilla:** "Email address" compartido con Resend para envío transaccional, propósito "App functionality".

**Sentry:** `sentry.scrub.ts` scrubea emails y teléfonos de mensajes/excepciones/breadcrumbs/URLs; `event.user` se reduce a solo el id (uuid opaco); se borran cookies, `request.data`, headers sensibles; `sendDefaultPii: false` explícito. **Confirmado: Sentry NO recibe PII estructurada** por diseño — la mitigación es "best effort" por regex (puede no capturar formatos no estándar). **Dato para la planilla:** Apple "Diagnostics" → recolectado, NO vinculado a identidad real, no usado para tracking. Google Play: "App info and performance" (crash logs), no compartido para publicidad. **Bloqueante menor:** no prometer en la privacy policy "cero PII en Sentry", sino "minimizamos activamente PII en diagnósticos".

### 4.5 Mensajería (contacto protegido)

- `public.messages` (`0006_messaging.sql:136-238`): `body text not null` — **texto plano, NO end-to-end**. `cipher_envelope jsonb` existe como columna reservada para un futuro cifrado E2E (comentario: "Hoy siempre null").
- TTL forzado a nivel de trigger (`app.messages_force_ttl()`): `expires_at = now() + 90 días` en cada INSERT, no evadible por API. Cron de purga diaria (`purge-expired-messages`).
- RLS: solo los dos participantes de la conversación leen mensajes — explícitamente ni staff ni global_admin tienen rama de acceso ("no somos un honeypot de chats").
- El contenido del mensaje sí sale hacia OpenAI para moderación antes de guardarse (ver §4.4) — "privado entre participantes" en la DB, pero no privado frente a OpenAI.
- **Bloqueante (transparencia, no técnico):** la privacy policy pública debería decir explícitamente que los mensajes NO son E2E hoy (aunque el schema esté preparado para migrarlo) — expectativa razonable en un producto que se posiciona como "protegido/anti-estafa".

### 4.6 Retención de datos / TTLs — tabla resumen (transcribible casi literal a la privacy policy)

| Tabla | TTL | Job (cron) |
|---|---|---|
| `messages` | 90 días desde creación (forzado) | `purge-expired-messages` (03:10 UTC) |
| `conversations` | 90 días sin mensajes vivos | `purge-stale-conversations` (03:40 UTC) |
| `notifications` | 60 días | `purge-expired-notifications` (03:20 UTC) |
| `audit_log` | 365 días | `purge-old-audit-log` (03:30 UTC) |
| `payment_events` (procesados) | 90 días | `purge-processed-payment-events` (03:50 UTC) |
| `broadcast_receipts` | 30 días tras fin del broadcast | `purge-old-broadcast-receipts` (04:00 UTC) |
| `moderation_queue` (resueltas) | 365 días | `purge-resolved-moderation-queue` (04:10 UTC) |
| `scam_reports` (upheld/dismissed) | 365 días | `purge-resolved-scam-reports` (04:20 UTC) |
| `assistant_queries` | 30 días | `purge-expired-assistant-queries` (04:50 UTC) |
| `boosts` (abandonados) | ver `0016_boosts.sql` (04:30/04:40 UTC) | — |

### 4.7 Borrado de cuenta

`deleteAccountAction` (`src/app/(app)/perfil/actions.ts:91-113`) llama `admin.auth.admin.deleteUser(user.id)`, con cascade/FKs de `0015_account_deletion_fk.sql`:
- **CASCADE** (se borran con la cuenta): `conversations`, `messages`, `listings`.
- **SET NULL** (se anonimiza, el contenido comunitario sobrevive): `posts.author_id`, `comments.author_id`, `scam_reports.reporter_id`, `moderation_queue.assigned_to/resolved_by`.
- **RESTRICT** (bloqueo intencional): `business_accounts.owner_id` — si el usuario tiene cuenta de negocio activa, el DELETE **falla** hasta que se dé de baja el negocio primero.

**Bloqueante (encontrado en la dimensión datos-privacidad):** `deleteAccountAction` **no maneja específicamente** el caso RESTRICT — si falla por violación de FK (usuario con `business_account` activo), el catch genérico solo muestra un mensaje de error genérico, sin explicar que debe cancelar su plan primero. Un usuario con negocio activo puede quedar atascado sin entender por qué. Google Play/Apple exigen que el flujo de borrado sea utilizable de punta a punta dentro de la app — esto hay que resolverlo antes de publicar.

**Dato para la planilla:** sí se puede responder afirmativamente "los usuarios pueden solicitar que se borren sus datos" y ofrecer un flujo in-app (`/perfil` → `DeleteAccount`, con doble confirmación) — Apple lo exige desde 2022 para cuentas creadas in-app.

### 4.8 Borrador de respuestas — Google Play Data Safety

| Pregunta | Respuesta sugerida |
|---|---|
| ¿Recopila o comparte datos de usuario? | Sí |
| Ubicación aproximada | Recopilada, no compartida con terceros para ads |
| Ubicación precisa | No recopilada |
| Info personal (nombre, email) | Recopilada y compartida (email con Resend/Stripe para funcionalidad) |
| Info financiera (payment info) | Recopilada, compartida con Stripe para procesar pagos |
| Mensajes / contenido de usuario | Recopilado, compartido con OpenAI para moderación automática |
| Fotos/videos | Recopilados, potencialmente compartidos con Google Vision si se activa |
| ID de dispositivo/otros identificadores | No se detectó tracking de ad-id en el código |
| Datos cifrados en tránsito | Sí (HTTPS/TLS estándar Vercel + Supabase + Stripe) |
| ¿Usuario puede pedir borrado de datos? | Sí, in-app (`/perfil`), con el matiz del bloqueante RESTRICT |
| ¿Se usan datos para publicidad? | No — sin SDK de ads ni tracking cross-app detectado |

### 4.9 Borrador de respuestas — Apple App Privacy / Nutrition Label

| Categoría Apple | ¿Aplica? | Vinculado a identidad | Usado para tracking |
|---|---|---|---|
| Contact Info (Name, Email) | Sí | Sí | No |
| Location (Coarse) | Sí | Sí | No |
| User Content (messages, photos, posts) | Sí | Sí | No |
| Financial Info (Payment Info) | Sí | Sí | No |
| Identifiers (User ID) | Sí | Sí | No |
| Usage Data | Probable (Sentry traces; Vercel Analytics no confirmado en código) | Parcial (uuid) | No |
| Diagnostics (Crash Data) | Sí (Sentry, con scrub de PII) | No (uuid opaco) | No |
| Sensitive Info (indicios migratorios) | Zona gris — `profiles_private.needs`; declarar conservador como "Other User Content" con acceso restringido | Sí (solo dueño) | No |
| Search/Browsing History | No visto | — | — |

### Bloqueantes de esta sección
- `deleteAccountAction` no maneja el caso RESTRICT de `business_accounts.owner_id` — riesgo de dejar a un usuario sin poder borrar su cuenta sin explicación clara.
- Falta confirmar el Data Processing Agreement/retención de OpenAI para el contenido de mensajes/posts/preguntas del asistente.
- No hay privacy policy pública confirmada como URL en el repo (desarrollado en profundidad en §8).
- Mensajería no es E2E hoy — si el marketing promete "mensajería protegida" sin aclarar que es server-side con TTL, hay riesgo de discrepancia entre lo declarado y lo real.

---

## 5. Contenido generado por usuarios y moderación

### 5.1 Tipos de contenido generado por usuarios

| Tipo | Visibilidad | Notas |
|---|---|---|
| Posts de feed (texto + foto opcional) | Público (`posts_select` para `anon, authenticated`) | Legible sin login |
| Comentarios | Público | Misma familia de policies |
| Listings/avisos (vivienda, negocio, profesional, evento, empleo) | Público | Incluye fotos de vivienda — dato sensible (dirección aprox., precio) |
| Mensajes directos | **Privado** — RLS solo participantes, sin rama de staff/global | TTL 90 días forzado |
| Reportes de estafa (`scam_reports`) | Semi-privado — reportante + staff del tenant + global_admin | Peso 1-3 derivado del Trust Score del reportante, no falsificable por el cliente |
| Perfiles (display_name, bio) | Público dentro del tenant | Entra a cola si flaggea |
| `verification_checks` | Público | No es UGC — solo `service_role` escribe; copy legal explícito anti-aval |

**Dato para la planilla (ambas tiendas):** declarar "Generates user content: Yes" — hay posts/comentarios/listings públicos + mensajería privada, ambos con moderación.

### 5.2 Pipeline de moderación

Post-moderación con gate duro para imágenes (el texto se publica primero y se audita después, salvo que la IA lo flague).

- **Motor:** OpenAI `omni-moderation-latest` (`src/lib/moderation/index.ts:111`), reimplementado ad-hoc también en `mensajes/actions.ts:52` (lógica duplicada, no bloqueante).
- **3 niveles** (`MODERATION_THRESHOLDS`): Tier 1 (0-30) auto-publica; Tier 2 (31-70) publica pero entra a monitoreo; Tier 3 (71-100) o `flagged=true` → cola humana, no se publica.
- Comentarios y mensajes flaggeados **nunca se insertan** — el intento entra a `moderation_queue` con el body real dentro de `reasons`.
- Listings **nunca nacen `published`** con JWT de usuario — siempre `draft → pending_review`.
- **Imágenes: NO hay moderación automática activa.** `isVisionConfigured` depende de `GOOGLE_VISION_API_KEY`/`GOOGLE_APPLICATION_CREDENTIALS`, **ninguna configurada hoy**. Toda foto sin Vision fuerza `pending_review` (revisión 100% humana).
- **Bloqueante crítico (no solo de tienda): no existe pipeline de detección de CSAM/NCMEC** (PhotoDNA) — `docs/PLAN_MAESTRO.md:224,265` lo señala como pendiente día 1. Google Play exige declarar y cumplir política CSAM para apps con subida de imágenes de usuarios; sin PhotoDNA/Vision activo esto es un vacío real de compliance, no solo de casillero. La única barrera hoy es el gate humano ("toda foto sin Vision → pending_review"), una mitigación manual razonable pero que no reemplaza una obligación de reporte NCMEC automatizada.
- **Degradación elegante:** si OpenAI no está configurado o falla, el contenido se publica igual pero se encola como tier 2 monitoreo — hoy `OPENAI_API_KEY` está configurada según `docs/PLAN_MAESTRO.md:182` ("moderación de texto activa").
- Cola de revisión humana: `/admin/moderacion`, gateada por `requireStaff("moderator")`. Toda acción queda en `audit_log`.

**Dato para la planilla:** Google Play "Content moderation"/App Store "User-Generated Content" preguntan si hay (a) moderación automatizada, (b) revisión humana, (c) mecanismo de reporte — las tres existen para texto; la moderación automática de imagen es la que falta.

### 5.3 Reporte y bloqueo de usuarios

- **Reportar contenido: SÍ existe** — `report_scam` RPC cubre `listing | profile | message`; botón "Reportar como estafa" reutilizable en 12+ superficies; posts se reportan indirectamente contra el perfil del autor. Cumple el requisito de "in-app reporting" de ambas tiendas.
- **Bloquear una conversación puntual: SÍ existe**, pero **NO es un bloqueo de usuario global.** `ignoreConversationAction` pone `conversations.status = 'blocked'` — solo esa conversación desaparece del inbox.
  - **Bloqueante:** no existe tabla `blocked_users`/`user_blocks` ni ningún mecanismo de bloqueo a nivel de perfil (grep vacío en todo el repo). Un usuario bloqueado en la conversación del listing X puede iniciar una conversación nueva sobre el listing Y (`conversations_listing_requester_uniq` es único por `(listing_id, created_by)`, no por par de usuarios). Ambas tiendas (Google Play "Safe messaging"/App Store guideline 1.2) exigen poder bloquear a una persona, no solo silenciar un hilo. Esto hay que resolverlo (tabla de bloqueo global + filtro en `request_contact`/inserción de conversaciones) antes de publicar una app con mensajería 1:1.
- **Expulsión de usuarios reincidentes: NO existe.** No hay noción de "strikes", suspensión ni ban automático/manual tras N reportes confirmados — el propio código lo dice: *"profiles no tiene status moderable hoy: la resolución de la cola es el registro; sanciones de cuenta son otra rebanada futura"* (`src/app/admin/moderacion/actions.ts:116-120`).
  - **Bloqueante:** ambas tiendas piden explícitamente, para apps con UGC/mensajería, un mecanismo para actuar sobre usuarios reincidentes (suspender/expulsar cuenta), no solo remover contenido puntual.

### 5.4 Verificación / restricción de edad

- **No existe ningún campo de edad, fecha de nacimiento, ni checkbox "soy mayor de 18/13"** en el registro (`registro-client.tsx`, `register-form.tsx`) — el formulario solo pide nombre/email/password.
- Tampoco hay checkbox de aceptación de Términos/Privacidad visible en ese componente.
- **Bloqueante:** Google Play exige declarar edad mínima real (IARC); si hay mensajería/UGC entre desconocidos, conviene 16+/18+ con autodeclaración de edad en el signup. App Store pide lo mismo vía el age rating quiz — sin gate de edad, conviene agregar consentimiento explícito de ToS/Privacy + declarar edad mínima 18 en el copy legal, dado el tema vivienda/dinero (fraude, estafas) que el propio plan ya reconoce como sensible. Ver también el gap de rango de edad de producto en §2.5.

### 5.5 Recomendación de clasificación

Contenido relevante para el rating: mensajería 1:1 sin bloqueo global, UGC público (texto+foto) sin moderación automática de imagen, temática de estafas/fraude inmobiliario, posible contenido ofensivo no filtrado hasta revisión humana.

- **Google Play (IARC):** el cuestionario generará como mínimo **PEGI 16/Teen** por "Users Interact" + "Shares Location/User Info" + "Unmoderated UGC" (imagen sin filtro automático) + mención de estafas/fraude. Recomendado marcar explícitamente: "Sí, UGC", "Sí, moderación (automática de texto + humana)", "Sí, reporte de contenido", "Bloqueo de usuario: parcial/no disponible aún" — declarar mal esto es motivo de rechazo o remoción.
- **App Store (age rating quiz):** "User-Generated Content" = Sí dispara el boilerplate del guideline 1.2 (requiere block + report + reincidencia + EULA). Con bloqueo de usuario ausente, Apple puede rechazar en revisión humana bajo guideline 1.2 hasta que exista (a) block, (b) report [existe], (c) contact mechanism [existe], (d) EULA/terms de conducta. Recomendación: **17+** mientras no se resuelvan los bloqueantes de bloqueo/expulsión, o declarar el UGC con todas las salvaguardas exigidas activas antes de intentar 12+.

### Bloqueantes de esta sección
- Sin pipeline de detección de CSAM (Vision/PhotoDNA) — mitigación manual existe (gate humano) pero no reemplaza obligación de reporte NCMEC automatizada.
- No hay bloqueo de usuario global, solo bloqueo de conversación puntual — requisito explícito de Google Play y Apple guideline 1.2.
- No hay mecanismo de suspensión/expulsión de cuentas reincidentes — solo remoción de contenido puntual.
- No hay verificación/declaración de edad mínima en el registro, ni checkbox de aceptación de Términos/Privacidad visible.

---

## 6. Assets visuales y branding (estado + gaps)

### 6.0 Contexto

`docs/PLAN_MAESTRO.md:62` dice explícitamente "instalable sin App Store (PWA)". Ningún documento rector menciona Play Store/App Store/TWA/Bubblewrap/PWABuilder/Capacitor. **La publicación en tiendas nativas es una dirección nueva, no contemplada por el pipeline de assets que existe hoy** — todo lo que sigue fue diseñado para un ícono de instalación PWA, no para una ficha de tienda.

### 6.1 Inventario de íconos existentes

Fuente única: `scripts/generate-icons.mjs` — rasteriza un SVG vectorial (monograma "CL" en arco) con `sharp`. Ningún ícono dibujado a mano en tamaño fijo; todo sale de un generador determinístico.

| Archivo | Tamaño real | Color | Purpose | Bordes |
|---|---|---|---|---|
| `public/icons/icon-192.png` | 192×192, RGBA | Azul `#1A5EDB` (gradiente) | `any` | rx=116 (squircle ~22.6%) |
| `public/icons/icon-512.png` | 512×512, RGBA | Azul | `any` | rx=116 |
| `public/icons/maskable-512.png` | 512×512, RGBA | Azul | `maskable` | full-bleed, safe zone 40% |
| `public/icons/apple-touch-icon.png` | 180×180, RGBA | Azul | — | full-bleed |
| `src/app/apple-icon.png` | 180×180, RGBA (idéntico, 10536 B) | Azul | link automático de Next | full-bleed |
| `src/app/favicon.ico` | multi-imagen (4 tamaños, 25931 B) | Azul | favicon navegador | — |
| `public/brand/favicon.svg` | vectorial, 394 B | Azul + monograma crema | favicon SVG alternativo | — |

**Dato para la planilla:** `maskable-512.png` ya está construido correctamente (full-bleed, safe zone del 40%) — exactamente lo que consumen Bubblewrap/PWABuilder para el ícono adaptativo nativo. **Esto NO es lo mismo** que un recurso Android nativo `<adaptive-icon>` con foreground/background como capas XML separadas — ese split no existe en el repo. Si el empaquetado es vía TWA (probable), el manifest actual alcanza; si se compila un shell Capacitor nativo, harán falta capas separadas.

**Bloqueante — falta el ícono 1024×1024 de App Store Connect.** Apple pide un ícono de marketing de 1024×1024, **sin canal alpha y sin esquinas redondeadas** (Apple aplica su propia máscara; un PNG con transparencia se rechaza en la subida). Los 4 PNG existentes son todos RGBA y el más grande es 512×512. El generador no produce ningún tamaño de 1024px ni variante opaca. Es trivial de generar (el SVG fuente es vectorial) pero hoy el archivo no existe.

**Bloqueante — ícono de Google Play Console (ficha, no el APK).** Play Console pide un ícono de 512×512, PNG de 32 bits, separado del ícono del bundle. `icon-512.png` cumple el tamaño; falta confirmar al subir si Play acepta el mismo archivo (esquinas ya redondeadas) o si conviene usar la versión full-bleed (`maskable-512.png`) para evitar doble-redondeo visual.

**Hallazgo de diseño (no bloqueante, relevante para consistencia de marca):** el ícono es **azul fijo (#1A5EDB) sin importar el tenant** (`scripts/generate-icons.mjs:39-47` hardcodea los gradientes; ambos tenants demo tienen `logoUrl: null` en `resolve.ts:51,63`, aunque el esquema sí soporta `logo_url` vía `mapTenantRow`). Si `comunidadlatina.com` (naranja `#C2410C`) también termina en una tienda, hoy mostraría el ícono azul de "dominicanos" — inconsistente con su propio color de marca. **Bloqueante condicional**, depende de si se publica una sola app insignia o una app por tenant (decisión de producto que no está en `docs/PLAN_MAESTRO.md`).

### 6.2 Screenshots de la app

**Bloqueante — no existe ninguno.** Búsqueda exhaustiva sobre `**/*screenshot*`, `public/images/`, `assets-source/` → cero resultados. Todo lo que hay en `public/images/` son fotografías editoriales e ilustraciones de marketing (Gemini/nanobanana), **no capturas reales de la interfaz**: `hero-community.png`, `hero-community-mobile.webp`, `hero-vivienda.png`, `onboarding-welcome.png`, `empty-state-search.png`, `og-default.png`, `guia-cover-itin.png` — ninguna muestra la app corriendo (feed, perfil, propiedades, Escudo, etc.).

Google Play exige mínimo 2 y hasta 8 screenshots de teléfono (16:9 a 9:16, 320-3840px por lado). App Store exige capturas por tamaño de dispositivo (6.9", 6.5", opcionalmente 5.5" + iPad si aplica). **Ninguno de estos tamaños tiene ni un placeholder.**

Para generarlas hace falta la app corriendo en un dispositivo/emulador real (o modo responsive a resolución exacta), navegando pantallas representativas: `/feed`, `/escudo` (el "wedge" del producto, con el emblema 3D `escudo-check.webp` como hero de 88px), `/propiedades`, `/perfil`, `/mensajes`. Requiere una sesión de captura dedicada — producción nueva, no transcripción de assets existentes.

### 6.3 Feature graphic (1024×500, obligatorio Google Play)

**Bloqueante — no existe.** Búsqueda sobre `**/*feature*graphic*` → 0 resultados; nada en el repo tiene esa relación de aspecto (2.048:1).

Lo más cercano reutilizable como **fuente** (no como archivo final) es `public/images/og-default.png` (1376×768, JPEG, "composición abstracta de marca: arcos y círculos azul sobre beige cálido, sin texto"). Su aspecto es 16:9 (1.778:1), más angosto que el 2.048:1 requerido — recortarlo implica perder contenido vertical y probablemente reescalar/regenerar en mayor resolución nativa para no salir pixelado. Alternativa: usar el pipeline de Meshy/nanobanana (`docs/MESHY-MCP-SETUP.md`) para generar un feature graphic dedicado en la proporción exacta.

### 6.4 Emblemas 3D — solo iconografía in-app, no reusables como marketing sin trabajo adicional

Evidencia de `public/brand/MANIFEST.json`: son WebP de 256×256 (Meshy, 7.3-10.7 KB c/u), comprimidos deliberadamente para datos móviles/gama baja. Sus superficies de uso son todas micro (88px hero en `/escudo`, 40px en avisos, 72px en verification-card, 32px en badges) — **nunca a tamaño grande en ningún punto del producto**. El equipo ya evaluó y descartó un escudo 3D de marca como ícono grande porque "el escudo inclinado achica las letras hasta volverlas una mancha" a 48px.

Para un feature graphic o screenshot promocional, los WebP de 256×256 servirían solo como elemento decorativo secundario, nunca como protagonista de una pieza 1024×500. Los renders alpha originales sin comprimir (`assets-source/emblems/alpha/*.png`, 512×512) podrían re-exportarse en mayor resolución si hiciera falta un asset de mayor calidad — cuesta créditos Meshy (balance actual 1755).

**Dato para la planilla:** si se decide usar un emblema como elemento visual de marketing, el candidato natural es `escudo-check.webp` — pieza central del wedge anti-estafa, "único visual sobre el pliegue" en `/escudo`.

### 6.5 Colores de marca por tenant y logo

| Tenant | Hex | Dominio | logoUrl (demo) |
|---|---|---|---|
| dominicanos (default) | `#1A5EDB` | dominicanos.com | `null` |
| comunidadlatina | `#C2410C` | comunidadlatina.com | `null` |

El esquema sí soporta logo por tenant, pero en los dos tenants demo el campo está vacío — no hay ningún archivo de logo específico de tenant en el repo, solo el logo genérico:
- `public/brand/brand-mark.svg` (128×128, escudo + monograma "CL") — usa `fill="currentColor"` en teoría retinteable, pero el manifest marca esto explícitamente como **código muerto**: "`<BrandMark>` NO SE USA EN NINGÚN LADO".
- `public/brand/favicon.svg` (394 B) — favicon fijo, no retinteable.

`docs/investigacion/13-diseno-ux-premium.md:87-88,710` confirma la intención de producto: el tenant admin sube "1 hex de marca · logo · nombre", y ese logo se usa "solo en el logo, nunca reemplaza los íconos funcionales del sistema" — el ícono de instalación/tienda permanece con el monograma genérico azul.

**Tipografía de marca:** `Plus Jakarta Sans` para UI/body, explícitamente no Inter/Roboto/Arial — dato a tener en cuenta si se diseña el feature graphic o screenshots con overlays de texto.

**Bloqueante condicional (mismo que en §6.1):** si la estrategia es "una app en la tienda por dominio/tenant" en vez de una sola app insignia, faltan logo real, ícono, y assets de tienda por tenant — ninguno existe hoy para ningún tenant.

### 6.6 Resumen de gaps de assets

| Asset | Estado |
|---|---|
| Ícono 512×512 Android (any) | Existe |
| Ícono maskable Android (manifest-level) | Existe, correcto |
| Ícono adaptativo Android nativo (foreground/background XML, si NO es TWA) | No existe |
| Ícono 1024×1024 App Store Connect (sin alpha) | **No existe** |
| Ícono iOS 180×180 (launcher) | Existe |
| Screenshots de teléfono (Google Play) | **No existen** |
| Screenshots iPhone 6.9"/6.5"/5.5" (App Store) | **No existen** |
| Screenshots tablet/iPad | **No existen** |
| Feature graphic 1024×500 (Google Play) | **No existe** (fuente parcial reutilizable, aspecto incorrecto) |
| Video promocional | No existe (opcional en ambas tiendas) |
| Ícono/branding por tenant (si apps separadas) | No existe para ningún tenant |
| Estrategia de empaquetado nativo (TWA/Bubblewrap vs Capacitor) | No decidida (ver §10) |

### Bloqueantes de esta sección
- Ícono 1024×1024 sin alfa para App Store Connect — no existe, es trivial de generar desde el SVG fuente.
- 100% de los screenshots de ambas tiendas — no existe ni un placeholder; requiere sesión de captura dedicada.
- Feature graphic 1024×500 de Google Play — no existe.
- Ícono/branding por tenant — solo existe un juego genérico azul, no diferenciado por color de marca.
- Estrategia de empaquetado nativo sin decidir (raíz de varios de los anteriores, ver §10).

---

## 7. Autenticación, roles y cuentas para revisores

### 7.1 Registro (`/registro`)

Campos pedidos y **ningún otro** (`src/app/(auth)/actions.ts:36-48`): `displayName` (2-60 car.), `email` (zod `z.email()`), `password` (8-72 car.). Explícitamente no se pide teléfono ni dirección — decisión de producto documentada en el propio copy.

Mecánica server-side (`registerAction`, `actions.ts:61-152`):
1. Rate limit 5 registros/hora por IP.
2. Se resuelve el tenant activo.
3. Se crea el usuario con admin client, `email_confirm: true` — **hoy NO hay verificación de email por correo** (comentario explícito: "en dev no hay verificación por email (Resend degradado)").
4. `app_metadata` fijado server-side: `{ tenant_id, role: "member" }` — todo registro público entra siempre como `member`.
5. Login inmediato desde el servidor — no hay paso intermedio de "revisá tu correo".

**Dato para la planilla:** el registro no pide teléfono → simplifica la sección "Datos personales" de las planillas de privacidad. **Dato para la planilla:** no hay verificación de email por correo en el alta — si Apple/Google preguntan cómo se verifica la identidad al registrarse, la respuesta hoy es "no se verifica, el email queda auto-confirmado".

### 7.2 Onboarding "Recién Llegado" (`/bienvenida`)

5 pasos (`onboarding-wizard.tsx`): país de origen → necesidades (a `profiles_private.needs`) → registro embebido (se saltea si ya hay sesión) → zona/barrio (texto libre, nunca dirección exacta) → celebración + redirect. Escape route siempre visible: "Explorar sin cuenta" → `/propiedades`; el guardado de onboarding no bloquea el aterrizaje si falla.

### 7.3 Login (`/entrar`)

Dos tabs: **con contraseña** (`signInWithPassword`, client-side directo, sin rate-limit propio de la app) y **magic link** (`signInWithOtp` → `/callback`, canjea PKCE, sanea `next` anti open-redirect). Si ya hay sesión, `/entrar` y `/registro` redirigen automáticamente.

**No existe flujo de "olvidé mi contraseña"/reset de password** en el código. La única vía alternativa sin contraseña es el magic link (requiere acceso al buzón real).

### 7.4 Roles existentes y qué ve cada uno

Fuente de verdad: siempre el JWT (`user.app_metadata.role`), nunca `profiles.role` (columna informativa/UI).

| Rol | Rango | Qué ve/hace |
|---|---|---|
| `member` | — | Toda la app pública/social: feed, propiedades, negocios, profesionales, eventos, mensajes, perfil, escudo, publicar. Cero acceso a `/admin/*`. |
| `moderator` | 1 | Solo `/admin/moderacion`: cola de moderación con score IA. |
| `domain_admin` | 2 | Moderación + `/admin/dominio`: stats del dominio, aprobaciones, reportes. En el seed: `carlos@demo.comunidadlatina.com`, tenant `dominicanos`. |
| `global_admin` | 3 | Los tres paneles, incluyendo `/admin/global`: crear tenants nuevos, broadcast global. En el seed: `geovanny@demo.comunidadlatina.com`. |

**Recomendación de cuenta para revisores:** dar una cuenta `member` pura para revisar la app pública (Google Play/App Store no necesitan ver el panel admin). Si hace falta mostrar también el panel de administración, usar la cuenta `domain_admin` (`carlos@...`) es más seguro que dar la cuenta `global_admin` de Geovanny, que puede crear tenants nuevos y mandar broadcasts globales — superficie de "power user" innecesaria y riesgosa para un tercero.

### 7.5 Estado de las cuentas demo

| Email | Rol | Tenant | Notas |
|---|---|---|---|
| `maria@demo.comunidadlatina.com` | `member` | `dominicanos` | Trust score 35, 1 listing propio para demostrar edición de aviso |
| `carlos@demo.comunidadlatina.com` | `domain_admin` | `dominicanos` | Trust score 82 |
| `geovanny@demo.comunidadlatina.com` | `global_admin` | `comunidadlatina` | Trust score 90 |

**Password:** NO vive en el repo. La vieja password (`Demo123!demo`) estaba comiteada y fue rotada tras detectar que exponía el panel `global_admin` a cualquiera con la URL. Hoy `scripts/seed.mjs:41-55` exige `SEED_DEMO_PASSWORD` (mín. 12 caracteres) vía variable de entorno y **aborta el seed sin ella** — sin fallback hardcodeado. La password real vive en `.env.local` (fuera de git) y/o en las envs del deploy Vercel.

**Bloqueante:** para completar las planillas de acceso de revisor hace falta ir a buscar el valor actual de `SEED_DEMO_PASSWORD` (o generar una nueva rotación) en el entorno donde corrió el seed contra la base de producción (`ktmbtpuhqqofdkisqseq`) — esto es trabajo humano fuera del alcance de este análisis. **Recomendación:** rotar de nuevo antes de dar cualquiera de estas 3 cuentas a un revisor externo, y considerar credenciales dedicadas solo para revisores (revocables sin tocar las cuentas demo internas).

### 7.6 Riesgo de rate-limit durante la revisión

Dos limitadores distintos:
- **Registro** (`registro:<ip>`, 5/hora, in-memory por instancia): no afecta el login de cuentas demo ya provistas, solo afecta crear cuentas nuevas. Suficiente para una prueba manual normal; podría toparse si el QA de la tienda hace retries automáticos repetidos.
- **Login:** no hay rate-limit propio de la app — se delega 100% al rate-limiting nativo de Supabase Auth (por IP + email, a nivel de todo el proyecto, no reseteable desde este código). Si se dispara durante pruebas repetidas de login con contraseña incorrecta, el bloqueo lo pone Supabase, no la app, y hay que ir al dashboard de Supabase Auth para desbloquear.

**Recomendación:** documentar en las review notes que no se debe reintentar login fallido más de un puñado de veces seguidas, y tener a mano acceso al Supabase Dashboard del proyecto durante la ventana de revisión.

### 7.7 Texto sugerido para "App access instructions" (Google Play) / "Sign-In information" (App Store Connect)

```
Esta app requiere cuenta para acceder a las funciones sociales (feed, mensajes,
publicar avisos, verificador anti-estafa). Proveemos una cuenta de prueba ya
creada — no hace falta registrarse para revisar la funcionalidad principal:

  Email:    maria@demo.comunidadlatina.com
  Password: <rotar antes de enviar — ver nota interna>
  Rol: usuario estándar (member) — NO tiene acceso a paneles de administración.

Si además necesitan revisar el panel de moderación/administración (ruta
/admin, accesible solo a roles de staff), usar en su lugar:

  Email:    carlos@demo.comunidadlatina.com
  Password: <misma rotación>
  Rol: domain_admin — ve moderación y estadísticas de un dominio/comunidad.

NO es necesario usar la cuenta global_admin (geovanny@demo.comunidadlatina.com)
para la revisión estándar; esa cuenta puede crear nuevas comunidades (tenants)
y no aporta nada a la evaluación de la experiencia de usuario final.

Alternativamente, el equipo de revisión puede crear su propia cuenta desde
"Sumate a tu comunidad" en la pantalla de login — el registro solo pide
nombre, email y contraseña (sin teléfono), con acceso inmediato tras
completar el formulario (no requiere confirmar un email).

Nota: si el login falla repetidamente con "demasiados intentos", esperar
unos minutos antes de reintentar — hay un límite de frecuencia de seguridad.
```

**Bloqueantes a resolver antes de la versión final de este texto:**
1. Rotar `SEED_DEMO_PASSWORD` y decidir si se reutiliza para `maria`/`carlos` o se generan credenciales dedicadas para revisores.
2. Confirmar contra qué dominio/URL de producción entra el reviewer y que resuelve al tenant correcto sin el parámetro `?t=` (que solo existe en dev).
3. Ya existe `DeleteAccount`/`deleteAccountAction` para cumplir el requisito de eliminación de cuenta de Apple/Google — dar de alta con una cuenta de prueba dedicada al reviewer (no `maria`/`carlos` persistentes) para que puedan ejercer ese flujo sin destruirlas.

### Bloqueantes de esta sección
- La password real de las cuentas demo no está en el repo (correctamente) y hay que recuperarla/rotarla desde `.env.local` o las envs de Vercel antes de completar los formularios.
- Decidir qué cuenta se entrega a cada tienda — recomendación firme: `member` como cuenta principal, `domain_admin` solo si se quiere mostrar el panel admin, nunca `global_admin` para revisores externos.
- Riesgo a documentar (no bloqueante): el rate-limit nativo de Supabase Auth sobre login/OTP no es configurable desde este código.
- Menor: no hay flujo de "olvidé mi contraseña" en la UI; si el reviewer pierde el acceso, solo queda el magic link.

---

## 8. Legal y páginas requeridas

### 8.1 Política de privacidad — NO EXISTE (bloqueante crítico)

No hay ninguna ruta, página, ni archivo estático de política de privacidad en todo el repo — verificado en `src/app` (todos los route groups), en `public/`, y en el propio footer público: `src/components/marketing/copy.ts:122` define `legalPlaceholders: ["Términos de uso", "Privacidad", "Normas de la comunidad"]`, y `src/app/(marketing)/layout.tsx:112-124` renderiza esos labels como **texto plano sin `href`**, cada uno con un `<Badge>{COPY.footer.soon}</Badge>` ("Pronto"). El equipo ya diseñó dónde va a vivir, y lo marcó explícitamente como "todavía no".

**Bloqueante:** tanto Google Play Console como App Store Connect piden una URL pública de política de privacidad como campo **obligatorio** del formulario — sin esa URL no se puede ni completar la ficha, mucho menos enviar a revisión.

Dado que la app maneja datos de una población perseguible (inmigrantes, posible estatus migratorio irregular), `docs/PLAN_MAESTRO.md:263` (§11.3) ya señala la exigencia de "minimización agresiva de datos, verificación fuera de la DB, Política de Solicitudes de Autoridades" — la política de privacidad no puede ser un template genérico, tiene que reflejar honestamente qué datos se recolectan (incluida cualquier verificación con Stripe Identity, OpenAI moderation, Sentry) y bajo qué circunstancias se entregarían a una autoridad. Insumo directo: §4 completo de este documento.

### 8.2 Términos de servicio — NO EXISTE

Mismo hallazgo que privacidad: solo placeholder ("Términos de uso"), sin ruta ni contenido. `docs/PLAN_MAESTRO.md:267` (§11.7) ya anticipa la necesidad de "un solo ToS/Privacy maestro; Domain Admin Agreement (indemnización, revocación)" — el plan reconoce la necesidad, no está escrito ni publicado.

**Bloqueante parcial:** App Store Connect no siempre exige ToS como campo obligatorio de metadata, pero con Stripe Checkout integrado (cuentas/suscripciones/pagos), Apple pide un EULA/ToS accesible. Google Play no lo exige como campo obligatorio de la consola, pero sin ToS la app queda expuesta legalmente.

### 8.3 Página de soporte/contacto — NO EXISTE como página

No hay ninguna ruta `/soporte`, `/contacto`, `/ayuda`, `/faq`. Lo único parecido es el remitente de emails transaccionales: `src/lib/email/index.ts:22` → `"Comunidad Latina <hola@comunidadlatina.com>"` — dirección "de envío", no necesariamente monitoreada para soporte, y no expuesta en ninguna página como "contactanos". Los "contact CTA" que existen en el código (`contact-cta.tsx`, `directory-contact-cta.tsx`, `message-cta.tsx`) son botones para contactar a un vendedor/profesional dentro del producto, no un canal de soporte al usuario de la plataforma.

**Bloqueante:** Google Play exige una URL de soporte (o email) en la ficha. `hola@comunidadlatina.com` podría usarse como email de soporte si Geovanny confirma que ese buzón se monitorea — es la salida más rápida sin construir nada nuevo, pero requiere confirmación explícita (¿o hace falta uno dedicado tipo `soporte@`?).

### 8.4 Patrón de copy legal ya establecido — aplica directo al copy de tienda

Patrón documentado como "§11 del plan", copy "EXACTO — no editar" (`src/components/trust/verification-card.tsx`):
- Nunca "verificado" a secas — siempre un **descriptor literal** del registro oficial consultado (ej. "Licencia activa según el Registro de Notarios Públicos — NY Department of State al [fecha]").
- Siempre con **fecha exacta de consulta**.
- Disclaimer fijo obligatorio: *"Esto NO garantiza conducta — nunca envíes dinero por adelantado."*
- Mismo patrón repetido en el footer público y en el hero de la home.
- Razón legal de fondo (`docs/PLAN_MAESTRO.md:262`, §11.2): un badge de aval o lenguaje de "confianza"/"seguridad" crea un deber de cuidado y saca a la plataforma de la protección de Sección 230 (caso *Roommates.com*), exponiendo a *negligent misrepresentation*.

**Implicación directa:** la descripción pública en Google Play/App Store debe seguir la misma disciplina — nunca "vivienda 100% verificada", "comunidad segura" o "sin estafas garantizado" sin matiz. Las frases de `hero.trustSignals` (`copy.ts:28-32`) ya pasaron el filtro legal interno y son buen punto de partida (ver también §2.1).

### 8.5 Riesgos legales que afectan el copy de la ficha de tienda

**a) Marca registrada "Comunidad Latina" — desarrollo completo en §2.4.** Implicación de copy: si se publica bajo ese nombre y luego se pierde la marca, hay que estar preparado para un rebrand forzado de nombre/ícono/screenshots/developer name en plena vida de la app.

**b) Veto al "Asistente de Trámites" (I-130/I-765/TPS/DACA) por UPL (bloqueante de copy).** `docs/PLAN_MAESTRO.md:111,262` y `docs/PROGRESS.md:194`: el Asistente de Trámites específico de inmigración está **vetado hasta revisión de un abogado de inmigración**, citando *FTC v. DoNotPay* como precedente de riesgo (unauthorized practice of law). A fecha de hoy sigue vetado, no construido. Lo que SÍ existe y está permitido: el **Asistente Comunitario genérico** (RAG con guardrails, "nunca genera plazos, montos ni interpretación de elegibilidad") y las **Guías** (`/guias`) de trámites generales con fuentes citadas.

**Implicación directa:** si la ficha de tienda menciona "asistente para tu I-130", "ayuda con tu TPS/DACA", "trámites de inmigración paso a paso" de forma que suene a asesoría legal automatizada, dispara exactamente el riesgo de UPL que el plan ya vetó a nivel de producto. La descripción debe restringirse a lo que el producto realmente hace: guías informativas con fuentes oficiales citadas + derivación a "hablá con un abogado verificado", nunca "te ayudamos con tu trámite de inmigración" como promesa de asesoría.

**Bloqueante:** antes de escribir la descripción final de la ficha, esa descripción debería pasar por la misma revisión legal que el plan exige para el producto (§11), específicamente para evitar lenguaje de aval y lenguaje de asesoría migratoria automatizada.

### Bloqueantes de esta sección
- Política de privacidad publicada en URL — no existe (solo placeholder "Pronto"). **Bloqueante crítico: sin esto no se puede enviar a ninguna tienda.**
- Términos de servicio publicados — no existe. Bloqueante para Apple si hay pagos/cuentas; riesgo legal general.
- Página/URL de soporte — no existe; solo `hola@comunidadlatina.com` sin confirmar como monitoreado. Bloqueante para Google Play.
- Marca "Comunidad Latina" venciendo octubre 2026 sin resolver — afecta el nombre público en ambas fichas (ver §2.4).
- Asistente de Trámites (UPL) vetado — no se puede describir en la ficha como asesoría de inmigración.

---

## 9. Estado de deploy, infraestructura y bloqueantes de negocio

### 9.1 Gates humanos pendientes — priorizados y clasificados

| # | Gate | ¿Bloquea tiendas? | ¿Bloquea usuarios reales en web? |
|---|---|---|---|
| 1 | Pentest + firma de ingeniero senior sobre RLS multi-tenant y webhook Stripe | Indirectamente — ninguna tienda certifica seguridad, pero Play/Apple piden **declarar** que los datos están protegidos; publicar sin este gate es enviar la ficha con una afirmación no validada | Sí, absoluto — impide cargar el primer dato real |
| 2 | Credenciales reales Stripe (pagos + Identity) | No bloquea el submit; si se publica con Stripe en modo test/apagado, hay que decidir qué declarar en Data Safety | Sí — sin esto no hay cobro ni verificación real |
| 3 | Credenciales reales Resend (email) | El email de confirmación es parte del flujo que un reviewer puede probar en vivo — si nunca llega, puede rechazar la build | Sí, para confirmación de cuenta real |
| 4 | Credenciales reales Google Vision (moderación de imágenes) | Indirecto: hoy todo listing con foto nace `pending_review` porque Vision no está configurado; un reviewer que suba una foto y no vea nada publicarse puede interpretarlo como bug | Sí, moderación real de fotos |
| 5 | Credenciales reales Sentry | No bloquea directamente, pero sin observabilidad un crash reportado por un reviewer no deja rastro para debuggear rápido | Sí, exigido por el propio plan maestro |
| 6 | Revisión legal del copy del verificador (Escudo) | Podría bloquear — Apple rechaza específicamente apps con claims de seguridad/verificación no sustanciados | No es la razón primaria en web, pero conviene resuelto antes de exponerlo a público externo |
| 7 | Dominio y DNS de producción | **Bloqueante directo para tienda** (ver §9.2) | No estrictamente — la demo ya corre en `.vercel.app` |
| 8 | Hardening de buckets de Storage + Leaked Password Protection (1 click c/u) | No bloquea el submit, pero es señal de madurez de seguridad; barato de cerrar ya | Va en el mismo pase que pentest/firma senior |
| 9 | Moderación de UGC operativa en producción (moderadores reales asignados) | Bloqueante real para Google Play — exige mecanismo funcionando en producción, no solo en código | Ídem |

**Orden de prioridad real para destrabar tiendas:** 7 (dominio) → 1 (pentest/firma) → 6 (copy legal) → 9 (moderación UGC operativa) → 2/3/4/5 (credenciales).

### 9.2 Vercel: estado real, plan y necesidad de dominio propio

- Proyecto `comunidad-latina` (team `manuels-projects-66819a23`), URL pública `https://comunidad-latina-taupe.vercel.app` (`comunidad-latina.vercel.app` a secas ya estaba tomado por otra cuenta).
- **`ssoProtection` desactivado a propósito** para que el cliente pudiera abrir la demo sin login de Vercel — hoy la demo es 100% pública, apuntando a la base de datos REAL (`ktmbtpuhqqofdkisqseq`), con advertencia explícita de no cargar datos de personas reales. Bloqueante de negocio (no de tienda): decidir cuándo re-cerrar esto o migrar a dominio real antes de tráfico masivo.
- **El proyecto Vercel NO tiene conexión con el repo de Git**: un `git push` no dispara build, todo deploy es manual vía `vercel deploy --prod`. Riesgo silencioso: si se asume CI/CD automático al preparar el build final para las tiendas, se puede terminar apuntando a una versión vieja.
- **Plan actual:** sin evidencia de que ya se contrató Vercel Pro — listado como pendiente de decisión de Geovanny (`docs/SETUP-ENV.md:30`, `docs/PLAN_MAESTRO.md:358`). El plan Hobby **prohíbe explícitamente uso comercial** y topa en 50 dominios — con dominios propios de por medio, Pro es obligatorio antes de producción real, tienda o no (~$20/mes).
- **¿Hace falta dominio propio antes de publicar en tiendas? SÍ, bloqueante directo.** Google Play pide sitio web (recomendado, usado para verificar Data Safety) y obligatoriamente URL de Privacy Policy; Apple exige URL de Privacy Policy (obligatorio) y opcionalmente Marketing/Support URL — ambos deben verse como producto real, no un preview de Vercel. Además, `robots.ts` del proyecto pone `Disallow: /` en cualquier host que no sea dominio real — la demo ya está diseñada para no ser indexada/tratada como "real", lo cual choca con presentarla como ficha oficial. **Conclusión:** técnicamente se puede empezar a llenar la planilla con la URL de Vercel, pero antes de enviar a revisión conviene tener al menos el dominio insignia (`comunidadlatina.com`) apuntando al proyecto.

### 9.3 Pendientes adicionales relevantes para "presentabilidad" ante revisor de tienda

- **Bug abierto de hidratación en `/admin/moderacion`** (React #418) — no rompe la función (Aprobar/Rechazar andan), pero un reviewer que vea un error en consola/pantalla puede marcarlo como bug de calidad. Barato de arreglar antes de exponer el admin a un tester externo.
- **`<BrandMark>` es código muerto** — cosmético, sin impacto en tienda, pero conviene decidir (borrar o usar) antes de congelar el build de submit.
- **CSP en modo Report-Only, no enforcing** — no bloquea tienda, pero es parte del mismo paquete de hardening que el pentest.
- **No hay entidad legal documentada para Geovanny** (sin LLC/S.R.L./Inc./D-U-N-S/EIN concreto en `docs/`). **Bloqueante para las cuentas de developer:** Apple Developer Program (cuenta Organization) exige D-U-N-S y verificación legal de la empresa; Google Play Console (cuenta de organización) exige datos fiscales/bancarios reales. Si no está constituida, esto es **semanas de lead time**, no algo resoluble en la sesión de llenar la planilla.

### Bloqueantes de esta sección
- Dominio propio + Vercel Pro no resueltos — bloqueante directo para presentar cualquier ficha con seriedad.
- Entidad legal no confirmada — bloquea la creación misma de las cuentas de developer en ambas tiendas (mayor lead time de toda la lista).
- Pentest/firma senior pendiente — condiciona qué se puede declarar honestamente en Data Safety/App Privacy.
- Moderación de UGC operativa (moderadores humanos reales asignados en producción) sin confirmar.
- Credenciales reales (Stripe, Resend, Vision, Sentry) pendientes de carga.

---

## 10. La brecha crítica: empaquetado nativo para Google Play y App Store

### 10.1 Confirmación: no existe wrapper nativo hoy

Búsqueda exhaustiva sobre el árbol principal (excluyendo `.claude/worktrees/`, copias de trabajo de otros agentes en paralelo):

```
grep -rlE "capacitor|cordova|react-native|expo-|@expo" .          → 0 resultados
grep -rliE "bubblewrap|trusted web activity|\btwa\b" .            → 0 resultados
find . -iname "*.gradle*" / "*.xcodeproj" / "Info.plist" / "AndroidManifest.xml" → 0 resultados
find . -maxdepth 3 -iname "android" -o -iname "ios"                → 0 resultados
grep -rli "app bundle|\.aab\b" .                                    → 0 resultados
find . -ipath "*.well-known*"                                       → 0 resultados (sin assetlinks.json)
```

`package.json` confirma el stack real: Next 16.2.10, `@serwist/next` + `serwist`, React/React-DOM 19, sin ninguna dependencia de Capacitor/Cordova/Expo/React Native. No hay `vercel.json`. Hoy es 100% una PWA servida por Next.js en Vercel — cualquier envío a Google Play o App Store hoy sería rechazado de inmediato: ambas tiendas exigen un binario instalable (.aab/.ipa), no una URL.

### 10.2 Los dos requisitos base de una TWA ya existen — y están bien construidos

Google Play acepta PWAs empaquetadas como **Trusted Web Activity (TWA)**, que solo requiere un Web App Manifest válido y un Service Worker registrado. Ambos ya existen y son correctos (ver también §3.5):
- `src/app/manifest.ts:21-71` — manifest dinámico por tenant, `display: "standalone"` (requisito clave), iconos 192/512/maskable-512.
- `src/app/sw.ts` + `next.config.ts:41-60` — Service Worker real vía Serwist (precache, NetworkFirst para navegaciones, CacheFirst para Supabase Storage, fallback offline). El SW solo se emite con `next build --webpack` — ya resuelto en `package.json`, pero cualquier CI alternativo que use `next build` a secas se lleva una PWA rota sin darse cuenta.

**Dato para la planilla:** como el manifest es dinámico por Host header, cada dominio de tenant genera su propio manifest automáticamente — no hay que mantener manifests separados a mano.

### 10.3 Ruta A — Google Play vía TWA (Bubblewrap/PWABuilder): viabilidad alta, con huecos concretos

1. `npx @bubblewrap/cli init --manifest=https://<dominio-real>/manifest.webmanifest` genera un proyecto Android (Gradle) mínimo que envuelve la URL en una Custom Tabs/TWA.
2. Bubblewrap pide: URL de manifest servida en el **dominio de producción real** (no sostenible contra `*.vercel.app`), un **package name** Android (ej. `com.dominicanos.app`), y genera el **keystore** de firma si no se provee uno.
3. El `.aab` resultante necesita **Digital Asset Links** (`/.well-known/assetlinks.json`) servido desde el dominio real, con el SHA-256 del certificado de firma — si falta o no matchea, Chrome degrada la TWA a una barra de navegador visible, lo cual reprueba la revisión de Play por "minimum functionality"/apariencia de WebView.

**Bloqueante:** no existe hoy `/.well-known/assetlinks.json` ni ruta que lo sirva — trivial de agregar (route handler estática) pero necesita el SHA-256 del keystore, que no existe todavía.

**Bloqueante:** no hay dominio propio apuntando al deploy — Digital Asset Links necesita el dominio de producción real y estable, no un subdominio de Vercel (ver §9.2).

### 10.4 Ruta B — App Store: TWA/WebView desnudo NO pasa la revisión de Apple

Apple aplica la **Guideline 4.2 "Minimum Functionality"**: rechaza apps que son esencialmente un sitio web reempaquetado sin funcionalidad nativa adicional. No existe un equivalente de TWA aceptado por Apple. Dos rutas reales:

- **(a) Capacitor con shell nativo + funcionalidad nativa real**: envolver la PWA en un WebView de Capacitor sumando al menos una capa nativa genuina — push notifications nativas (APNs), biometría para login, deep-linking nativo, compartir nativo, widgets. Esfuerzo real de desarrollo (semanas, no días).
- **(b) Diferir iOS**: entrar primero solo a Google Play (ruta TWA casi mecánica dado que manifest+SW ya existen) y dejar iOS para una fase posterior, evaluando mientras tanto "Add to Home Screen" de Safari (iOS 16.4+ permite instalar con manifest sin pasar por la App Store) como canal de facto.

**Recomendación:** dado el estado actual (0% de trabajo nativo iniciado, foco del negocio en el wedge de vivienda verificada, no en mobile-first), **Ruta B(b)** es la más razonable para la próxima fase: Google Play primero vía TWA, iOS diferido detrás de "Add to Home Screen" + revisitar Capacitor cuando haya funcionalidad nativa real que lo justifique (ej. notificaciones push para alertas de nuevos listings).

### 10.5 Multi-tenant × empaquetado nativo: dimensión del esfuerzo

La arquitectura es un solo motor de código + Host header → tenant (§3.1). Para nativo, la implicación es:
- **Cada tenant/dominio que se quiera publicar necesita SU PROPIO wrapper Android (.aab) separado** — cada TWA está atado a un solo `start_url`/dominio vía Digital Asset Links; no se puede tener una app que sirva dos dominios con branding distinto y pase la verificación.
- Cada wrapper necesita su propio **package name**, su propia ficha de Play Store (nombre, ícono, descripción, capturas — todo per-tenant).
- **Lo que sí es reusable:** el template/proceso de generación (Bubblewrap con casi la misma config por tenant) y el keystore de firma (si se decide firmar todos los wrappers con la misma key, razonable si son del mismo dueño).
- **Conclusión:** NO es "1 wrapper genérico que sirve a todos los tenants" — es "1 template reusable, N wrappers publicados". Con 2 tenants demo activos hoy, esto ya implica 2 fichas de Play Store separadas si ambos se quieren publicar como apps nativas. Esta conclusión es consistente entre el análisis de arquitectura y el análisis de empaquetado nativo — ambos llegan al mismo punto desde ángulos distintos (uno desde la resolución de tenant en código, otro desde los requisitos concretos de Digital Asset Links).

### 10.6 Requisitos técnicos concretos que faltan y quién los provee

| Requisito | Estado hoy | Quién lo provee |
|---|---|---|
| Dominio propio con HTTPS válido | **Bloqueante** — no apuntado, hoy corre en `*.vercel.app` | Geovanny (compra/DNS) + config en Vercel |
| `/.well-known/assetlinks.json` | **Bloqueante** — no existe | Generarlo una vez exista dominio + keystore (trivial) |
| Keystore de firma Android | **Bloqueante** — no generado | `keytool` o vía Bubblewrap `init`; guardarlo con máximo cuidado (perderlo = no poder actualizar la app nunca más) |
| Cuenta de desarrollador Google Play | **Bloqueante** — sin confirmar | Geovanny, pago único $25 USD |
| Cuenta Apple Developer Program | **Bloqueante** (si se va a iOS) — sin confirmar | Geovanny, $99 USD/año |
| Proyecto Android (Gradle) generado por Bubblewrap | **Bloqueante** — no existe | Se genera en la próxima sesión apuntando al dominio real |
| Shell Capacitor + feature nativa (si iOS) | **Bloqueante**, no iniciado | Desarrollo nuevo, semanas de esfuerzo |
| Manifest dinámico por tenant | Ya existe y es correcto | — |
| Service Worker (Serwist) | Ya existe y es correcto | — |

### 10.7 Recomendación de secuencia para la próxima sesión

1. **Resolver el dominio real primero** (decisión de negocio de Geovanny, no técnica): apuntar `dominicanos.com` (u otro dominio elegido) al proyecto Vercel.
2. Con el dominio real sirviendo HTTPS: correr `npx @bubblewrap/cli init --manifest=https://<dominio>/manifest.webmanifest`, generar el keystore, anotar el SHA-256, agregar `public/.well-known/assetlinks.json`.
3. Verificar con la herramienta oficial de Google (Digital Asset Links generator) que el asset link resuelve antes de subir el `.aab`.
4. Recién ahí, evaluar iOS como fase posterior (Ruta B).

**No correr Bubblewrap todavía contra `*.vercel.app`** — no es estable para Digital Asset Links a largo plazo y generaría trabajo descartable.

### Bloqueantes de esta sección
- **Decidir el modelo de empaquetado** — N apps por tenant/dominio vs. 1 app con selector (feature nueva, no existe hoy) vs. descartar tiendas nativas — la decisión raíz de la que cuelgan casi todos los demás bloqueantes de este documento.
- Generar assets de marca por tenant (íconos, feature graphic, screenshots) — hoy genéricos y compartidos (desarrollado en §6).
- Arreglar la resolución de dominio hardcodeada antes de sumar tenants reales (desarrollado en §3.2).
- Dominio propio + keystore + Digital Asset Links — ninguno existe hoy, son prerrequisito técnico duro de la Ruta A.
- Revisar `Permissions-Policy`/CSP si cualquier feature nativa (KYC con cámara, geolocalización) entra al roadmap.
- El plan maestro vigente (v1-v4) fue explícito en que apps nativas eran "Fase 2+ fuera de alcance" — publicar en tiendas es un pivot de producto que requiere decisión explícita nueva de Geovanny, no solo una tarea de packaging.

---

## 11. Checklist accionable para la próxima sesión

### (a) Lo que se puede hacer YA con lo que existe (no depende de nadie externo)

1. **Redactar y publicar las páginas de Política de Privacidad y Términos de Servicio.** El contenido puede escribirse ya con lo que se sabe del producto (qué se recolecta y cómo se protege — usar §4 y §8 de este documento + `docs/investigacion/power-up/11-legal-compliance-riesgo.md` como base). No depende de credenciales ni de Geovanny, solo de tiempo de escritura + revisión legal ligera. Es el bloqueante más crítico y el más barato de resolver.
2. **Arreglar el bug de hidratación de `/admin/moderacion`** (React #418) — ya diagnosticado con hipótesis concreta en `docs/PROGRESS.md`.
3. **Agregar manejo específico del caso RESTRICT en `deleteAccountAction`** — mostrar "cancelá tu cuenta de negocio primero" en vez del error genérico cuando falla por `business_accounts.owner_id`.
4. **Cerrar el hardening de 1 click** de Storage buckets + Leaked Password Protection — SQL ya listo en `supabase/manual/harden-storage-listing.sql`.
5. **Arreglar la resolución de dominio hardcodeada** (`resolve.ts` + `robots.ts`) para que lea de `tenant_domains` vía la RPC `get_tenant_by_domain` ya existente — destraba escalar a más tenants sin redeploys, independiente de la decisión de empaquetado nativo.
6. **Generar el ícono 1024×1024 sin alfa** para App Store Connect — aplanar el SVG fuente sobre fondo sólido; el generador (`scripts/generate-icons.mjs`) ya existe y es trivial de extender.
7. **Diseñar (al menos especificar/migrar) el esquema de bloqueo global de usuario** — tabla `blocked_users`/`user_blocks` + filtro en `request_contact`/inserción de conversaciones. Requisito duro de ambas tiendas para apps con mensajería 1:1; dejar el diseño listo acelera la próxima sesión aunque no se active todavía.
8. **Planificar y ejecutar la sesión de captura de screenshots reales** de la app en las pantallas candidatas (`/feed`, `/escudo`, `/propiedades`, `/perfil`, `/mensajes`) — la demo ya corre, no requiere nada externo.
9. **Rehacer/regenerar el feature graphic 1024×500** — vía el pipeline Meshy/nanobanana ya documentado, o recortando y reescalando `og-default.png` en mayor resolución nativa.
10. **Empezar a completar los campos de la ficha que no dependen de infraestructura**: descripción (borrador en §2.1), categoría (de `manifest.ts` `categories`), clasificación de contenido/rating (borrador en §5.5).
11. **Decidir y documentar qué cuenta demo se usará como cuenta de revisión** — recomendación firme: `member` (`maria@...`) como principal, `domain_admin` (`carlos@...`) solo si se quiere mostrar el panel admin, nunca `global_admin`.

### (b) Depende de que Manuel/Geovanny resuelvan algo externo (credenciales, dominio, decisiones) — ordenado por prioridad

1. **Decisión de negocio raíz: ¿el plan sigue PWA-only o pivota a empaquetado nativo?** Casi todo el resto de esta lista (y la sección 10 completa) cuelga de esta decisión — hoy no está tomada ni documentada en `docs/PLAN_MAESTRO.md` §16.
2. **Decidir el nombre público de la app para las tiendas** ("Comunidad Latina" vs. "Dominicanos en USA" vs. otro) — tiene implicancia legal directa sobre el specimen de marca USPTO (ver §2.4).
3. **Confirmar/resolver en TSDR el deadline de la marca** (Sección 8 vs. umbral de abandono) — coordinar con el abogado de marca; sigue abierto desde `docs/HANDOFF.md`.
4. **Constituir/confirmar la entidad legal** para las cuentas de developer — Apple Developer Program (Organization) exige D-U-N-S, Google Play Console exige datos fiscales/bancarios reales. Si no está constituida, es la dependencia de **mayor lead time** de toda la lista (semanas).
5. **Comprar/apuntar el dominio propio** (mínimo `comunidadlatina.com`) al proyecto Vercel + **contratar Vercel Pro** (~$20/mes, obligatorio: el plan Hobby prohíbe uso comercial).
6. **Conseguir la firma del ingeniero senior de seguridad** (pentest) sobre RLS multi-tenant y el webhook de Stripe — condiciona qué se puede declarar honestamente en Data Safety/App Privacy, y es el gate que habilita cargar el primer dato real.
7. **Cargar credenciales reales**: Stripe (test→live), Resend, Google Vision, Sentry — depende de que Geovanny cree/autorice esas cuentas (`docs/SETUP-ENV.md` Paso 2).
8. **Conseguir revisión legal del copy del verificador del Escudo** (abogado) — Apple rechaza específicamente claims de seguridad/verificación no sustanciados.
9. **Rotar/generar la password dedicada de las cuentas demo para revisores** — recuperar `SEED_DEMO_PASSWORD` del entorno de producción o generar una nueva rotación; considerar credenciales dedicadas solo para revisores.
10. **Confirmar si `hola@comunidadlatina.com` está monitoreado como soporte**, o decidir/crear una dirección dedicada (ej. `soporte@`).
11. **Definir el rango de edad objetivo del producto** — falta en los documentos rectores, necesario para la clasificación de contenido de ambas tiendas.
12. **Asignar moderadores humanos reales operativos** en `/admin/moderacion` antes del submit — Google Play exige el mecanismo funcionando en producción, no solo en código.
13. **Si la decisión #1 es ir a nativo:** generar el keystore Android, comprar las cuentas de developer (Google Play $25 USD único, Apple $99 USD/año), y decidir el modelo N-apps-por-tenant vs. selector-in-app (ver §10.5).

---

## 12. Fuentes

Documentos de estrategia y estado:
- `docs/PLAN_MAESTRO.md` (V4, canon)
- `docs/versiones/PLAN_MAESTRO_v1.md`, `docs/versiones/PLAN_MAESTRO_v2.md`
- `docs/PROGRESS.md`
- `docs/HANDOFF.md`
- `docs/ARQUITECTURA.md`
- `docs/SETUP-ENV.md`
- `docs/MESHY-MCP-SETUP.md`
- `docs/investigacion/03-benchmark-sngine-competidores.md`
- `docs/investigacion/13-diseno-ux-premium.md`
- `docs/investigacion/power-up/12-go-to-market-lanzamiento.md`
- `docs/investigacion/power-up/11-legal-compliance-riesgo.md`
- `README.md`
- `.env.example`

Rutas de la app (`src/app`):
- `(auth)/actions.ts`, `(auth)/entrar/page.tsx`, `(auth)/registro/page.tsx`, `(auth)/registro/registro-client.tsx`, `(auth)/callback/route.ts`, `(auth)/layout.tsx`
- `(app)/feed/actions.ts`, `(app)/feed/queries.ts`
- `(app)/mensajes/actions.ts`
- `(app)/publicar/actions.ts`
- `(app)/perfil/actions.ts`, `(app)/perfil/verificar/actions.ts`
- `(app)/impulsar/[listingId]/actions.ts`
- `(app)/negocios/presencia/actions.ts`
- `(marketing)/layout.tsx`
- `admin/moderacion/page.tsx`, `admin/moderacion/actions.ts`, `admin/guard.ts`, `admin/layout.tsx`
- `manifest.ts`, `apple-icon.png`, `favicon.ico`, `sw.ts`, `robots.ts`
- `src/middleware.ts` (renombrado `proxy.ts` en versiones nuevas de Next, mismo contenido)

Componentes (`src/components`):
- `auth/login-form.tsx`, `auth/register-form.tsx`, `auth/delete-account.tsx`
- `onboarding/onboarding-wizard.tsx`
- `admin/admin-nav.tsx`
- `trust/report-scam-button.tsx`, `trust/verification-card.tsx`
- `marketing/copy.ts`

Librerías (`src/lib`):
- `tenant/resolve.ts`, `tenant/match.ts`, `tenant/guard.ts`, `tenant/brand-pipeline.ts`
- `moderation/index.ts`
- `config/services.ts`
- `email/index.ts`
- `rag/index.ts`
- `rate-limit/index.ts`
- `stripe/index.ts`
- `sentry.scrub.ts`

Migraciones de Supabase (`supabase/migrations`):
- `0003_profiles_trust.sql`, `0004_listings.sql`, `0005_escudo.sql`, `0006_messaging.sql`, `0007_social.sql`, `0008_monetization.sql`, `0009_moderation.sql`, `0011_notifications_audit.sql`, `0013_cron_ttl.sql`, `0014_rpcs.sql`, `0015_account_deletion_fk.sql`, `0016_boosts.sql`, `0017_rag_assistant.sql`
- `supabase/manual/harden-storage-listing.sql`

Scripts y configuración:
- `scripts/seed.mjs`, `scripts/generate-icons.mjs`
- `next.config.ts`, `package.json`, `.vercel/project.json`

Assets:
- `public/brand/MANIFEST.json`, `public/brand/brand-mark.svg`, `public/brand/favicon.svg`, `public/brand/emblems/*.webp`
- `public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png`
- `public/images/MANIFEST.json`, `public/images/*.{png,webp}`
- `assets-source/emblems/{alpha/*.png,generate.mjs,process.mjs,prompts.mjs}`
- `assets-source/brand-raster/*.png`
