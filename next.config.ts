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
 * CSP en modo REPORT-ONLY para empezar: reporta violaciones sin romper nada.
 * ⚠️ Pasar a `Content-Security-Policy` (enforcing) recién después de validar
 * en staging que no hay violaciones legítimas (revisar console/Sentry).
 *
 * - script-src: 'unsafe-inline' es requisito de Next.js (scripts inline de
 *   hidratación); js.stripe.com para Stripe.js (Checkout/Identity).
 * - connect-src: Supabase (REST + Realtime wss), OpenAI (moderación/RAG),
 *   Sentry ingest, Stripe API.
 * - img-src: blob:/data: (previews de upload) + Storage de Supabase.
 */
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openai.com https://*.ingest.sentry.io https://*.sentry.io https://api.stripe.com",
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
  // Permissions mínimas: no usamos cámara/mic/geo desde el navegador.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  // Explícito y vacío: sin esto, `next dev` (Turbopack) ABORTA al ver el
  // `webpack()` que inyecta withSerwist ("webpack config and no turbopack
  // config"). En dev Serwist está disabled, así que Turbopack puede ignorar
  // ese webpack() tranquilamente.
  turbopack: {},
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      ...(envPattern ? [envPattern] : []),
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
