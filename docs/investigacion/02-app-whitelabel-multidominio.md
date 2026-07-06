# 02 — Arquitectura de la Capa de Aplicación Next.js: White-Label Multi-Tenant Multi-Dominio

> **Proyecto:** Comunidad Latina / NYLabel — Red social white-label multi-tenant (PWA)
> **Rol de este documento:** Arquitectura de la capa de aplicación Next.js (App Router)
> **Fecha:** 2026-07-06
> **Stack fijado:** Next.js 15/16 + TypeScript · Supabase (Auth/Postgres/Storage/Realtime) · Vercel (hosting + custom domains) · Stripe Connect · Bunny/Cloudflare Stream · Twilio · Resend
> **Verificado contra:** docs oficiales Next.js (v16.2.x, actualizado 2026-02) y Vercel Platforms / REST API (2026)
> **Coordina con:** agente de datos (config del tenant vive en Postgres; asumimos tablas `tenants` + `tenant_config` con RLS por `tenant_id`)

---

## 0. TL;DR de decisiones (para el plan maestro)

| # | Decisión | Elección | Motivo |
|---|----------|----------|--------|
| D1 | Patrón de plataforma | **Multi-tenant single-deployment** (Vercel for Platforms) | Branding difiere, funcionalidad es la misma. Menor complejidad que multi-project. |
| D2 | Resolución de tenant | **Middleware por hostname → rewrite a `/_sites/[tenant]`** + header `x-tenant-id` | Estándar oficial Next.js. Un solo código sirve N dominios. |
| D3 | Runtime del middleware | **Node.js runtime** en Next 16 (`proxy.ts`), Edge aceptable en 15 | Necesitamos leer config (Edge Config o KV) con baja latencia; Node runtime evita indirección. |
| D4 | Fuente de config para routing | **Vercel Edge Config** (domain→tenantId) como capa hot + Postgres como source of truth | Edge Config lee en <1ms desde middleware, sin round-trip a DB en cada request. |
| D5 | Carga de config completa del tenant | **`'use cache'` / `unstable_cache`** en un server helper `getTenant()` con tag `tenant:{id}` | Cachea branding/módulos; se invalida por tag al editar en el admin. |
| D6 | Theming white-label | **CSS variables inyectadas en `<html style>` desde RSC** + Tailwind mapeado a esas variables | Cambia colores/fuentes sin recompilar. Tokens vienen de DB. |
| D7 | Manifest PWA dinámico | **Route Handler `app/manifest.webmanifest/route.ts`** (NO `manifest.ts`) | `manifest.ts` se evalúa estático; el route handler lee `headers()` → manifest por tenant. |
| D8 | Custom domains | **Vercel REST API `POST /v10/projects/{id}/domains`** desde el flujo de alta de tenant | "Crear tenant en minutos". SSL automático de Vercel. |
| D9 | Estrategia de dominios | **Dominios individuales agregados vía API** (no wildcard como default) | Cada tenant es un apex propio (colombianos.com). Wildcard solo para subdominios `*.comunidadlatina.com`. |
| D10 | Rendering | **ISR/PPR por defecto** para páginas públicas cacheables por tenant; **SSR dinámico** para feeds autenticados | Feeds sociales son personalizados → dinámico. Landing/perfiles públicos → cacheable. |
| D11 | i18n + moneda | **Config del tenant, NO routing i18n de Next** (`/es/`, `/en/`) | Cada dominio = 1 idioma/moneda. No queremos prefijos de locale en la URL. |
| D12 | Feature flags (módulos) | **`tenant.modules` (jsonb) leído en server + guard `<Module id="propiedades">`** | On/off por dominio desde la misma config cacheada. |
| D13 | Seguridad multi-tenant | **RLS en Postgres (source of truth) + validación de tenant en cada Server Action / Route Handler** | Nunca confiar solo en el middleware. Defense-in-depth. |

---

## 1. Multi-Tenant en Next.js App Router

### 1.1 Modelo mental

Un solo proyecto Next.js desplegado una vez en Vercel. Vercel enruta **N dominios** (colombianos.com, dominicanos.com, …, `*.comunidadlatina.com`) al mismo deployment. El **middleware** es quien, en cada request, mira el `Host` header, resuelve el `tenantId`, y reescribe la URL interna a un segmento dinámico `/_sites/[tenant]/...` que el usuario nunca ve.

```
Request: https://colombianos.com/propiedades
                    │
                    ▼
          ┌───────────────────┐
          │  middleware.ts     │  lee Host = "colombianos.com"
          │  (proxy.ts en v16) │  Edge Config lookup: → tenantId = "col"
          └─────────┬─────────┘
                    │  rewrite interno + set header x-tenant-id: col
                    ▼
   /_sites/col/propiedades   ← el árbol de rutas real (invisible al usuario)
                    │
                    ▼
          RSC layout lee el tenant, inyecta branding, renderiza módulos on
```

**Regla de oro:** la URL pública **nunca** contiene el `tenant`. `/_sites/[tenant]` es puramente interno (rewrite, no redirect).

### 1.2 Snippet de middleware (production-ready)

> **Nota de versión:** En **Next.js 16** el archivo se renombra `middleware.ts` → `proxy.ts` y la función `middleware` → `proxy` (mismo primitivo; motivado en parte por CVE-2025-29927). El codemod es `npx @next/codemod@latest middleware-to-proxy`. El código de abajo es idéntico salvo el nombre. Elegimos **Node.js runtime** para poder usar el SDK de Supabase/Edge Config sin límites del Edge.

