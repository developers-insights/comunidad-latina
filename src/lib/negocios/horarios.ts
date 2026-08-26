import "server-only";

import {
  esDiaSemana,
  estadoDeApertura,
  type DiaSemana,
  type EstadoApertura,
  type Tramo,
} from "@/lib/horarios";
import { supabaseSinTipar } from "@/lib/resenas";

/**
 * =============================================================================
 * "ABIERTOS AHORA" PARA UN LISTADO ENTERO — dos consultas, no dos por tarjeta
 * =============================================================================
 *
 * `components/negocios/horario-seccion.tsx` resuelve el horario de UNA ficha con
 * dos consultas. Ese patrón está perfecto ahí y sería un desastre acá: treinta
 * tarjetas serían sesenta consultas. Este módulo hace la MISMA lectura una sola
 * vez para toda la página y devuelve un Map — el costo crece con la cantidad de
 * TRAMOS que hay que leer, no con la cantidad de negocios en pantalla.
 *
 * ── LA CUENTA NO SE REIMPLEMENTA ────────────────────────────────────────────
 * El "¿está abierto?" sale de `estadoDeApertura()` de `lib/horarios`, la misma
 * función pura que usa la ficha y el chip que se refresca en el cliente. Acá no
 * hay una segunda versión de la regla: si el borde del horario cambia, cambia en
 * un solo lugar. Lo único propio de este archivo es CÓMO se traen los datos.
 *
 * ── LA ZONA ES LA DEL NEGOCIO, SIEMPRE ──────────────────────────────────────
 * `listing_hours.time_zone` (0093) es obligatoria justamente para esto: "abre a
 * las 9" son las 9 en la vereda del local, no las 9 del servidor de Vercel ni
 * las del teléfono de quien busca. Un negocio sin zona legible no dice nada —
 * `estadoDeApertura` devuelve `zona_desconocida` y la tarjeta no pinta el chip.
 * Preferimos no decir nada antes que decir "Abierto" con la hora equivocada.
 *
 * ── EL TECHO DEL QUERYSTRING ────────────────────────────────────────────────
 * Las lecturas de supabase-js son GET: un `.in(...)` viaja ENTERO en la URL, y
 * Kong corta el request line alrededor de los 8 KB. Un uuid con su coma son 37
 * bytes, así que el lote se corta en `MAX_IDS_POR_LOTE` y los lotes salen en
 * paralelo. Con la página de 30 (o los 90 del overfetch de filtros) alcanza un
 * solo lote; el corte está para que el día que alguien suba el límite del
 * listado esto no falle con un 414 silencioso.
 *
 * `listing_hours` / `listing_hours_slots` no están en `database.types.ts`
 * todavía (la 0093 es posterior a la última regeneración) → se leen con el
 * escape acotado `supabaseSinTipar()`, igual que `horario-seccion.tsx` y
 * `marketplace/store-directory.ts`. Cuando se regeneren los tipos, esto vuelve
 * a `Tables<"listing_hours">`.
 */

export interface HorarioDeNegocio {
  /** Zona IANA del negocio, tal cual la guardó `listing_hours`. */
  timeZone: string;
  /** Tramos del negocio, ya normalizados al modelo de `lib/horarios`. */
  tramos: Tramo[];
}

/**
 * Cuántos ids entran en un `.in(...)`. 80 × 37 bytes ≈ 3 KB de querystring:
 * queda holgado bajo el techo de ~8 KB de Kong incluso sumando el resto de la
 * URL (host, path, `select=`, `order=`).
 */
export const MAX_IDS_POR_LOTE = 80;

interface FilaHorario {
  listing_id: string;
  time_zone: string;
}

interface FilaTramo {
  listing_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
}

