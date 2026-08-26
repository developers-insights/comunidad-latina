# ARQUITECTURA — Contrato vinculante para el enjambre

> Este documento es el contrato técnico que TODO agente debe cumplir al escribir código en este repo.
> Si contradice al `PLAN_MAESTRO.md`, gana el Plan Maestro. Si un agente necesita desviarse, lo documenta en su entrega.
> Fecha: 2026-07-06 · Estado: CANON

## 1. Stack (fijo, no sugerir alternativas)

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router, `src/`, alias `@/*`) + TypeScript estricto |
| Estilos | Tailwind CSS v4 (tokens en `globals.css` vía `@theme`) |
| DB/Auth/Storage/Realtime | Supabase (proyecto `ktmbtpuhqqofdkisqseq`, Postgres 17) — cliente `@supabase/ssr` + `@supabase/supabase-js` |
| Pagos | Stripe (degradado hoy — ver §7) |
| Iconos | `@phosphor-icons/react` (peso Regular/Light; Fill solo estado activo). PROHIBIDO emoji como ícono funcional |
| Motion | `motion` (framer-motion v12) + CSS transitions con los motion tokens |
| PWA | `@serwist/next` (service worker en `src/app/sw.ts`) |
| Email | Resend (degradado hoy) |
| Moderación | OpenAI omni-moderation, **solo texto** (activo) + Google Vision, imagen (degradado) |
| Asistente Comunitario (RAG) | **Anthropic (Claude)** — no OpenAI |
| Content Integrity | SHA-256 + huella perceptual en `bit(N)` con índice HNSW `bit_hamming_ops` (pgvector 0.8.2) |
| Tests | Vitest + Testing Library |
| Variantes de componentes | `class-variance-authority` + `clsx` + `tailwind-merge` (helper `cn()` en `src/lib/utils.ts`) |
| Color science (brand pipeline) | `culori` |

## 2. Estructura de carpetas (ownership del enjambre)

> **Regenerada desde el árbol real el 2026-08-13.** La versión anterior listaba 8 rutas
> en `(app)/`, 6 carpetas en `components/` y 7 en `lib/`; el repo tenía 25, 33 y 36.
> Además ubicaba `supabase/migrations/` y `scripts/` DENTRO de `src/`, cuando están en
> la raíz. Eso no era un detalle cosmético: la regla de ownership del final de esta
> sección es lo que evita que dos agentes escriban el mismo archivo en un despacho
> paralelo, y una carpeta que no figura acá no tiene dueño que la proteja.
>
> **`SIN DUEÑO — asignar` es una entrada honesta, no un hueco.** Marca las carpetas
> cuyo dueño no se pudo inferir del contenido ni de los dueños ya declarados. Una
> atribución inventada es peor que un `SIN DUEÑO` visible: la primera hace que dos
> agentes se pisen creyendo que tienen permiso.

### 2.1 Raíz del repo

```
comunidad_latina/
├─ src/                        ← la app (ver 2.2–2.4)
├─ supabase/migrations/        ← SQL numerado (DB — ya aplicado vía MCP, NO tocar sin gate)
├─ scripts/                    ← utilitarios .mjs de operación (INFRA)
│                                new-tenant.mjs · seed*.mjs · apply-migrations.mjs
│                                rls-enumerator.mjs · vercel-env-sync.mjs · generate-icons.mjs
├─ public/                     ← estáticos (PWA). `sw.js` es GENERADO: está en .gitignore
├─ docs/                       ← este contrato + PROGRESS.md + investigación
├─ assets-source/              ← fuentes de los assets (DESIGN)
├─ next.config.ts              ← CSP, headers, imágenes, Serwist (PWA + INFRA)
├─ eslint.config.mjs · vitest.config.ts · tsconfig.json   ← tooling (INFRA)
└─ AGENTS.md · CLAUDE.md       ← instrucciones del enjambre (INFRA)
```

### 2.2 `src/app/`