```ts
// middleware.ts  (o proxy.ts en Next 16)
import { NextRequest, NextResponse } from 'next/server'
import { get } from '@vercel/edge-config'

// Dominios de "plataforma" que NO son tenants (panel super-admin, api, etc.)
const ROOT_DOMAINS = new Set(['admin.comunidadlatina.com'])

export const config = {
  // Excluir assets estáticos, imágenes de Next y el propio manifest/sw
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\..*).*)'],
  // runtime: 'nodejs',  // recomendado en v16 (proxy.ts). En v15 Edge también sirve.
}

/** Normaliza el hostname: quita puerto, www y el sufijo de preview de Vercel. */
function normalizeHost(host: string): string {
  return host
    .replace(/:\d+$/, '')            // quita :3000 en local
    .replace(/^www\./, '')           // trata www.x.com === x.com
    .toLowerCase()
}

export default async function middleware(req: NextRequest) {
  const rawHost = req.headers.get('host') ?? ''
  const host = normalizeHost(rawHost)
  const url = req.nextUrl

  // 1) Panel global del Super Admin → pasa derecho a /admin
  if (ROOT_DOMAINS.has(host)) {
    return NextResponse.rewrite(new URL(`/_admin${url.pathname}`, req.url))
  }

  // 2) Resolver tenant desde Edge Config (hot path, <1ms, sin tocar Postgres)
  //    Edge Config = { "domains": { "colombianos.com": "col", ... } }
  const domainMap = (await get<Record<string, string>>('domains')) ?? {}
  const tenantId =
    domainMap[host] ??
    // fallback subdominio: peru.comunidadlatina.com → "peru"
    resolveSubdomainTenant(host)

  // 3) Dominio no reconocido → landing de marketing / 404 controlado
  if (!tenantId) {
    return NextResponse.rewrite(new URL('/_unknown-domain', req.url))
  }

  // 4) Rewrite al árbol real + propagar tenant en header (lo leen RSC/Route Handlers)
  const rewritten = new URL(`/_sites/${tenantId}${url.pathname}`, req.url)
  const res = NextResponse.rewrite(rewritten)
  res.headers.set('x-tenant-id', tenantId)
  res.headers.set('x-tenant-host', host)
  return res
}

function resolveSubdomainTenant(host: string): string | null {
  // Solo para *.comunidadlatina.com (dominio raíz con wildcard)
  const ROOT = 'comunidadlatina.com'
  if (host === ROOT) return 'comunidadlatina'        // el tenant "genérico"
  if (host.endsWith(`.${ROOT}`)) return host.replace(`.${ROOT}`, '')
  return null
}
```

**Por qué Edge Config y no una query a Postgres en el middleware:**
- El middleware corre en **cada** request. Un round-trip a Postgres agrega 20–80ms a todo. Edge Config resuelve en <1ms desde la red edge.
- Edge Config es el mapa `dominio → tenantId` (chico, cambia solo al crear/borrar tenants). El **resto** de la config (branding, módulos) se carga después en el RSC, cacheada por tag.
- Alternativa si no se quiere Edge Config: Vercel KV / Upstash Redis. Peor latencia que Edge Config pero válido.

> ⚠️ **CVE-2025-29927:** nunca usar el middleware como **única** capa de auth. El header `x-middleware-subrequest` permitió bypass histórico. El middleware acá solo hace *routing*; la autorización real vive en Server Components / Server Actions / RLS.

### 1.3 Cargar y proveer la config del tenant en el server

Patrón central: un helper `getTenant()` cacheado que lee el header `x-tenant-id` (puesto por el middleware) y trae la config completa desde Postgres, cacheada por tag para invalidación quirúrgica desde el admin.

```ts
// lib/tenant/get-tenant.ts
import { headers } from 'next/headers'
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'

export interface TenantConfig {
  id: string
  host: string
  name: string                 // "Colombianos en NY"
  locale: 'es' | 'en'
  currency: 'USD' | 'COP' | 'DOP' | 'MXN' | 'VEF' | 'PEN' | 'CLP'
  branding: {
    logoUrl: string
    faviconUrl: string
    colors: { primary: string; secondary: string; accent: string; bg: string; fg: string }
    fontSans: string           // p.ej. "Inter"
    themeColor: string         // para PWA
  }
  seo: { title: string; description: string; ogImageUrl: string; keywords: string[] }
  modules: Record<ModuleId, boolean>   // { propiedades: true, negocios: false, ... }
}

export type ModuleId =
  | 'feedPrincipal' | 'feedPropiedades' | 'feedNegocios' | 'feedEventos' | 'feedProfesionales'
  | 'propiedades' | 'negocios' | 'profesionales' | 'eventos'
  | 'creatorMarketplace' | 'marketplaceTiendas' | 'publicidad' | 'grupos' | 'historias' | 'broadcast'

/** Cacheado por tenant; se revalida por tag desde el admin al guardar cambios. */
const loadTenantById = (tenantId: string) =>
  unstable_cache(
    async (): Promise<TenantConfig | null> => {
      const supabase = createServiceClient()
      const { data } = await supabase
        .from('tenant_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .single()
      return data ? mapRowToConfig(data) : null
    },
    ['tenant-config', tenantId],
    { tags: [`tenant:${tenantId}`], revalidate: 3600 }, // TTL de respaldo 1h
  )()

/** Único punto de acceso desde RSC. Lee el header que puso el middleware. */
export async function getTenant(): Promise<TenantConfig> {
  const h = await headers()                    // Next 15+: headers() es async
  const tenantId = h.get('x-tenant-id')
  if (!tenantId) throw new Error('Tenant no resuelto (middleware no seteó x-tenant-id)')
  const cfg = await loadTenantById(tenantId)
  if (!cfg) throw new Error(`Config de tenant no encontrada: ${tenantId}`)
  return cfg
}
```

