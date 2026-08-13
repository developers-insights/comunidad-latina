import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Escape hatch de tipos para las columnas y la RPC de la 0098.
 *
 * `src/lib/types/database.types.ts` es GENERADO: hasta que alguien lo regenere,
 * no conoce `listings.expires_at`, `listings.renewal_count`,
 * `public.listing_expiry_config` ni `public.renovar_publicacion()`. El cliente
 * tipado rechazaría esos nombres en tiempo de compilación aunque existan en la
 * base.
 *
 * Es exactamente el mismo patrón —y el mismo motivo— que
 * `supabaseSinTiparComunidad` en 0096. Se castea a `SupabaseClient` SIN
 * genérico, no a `any`: el cliente sigue tipado en su forma (métodos, promesas,
 * `{ data, error }`), lo único que se pierde es el catálogo de columnas.
 *
 * CUÁNDO BORRAR ESTO: cuando se regenere `database.types.ts`. Un `select` de una
 * columna que no existe falla igual en runtime, así que esto no oculta errores
 * reales; sólo evita que el typecheck bloquee una migración ya aplicada.
 */
export function supabaseSinTiparListings(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/** Fila cruda de `listings` con lo que necesita la pantalla de vencimientos. */
export type PublicacionRow = {
  id: string;
  kind: string;
  title: string;
  status: string;
  photos: string[] | null;
  published_at: string | null;
  created_at: string;
  expires_at: string | null;
  expiry_warn_at: string | null;
  expired_at: string | null;
  renewal_count: number | null;
};

/** Columnas que pide la pantalla. Una sola definición para query y tipo. */
export const PUBLICACION_COLUMNS =
  "id, kind, title, status, photos, published_at, created_at, expires_at, expiry_warn_at, expired_at, renewal_count";
