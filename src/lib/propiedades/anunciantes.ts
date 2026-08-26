import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { buildTrustSignals, toTrustLevel } from "@/lib/trust/signals";
import type { TrustLevel, TrustSignal } from "@/components/trust";
import type { Json } from "@/lib/types/database.types";
import { resumenDeStats, type ResumenPuntaje } from "@/lib/resenas";
import { supabaseSinTipar } from "@/lib/resenas/types";

/**
 * =============================================================================
 * «AGENTES Y PROPIETARIOS» — el directorio que la spec pide, derivado y no
 * inventado
 * =============================================================================
 *
 * Spec del cliente (§4): «Este directorio incluye propietarios, agentes
 * inmobiliarios, compañías administradoras y representantes autorizados. Cada
 * perfil debe mostrar su verificación, ciudad, calificaciones y propiedades
 * activas.»
 *
 * ── LA DECISIÓN DEL ARCHIVO: NO HAY UNA TABLA DE AGENTES, Y NO DEBE HABERLA ──
 * La tentación es crear `listings.kind = 'agent'` y pedirle a la gente que se
 * dé de alta dos veces: una como agente y otra por cada aviso. Se descartó por
 * tres motivos, en orden de peso:
 *
 *  1. NACERÍA VACÍO Y MENTIROSO. Un directorio que hay que llenar a mano
 *     arranca con cero fichas mientras la comunidad ya tiene veinte alquileres
 *     publicados, y quien lo abre concluye que no hay nadie alquilando.
 *
 *  2. LAS CUATRO CATEGORÍAS DE LA SPEC NO SON CUATRO TABLAS. Propietario,
 *     agente, administradora y representante son ROLES de la misma persona
 *     frente a un aviso, y una misma cuenta puede ser las cuatro cosas en
 *     avisos distintos. Modelarlas como fichas separadas obliga a elegir una.
 *
 *  3. EL DATO YA EXISTE, COMPLETO Y VIVO. Quién publica cada alquiler está en
 *     `listings.created_by` (cuenta de la comunidad) o en
 *     `listings.publisher_name` (fuente externa: seed, API de un portal). El
 *     directorio ES esa lista agrupada, así que no puede desactualizarse
 *     respecto de los avisos: sale de ellos.
 *
 * O sea: acá «agente o propietario» significa QUIEN TIENE ALQUILERES
 * PUBLICADOS AHORA. Es una definición que la pantalla puede sostener.
 *
 * ── LOS ANUNCIANTES EXTERNOS ENTRAN, PERO NO MIENTEN ────────────────────────
 * Un aviso importado tiene `publisher_name` y no tiene cuenta: no hay perfil
 * que abrir, ni identidad verificada, ni Trust Score. Aparece igual —es un
 * anunciante real de esta comunidad y esconderlo daría un directorio más chico
 * que el listado— pero sin insignia, sin puntaje y sin enlace a un perfil que
 * no existe. La tarjeta lo dice con la palabra, no con un vacío.
 *
 * ── EL TOPE, Y POR QUÉ NO ES PAGINACIÓN ─────────────────────────────────────
 * Se agrupan en memoria hasta `MAX_AVISOS` avisos publicados. No hay keyset
 * porque no hay una clave por la que paginar: el orden del directorio depende
 * de un conteo que sólo existe DESPUÉS de agrupar. Con el tamaño real de una
 * comunidad de barrio (decenas de alquileres, no miles) esto es una consulta y
 * media; el día que haga falta, lo que corresponde es una vista materializada
 * por comunidad, no un cursor sobre una agrupación en memoria.
 */

type Supabase = SupabaseClient<Database>;

/**
 * Techo de avisos que se leen para agrupar. 400 filas de seis columnas cortas
 * son ~40 KB: entran de sobra en una consulta y cubren cualquier comunidad
 * real. Pasado el tope, se pierden los anunciantes de los avisos MÁS VIEJOS
 * (el orden es `created_at desc`), que es exactamente el corte que menos duele:
 * quien publicó algo esta semana está seguro.
 */