```
src/
├─ middleware.ts               ← resolución de tenant (tenant_domains) + sesión (INFRA)
├─ instrumentation*.ts         ← Sentry / onRequestError (OBSERVABILIDAD)
├─ app/
│  ├─ layout.tsx · error.tsx · global-error.tsx · not-found.tsx   ← raíz (INFRA)
│  ├─ globals.css              ← TODOS los design tokens (@theme) (DESIGN)
│  ├─ manifest.ts · sw.ts · ~offline/   ← PWA
│  ├─ robots.ts · sitemap.ts   ← indexación; leen tenant_domains (LANDING)
│  ├─ (marketing)/             ← LANDING
│  │  ├─ page.tsx · guias/     ← landing + guías SEO
│  │  └─ legal/                ← términos, privacidad, cookies (LEGAL)
│  ├─ (auth)/                  ← AUTH
│  │  ├─ entrar/ · registro/ · bienvenida/ · recuperar/
│  │  ├─ callback/             ← canjea ?code= (PKCE)
│  │  └─ confirmar/            ← canjea ?token_hash= (lib/auth/confirmation.ts)
│  ├─ (app)/                   ← app autenticada con bottom-nav (shell: INFRA)
│  │  ├─ feed/ · social/ · videos/         ← SOCIAL
│  │  ├─ publicaciones/                    ← "mis publicaciones" + renovación (MONETIZACIÓN)
│  │  ├─ publicar/                         ← alta de aviso, cualquier vertical (DIRECTORIOS)
│  │  ├─ propiedades/                      ← VIVIENDA
│  │  ├─ negocios/ · profesionales/ · eventos/   ← DIRECTORIOS
│  │  ├─ marketplace/                      ← tiendas, productos, membresía (MARKETPLACE)
│  │  ├─ empleos/                          ← EMPLEOS
│  │  ├─ creadores/                        ← CREADORES
│  │  ├─ comunidad/                        ← guías, casos, perdidos (COMUNIDAD)
│  │  ├─ asistente/                        ← ASISTENTE
│  │  ├─ buscar/                           ← BÚSQUEDA
│  │  ├─ mensajes/                         ← contacto protegido (MENSAJES)
│  │  ├─ notificaciones/                   ← NOTIFICACIONES
│  │  ├─ perfil/                           ← perfil propio + [id] público (AUTH)
│  │  ├─ ajustes/                          ← cuenta, privacidad, teléfono, tema (AUTH)
│  │  ├─ verificacion/                     ← check azul pago, 0101 (VERIFICACIÓN)
│  │  ├─ escudo/                           ← verificador + reportes de estafa (ESCUDO)
│  │  ├─ contenido/reclamar/               ← disputas de autoría (INTEGRIDAD)
│  │  ├─ impulsar/ · impulsar-post/        ← boosts y campañas (MONETIZACIÓN)
│  │  └─ reportes/                         ← SIN DUEÑO — asignar (una action suelta;
│  │                                         parece ESCUDO o MODERACIÓN, no está claro)
│  ├─ admin/                   ← ADMIN
│  │  ├─ global/ (incl. dominios/) · dominio/ · moderacion/ · miembros/
│  │  ├─ creadores/ · empleos/ · metricas/
│  │  └─ guard.ts · scope.ts   ← autorización por rol desde el JWT
│  └─ api/
│     ├─ assistant/            ← ASISTENTE (moderación + rate limit + RAG fts)
│     └─ webhooks/stripe/      ← PAGOS
```

### 2.3 `src/components/`

```
├─ components/
│  ├─ ui/            ← primitivos del design system (DESIGN — solo DESIGN escribe acá)
│  ├─ theme/ · motion/ · experience/ · media/   ← tema, animación, transiciones (DESIGN)
│  ├─ shell/         ← BottomNav, Header, module-access (INFRA)
│  ├─ pwa/           ← install prompt, retry (PWA)
│  ├─ auth/          ← formularios de sesión, perfil, identidad (AUTH)
│  ├─ feed/ · social/ ← tarjetas, composer, comentarios (SOCIAL)
│  ├─ listings/      ← VIVIENDA
│  ├─ directory/ · negocios/   ← fichas y horarios de directorios (DIRECTORIOS)
│  ├─ marketplace/   ← MARKETPLACE
│  ├─ empleos/       ← EMPLEOS
│  ├─ creators/      ← CREADORES
│  ├─ comunidad/     ← COMUNIDAD
│  ├─ assistant/     ← ASISTENTE
│  ├─ search/        ← BÚSQUEDA
│  ├─ messaging/     ← MENSAJES
│  ├─ notifications/ ← NOTIFICACIONES
│  ├─ verificacion/  ← check azul (VERIFICACIÓN)
│  ├─ trust/ · escudo/  ← Trust Score, verificador, reportes (ESCUDO)
│  ├─ integrity/     ← declaración de originalidad (INTEGRIDAD)
│  ├─ boosts/        ← MONETIZACIÓN
│  ├─ legal/         ← banner y preferencias de consentimiento (LEGAL)
│  ├─ admin/         ← ADMIN
│  ├─ marketing/     ← LANDING
│  ├─ onboarding/    ← wizard de "Recién Llegado" (AUTH)
│  ├─ resenas/       ← reseñas y estrellas (RESEÑAS)
│  ├─ matching/      ← "Para vos" (MATCHING)
│  └─ time/          ← zona horaria del lector (INFRA)
```

