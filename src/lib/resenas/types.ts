/**
 * =============================================================================
 * RESEÑAS DE AVISOS — contrato con la base (migración 0093)
 * =============================================================================
 *
 * ⚠️ ESCAPE DE TIPOS — `src/lib/types/database.types.ts` está generado hasta la
 * 0076, así que `listing_reviews`, `listing_review_stats` y la RPC
 * `report_listing_review` todavía no existen ahí. Mientras tanto se tocan a
 * través de `supabaseSinTipar()` y de las interfaces de fila de este archivo,
 * que son transcripción literal de la migración. Es el mismo escape acotado que
 * ya usa el módulo de disputas para las tablas de la 0086, y tiene la misma
 * fecha de vencimiento: cuando se regenere el archivo de tipos, esto se borra y
 * las interfaces se reemplazan por `Tables<"listing_reviews">`.
 *
 * El cast vive en UNA función con nombre feo para que sea imposible usarlo sin
 * darse cuenta, y cada uso va pegado a la interfaz de fila que corresponde: el
 * tipado se pierde en el borde y se recupera en la línea siguiente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Puntaje mínimo y máximo — espeja `check (rating between 1 and 5)`. */
export const PUNTAJE_MIN = 1;
export const PUNTAJE_MAX = 5;

/** Espeja `check (char_length(body) <= 1000)` de la 0093. */
export const MAX_CARACTERES_RESENA = 1000;

/** Los cinco valores posibles, para pintar las estrellas sin magia. */
export const PUNTAJES: readonly number[] = [1, 2, 3, 4, 5];

/** `listing_reviews.status` — CHECK de la 0093. */
export const ESTADOS_RESENA = ["published", "hidden"] as const;
export type EstadoResena = (typeof ESTADOS_RESENA)[number];

/** Fila de `public.listing_reviews`, tal cual la 0093. */
export interface ResenaRow {
  id: string;
  tenant_id: string;
  listing_id: string;
  author_id: string;
  rating: number;
  body: string | null;
  owner_reply: string | null;
  owner_reply_by: string | null;
  owner_reply_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Fila de `public.listing_review_stats` — el agregado mantenido por trigger. */
export interface ResenaStatsRow {
  listing_id: string;
  tenant_id: string;
  rating_avg: number | string | null;
  rating_count: number;
  updated_at: string;
}

/** Una reseña ya lista para pintar, con su autor resuelto. */
export interface ResenaVista {
  id: string;
  autorId: string;
  autorNombre: string;
  autorAvatar: string | null;
  puntaje: number;
  texto: string | null;
  fecha: string;
  respuesta: string | null;
  respuestaFecha: string | null;
  /** true si la escribió quien está mirando: habilita editar y borrar. */
  esMia: boolean;
  /**
   * La firmó un NEGOCIO (0117): `autorNombre` y `autorAvatar` ya vienen con los
   * del local, y la lista le pone la insignia de tienda al avatar. Quién está
   * detrás sigue siendo `autorId` —lo necesitan "es mía", el bloqueo y la
   * moderación—, pero no se muestra: si la reseña sale a nombre del comercio,
   * mostrar además a su dueño sería revelar algo que el interruptor de perfil
   * promete no revelar.
   */
  esDeNegocio: boolean;
}

/** El resumen de puntaje de un aviso. `promedio` null = todavía nadie opinó. */
export interface ResumenPuntaje {
  promedio: number | null;
  cantidad: number;
}

/**
 * Cliente sin el genérico `Database`, para las superficies de la 0093 que
 * todavía no están en `database.types.ts`. Cast acotado y con fecha de
 * vencimiento, NO una puerta general.
 */
export function supabaseSinTipar(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}