function enLotes<T>(items: readonly T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

/**
 * Horario de N negocios en dos consultas por lote (cabecera + tramos).
 *
 * Nunca lanza: si la lectura falla, el negocio simplemente no tiene horario
 * conocido y la tarjeta no muestra estado. Un chip de apertura que no se pudo
 * leer NO se inventa.
 */
export async function fetchHorariosDeNegocios(
  client: unknown,
  listingIds: readonly string[],
): Promise<Map<string, HorarioDeNegocio>> {
  const porNegocio = new Map<string, HorarioDeNegocio>();
  const ids = [...new Set(listingIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return porNegocio;

  const supabase = supabaseSinTipar(client);

  const resultados = await Promise.all(
    enLotes(ids, MAX_IDS_POR_LOTE).map((lote) =>
      Promise.all([
        supabase.from("listing_hours").select("listing_id, time_zone").in("listing_id", lote),
        supabase
          .from("listing_hours_slots")
          .select("listing_id, weekday, opens_at, closes_at")
          .in("listing_id", lote)
          .order("weekday", { ascending: true })
          .order("opens_at", { ascending: true }),
      ]),
    ),
  );

  for (const [cabeceras, tramos] of resultados) {
    if (cabeceras.error) {
      console.warn("[negocios] no se pudo leer la zona horaria de un lote de negocios", {
        code: (cabeceras.error as { code?: string }).code,
      });
      continue;
    }
    for (const fila of (cabeceras.data ?? []) as FilaHorario[]) {
      // La zona la valida la base en dos capas (formato + existencia real, 0093).
      // Acá alcanza con que venga: `estadoDeApertura` devuelve `zona_desconocida`
      // sola si el motor de Intl no la reconoce.
      if (typeof fila.time_zone !== "string" || fila.time_zone.length === 0) continue;
      porNegocio.set(fila.listing_id, { timeZone: fila.time_zone, tramos: [] });
    }

    if (tramos.error) {
      console.warn("[negocios] no se pudieron leer los tramos de un lote de negocios", {
        code: (tramos.error as { code?: string }).code,
      });
      continue;
    }
    for (const fila of (tramos.data ?? []) as FilaTramo[]) {
      const horario = porNegocio.get(fila.listing_id);
      // Un tramo sin cabecera es imposible por FK, pero si la cabecera no se
      // pudo leer, el tramo se descarta: sin zona no hay forma de interpretarlo.
      if (!horario || !esDiaSemana(fila.weekday)) continue;
      horario.tramos.push({
        weekday: fila.weekday as DiaSemana,
        opensAt: fila.opens_at,
        closesAt: fila.closes_at,
      });
    }
  }

  return porNegocio;
}

/**
 * Estado de apertura de cada negocio en un instante dado.
 *
 * `ahora` entra por parámetro (y no se lee de `Date.now()` acá adentro) por dos
 * motivos: se puede testear el borde del horario a cualquier hora, y las treinta
 * tarjetas de una página se calculan todas contra el MISMO instante — con
 * `Date.now()` por tarjeta, un negocio podría quedar "abierto" y el de al lado
 * "cerrado" por el milisegundo en que se los evaluó.
 */
export function estadosDeApertura(
  horarios: ReadonlyMap<string, HorarioDeNegocio>,
  ahora: Date,
): Map<string, EstadoApertura> {
  const estados = new Map<string, EstadoApertura>();
  for (const [listingId, horario] of horarios) {
    estados.set(listingId, estadoDeApertura(horario.tramos, horario.timeZone, ahora));
  }
  return estados;
}

/**
 * ¿Cuenta como "abierto ahora" para el filtro?
 *
 * SÓLO `abierto`. Un negocio sin horario cargado no es "abierto": es un negocio
 * del que no sabemos nada, y colarlo en el filtro haría que la lista prometa
 * puertas abiertas que nadie declaró. `zona_desconocida` sigue el mismo
 * criterio — es una lectura que no se pudo interpretar, no un local atendiendo.
 */
export function estaAbiertoAhora(estado: EstadoApertura | null | undefined): boolean {
  return estado?.estado === "abierto";
}
