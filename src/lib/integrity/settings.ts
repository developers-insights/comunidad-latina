import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * =============================================================================
 * UMBRALES DE INTEGRIDAD POR COMUNIDAD
 * =============================================================================
 *
 * Hasta la 0086 el único umbral del módulo era la constante `DEFAULT_MAX_DISTANCE`
 * de `./scan.ts`: 10 bits sobre 64, igual para todas las comunidades y sin forma
 * de moverlo sin un deploy. El pliego pedía lo contrario — "los valores exactos
 * de los umbrales deben probarse con contenido real antes del lanzamiento y poder
 * modificarse desde el panel administrativo" — porque el número correcto depende
 * del tipo de contenido que sube cada comunidad, y eso no se sabe de antemano.
 *
 * LO QUE ESTE MÓDULO NO HACE: decidir. Sólo trae los números. Quién bloquea, quién
 * va a revisión y quién pasa lo sigue decidiendo `app.scan_content_asset` en SQL
 * (ver el docblock de `./scan.ts`: dos fuentes de verdad para "esto es un
 * duplicado" terminan en un bug silencioso que aparece recién con el primer
 * reclamo).
 *
 * DEGRADACIÓN: igual que todo el pipeline, nunca lanza. Si la base no responde,
 * si la función todavía no está migrada o si la fila del tenant no existe, se
 * devuelven los DEFAULTS — que son exactamente los valores que el módulo tenía
 * hardcodeados antes, así que "no pude leer la config" nunca afloja un control.
 */

export interface IntegritySettings {
  /** Distancia máxima en bits para considerar dos imágenes "la misma" (pHash 64 bits). */
  maxDistanceSimilarBits: number;
  /**
   * Por debajo de esta distancia la coincidencia es tan fuerte que se trata como
   * el mismo archivo. Siempre ≤ `maxDistanceSimilarBits`.
   */
  umbralBloqueoBits: number;
  /** El contenido marcado como comercial nunca se aprueba solo. */
  revisionHumanaObligatoriaComercial: boolean;
  /** Un duplicado exacto subido por otra cuenta frena la publicación. */
  bloquearDuplicadoDeOtroUsuario: boolean;
}

/**
 * Los defaults NO son valores de relleno: son el comportamiento que el módulo
 * tuvo desde la 0061. Si algo falla, el sistema se comporta como antes, no más
 * permisivo.
 */
export const DEFAULT_INTEGRITY_SETTINGS: IntegritySettings = {
  maxDistanceSimilarBits: 10,
  umbralBloqueoBits: 4,
  revisionHumanaObligatoriaComercial: true,
  bloquearDuplicadoDeOtroUsuario: true,
};

/** Rango sano de una distancia de Hamming sobre una huella de 64 bits. */
const MIN_BITS = 0;
const MAX_BITS = 64;

function clampBits(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < MIN_BITS || rounded > MAX_BITS) return fallback;
  return rounded;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Normaliza lo que devuelve la base. Se hace acá y no en el borde del render
 * porque un umbral inválido (negativo, 900, null) no puede convertirse en
 * "revisá todo" ni en "no revises nada": degrada al default y sigue.
 *
 * INVARIANTE QUE SE FUERZA ACÁ: el umbral de bloqueo nunca puede ser MAYOR que
 * el de similitud. Si la config quedó incoherente, bloquear más de lo que
 * siquiera se considera parecido no tiene sentido — se recorta al de similitud.
 */
export function normalizeIntegritySettings(raw: unknown): IntegritySettings {
  if (!raw || typeof raw !== "object") return DEFAULT_INTEGRITY_SETTINGS;
  const row = raw as Record<string, unknown>;

  const maxDistanceSimilarBits = clampBits(
    row.max_distance_similar_bits,
    DEFAULT_INTEGRITY_SETTINGS.maxDistanceSimilarBits,
  );
  const umbralBloqueoBits = Math.min(
    clampBits(row.umbral_bloqueo_bits, DEFAULT_INTEGRITY_SETTINGS.umbralBloqueoBits),
    maxDistanceSimilarBits,
  );

  return {
    maxDistanceSimilarBits,
    umbralBloqueoBits,
    revisionHumanaObligatoriaComercial: readBool(
      row.revision_humana_obligatoria_comercial,
      DEFAULT_INTEGRITY_SETTINGS.revisionHumanaObligatoriaComercial,
    ),
    bloquearDuplicadoDeOtroUsuario: readBool(
      row.bloquear_duplicado_de_otro_usuario,
      DEFAULT_INTEGRITY_SETTINGS.bloquearDuplicadoDeOtroUsuario,
    ),
  };
}

/**
 * Trae los umbrales de la comunidad actual.
 *
 * El `tenant_id` NO se pasa por parámetro a propósito: la función de la base lo
 * deriva de `app.current_tenant_id()`. Aceptarlo desde la app sería exactamente
 * el agujero multi-tenant que el resto del repo evita.
 *
 * Nunca lanza. Nunca devuelve null.
 */
export async function getIntegritySettings(
  client: SupabaseClient<Database>,
): Promise<IntegritySettings> {
  try {
    // Sin cast: `get_content_integrity_settings` (0086) quedó tipada en la
    // regeneración de `database.types.ts` del 2026-08-24. Antes acá había un
    // `client as unknown as SupabaseClient` porque los tipos estaban clavados
    // en la 0076.
    const { data, error } = await client.rpc("get_content_integrity_settings");
    if (error) {
      console.warn("[integrity] no se pudieron leer los umbrales; van los defaults", {
        code: error.code,
      });
      return DEFAULT_INTEGRITY_SETTINGS;
    }
    // La función devuelve una fila; PostgREST puede entregarla suelta o en array.
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeIntegritySettings(row);
  } catch (error) {
    console.warn("[integrity] lectura de umbrales fallida; van los defaults", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return DEFAULT_INTEGRITY_SETTINGS;
  }
}