> **Next 16 — `'use cache'`:** el equivalente moderno de `unstable_cache` es la directiva `'use cache'` + `cacheTag()`/`cacheLife()`. `unstable_cache` entra en ventana de deprecación con codemod hacia `'use cache'`. Para arrancar hoy en 15 usamos `unstable_cache`; migrar a `'use cache'` es mecánico. **Gotcha verificado:** en Draft Mode todas las funciones cacheadas se re-ejecutan (útil para preview de branding).

**Invalidación desde el admin** (cuando el Domain Admin cambia un color o togglea un módulo):

```ts
// app/_admin/actions/save-branding.ts
'use server'
import { revalidateTag } from 'next/cache'

export async function saveBranding(tenantId: string, patch: Partial<TenantConfig['branding']>) {
  await assertDomainAdmin(tenantId)           // authz real, no confiar en middleware
  await db.updateTenantBranding(tenantId, patch)
  revalidateTag(`tenant:${tenantId}`)         // ← purga la cache de ESE tenant
}
```

### 1.4 Estrategia de rendering por tenant

| Superficie | Rendering | Razón |
|-----------|-----------|-------|
| Landing pública del dominio, perfiles públicos de negocio/propiedad, páginas de evento | **ISR / PPR** con `revalidate` + tag por tenant | Cacheable, mismo contenido para todos los visitantes; se purga al editar. SEO fuerte. |
| 5 Feeds (Principal, Propiedades, Negocios, Eventos, Profesionales) autenticados | **SSR dinámico** (shell estático + datos en Suspense) | Contenido personalizado por usuario/Trust Score; no cacheable globalmente. |
| Historias/Status, chat, notificaciones | **Client + Supabase Realtime** | Tiempo real. |
| Panel Domain Admin / Super Admin | **SSR dinámico**, `runtime nodejs` | Datos sensibles, siempre frescos. |

**PPR (Partial Prerendering):** ideal acá — el "cascarón" (header con branding del tenant, layout de módulos) se prerenderiza estático por tenant, y los feeds se streamean dinámicos dentro de `<Suspense>`. Esto da First Paint instantáneo con branding correcto + datos frescos.

```tsx
// app/_sites/[tenant]/(feed)/page.tsx
export const experimental_ppr = true   // (o cacheComponents en Next 16)

export default async function FeedPage() {
  const tenant = await getTenant()      // estático: branding conocido en build/ISR
  return (
    <FeedShell tenant={tenant}>
      <Suspense fallback={<FeedSkeleton />}>
        <PersonalizedFeed />            {/* dinámico: depende del usuario */}
      </Suspense>
    </FeedShell>
  )
}
```

---

## 2. White-Label Dinámico SIN Recompilar

El requisito duro: **Geovanny crea un tenant nuevo y define logo/colores/fuente desde el admin, y el dominio se ve con ese branding sin un `git push` ni un build.** Esto se logra inyectando **CSS variables** en tiempo de request desde el RSC, y mapeando Tailwind a esas variables.

### 2.1 Design tokens desde DB → CSS variables

El `root layout` del tenant lee la config y escribe las variables en el `<html>`:

```tsx
// app/_sites/[tenant]/layout.tsx
import { getTenant } from '@/lib/tenant/get-tenant'

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const t = await getTenant()
  const c = t.branding.colors

  return (
    <html
      lang={t.locale}
      style={{
        // Tokens que Tailwind consume (ver 2.2). Vienen 100% de DB.
        '--color-primary': c.primary,
        '--color-secondary': c.secondary,
        '--color-accent': c.accent,
        '--color-bg': c.bg,
        '--color-fg': c.fg,
        '--font-sans': t.branding.fontSans,
      } as React.CSSProperties}
    >
      <body className="bg-[--color-bg] text-[--color-fg] font-sans">
        {children}
      </body>
    </html>
  )
}
```

### 2.2 Tailwind mapeado a las variables (theming en runtime)

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss'