### 2.4 `src/lib/`

```
├─ lib/
│  ├─ supabase/      ← client.ts (browser), server.ts (RSC/actions),
│  │                   admin.ts (service-role, SOLO server), middleware.ts (INFRA)
│  ├─ tenant/        ← resolve.ts · domain-lookup.ts · domain-routing.ts · guard.ts ·
│  │                   match.ts (INFRA) · brand-pipeline.ts (INFRA + DESIGN: la escala
│  │                   tonal WCAG la consume el tema, pero el gate lo corre new-tenant.mjs)
│  ├─ config/services.ts   ← flags de degradación elegante (INFRA)
│  ├─ types/database.types.ts  ← generado desde Supabase (DB — NO editar a mano)
│  ├─ i18n/          ← diccionarios ES/EN, helper t() (i18n, §8)
│  ├─ utils.ts       ← cn(), formatos Intl (INFRA — lo importa medio repo)
│  ├─ auth/ · profile/ · perfil-activo/ · phone/   ← AUTH
│  ├─ social/        ← SOCIAL
│  ├─ listings/ · propiedades/   ← VIVIENDA
│  ├─ horarios/      ← apertura de negocios (DIRECTORIOS)
│  ├─ empleos/ · creators/       ← EMPLEOS · CREADORES
│  ├─ comunidad/     ← COMUNIDAD
│  ├─ rag/           ← recuperación fts del Asistente (ASISTENTE)
│  ├─ moderation/    ← clasificación de contenido y contact-block (MODERACIÓN)
│  ├─ trust/         ← cómputo/formateo de niveles Trust Score (ESCUDO)
│  ├─ integrity/     ← huellas, procedencia, disputas (INTEGRIDAD)
│  ├─ verificacion/  ← check azul: catálogo, lectura, webhook (VERIFICACIÓN)
│  ├─ stripe/ · pricing/ · monetization/ · boosts/   ← PAGOS / MONETIZACIÓN
│  ├─ notifications/ ← NOTIFICACIONES
│  ├─ resenas/       ← RESEÑAS
│  ├─ matching/      ← MATCHING
│  ├─ metrics/       ← métricas del panel (ADMIN)
│  ├─ consent/       ← categorías y gate de cookies (LEGAL)
│  ├─ email/         ← Resend + templates (EMAILS)
│  ├─ media/         ← límites, medición y mezcla de audio/video (SOCIAL + INTEGRIDAD)
│  ├─ time/          ← zona horaria de la comunidad y del lector (INFRA)
│  ├─ rate-limit/ · url/   ← INFRA (seguridad app-layer, §9)
│  ├─ brand.ts       ← SIN DUEÑO — asignar (constante suelta; convive con
│  │                   tenant/brand-pipeline.ts, que sí tiene dueño)
│  └─ design/        ← SIN DUEÑO — asignar (un solo hook, `use-overlay.ts`;
│                      por contenido parece DESIGN, pero DESIGN escribe en
│                      `components/ui/` y esto es lógica)
```

**Regla de ownership:** cada agente escribe SOLO en las carpetas de su módulo (marcadas
arriba). `components/ui/` y `globals.css` son del agente DESIGN; los demás los consumen,
no los editan. `supabase/migrations/` y `lib/types/database.types.ts` no se tocan sin el
gate de DB. Una carpeta marcada `SIN DUEÑO — asignar` se toca previa asignación
explícita, no por default.

## 3. Multi-tenancy (cómo fluye el tenant)

