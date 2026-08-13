/**
 * Punto de entrada del vencimiento de publicaciones (migración 0098).
 *
 * Todo lo que se exporta acá es PURO: sin I/O, sin `server-only`. Lo consumen
 * por igual los Server Components de `/publicaciones`, el botón de renovar
 * (cliente) y los tests. Las lecturas viven en la propia ruta (`queries.ts`) y
 * las escrituras en su `actions.ts` — mismo reparto que `src/lib/comunidad`.
 */

export { VENCIMIENTO_COPY } from "./copy";

export {
  PUBLICACION_COLUMNS,
  supabaseSinTiparListings,
  type PublicacionRow,
} from "./types";

export {
  DEFAULT_EXPIRY_CONFIG,
  LISTING_KINDS,
  MOTIVOS_NO_RENOVABLE,
  calcularVencimiento,
  diasHasta,
  estadoDeVencimiento,
  isMotivoNoRenovable,
  kindVence,
  parseExpiryConfig,
  puedeRenovar,
  type EstadoVencimiento,
  type ExpiryConfig,
  type ExpiryConfigRow,
  type ListingKind,
  type MotivoNoRenovable,
  type PublicacionVencible,
  type ResultadoRenovable,
} from "./vencimiento";
