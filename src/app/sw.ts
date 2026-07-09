/**
 * Service worker de Comunidad Latina (módulo PWA) — Serwist.
 *
 * Estrategia (§3.4 del design brief: offline-first para conexión pobre):
 *  - Precache: assets del build + /~offline + su ilustración (inyectados por
 *    @serwist/next en `self.__SW_MANIFEST` vía additionalPrecacheEntries).
 *  - Páginas (navegaciones RSC/HTML): NetworkFirst — contenido fresco si hay
 *    red, lo último guardado si no (defaultCache de @serwist/next/worker).
 *  - Imágenes y estáticos de Next: StaleWhileRevalidate (defaultCache).
 *  - Supabase Storage (fotos de listings/avatares, URLs públicas inmutables):
 *    CacheFirst con expiración — no re-descargar fotos con datos móviles.
 *  - Fallback: si una navegación falla sin cache → /~offline (página premium).
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, Serwist } from "serwist";

// Tipado mínimo del scope del worker sin sumar `lib: ["webworker"]` al
// tsconfig compartido (que ya usa "dom" y no es de este módulo).
declare const self: SerwistGlobalConfig & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
} & typeof globalThis;

/** Fotos servidas por Supabase Storage (bucket PÚBLICO): inmutables por path.
 *  Acotado a /object/public/: los objetos firmados (/object/sign/, con ?token=
 *  rotativo) y autenticados nunca dan cache-hit y no deben servirse stale desde
 *  caché tras revocar acceso → caen al defaultCache (NetworkFirst cross-origin). */
const supabaseStorageCache: RuntimeCaching = {
  matcher: ({ url }) =>
    url.hostname.endsWith(".supabase.co") &&
    url.pathname.startsWith("/storage/v1/object/public/"),
  handler: new CacheFirst({
    cacheName: "supabase-storage",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 días
        maxAgeFrom: "last-used",
      }),
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [supabaseStorageCache, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
