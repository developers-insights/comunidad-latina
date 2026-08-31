import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { readZonaCookie, ZONA_COOKIE } from "./cookie";
import { zonasCoincidentes } from "./coincidencias";
import { resolverZona, TODA_LA_COMUNIDAD, type ZonaActiva } from "./precedencia";

/**
 * =============================================================================
 * "TU ZONA" DEL LADO DEL SERVIDOR — una sola resolución por request
 * =============================================================================
 *
 * Todo lo de este archivo está `cache()`-eado por request (React dedupe). Esto
 * importa: el header lo pide, y después CADA listado de módulo lo vuelve a
 * pedir. Sin dedupe serían siete lecturas de perfil y siete escaneos de zonas
 * en la misma navegación.
 *
 * Y hay un ahorro más grande escondido: `getZonaActiva()` NO toca la base
 * cuando la cookie ya dice algo (elegiste una zona, o elegiste ver todo). La
 * consulta al perfil ocurre sólo mientras la cookie no existe, que es el estado
 * de quien todavía no usó la feature.
 */

/** El valor CRUDO de `cl-zona`, o `null`. Nunca se usa sin sanear. */
const getZonaCookieRaw = cache(async (): Promise<string | null> => {
  try {
    const store = await cookies();
    return store.get(ZONA_COOKIE)?.value ?? null;
  } catch {
    // Fuera de un request (build estático): no hay cookie que leer.
    return null;
  }
});

/**
 * `profiles.area_label` de quien mira, o `null` (sin sesión / sin zona / falla).
 *
 * Se exporta —y no queda privada— para que los listados que ya leían esta misma
 * columna a mano la pidan por acá: `cache()` los dedupe con la resolución de la
 * zona y la lectura del perfil vuelve a ser UNA por request, no una por pantalla
 * más otra por el header.
 */
export const getAreaLabelDelPerfil = cache(async (): Promise<string | null> => {
  try {
    const userId = await getAuthUserId();
    if (!userId) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("area_label")
      .eq("id", userId)
      .maybeSingle();
    return data?.area_label ?? null;
  } catch {
    return null;
  }
});

/**
 * La zona que gobierna la navegación: cookie > perfil > toda la comunidad.
 *
 * NO conoce el `?zona=` de ningún módulo — eso es de cada pantalla, y se resuelve
 * en `resolverVistaZona`. Acá vive lo que el HEADER tiene que mostrar, que es lo
 * mismo en toda la app.
 */
export const getZonaActiva = cache(async (): Promise<ZonaActiva> => {
  const cookie = readZonaCookie(await getZonaCookieRaw());
  // La cookie ya decidió (una zona, o "toda la comunidad" explícito): no hace
  // falta ir a buscar el perfil. Una cookie ILEGIBLE no decide nada y cae al
  // perfil, igual que si no existiera — que es lo que corresponde: el valor lo
  // escribe el navegador y basura no puede significar "no filtres".
  if (cookie?.modo === "todas") return TODA_LA_COMUNIDAD;
  if (cookie?.modo === "zona") return { label: cookie.label, origen: "cookie" };
  return resolverZona({ perfilZona: await getAreaLabelDelPerfil() });
});

/**
 * Las zonas que existen en esta comunidad: `distinct area_label` de lo
 * publicado.
 *
 * ── EL TECHO DE 200 Y LO QUE SIGNIFICA ──────────────────────────────────────
 * Es el mismo `limit(200)` que ya usaban los chips de /propiedades y el
 * selector de audiencia de /impulsar-post — de ahí salió esta función, para
 * que la tercera copia no existiera. Son 200 FILAS, no 200 etiquetas distintas:
 * en una comunidad grande la muestra puede no traer todos los barrios. Por eso
 * `zonasCoincidentes` siembra siempre con la zona elegida (ver su docblock): el
 * catálogo sirve para AMPLIAR el match, nunca para negarlo.
 *
 * Ante una falla devuelve la lista vacía y no lanza: sin catálogo el filtro
 * degrada a la etiqueta exacta, que es angosto pero honesto — y el estado vacío
 * de la zona ofrece la salida en un toque.
 */