export default {
  theme: {
    extend: {
      colors: {
        // Cada color de marca apunta a la CSS var (resuelta por tenant en runtime)
        primary:   'rgb(var(--color-primary) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
        accent:    'rgb(var(--color-accent) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
} satisfies Config
```

> **Convención:** guardar los colores en DB como triplete RGB `"37 99 235"` (no `#2563eb`) para poder usar `rgb(var(--color-primary) / <alpha-value>)` y que `bg-primary/50` (opacidad) funcione. Documentar esto para el agente de datos.

**Con Tailwind v4** (CSS-first, `@theme`): se puede declarar el tema en CSS y overridear las variables por tenant igual. El principio es idéntico: **la variable la define el server según el tenant; las utilities de Tailwind son estáticas**. Esto mantiene un solo CSS bundle para todos los tenants (no se recompila nada).

### 2.3 Fuentes por tenant

Dos estrategias, elegimos la **B** como default:

- **A — `next/font` con set fijo:** precargar un pool de 4–6 fuentes (Inter, Poppins, Roboto, Montserrat…) y que `--font-sans` apunte a la elegida. Ventaja: self-hosted, sin CLS, óptimo Core Web Vitals. Desventaja: el tenant solo elige de un catálogo.
- **B — Catálogo curado (recomendado):** exactamente lo anterior. Para un producto white-label, un **catálogo de fuentes** es mejor UX que "cualquier URL de fuente" (evita fuentes rotas, problemas de licencia y CLS). El admin elige de un dropdown; guardamos el `key` en `tenant.branding.fontSans`.

```tsx
// app/_sites/[tenant]/fonts.ts  — pool precargado con next/font
import { Inter, Poppins, Montserrat } from 'next/font/google'
export const FONTS = {
  inter: Inter({ subsets: ['latin'], variable: '--font-inter' }),
  poppins: Poppins({ subsets: ['latin'], weight: ['400','600','700'], variable: '--font-poppins' }),
  montserrat: Montserrat({ subsets: ['latin'], variable: '--font-montserrat' }),
} as const
```

### 2.4 Favicon dinámico por tenant

`favicon.ico` estático NO sirve (es el mismo para todos). Dos opciones:

1. **Vía `<link>` en el `<head>` del layout** apuntando al asset del tenant en Supabase Storage (más simple):

```tsx
// dentro de generateMetadata del layout del tenant (ver 5.1)
icons: { icon: t.branding.faviconUrl, apple: t.branding.faviconUrl }
```

2. **Route handler dinámico** `app/_sites/[tenant]/icon.tsx` con `next/og` si se quiere generar el favicon on-the-fly. Innecesario si el tenant ya sube su favicon.

Elegimos **(1)**: el favicon vive en Storage, la URL en `tenant_config`, y se referencia desde metadata. Cero build.

---

## 3. Custom Domains en Vercel (flujo "crear tenant en minutos")

### 3.1 Arquitectura de dominios

**Vercel for Platforms** confirma explícitamente: **unlimited custom domains** + `*.yourdomain.com`, **SSL automático** (emisión y renovación por Vercel), y **gestión programática** vía REST API / SDK. Este es exactamente nuestro caso de uso ("serve thousands of domains on one project").

Estrategia elegida:

| Tipo de dominio | Método | Ejemplo |
|-----------------|--------|---------|
| **Apex propio de cada tenant** | Agregar dominio **individual** vía API + el cliente configura DNS (A record) | colombianos.com, mexicanos.com, venezolanos.net |
| **Subdominios de la marca raíz** | **Wildcard** `*.comunidadlatina.com` (requiere nameservers de Vercel) | peru.comunidadlatina.com |

**Por qué dominios individuales y no todo wildcard:** los tenants tienen **apex domains distintos** (colombianos.com ≠ mexicanos.com). Un wildcard `*.comunidadlatina.com` no cubre esos apex. Cada apex propio se agrega como dominio individual. El wildcard se reserva para el flujo de "subdominio gratis bajo comunidadlatina.com".

**Restricción DNS verificada (RFC1034):** un **apex** (colombianos.com) debe usar **A record** apuntando a la IP de Vercel (`76.76.21.21`), NO CNAME (un CNAME en el apex viola el RFC y rompe MX/NS). Los **subdominios** sí usan CNAME (`cname.vercel-dns.com`). El **wildcard** requiere delegar nameservers a Vercel (para resolver los challenges de SSL wildcard).

### 3.2 Agregar dominio programáticamente (flujo de alta de tenant)

Endpoint verificado: **`POST https://api.vercel.com/v10/projects/{idOrName}/domains`**.

```ts
// lib/vercel/add-domain.ts  — se llama desde el flujo "crear tenant" del Super Admin
const VERCEL_API = 'https://api.vercel.com'

export async function addTenantDomain(domain: string) {
  const res = await fetch(
    `${VERCEL_API}/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains` +
      `?teamId=${process.env.VERCEL_TEAM_ID}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    },
  )
  if (!res.ok && res.status !== 409) {
    // 409 = ya existe en el proyecto (idempotente, lo tratamos como OK)
    throw new Error(`Vercel addDomain falló: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<{
    name: string
    verified: boolean
    verification?: Array<{ type: string; domain: string; value: string; reason: string }>
  }>
}
```

**Verificación de DNS/SSL:** si `verified === false`, la respuesta trae un array `verification` con el challenge (registro TXT o instrucción de A/CNAME). Endpoint de verificación: **`POST /v9/projects/{id}/domains/{domain}/verify`**. Vercel emite el certificado SSL automáticamente **en minutos** una vez que el DNS resuelve. Se puede pollear el estado con `GET /v9/projects/{id}/domains/{domain}`.

> **"Verified = true" engañoso (gotcha de comunidad):** al agregar por API a veces vuelve `verified: true` aunque el DNS aún no apunte. La fuente de verdad del estado real es el config del dominio (`GET .../domains/{domain}/config` → campo `misconfigured`). El flujo de alta debe pollear ESE endpoint, no confiar en el `verified` inicial.

### 3.3 Flujo completo "crear tenant en minutos" (secuencia)

```
Super Admin (panel) completa: dominio, nombre, país, idioma, moneda, logo, colores
        │
        ▼
1. Server Action `createTenant()`:
   a. INSERT en Postgres  (tenants + tenant_config)          [agente de datos]
   b. addTenantDomain(domain)  → Vercel REST API             [este agente]
   c. Actualizar Edge Config: domains[domain] = tenantId     [Vercel API/SDK]
        │
        ▼
2. Mostrar al admin las instrucciones DNS que devolvió Vercel
   (A record → 76.76.21.21  para apex; CNAME para subdominio)
        │
        ▼
3. Background poll: GET domain/config hasta misconfigured === false
   → marcar tenant.status = 'live'
        │
        ▼
4. Vercel emite SSL automáticamente. Tenant online. Cero deploy.
```

**Actualizar Edge Config vía API** (para que el middleware resuelva el dominio nuevo sin redeploy):

```ts
// PATCH del Edge Config item "domains"
await fetch(`${VERCEL_API}/v1/edge-config/${EDGE_CONFIG_ID}/items?teamId=${TEAM_ID}`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: [{ operation: 'update', key: 'domains', value: { ...current, [domain]: tenantId } }],
  }),
})
```

> **Límite verificado:** Hobby = 50 dominios/proyecto. Para producción con N tenants se necesita **plan Pro/Enterprise** (Vercel for Platforms habla de "unlimited"). **Documentar como dependencia comercial en el plan maestro.**

---

## 4. PWA (Instalable, Offline, Push)

### 4.1 Manifest dinámico por tenant — decisión clave

**Problema verificado:** `app/manifest.ts` se evalúa **estáticamente** (se cachea; no recibe el request), así que NO puede devolver branding distinto por hostname. Un solo `manifest.ts` daría el mismo nombre/ícono/color a todos los dominios → PWA instalada con branding equivocado.

**Solución:** un **Route Handler** en `app/manifest.webmanifest/route.ts` que lee `headers()` (request-time API → dynamic) y devuelve el manifest del tenant. Se linkea con `<link rel="manifest" href="/manifest.webmanifest">`.

```ts
// app/manifest.webmanifest/route.ts
import { NextResponse } from 'next/server'
import { getTenant } from '@/lib/tenant/get-tenant'

export const dynamic = 'force-dynamic'   // depende del host → nunca estático

export async function GET() {
  const t = await getTenant()            // lee x-tenant-id del middleware
  return NextResponse.json({
    name: t.name,
    short_name: t.name.split(' ')[0],
    description: t.seo.description,
    id: `/?tenant=${t.id}`,              // id único por tenant (scope de instalación)
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: t.branding.colors.bg,
    theme_color: t.branding.themeColor,
    icons: [
      { src: `${t.branding.faviconUrl}?s=192`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: `${t.branding.faviconUrl}?s=512`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }, {
    headers: { 'Content-Type': 'application/manifest+json' },
  })
}
```

> **Importante:** hay que **excluir `/manifest.webmanifest` del matcher del middleware** para el rewrite pero **permitir que el header `x-tenant-id` se resuelva**. Alternativa robusta: que el propio route handler llame a `headers().get('host')` y resuelva el tenant por su cuenta (no depender del rewrite). Recomendado: resolver el host dentro del handler para que sea auto-suficiente.

### 4.2 Service Worker

Estrategia: **Serwist** (sucesor de `next-pwa`) para generar el SW con precache + runtime caching, o un `public/sw.js` manual para máximo control. Para un producto completo con push + offline, **Serwist** es la elección (menos código, estrategias de cache probadas). El SW es **compartido por todos los tenants** (un solo `/sw.js`); el branding lo da el manifest, no el SW.

Headers obligatorios para el SW (en `next.config.js`), verificados en docs:

```js
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}
```

### 4.3 Instalabilidad

- Manifest válido (§4.1) + HTTPS (Vercel lo da) → el navegador muestra el prompt de instalación automáticamente.
- **iOS 16.4+**: soporta PWA instalada + web push, pero **no** hay `beforeinstallprompt`. Mostrar el componente `InstallPrompt` con instrucciones ("Compartir → Añadir a inicio") solo en iOS y solo si no está en `display-mode: standalone`.
- El `scope`/`id` por tenant en el manifest asegura que instalar colombianos.com y mexicanos.com sean **dos apps separadas** en el home screen.

### 4.4 Web Push por tenant

Push notifications con **VAPID** + librería `web-push` (Server Action). Patrón oficial confirmado. Adaptación multi-tenant:

- Guardar cada `PushSubscription` en Postgres **con su `tenant_id` y `user_id`** (tabla `push_subscriptions`, RLS por tenant).
- Al enviar (broadcast del Domain Admin, o Broadcast Global del Super Admin), filtrar por `tenant_id`.
- **VAPID keys:** un par global para toda la plataforma es suficiente (VAPID identifica al *servidor de aplicación*, no al tenant). El branding del push (título, ícono) se pasa en el payload por tenant.
- **Broadcast Global** (caso de la persona desaparecida): iterar todos los tenants activos y enviar a cada subscription; el SW muestra la notificación con el ícono del tenant correspondiente.

```ts
// app/actions/push.ts (extracto)
'use server'
import webpush from 'web-push'
webpush.setVapidDetails('mailto:soporte@comunidadlatina.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)

export async function broadcastToTenant(tenantId: string, payload: { title: string; body: string; icon: string; url: string }) {
  await assertCanBroadcast(tenantId)                       // authz
  const subs = await db.getSubscriptions(tenantId)        // RLS por tenant
  await Promise.allSettled(subs.map(s =>
    webpush.sendNotification(s, JSON.stringify(payload)).catch(pruneDeadSub(s))))
}
```

### 4.5 Offline básico

- **Serwist** precachea el app shell (layout, CSS, JS crítico) → la app abre offline.
- Runtime caching: `NetworkFirst` para feeds (muestra último cache si no hay red), `CacheFirst` para imágenes/avatares.
- Cola de escritura offline (crear post sin conexión) → **Background Sync API** que reintenta al reconectar. Coincide con el requisito "Works offline with sync on reconnect".

---

## 5. i18n + Moneda por Tenant · SEO por Dominio

### 5.1 SEO por dominio (metadata dinámica)

`generateMetadata` en el layout del tenant produce title/description/OG por dominio. **Verificado**: metadata puede ser async y leer el tenant.

```tsx
// app/_sites/[tenant]/layout.tsx
import type { Metadata } from 'next'
import { getTenant } from '@/lib/tenant/get-tenant'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTenant()
  return {
    metadataBase: new URL(`https://${t.host}`),
    title: { default: t.seo.title, template: `%s · ${t.name}` },
    description: t.seo.description,
    keywords: t.seo.keywords,
    icons: { icon: t.branding.faviconUrl, apple: t.branding.faviconUrl },
    manifest: '/manifest.webmanifest',
    openGraph: {
      title: t.seo.title, description: t.seo.description,
      url: `https://${t.host}`, siteName: t.name,
      images: [{ url: t.seo.ogImageUrl }], locale: t.locale === 'es' ? 'es_US' : 'en_US',
    },
    alternates: { canonical: `https://${t.host}` },   // canonical al dominio propio
    robots: t.status === 'live' ? 'index,follow' : 'noindex',
  }
}
```

**Sitemap y robots por tenant** — como son dinámicos por host, usar route handlers:

```ts
// app/sitemap.xml/route.ts  (dinámico por host, no el sitemap.ts estático)
export const dynamic = 'force-dynamic'
export async function GET() {
  const t = await getTenant()
  const urls = await db.getPublicUrls(t.id)   // propiedades, negocios, eventos públicos
  return new Response(buildSitemapXml(t.host, urls),
    { headers: { 'Content-Type': 'application/xml' } })
}

// app/robots.txt/route.ts
export async function GET() {
  const t = await getTenant()
  const body = t.status === 'live'
    ? `User-agent: *\nAllow: /\nSitemap: https://${t.host}/sitemap.xml`
    : `User-agent: *\nDisallow: /`
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } })
}
```

> **SEO multi-dominio:** cada dominio es una entidad SEO independiente con su propio canonical apuntando a sí mismo. NO usar `hreflang` cruzado entre dominios de países distintos (colombianos.com y mexicanos.com no son "traducciones" — son productos distintos). Esto evita canibalización.

### 5.2 i18n + moneda: NO usar el i18n-routing de Next

**Decisión:** cada dominio sirve **un** idioma y **una** moneda (definidos en `tenant_config`). NO usamos rutas con prefijo de locale (`/es/`, `/en/`) porque:
- Ensuciarían URLs de dominios que son mono-idioma.
- El middleware ya está ocupado con el rewrite de tenant.

Implementación:
- **Traducciones de UI:** `next-intl` en modo "sin routing" — el locale viene de `tenant.locale`, se pasa vía provider en el layout. Los mensajes se cargan por locale desde `/messages/{locale}.json`.
- **Moneda:** helper `formatMoney(amount, tenant.currency)` con `Intl.NumberFormat`. Los precios de planes ($29/3m etc.) se muestran en la moneda del tenant (o se mantienen en USD con conversión informativa — decisión de producto pendiente para el agente de datos/pagos).

```tsx
// app/_sites/[tenant]/layout.tsx (fragmento del provider de i18n)
import { NextIntlClientProvider } from 'next-intl'
const messages = (await import(`@/messages/${t.locale}.json`)).default
// ...
<NextIntlClientProvider locale={t.locale} messages={messages}>{children}</NextIntlClientProvider>
```

---

## 6. Estructura de Carpetas y Feature Flags (módulos on/off)

### 6.1 Estructura de carpetas (App Router)

```
app/
├── middleware.ts                 # (proxy.ts en Next 16) — resolución de tenant
├── manifest.webmanifest/
│   └── route.ts                  # manifest PWA dinámico por tenant
├── sitemap.xml/route.ts          # sitemap dinámico por host
├── robots.txt/route.ts           # robots dinámico por host
│
├── _sites/                       # ← árbol REAL de tenants (rewrite interno, invisible)
│   └── [tenant]/
│       ├── layout.tsx            # inyecta CSS vars + branding + i18n + metadata
│       ├── (public)/             # rutas públicas cacheables (ISR/PPR) → SEO
│       │   ├── page.tsx          # landing del dominio
│       │   ├── propiedades/[id]/page.tsx
│       │   ├── negocios/[slug]/page.tsx
│       │   └── eventos/[id]/page.tsx
│       ├── (app)/                # rutas autenticadas (SSR dinámico)
│       │   ├── layout.tsx        # requiere sesión; navbar con módulos on
│       │   ├── feed/page.tsx
│       │   ├── propiedades/…     # gate por módulo
│       │   ├── negocios/…
│       │   ├── profesionales/…
│       │   ├── eventos/…
│       │   ├── grupos/…
│       │   ├── historias/…
│       │   └── marketplace/…
│       └── admin/                # panel del DOMAIN ADMIN (de ese tenant)
│           ├── page.tsx
│           ├── modulos/page.tsx  # toggles on/off
│           └── branding/page.tsx # editor de colores/logo/fuente
│
├── _admin/                       # panel del SUPER ADMIN (admin.comunidadlatina.com)
│   ├── layout.tsx
│   ├── tenants/                  # crear/editar tenants (llama Vercel API)
│   ├── broadcast/page.tsx        # Broadcast Global
│   └── analytics/page.tsx        # stats consolidadas de toda la red
│
├── _unknown-domain/page.tsx      # dominio no reconocido
└── api/                          # route handlers globales (webhooks Stripe, etc.)
    ├── webhooks/stripe/route.ts
    └── health/route.ts