const MAX_AVISOS = 400;

/** Cuántas fichas de anunciante se pintan. */
export const MAX_ANUNCIANTES = 60;

export interface AnuncianteVista {
  /**
   * Clave estable de la tarjeta. Para una cuenta es el `profiles.id`; para un
   * anunciante externo, `externo:<nombre>` — no comparten espacio de ids a
   * propósito, para que un nombre externo no pueda colisionar con un uuid.
   */
  key: string;
  nombre: string;
  avatarUrl: string | null;
  /** `null` = anunciante externo: no hay perfil que abrir. */
  profileId: string | null;
  /** Ciudad o zona donde tiene más avisos publicados. */
  zona: string | null;
  identityVerified: boolean;
  /** Trust Score de la cuenta. `null` para un anunciante externo. */
  trust: { score: number; level: TrustLevel; signals: TrustSignal[] } | null;
  /** Promedio y cantidad de reseñas sumando TODOS sus avisos activos. */
  puntaje: ResumenPuntaje;
  /** Cuántos alquileres tiene publicados ahora mismo. */
  activos: number;
}

interface FilaAviso {
  id: string;
  created_by: string | null;
  publisher_name: string | null;
  area_label: string | null;
}

/**
 * El directorio completo, ya ordenado: primero quien más avisos activos tiene y,
 * a igual cantidad, por nombre. Nunca lanza — un directorio que revienta se
 * lleva puesta la pestaña entera, y lo que corresponde ante una falla es
 * mostrarlo vacío y dejar rastro en el log.
 */
