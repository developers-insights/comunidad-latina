import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * next.config.ts — propiedad del módulo PWA (ARQUITECTURA.md §2).
 *
 * ⚠️ Serwist + Turbopack: `@serwist/next` inyecta el service worker vía plugin
 * de WEBPACK. Next 16 usa Turbopack por default, que ignora `webpack()`:
 *  - `next dev` (Turbopack): sin SW — intencional, `disable` en dev igualmente.
 *  - `next build` (Turbopack): compila OK pero NO emite public/sw.js.
 *  - `next build --webpack`: build de producción CON service worker. ✅
 * Por eso el script `build` de package.json corre `next build --webpack`.
 * Si algún día se quiere Turbopack en prod: migrar a `@serwist/turbopack`.
 */

/** Hash de un archivo de /public para versionar su entrada de precache. */
function publicFileRevision(relativePath: string): string {
  try {
    return createHash("md5")
      .update(readFileSync(path.join(process.cwd(), "public", relativePath)))
      .digest("hex")
      .slice(0, 16);
  } catch {
    return "missing";
  }
}

// La página /~offline cambia con cada build (chunks nuevos) → revision única
// por build para que el SW la re-precachee al actualizarse.
const buildRevision = createHash("md5")
  .update(`${Date.now()}-${process.env.VERCEL_GIT_COMMIT_SHA ?? "local"}`)
  .digest("hex")
  .slice(0, 16);

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // Nota: definir additionalPrecacheEntries reemplaza el glob default de
  // /public — a propósito: NO precacheamos los hero PNG (~1 MB c/u) en la
  // primera visita de un público con datos móviles limitados. Solo lo que la
  // experiencia offline necesita de verdad:
  additionalPrecacheEntries: [
    { url: "/~offline", revision: buildRevision },
    {
      url: "/images/empty-state-search.png",
      revision: publicFileRevision("images/empty-state-search.png"),
    },
    { url: "/icons/icon-192.png", revision: publicFileRevision("icons/icon-192.png") },
    { url: "/icons/icon-512.png", revision: publicFileRevision("icons/icon-512.png") },
    {
      url: "/icons/maskable-512.png",
      revision: publicFileRevision("icons/maskable-512.png"),
    },
  ],
});

// Host real del proyecto Supabase (fotos de listings/avatars/tenant-assets)
// para el allowlist de next/image. El wildcard *.supabase.co cubre cualquier
// proyecto cloud; el bloque del env cubre además self-hosted / local.
type RemotePattern = NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
>[number];

function supabaseRemotePattern(): RemotePattern | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith(".supabase.co")) return null; // ya cubierto
    return {
      protocol: url.protocol === "http:" ? "http" : "https",
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
      pathname: "/storage/v1/object/public/**",
    };
  } catch {
    return null;
  }
}

const envPattern = supabaseRemotePattern();

// ---------------------------------------------------------------------------
// Security headers (módulo PRODUCTION READINESS — edición aditiva, coordinada
// con el módulo emails-sentry que envuelve este config con withSentryConfig).
// ---------------------------------------------------------------------------