lib/
├── tenant/
│   ├── get-tenant.ts             # getTenant() cacheado
│   ├── modules.ts                # helpers de feature flags
│   └── types.ts
├── vercel/add-domain.ts          # gestión programática de dominios
├── supabase/{server,service,client}.ts
└── i18n/…

components/
├── tenant/
│   ├── ModuleGate.tsx            # <ModuleGate id="propiedades">
│   └── BrandLogo.tsx
└── ui/…                          # design system (Tailwind + CSS vars)

messages/{es,en}.json             # traducciones de UI
```

**Nota sobre route groups:** `(public)` vs `(app)` separa rendering (ISR vs SSR) y layouts (con/sin auth) sin afectar la URL. Clave para mezclar páginas SEO-cacheables con feeds dinámicos bajo el mismo tenant.

### 6.2 Patrón de feature flags (módulos on/off)

Los módulos viven en `tenant.modules` (jsonb) y se leen de la config ya cacheada — **sin queries extra**. Tres niveles de enforcement:

**1. UI gate (componente):**

```tsx
// components/tenant/ModuleGate.tsx  (Server Component)
import { getTenant, type ModuleId } from '@/lib/tenant/get-tenant'

export async function ModuleGate({ id, children }: { id: ModuleId; children: React.ReactNode }) {
  const t = await getTenant()
  if (!t.modules[id]) return null      // módulo off → no se renderiza
  return <>{children}</>
}
```

**2. Route guard (en el layout/page del módulo):**

```tsx
// app/_sites/[tenant]/(app)/propiedades/layout.tsx
import { notFound } from 'next/navigation'
import { getTenant } from '@/lib/tenant/get-tenant'