1. **Middleware** (`src/middleware.ts`, async): lee `Host` header → resuelve tenant vía RPC `public.resolve_tenant_domain` contra `public.tenant_domains` (`src/lib/tenant/domain-lookup.ts`, timeout 1,5 s), y la regla pura de `domain-routing.ts` decide entre servir / redirigir 308 al dominio canónico / 404 (desconocido, `suspended`, `archived`) / 503 (base caída y host que ningún respaldo conoce). El caché es un `Map` **a nivel de módulo** —`unstable_cache` no aplica en el proxy, que desde Next 16 corre en runtime Node; el porqué está en el encabezado de `domain-lookup.ts`— con 300 s positiva, 60 s negativa y *stale-on-error* 24 h. `DOMAIN_TENANTS` sobrevive **solo como respaldo** cuando la base no responde: ya no es la fuente de verdad. En dev: query `?cl-tenant=<slug>` o cookie `cl-tenant`, default `dominicanos` — el parámetro se llama igual que la cookie a propósito, porque `?t=` ya es el de las **pestañas** de Perfil, Negocios, Profesionales y Marketplace y hasta el 2026-08-24 las dos cosas se pisaban (abrir `/negocios?t=ofertas` dejaba la app entera vacía, sin errores, por 30 días). Un slug de pista que no existe ya no falla en silencio: el proxy lo verifica contra la base **sólo en local**, sirve una página que explica qué pasó y borra la cookie (`src/lib/tenant/slug-lookup.ts`). Inyecta `x-tenant-slug` + `x-tenant-id` como request headers y refresca la sesión de Supabase (patrón `@supabase/ssr`).
2. **Server Components / actions**: helper `getTenant()` en `lib/tenant/resolve.ts` lee los headers y devuelve `{ id, slug, name, brandHex, theme, modules, locale, currency }`.
3. **Branding**: el root layout llama `getTenant()` y pinta las CSS variables de marca (`--color-brand-*`) generadas por `brand-pipeline.ts` como inline style en `<html>` — el resto de los tokens es fijo (Capa 1/2 del design system).
4. **RLS es la frontera real**: el `tenant_id` del JWT (`app_metadata.tenant_id`) gobierna toda lectura/escritura autenticada. El filtro `.eq('tenant_id', …)` en queries de contenido público es por corrección de UX, no la barrera de seguridad.

## 4. Auth (login sin teléfono — §5.4)

- Supabase Auth con **email + password** y **magic link** (OTP email). NUNCA pedir teléfono.
- Registro: server action crea el usuario y setea `app_metadata: { tenant_id, role: 'member' }` vía cliente admin (service role) — el signup público NUNCA puede elegir su propio role/tenant desde el cliente.
- `profiles` row se crea en el mismo server action (no trigger sobre auth.users, para control de errores).
- Sesión: patrón `@supabase/ssr` completo (cookies, middleware refresh). `lib/supabase/admin.ts` importa `server-only`.
- Roles: `member | moderator | domain_admin | global_admin` — leídos del JWT en el server (`app_metadata.role`), nunca de la DB en el request path para gating de UI.

## 5. Design System (resumen ejecutable — detalle completo en `docs/investigacion/13-diseno-ux-premium.md`, RIGE TAL CUAL)