export async function fetchAnunciantesDePropiedades(
  supabase: Supabase,
  args: { tenantId: string; areaLabels?: readonly string[] },
): Promise<AnuncianteVista[]> {
  let query = supabase
    .from("listings")
    .select("id, created_by, publisher_name, area_label")
    .eq("tenant_id", args.tenantId)
    .eq("kind", "property")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(MAX_AVISOS);

  // "Tu zona" también recorta acá: un directorio que ignora la zona elegida
  // mostraría agentes de otro barrio adentro de una pantalla que dice el
  // nombre de un barrio.
  if (args.areaLabels && args.areaLabels.length > 0) {
    query = query.in("area_label", [...args.areaLabels]);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[vivienda] no se pudo leer el directorio de anunciantes", {
      code: error.code,
    });
    return [];
  }

  const avisos = (data ?? []) as FilaAviso[];
  if (avisos.length === 0) return [];

  // ---- Agrupación ---------------------------------------------------------
  interface Grupo {
    key: string;
    profileId: string | null;
    nombreExterno: string | null;
    listingIds: string[];
    zonas: Map<string, number>;
  }
  const grupos = new Map<string, Grupo>();

  for (const aviso of avisos) {
    // Con cuenta manda la cuenta, SIEMPRE: un aviso puede traer los dos campos
    // (importado y después reclamado por su dueño) y agruparlo por el nombre
    // partiría a la misma persona en dos fichas del directorio.
    const key = aviso.created_by
      ? aviso.created_by
      : aviso.publisher_name
        ? `externo:${aviso.publisher_name.trim().toLowerCase()}`
        : null;
    if (!key) continue; // Sin dueño ni nombre no hay a quién listar.

    let grupo = grupos.get(key);
    if (!grupo) {
      grupo = {
        key,
        profileId: aviso.created_by,
        nombreExterno: aviso.created_by ? null : (aviso.publisher_name?.trim() ?? null),
        listingIds: [],
        zonas: new Map(),
      };
      grupos.set(key, grupo);
    }
    grupo.listingIds.push(aviso.id);
    if (aviso.area_label) {
      grupo.zonas.set(aviso.area_label, (grupo.zonas.get(aviso.area_label) ?? 0) + 1);
    }
  }

  const profileIds = [...grupos.values()]
    .map((grupo) => grupo.profileId)
    .filter((id): id is string => Boolean(id));
  const listingIds = avisos.map((aviso) => aviso.id);

  const [perfiles, trusts, stats] = await Promise.all([
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, display_name, avatar_url, identity_verified")
          .in("id", profileIds)
      : Promise.resolve({ data: [] as never[] }),
    profileIds.length > 0
      ? supabase
          .from("trust_scores")
          .select("profile_id, score, level, signals")
          .in("profile_id", profileIds)
      : Promise.resolve({ data: [] as never[] }),
    /**
     * `listing_review_stats` (0093) es 1:1 con el aviso y la mantiene un
     * trigger: leerla es una consulta por claves primarias, no un `avg()` sobre
     * `listing_reviews` por cada anunciante. Va por `supabaseSinTipar` por el
     * mismo motivo que el resto de las superficies de la 0093.
     */
    supabaseSinTipar(supabase)
      .from("listing_review_stats")
      .select("listing_id, rating_avg, rating_count")
      .in("listing_id", listingIds),
  ]);

  const perfilPorId = new Map(
    ((perfiles.data ?? []) as Array<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      identity_verified: boolean | null;
    }>).map((fila) => [fila.id, fila]),
  );
  const trustPorId = new Map(
    ((trusts.data ?? []) as Array<{
      profile_id: string;
      score: number | null;
      level: string | null;
      signals: Json | null;
    }>).map((fila) => [fila.profile_id, fila]),
  );
  const statsPorListing = new Map(
    ((stats.data ?? []) as Array<{
      listing_id: string;
      rating_avg: number | string | null;
      rating_count: number;
    }>).map((fila) => [fila.listing_id, fila]),
  );

  const vistas: AnuncianteVista[] = [];
  for (const grupo of grupos.values()) {
    const perfil = grupo.profileId ? perfilPorId.get(grupo.profileId) : undefined;
    const trust = grupo.profileId ? trustPorId.get(grupo.profileId) : undefined;

    // El promedio del anunciante es el de TODAS sus reseñas juntas, ponderado
    // por cuántas tiene cada aviso. Promediar los promedios daría el mismo peso
    // a un aviso con una reseña que a otro con treinta.
    let suma = 0;
    let cantidad = 0;
    for (const listingId of grupo.listingIds) {
      const resumen = resumenDeStats(statsPorListing.get(listingId));
      if (resumen.promedio !== null && resumen.cantidad > 0) {
        suma += resumen.promedio * resumen.cantidad;
        cantidad += resumen.cantidad;
      }
    }

    // La zona más repetida entre sus avisos. Ante empate gana la alfabética,
    // que es arbitraria pero ESTABLE: sin desempate, la ciudad de una misma
    // ficha podía cambiar entre dos renders idénticos.
    let zona: string | null = null;
    let mejor = 0;
    for (const [etiqueta, veces] of [...grupo.zonas].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
      if (veces > mejor) {
        mejor = veces;
        zona = etiqueta;
      }
    }

    vistas.push({
      key: grupo.key,
      nombre: perfil?.display_name || grupo.nombreExterno || "Anunciante",
      avatarUrl: perfil?.avatar_url ?? null,
      profileId: grupo.profileId,
      zona,
      identityVerified: Boolean(perfil?.identity_verified),
      trust: grupo.profileId
        ? {
            score: trust?.score ?? 0,
            level: toTrustLevel(trust?.level),
            signals: buildTrustSignals(trust?.signals ?? {}, Boolean(perfil?.identity_verified)),
          }
        : null,
      puntaje: {
        promedio: cantidad > 0 ? suma / cantidad : null,
        cantidad,
      },
      activos: grupo.listingIds.length,
    });
  }

  return vistas
    .sort((a, b) =>
      b.activos === a.activos ? a.nombre.localeCompare(b.nombre, "es") : b.activos - a.activos,
    )
    .slice(0, MAX_ANUNCIANTES);
}
