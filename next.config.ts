import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

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

const nextConfig: NextConfig = {
  // Explícito y vacío: sin esto, `next dev` (Turbopack) ABORTA al ver el
  // `webpack()` que inyecta withSerwist ("webpack config and no turbopack
  // config"). En dev Serwist está disabled, así que Turbopack puede ignorar
  // ese webpack() tranquilamente.
  turbopack: {},
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

export default withSerwist(nextConfig);