- **Tokens** en `globals.css` con `@theme` de Tailwind v4: escala de neutros CÁLIDOS (#FCFCFB…#0D0C08), semánticos fijos (success #1A7F5A, warning #B7791F, danger #C23B3B, info #2B6CB0 + sus `-bg`), radios (10/16/20/28/32/full), sombras difusas cálidas, motion tokens (`--ease-out-premium: cubic-bezier(0.32,0.72,0,1)`, spring, duraciones 100-500ms), espaciado 4px.
- **Tipografía**: General Sans (headings, via Fontshare `next/font/local` — descargar los .woff2 a `src/fonts/`) + Plus Jakarta Sans (body, `next/font/google`). `tabular-nums` para números/precios/Trust Score. PROHIBIDO Inter/Roboto/Arial.
- **Brand color**: SOLO en CTA primario, nav activo, acentos puntuales, zona de logo. NUNCA fondos masivos ni texto body. Los semánticos NUNCA derivan de la marca.
- **Double-Bezel** en toda tarjeta de confianza (shell `--radius-xl` + core concéntrico) — componente `<BezelCard>`.
- **Componentes ui/ mínimos**: Button (5 variantes × 3 tamaños, spring feedback), Input/Textarea/Select, BezelCard, Chip, Badge, Avatar, Skeleton (shimmer, no spinners), EmptyState (ilustración+mensaje+acción), BottomSheet, Dialog, Toast, Tabs, Banner, Progress. Todos con `:focus-visible` ring, targets ≥44px, `aria-*` correctos, dark mode.
- **Trust UI (gramática fija)**: `<TrustScoreBadge>` = barra 5 segmentos + número + nivel + ícono; siempre clickeable → `<TrustScoreSheet>` con desglose. Niveles: Nuevo(gris/brote) Verificado(info/check) Confiable(success/escudo) Premium(dorado/estrella) Diamante(acento/diamante).
- **Copy**: español rioplatense-neutro cálido, voseo suave como el design brief; NUNCA jerga técnica; el copy legal del verificador usa SIEMPRE descriptor literal + fecha + disclaimer (§11 del plan): *"Licencia activa según [registro] al [fecha]. Esto NO garantiza conducta — nunca envíes dinero por adelantado."*
- **Estados**: skeletons en toda carga; estados vacíos que guían; errores cálidos ("Algo no cargó bien de nuestro lado — no es tu culpa") + Reintentar.

## 6. Data access

- **Server Components** por default; client components solo para interactividad.
- Lecturas: cliente Supabase **server** (anon key + cookies del usuario) → RLS aplica. Keyset pagination (`created_at,id` cursor), nunca offset.
- Escrituras: **server actions** con validación Zod al borde.
- `admin.ts` (service role): SOLO webhooks Stripe, cron jobs, moderación server-side, signup metadata. JAMÁS en un request path de usuario para leer datos.
- Tipos: importar de `lib/types/database.types.ts`.

## 7. Degradación elegante (§5.6 del plan)

`src/lib/config/services.ts` exporta flags derivados de env vars: `isStripeConfigured`, `isResendConfigured`, `isVisionConfigured`, `isSentryConfigured`, `isOpenAIConfigured`.
- Stripe ausente → toda acción de pago abre `<ProximamentePremium feature="pagos" />` (BezelCard cálida, copy: "Estamos terminando de configurar los pagos. Va a estar disponible muy pronto."), loguea el intento. El botón NUNCA rompe.
- Resend ausente → emails se saltan con log; aviso suave in-app.
- Vision ausente → imágenes van a `moderation_queue` como `pending` y el listing queda `pending_review` — NUNCA publicar imagen sin moderar (en dev, `MODERATION_DEV_AUTO_APPROVE=true` permite aprobar automático).
- Regla de oro: **nunca un error técnico crudo al usuario; siempre un estado premium.**

## 8. i18n

- `lib/i18n/`: diccionario TS por namespace (`common.ts`, `auth.ts`, `listings.ts`, …), ES es la fuente de verdad, EN puede quedar incompleto (fallback a ES). Helper `t(key)` server-safe. Fechas/números con `Intl.*` y locale del tenant. Ningún string de UI hardcodeado en JSX de páginas — siempre del diccionario del módulo.

## 9. Seguridad app-layer

- Validación Zod en toda server action / route handler.
- **No existen rutas `api/cron/*`.** Las purgas periódicas (TTL de mensajes, códigos SMS, retención) corren como jobs `pg_cron` dentro de Postgres — ver `0013_cron_ttl.sql` y `0069_retencion_de_lo_nuevo.sql`. `CRON_SECRET` hoy se usa para otra cosa: el HMAC del hash anónimo del Asistente. Si alguna vez se agrega una ruta de cron HTTP, ahí sí exige `Authorization: Bearer ${CRON_SECRET}`.
- Webhook Stripe: firma verificada con SDK sobre body crudo, idempotencia por `event.id` (tabla `payment_events`), respuesta 2xx <200ms (procesar async).
- Jamás exponer `service_role`/`sk_` al cliente. Nada de secretos en `NEXT_PUBLIC_*`.
- Sanitizar todo contenido user-generated al render (no `dangerouslySetInnerHTML` sin sanitizar; markdown de guías con render seguro).

## 10. Verificación (gates)

- `npm run build` + `npx tsc --noEmit` + `npm run lint` verdes antes de cerrar cualquier rebanada.
- `npm run check:rls` (enumerador) verde tras cada migración.
- Los gates HUMANOS del plan (§5.2, §14.4: pentest + firma senior antes del primer dato real) siguen vigentes — este repo llega hasta "listo para ese gate".
