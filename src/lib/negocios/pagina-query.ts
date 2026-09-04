import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listingPhotoUrl } from "@/components/listings/helpers";
import { normalizarServicios } from "./pagina";

/**
 * Lo que la 0127 le agregó a la ficha de un negocio: sus servicios, su logo y
 * su portada.
 *
 * ── POR QUÉ UNA CONSULTA APARTE Y NO TRES COLUMNAS MÁS EN EL `select` GRANDE ─
 * Porque `database.types.ts` está generado hasta la 0076 y estas columnas no
 * existen ahí (mismo escape acotado que ya usan reseñas y el perfil activo),
 * pero sobre todo porque tiene que TOLERAR que la migración todavía no esté
 * aplicada: un entorno sin la 0127 devuelve un 42703 ("column does not exist")
 * y con las columnas dentro del select principal ese error se llevaría puesta
 * la página entera del negocio. Separada, el peor caso es una sección de
 * servicios vacía y el avatar de siempre — que es exactamente el estado
 * anterior a esta migración.
 *
 * Es el mismo criterio que ya sigue `fetchPuestosDelNegocio` (0107): "en un
 * entorno sin la migración aplicada devuelve [] y la sección no se dibuja".
 */
export interface PaginaDeNegocio {
  /** Servicios ya normalizados, en el orden que los cargó el dueño. */
  servicios: string[];
  /** Path crudo del bucket — el que la RPC vuelve a validar al guardar. */
  logoPath: string | null;
  coverPath: string | null;
  /** Los mismos, ya resueltos a URL pública para pintarlos. */
  logoUrl: string | null;
  coverUrl: string | null;
}

export const PAGINA_DE_NEGOCIO_VACIA: PaginaDeNegocio = {
  servicios: [],
  logoPath: null,
  coverPath: null,
  logoUrl: null,
  coverUrl: null,
};

interface FilaPagina {
  services: string[] | null;
  logo_path: string | null;
  cover_path: string | null;
}

export async function fetchPaginaDeNegocio(
  client: unknown,
  listingId: string,
): Promise<PaginaDeNegocio> {
  try {
    const supabase = client as SupabaseClient;
    const { data, error } = await supabase
      .from("listings")
      .select("services, logo_path, cover_path")
      .eq("id", listingId)
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.warn("[negocios] no se pudo leer la página del negocio", {
          listingId,
          code: error.code,
        });
      }
      return PAGINA_DE_NEGOCIO_VACIA;
    }

    const fila = data as FilaPagina;
    const logoPath = limpiar(fila.logo_path);
    const coverPath = limpiar(fila.cover_path);

    return {
      servicios: normalizarServicios(fila.services ?? []),
      logoPath,
      coverPath,
      logoUrl: logoPath ? listingPhotoUrl(logoPath) : null,
      coverUrl: coverPath ? listingPhotoUrl(coverPath) : null,
    };
  } catch {
    return PAGINA_DE_NEGOCIO_VACIA;
  }
}

function limpiar(valor: string | null): string | null {
  const path = valor?.trim() ?? "";
  return path.length > 0 ? path : null;
}

/**
 * Logo y portada de VARIOS negocios de una, para el directorio.
 *
 * En lote y no una consulta por tarjeta: el listado ya resuelve así las
 * calificaciones y los estados de apertura, y una tarjeta que dispara su propia
 * consulta es un N+1 esperando a que la comunidad crezca.
 *
 * Tolerante por el mismo motivo que `fetchPaginaDeNegocio`: si la 0127 no está
 * aplicada, devuelve un mapa vacío y el directorio se ve exactamente como
 * antes. Estas columnas NO se agregan al `select` grande del listado justamente
 * para que un `column does not exist` no deje la sección entera vacía.
 */
export async function fetchFotosDeNegocios(
  client: unknown,
  listingIds: readonly string[],
): Promise<Map<string, { logoUrl: string | null; coverUrl: string | null }>> {
  const mapa = new Map<string, { logoUrl: string | null; coverUrl: string | null }>();
  if (listingIds.length === 0) return mapa;

  try {
    const supabase = client as SupabaseClient;
    const { data, error } = await supabase
      .from("listings")
      .select("id, logo_path, cover_path")
      .in("id", [...listingIds]);

    if (error || !data) return mapa;

    for (const fila of data as (FilaPagina & { id: string })[]) {
      const logoPath = limpiar(fila.logo_path);
      const coverPath = limpiar(fila.cover_path);
      if (!logoPath && !coverPath) continue;
      mapa.set(fila.id, {
        logoUrl: logoPath ? listingPhotoUrl(logoPath) : null,
        coverUrl: coverPath ? listingPhotoUrl(coverPath) : null,
      });
    }
    return mapa;
  } catch {
    return mapa;
  }
}