/**
 * CSP en modo ENFORCING (`Content-Security-Policy`).
 *
 * Validado en vivo con Playwright sobre build de PRODUCCIÓN (`next start`),
 * 2026-07-22, recorriendo rutas públicas y logueadas (feed, propiedades,
 * marketplace, videos, perfil, mensajes, notificaciones, legales). Bajo
 * report-only aparecieron exactamente dos clases de violación, ambas resueltas
 * antes de pasar a enforcing:
 *  - `media-src`: los <video> de Supabase Storage (reels del feed y /videos)
 *    caían al fallback `default-src 'self'` porque media-src no estaba
 *    declarada → se agregó (mismo host ya permitido en img-src/connect-src).
 *  - `https://images.pexels.com` en img-src: las fotos del DEMO se sirven desde
 *    Pexels (contenido de SEED — `scripts/seed-images.json`; no hay uso en
 *    `src/`). El entorno desplegado HOY es el demo, que sirve esas URLs desde
 *    la DB, así que se permite explícitamente para no romperlo bajo enforcing.
 *    ⚠️ DEUDA: es un artefacto de demo. Cuando el contenido demo migre a
 *    Supabase Storage (o en un tenant de producción real, donde las fotos de
 *    usuarios van a Storage), QUITAR esta entrada — producción no necesita
 *    Pexels.
 * Ningún otro recurso (Stripe, OpenAI, Sentry, fuentes) violó la política.
 *
 * - script-src: 'unsafe-inline' + js.stripe.com para Stripe.js (Checkout/Identity).
 *
 *   ¿SE PUEDE SACAR EL 'unsafe-inline' CON UN NONCE? (evaluado 2026-08-02
 *   contra `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`,
 *   no de memoria.) Sí, Next 16 lo soporta: el proxy genera el nonce, lo mete
 *   en el header y en `x-nonce`, y Next se lo pega solo a sus scripts de
 *   hidratación. O sea que el problema NO es la hidratación.
 *
 *   El problema es el precio: "you **must use dynamic rendering** to add
 *   nonces" — un nonce se emite por request, y una página estática se generó
 *   cuando no había request. Poner nonce obliga a mover la CSP de acá al proxy
 *   y a empujar a dinámico TODA la superficie que hoy es estática, incluidas
 *   la landing y las guías `/guias/[slug]`, que existen para posicionar. Se
 *   cambiaría una mejora defensiva acotada (con `frame-ancestors 'none'`,
 *   `base-uri 'self'` y `form-action 'self'` ya puestos, el 'unsafe-inline' de
 *   script-src sólo importa si además existe una inyección de HTML) por perder
 *   el render estático del SEO. NO se hace hoy; queda anotado acá para que la
 *   próxima persona no tenga que volver a averiguarlo.
 *
 *   `style-src 'unsafe-inline'` no se puede sacar ni con nonce: el branding del
 *   tenant se pinta como ATRIBUTO `style` en <html> (ARQUITECTURA §3) y los
 *   nonces no aplican a atributos, sólo a elementos <style>.
 * - connect-src: Supabase (REST + Realtime wss), OpenAI (moderación/RAG),
 *   Sentry ingest, Stripe API.
 * - img-src: blob:/data: (previews de upload) + Storage de Supabase + Pexels (demo).
 * - media-src: <video>/<audio> de Supabase Storage + blob: (preview local).
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  // https://images.pexels.com → SOLO por las fotos del seed demo (ver deuda arriba).
  "img-src 'self' data: blob: https://*.supabase.co https://images.pexels.com",
  "media-src 'self' blob: https://*.supabase.co",
  "font-src 'self' data:",
  // https://images.pexels.com también en connect-src: el service worker (Serwist)
  // revalida las <img> con fetch() y ese fetch cae bajo connect-src, no img-src —
  // sin esto las fotos del seed demo se bloquean bajo enforcing (deuda: ver arriba).
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://images.pexels.com https://api.openai.com https://*.ingest.sentry.io https://*.sentry.io https://api.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  // HSTS: 2 años + subdominios. Vercel sirve todo por HTTPS, así que es seguro.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nada de la app necesita ser embebida en iframes de terceros (anti-clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // COOP: corta la relación con quien nos abrió, así una pestaña de otro origen
  // no conserva una referencia a nuestra ventana (XS-Leaks, tabnabbing inverso).
  // `same-origin-allow-popups` y no `same-origin` a propósito: la variante dura
  // también rompería un popup que ABRIÉRAMOS nosotros, y los flujos de Stripe
  // (Checkout, Identity, 3DS) pueden usar uno. Esta variante nos aísla del
  // opener sin tocar lo que abrimos.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // CORP a nivel global NO se pone: aplica a cómo TERCEROS embeben nuestros
  // recursos, y `same-origin` bloquearía que WhatsApp/Facebook levanten la
  // og:image al compartir un aviso — que es un canal de distribución real de
  // este producto, no un detalle. Si algún día hay un recurso que de verdad no
  // debe embeberse, va con CORP en su propia ruta, no acá.
  // Permissions mínimas: no usamos cámara/mic/geo desde el navegador.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // Explícito y vacío: sin esto, `next dev` (Turbopack) ABORTA al ver el
  // `webpack()` que inyecta withSerwist ("webpack config and no turbopack
  // config"). En dev Serwist está disabled, así que Turbopack puede ignorar
  // ese webpack() tranquilamente.
  turbopack: {},
  // Entrada del demo directo al login (feedback de revisión: la landing es un
  // "para después"; lo primero que interesa es la app tras el registro). 307
  // temporal a propósito — reversible sin cache agresivo: borrar este bloque
  // devuelve la landing en `/`. La landing sigue viva en el repo, solo deja de
  // ser la puerta de entrada. Los subpaths de (marketing) —/guias, etc.— no se
  // tocan.
  async redirects() {
    return [
      { source: "/", destination: "/entrar", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    // AVIF primero (~20% menos bytes que webp, doc image.md §formats), webp de
    // fallback. El default de Next 16 es SOLO ['image/webp'] → sin esta línea
    // AVIF nunca se emite. Afecta a TODO lo que pasa por /_next/image: fotos de
    // listings/avatars (Supabase Storage), covers de guías y el hero.
    formats: ["image/avif", "image/webp"],
    // Next 16 exige un allowlist de qualities para permitir cualquier valor
    // distinto del default (75). 62 se usa en fotos UGC de tarjetas chicas
    // (≤512px), donde es visualmente indistinguible pero pesa bastante menos.
    qualities: [62, 75],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      // Pexels: fotos del seed demo. Evita el 400 del optimizador si algún
      // componente rutea una URL de Pexels por next/image (deuda: quitar al
      // migrar el contenido demo a Supabase Storage).
      {
        protocol: "https",
        hostname: "images.pexels.com",
        pathname: "/**",
      },
      ...(envPattern ? [envPattern] : []),
    ],
  },
  // Reescribe `import { X } from '@phosphor-icons/react[...]'` a imports directos
  // por-ícono: garantiza tree-shaking uniforme (aunque webpack ya lo hace con
  // sideEffects:false) y acelera dev/HMR. Aditivo: no toca turbopack:{} ni el
  // pipeline Serwist/Sentry. Ref: docs/.../optimizePackageImports.md
  experimental: {
    optimizePackageImports: [
      "@phosphor-icons/react",
      "@phosphor-icons/react/dist/ssr",
    ],
  },
};

const baseConfig = withSerwist(nextConfig);

/**
 * Sentry (módulo OBSERVABILIDAD): withSentryConfig SOLO si hay DSN en build.
 * Sin DSN (hoy) el build queda idéntico al de siempre — cero riesgo. Con DSN,
 * inyecta la instrumentación de webpack y (si además hay SENTRY_AUTH_TOKEN)
 * sube source maps al proyecto SENTRY_ORG/SENTRY_PROJECT.
 */
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(baseConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      // Source maps más completos para stack traces legibles en prod…
      widenClientFileUpload: true,
      // …pero jamás públicos: se borran del bundle tras subirlos.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      // Tree-shake de los logger statements del SDK en producción.
      disableLogger: true,
    })
  : baseConfig;
