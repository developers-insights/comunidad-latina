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
| Moderación | OpenAI omni-moderation (activo) + Google Vision (degradado) |
| Tests | Vitest + Testing Library |
| Variantes de componentes | `class-variance-authority` + `clsx` + `tailwind-merge` (helper `cn()` en `src/lib/utils.ts`) |
| Color science (brand pipeline) | `culori` |

## 2. Estructura de carpetas (ownership del enjambre)

```
src/
├─ middleware.ts               ← resolución de tenant + sesión Supabase (INFRA)
├─ app/
│  ├─ layout.tsx               ← root: fuentes, theme del tenant, providers (INFRA/DESIGN)
│  ├─ globals.css              ← TODOS los design tokens (@theme) (DESIGN)
│  ├─ manifest.ts              ← PWA manifest dinámico por tenant (PWA)
│  ├─ sw.ts                    ← service worker Serwist (PWA)
│  ├─ (marketing)/             ← landing pública, guías SEO (LANDING)
│  │  ├─ page.tsx              ← landing del tenant
│  │  └─ guias/[slug]/
│  ├─ (auth)/                  ← login, registro, onboarding (AUTH)
│  │  ├─ entrar/  ├─ registro/  └─ bienvenida/   ← onboarding "Recién Llegado"
│  ├─ (app)/                   ← app autenticada con bottom-nav (shell: INFRA)
│  │  ├─ feed/                 ← feed principal (SOCIAL)
│  │  ├─ propiedades/          ← vertical vivienda (VIVIENDA)
│  │  │  ├─ page.tsx (búsqueda/lista) ├─ [id]/ (detalle) └─ publicar/
│  │  ├─ negocios/  ├─ profesionales/  ├─ eventos/   (SOCIAL/directorios)
│  │  ├─ mensajes/             ← contacto protegido (MENSAJES)
│  │  ├─ perfil/               ← perfil propio + [id] público (AUTH)
│  │  └─ escudo/               ← Escudo Anti-Estafa: verificador + reportes (ESCUDO)
│  ├─ admin/                   ← paneles por rol (ADMIN)
│  │  ├─ global/  ├─ dominio/  └─ moderacion/
│  └─ api/
│     ├─ webhooks/stripe/route.ts   (PAGOS)
│     └─ cron/…/route.ts            (protegidos con CRON_SECRET)
├─ components/
│  ├─ ui/          ← primitivos del design system (DESIGN — solo DESIGN escribe acá)
│  ├─ trust/       ← TrustScoreBadge, TrustScoreSheet, VerificationCard, ScamShieldNotice, ReportScamButton (ESCUDO)
│  ├─ listings/    (VIVIENDA)  ├─ feed/ (SOCIAL)  ├─ messaging/ (MENSAJES)  └─ shell/ (INFRA: BottomNav, Header)
├─ lib/
│  ├─ supabase/    ← client.ts (browser), server.ts (RSC/actions), admin.ts (service-role, SOLO server), middleware.ts
│  ├─ tenant/      ← resolve.ts (Host→tenant, cache), brand-pipeline.ts (hex→escala tonal WCAG)
│  ├─ config/services.ts       ← flags de degradación elegante (isStripeConfigured, …)
│  ├─ i18n/        ← diccionarios ES (default) / EN, helper t()
│  ├─ trust/       ← cómputo/formateo de niveles Trust Score
│  ├─ types/database.types.ts  ← generado desde Supabase (NO editar a mano)
│  └─ utils.ts     ← cn(), formatos Intl
├─ supabase/migrations/        ← SQL (DB — ya aplicado vía MCP, NO tocar sin gate)
└─ scripts/                    ← rls-enumerator.mjs, seed.mjs
```

**Regla de ownership:** cada agente escribe SOLO en las carpetas de su módulo (marcadas arriba). `components/ui/` y `globals.css` son del agente DESIGN; los demás los consumen, no los editan.

## 3. Multi-tenancy (cómo fluye el tenant)

1. **Middleware** (`src/middleware.ts`): lee `Host` header → resuelve tenant vía RPC `get_tenant_by_domain` (con cache en memoria + fallback). En dev: query `?t=<slug>` o cookie `cl-tenant`, default `dominicanos`. Inyecta `x-tenant-slug` + `x-tenant-id` como request headers y refresca la sesión de Supabase (patrón `@supabase/ssr`).
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
- `api/cron/*` exige header `Authorization: Bearer ${CRON_SECRET}`.
- Webhook Stripe: firma verificada con SDK sobre body crudo, idempotencia por `event.id` (tabla `payment_events`), respuesta 2xx <200ms (procesar async).
- Jamás exponer `service_role`/`sk_` al cliente. Nada de secretos en `NEXT_PUBLIC_*`.
- Sanitizar todo contenido user-generated al render (no `dangerouslySetInnerHTML` sin sanitizar; markdown de guías con render seguro).

## 10. Verificación (gates)

- `npm run build` + `npx tsc --noEmit` + `npm run lint` verdes antes de cerrar cualquier rebanada.
- `npm run check:rls` (enumerador) verde tras cada migración.
- Los gates HUMANOS del plan (§5.2, §14.4: pentest + firma senior antes del primer dato real) siguen vigentes — este repo llega hasta "listo para ese gate".