export default async function PropiedadesLayout({ children }: { children: React.ReactNode }) {
  const t = await getTenant()
  if (!t.modules.propiedades) notFound()   // módulo off → 404 real
  return <>{children}</>
}
```

**3. Navegación dinámica** (el navbar solo muestra módulos activos):

```tsx
// components/tenant/Nav.tsx
const t = await getTenant()
const items = NAV_ITEMS.filter(item => t.modules[item.moduleId])
```

**Guard en el server (defensa real):** cualquier Server Action de un módulo valida `t.modules[id]` **y** la autorización del usuario antes de escribir. Nunca confiar en que la UI ocultó el botón.

```ts
export async function createProperty(input: PropertyInput) {
  const t = await getTenant()
  if (!t.modules.propiedades) throw new Error('Módulo no habilitado')
  await assertUser()                       // sesión válida
  // RLS en Postgres agrega el filtro tenant_id automáticamente
  return db.insertProperty({ ...input, tenant_id: t.id })
}
```

---

## 7. Seguridad Multi-Tenant (crítico)

Capas de aislamiento (defense-in-depth), de afuera hacia adentro:

1. **Middleware:** solo *routing* (resuelve tenant). NUNCA es la capa de auth (CVE-2025-29927).
2. **Header `x-tenant-id`:** conveniencia para RSC. Un cliente podría intentar spoofearlo → por eso el server **re-resuelve el tenant desde el host** en superficies sensibles y no confía ciegamente en el header entrante. (En Vercel, los headers seteados por el middleware con `NextResponse.rewrite` no son inyectables por el cliente, pero validamos igual.)
3. **Sesión Supabase:** el usuario pertenece a un `tenant_id`. Al autenticar, verificar que `session.tenant_id === tenantResueltoPorHost`. Un usuario de col no opera en mex.
4. **RLS en Postgres (source of truth):** toda query filtra por `tenant_id = current_setting('app.current_tenant')`. Es la garantía final de que no hay fuga de datos entre comunidades, aunque falle todo lo anterior. **Coordinar con el agente de datos** para setear `app.current_tenant` por request (vía `set_config` en el pooler o en cada conexión).
5. **Server Actions / Route Handlers:** cada mutación valida (a) módulo habilitado, (b) rol del usuario, (c) pertenencia al tenant.

> **Skill recomendada para el plan maestro:** `multi-tenant-safety-checker` y `supabase-audit-rls` para auditar el aislamiento antes de producción.

---

## 8. Trade-offs y Riesgos

| Área | Decisión | Trade-off / Riesgo | Mitigación |
|------|----------|--------------------|-----------|
| Resolución de tenant | Edge Config para `domain→tenantId` | Edge Config tiene límite de tamaño (~512KB / plan); miles de dominios podrían no entrar | Con cientos de tenants entra sobrado. Si escala a miles: mover a Vercel KV/Redis con cache en memoria del edge. |
| Middleware runtime | Node.js (v16) | Node runtime en middleware tiene arranque algo mayor que Edge | Fluid Compute mitiga cold starts. El lookup es Edge Config (rápido) igual. |
| Manifest dinámico | Route handler `force-dynamic` | No se cachea → costo por request de instalación | El manifest se pide pocas veces (instalación/refresh), no en cada navegación. Aceptable. |
| Theming por CSS vars | Colores en runtime | FOUC si las vars no llegan en el primer paint | Se inyectan en el `<html style>` del RSC → llegan en el HTML inicial, sin flash. |
| Fuentes | Catálogo curado | El tenant no puede subir "cualquier" fuente | Es lo correcto para white-label (licencias, CLS). Documentar como decisión de producto. |
| Dominios apex | A record manual del cliente | El tenant debe configurar DNS (fricción no-técnica) | Panel con instrucciones claras + polling de estado + soporte. Para subdominios `*.comunidadlatina.com` es 100% automático (cero DNS del cliente). |
| Límite de dominios Vercel | Unlimited requiere Pro/Enterprise | Costo de plataforma | Dependencia comercial. Cuantificar en el plan maestro (Vercel for Platforms pricing). |
| Verificación de dominio | API a veces reporta `verified:true` prematuro | Falso positivo de "listo" | Pollear `GET domains/{d}/config.misconfigured`, no el `verified` inicial. |
| SSL wildcard | Requiere nameservers de Vercel | Ceder control de DNS del dominio raíz | Solo afecta a `comunidadlatina.com` (el nuestro), no a los apex de tenants. Aceptable. |
| Cache de config | `unstable_cache` (deprecándose) | Migración futura a `'use cache'` | Migración mecánica con codemod. Encapsulado en `getTenant()` → un solo lugar a cambiar. |
| iOS PWA | Sin `beforeinstallprompt` | UX de instalación manual en iOS | Componente `InstallPrompt` con instrucciones nativas iOS. |
| Realtime a escala | Supabase Realtime por tenant | Muchos canales concurrentes | Namespacing de canales por `tenant_id`; revisar límites de conexiones del plan Supabase con el agente de datos. |

---

## 9. Dependencias e Inputs Pendientes (para coordinar)

**Del agente de datos (Postgres):**
- Esquema de `tenants` y `tenant_config` con columnas: branding (jsonb con colores en formato RGB triplete), `modules` (jsonb), `locale`, `currency`, `seo` (jsonb), `status`, `host`.
- RLS por `tenant_id` en TODAS las tablas + mecanismo para setear `app.current_tenant` por request.
- Tabla `push_subscriptions` (tenant_id, user_id, subscription jsonb, endpoint unique).

**Del agente de pagos (Stripe Connect):**
- Si los precios de planes se muestran en moneda del tenant o en USD fijo (afecta `formatMoney`).

**Decisiones de plataforma (comerciales):**
- Plan de Vercel (Pro/Enterprise para dominios unlimited).
- Habilitar Vercel Edge Config + generar `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `EDGE_CONFIG_ID`.
- Generar VAPID keys globales (`web-push generate-vapid-keys`).