/**
 * ── POR QUÉ ADEMÁS DEL `cache()` HAY UN MEMO CON VENCIMIENTO ────────────────
 *
 * `cache()` de React dedupe DENTRO de un request. Alcanza para pintar una
 * pantalla —el header y los siete listados comparten una lectura— y no alcanza
 * para el scroll infinito del feed, donde cada tanda es un request NUEVO: al
 * recorrer una comunidad entera esta consulta se repetía una vez por tanda,
 * trayendo 200 filas de `listings` cada vez para calcular un `distinct` que en
 * la práctica devuelve los mismos barrios durante días.
 *
 * Lo que se cachea es un dato PÚBLICO y por comunidad —qué barrios tienen algo
 * publicado—, sin nada de la persona que mira: no hay riesgo de servirle a
 * alguien el estado de otro, que es lo único que haría inaceptable un memo
 * compartido entre requests.
 *
 * Vive en memoria del proceso y no en Next: `cacheComponents` no está prendido
 * en este proyecto (`next.config.ts`) y prenderlo cambia la semántica de
 * renderizado de TODA la app — es una migración propia, no el peaje de una
 * optimización de una función. En serverless cada instancia calienta su copia;
 * eso es correcto para un acelerador, que ante la duda sólo puede costar un
 * viaje de más.
 *
 * `VENCIMIENTO_MS` es corto a propósito: el precio de estar desactualizado es
 * que un barrio recién estrenado tarde hasta cinco minutos en ensanchar el
 * match de la zona, y `zonasCoincidentes` ya siembra con la zona elegida, así
 * que ese barrio nunca desaparece del filtro — sólo tarda en sumar vecinos.
 */
const VENCIMIENTO_MS = 5 * 60 * 1000;
const zonasPorTenant = new Map<string, { zonas: string[]; vence: number }>();

/** Sólo para los tests: nada de estado colgado entre casos. */
export function _olvidarZonasCacheadas(): void {
  zonasPorTenant.clear();
}

export const listarZonasDelTenant = cache(async (tenantId: string): Promise<string[]> => {
  const guardado = zonasPorTenant.get(tenantId);
  if (guardado && guardado.vence > Date.now()) return guardado.zonas;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("listings")
      .select("area_label")
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .not("area_label", "is", null)
      .limit(200);
    if (error) {
      console.warn("[zona] no se pudieron leer las zonas de la comunidad", { code: error.code });
      // Un fallo NO se guarda: cachear el vacío durante cinco minutos
      // convertiría un hipo de red en cinco minutos de filtro angosto.
      return [];
    }
    const zonas = [
      ...new Set(
        (data ?? [])
          .map((row) => row.area_label?.trim())
          .filter((label): label is string => Boolean(label)),
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
    zonasPorTenant.set(tenantId, { zonas, vence: Date.now() + VENCIMIENTO_MS });
    return zonas;
  } catch {
    return [];
  }
});

export interface VistaZona {
  /** Qué zona se está mostrando y de dónde salió. */
  zona: ZonaActiva;
  /**
   * Las etiquetas exactas para el `.in("area_label", …)`. Vacío = NO filtrar
   * (nunca "no hay nada": con zona elegida siempre trae al menos una).
   */
  areaLabels: string[];
  /**
   * `true` cuando el filtro lo puso la cookie/el perfil y no la URL. Es la
   * condición para mostrar el estado vacío propio de la zona: con `?zona=` en
   * la URL manda el filtro del módulo, que ya tiene su propio "limpiar filtros".
   */
  filtraPorPreferencia: boolean;
}

/**
 * Lo que un listado necesita para respetar la zona, resuelto de una.
 *
 * `urlZona` es el filtro propio del módulo cuando lo tiene (`?zona=` en
 * Vivienda, `?ciudad=` en Eventos). Si viene puesto, GANA: un enlace compartido
 * muestra lo que promete. Y en ese caso `areaLabels` queda vacío a propósito —
 * el módulo ya aplica su `.eq()` exacto de siempre y nada cambia.
 */
export const resolverVistaZona = cache(
  async (tenantId: string, urlZona?: string | null): Promise<VistaZona> => {
    const zonaUrl = resolverZona({ urlZona });
    if (zonaUrl.origen === "url") {
      return { zona: zonaUrl, areaLabels: [], filtraPorPreferencia: false };
    }

    const zona = await getZonaActiva();
    if (!zona.label) {
      return { zona: TODA_LA_COMUNIDAD, areaLabels: [], filtraPorPreferencia: false };
    }

    const areaLabels = zonasCoincidentes(zona.label, await listarZonasDelTenant(tenantId));
    return { zona, areaLabels, filtraPorPreferencia: areaLabels.length > 0 };
  },
);