**Variables de entorno mínimas:**
```
VERCEL_API_TOKEN=            # gestión de dominios
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
EDGE_CONFIG=                 # connection string del Edge Config
EDGE_CONFIG_ID=              # para PATCH del mapa de dominios
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # solo server, para service client
```

---

## 10. Secuencia de Build (para el plan maestro ejecutable por agentes)

1. **Fundación:** scaffold Next.js 15 + TS + Tailwind (vars mapeadas). Estructura de carpetas §6.1. `middleware.ts` con rewrite a `/_sites/[tenant]` (Edge Config mock local primero).
2. **Tenant resolution:** `getTenant()` + `unstable_cache` + tag. Wiring de `x-tenant-id`. Layout con inyección de CSS vars.
3. **White-label:** editor de branding en `admin/branding` + `revalidateTag`. Pool de fuentes. Favicon desde Storage.
4. **PWA:** `manifest.webmanifest/route.ts`, Serwist SW, headers de seguridad, InstallPrompt, web-push + VAPID.
5. **Custom domains:** `lib/vercel/add-domain.ts` + flujo `createTenant()` (Postgres → Vercel API → Edge Config PATCH) + polling de estado DNS/SSL.
6. **SEO/i18n:** `generateMetadata` por tenant, `sitemap.xml`/`robots.txt` route handlers, `next-intl` sin routing, `formatMoney`.
7. **Feature flags:** `ModuleGate`, route guards, nav dinámica, guards en Server Actions.
8. **Seguridad:** auditoría RLS + validación de pertenencia a tenant en todas las mutaciones (skills `multi-tenant-safety-checker`, `supabase-audit-rls`).

---

## Fuentes

- [Next.js — Guía Multi-tenant](https://nextjs.org/docs/app/guides/multi-tenant)
- [Next.js — Guía PWA (v16.2, act. 2026-02-11)](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Next.js — manifest.json (file convention)](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest)
- [Next.js — Discussion #61130: manifest dinámico (workaround route handler)](https://github.com/vercel/next.js/discussions/61130)
- [Next.js — unstable_cache](https://nextjs.org/docs/app/api-reference/functions/unstable_cache)
- [Next.js — Migrating to Cache Components ('use cache')](https://nextjs.org/docs/app/guides/migrating-to-cache-components)
- [Next.js — Upgrading v16 (middleware → proxy)](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Vercel — For Platforms (multi-tenant)](https://vercel.com/docs/multi-tenant)
- [Vercel — Configuring Custom Domains (Platforms)](https://vercel.com/platforms/docs/multi-tenant-platforms/configuring-domains)
- [Vercel — Add a domain to a project (REST API)](https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project)
- [Vercel — Setting up a custom domain](https://vercel.com/docs/domains/set-up-custom-domain)
- [Vercel — Platforms Starter Kit](https://vercel.com/templates/next.js/platforms-starter-kit)
- [Vercel Routing Middleware (skill vercel:routing-middleware)]
