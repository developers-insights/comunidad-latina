import type { EventCardModel } from "@/components/directory";
import { claveDeDia, estadoDelEvento } from "@/lib/eventos/vigencia";
import { extractSponsored } from "./sponsored";

export type When = "" | "mes" | "pasados";

/** Tarjeta + las fechas CRUDAS, que `EventCardModel.date` ya no conserva. */
export interface EventRow {
  card: EventCardModel;
  startsAt: string | null;
  endsAt: string | null;
}

export interface OpcionesDeListado {
  now: Date;
  timeZone: string;
  maxPasados: number;
  maxPatrocinados: number;
}

export interface ListadoDeEventos {
  patrocinados: EventCardModel[];
  proximos: EventCardModel[];
  pasados: EventCardModel[];
  /** Hay pasados debajo de una vista de próximos: necesitan su título. */
  rotularPasados: boolean;
  /** La vista de próximos quedó vacía y sólo hay pasados para mostrar. */
  sinProximos: boolean;
}

/**
 * Cuánto antes de hoy arranca la ventana de vigentes. Un evento largo que empezó
 * hace días sigue en curso, y `ends_at` no se puede filtrar desde PostgREST: de eso
 * se ocupa `armarListado`. También absorbe que la comparación sea de texto sobre un
 * JSONB, donde cada fecha trae su propio huso.
 */
const MARGEN_DE_VIGENCIA_MS = 30 * 24 * 60 * 60 * 1000;

export function corteDeVigencia(now: Date): string {
  return new Date(now.getTime() - MARGEN_DE_VIGENCIA_MS).toISOString();
}

/**
 * Filtro `.or()` de la ventana de vigentes. Los que no tienen fecha van acá para que
 * sigan apareciendo al final. La fecha va entre comillas porque `:` y `.` son
 * reservados en esta sintaxis.
 */
export function filtroDeVigentes(corte: string): string {
  return `attrs->>starts_at.gte."${corte}",attrs->>starts_at.is.null`;
}

/** Cuántos eventos anteriores al corte hacen falta para esta vista. */
export function topeDePasados(
  when: When,
  { maxEventos, maxPasados }: { maxEventos: number; maxPasados: number },
): number {
  if (when === "mes") return 0;
  return when === "pasados" ? maxEventos : maxPasados;
}

/** Junta las dos ventanas. El orden final lo pone `armarListado`. */
export function unirVentanas<T extends { id: string }>(
  vigentes: readonly T[] | null,
  pasados: readonly T[] | null,
): T[] {
  const porId = new Map<string, T>();
  for (const row of [...(vigentes ?? []), ...(pasados ?? [])]) {
    if (!porId.has(row.id)) porId.set(row.id, row);
  }
  return [...porId.values()];
}

function instanteDe(row: EventRow): number {
  const time = row.startsAt ? new Date(row.startsAt).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/** Del más cercano al más lejano, con los que no tienen fecha al final. */
function cronologico(rows: readonly EventRow[]): EventRow[] {
  return [...rows].sort((a, b) => {
    const [ta, tb] = [instanteDe(a), instanteDe(b)];
    return ta === tb ? 0 : ta - tb;
  });
}

function esDelMes(row: EventRow, { now, timeZone }: OpcionesDeListado): boolean {
  if (estadoDelEvento(row, now, timeZone) === "en_curso") return true;
  if (!row.startsAt) return false;
  const inicio = new Date(row.startsAt);
  if (Number.isNaN(inicio.getTime())) return false;
  return claveDeDia(inicio, timeZone).slice(0, 7) === claveDeDia(now, timeZone).slice(0, 7);
}

/**
 * Reparte las filas según el filtro temporal y decide qué se patrocina.
 *
 * Sin filtro se conserva lo que el cliente ya vio y aprobó: los próximos y una
 * cola corta de los últimos que pasaron. Los filtros explícitos muestran UN
 * bloque solo.
 *
 * ── POR QUÉ "PRÓXIMOS" MOSTRABA UN EVENTO TERMINADO ──────────────────────────
 * El título "Ya pasaron" sólo se pintaba si había algo arriba, así que cuando
 * todos los eventos habían terminado los pasados quedaban sueltos bajo el filtro
 * "Próximos". Y los patrocinados salían de los dos grupos: un boost todavía
 * activo subía un evento terminado arriba de todo. Por eso `rotularPasados` ya no
 * depende de lo que haya arriba, y sólo se patrocina lo que todavía no terminó.
 */
export function armarListado(
  rows: readonly EventRow[],
  when: When,
  boostedIds: ReadonlySet<string>,
  opciones: OpcionesDeListado,
): ListadoDeEventos {
  const { now, timeZone, maxPasados, maxPatrocinados } = opciones;
  const ordenados = cronologico(rows);
  const noTerminados = ordenados.filter(
    (row) => estadoDelEvento(row, now, timeZone) !== "terminado",
  );
  const terminados = ordenados
    .filter((row) => estadoDelEvento(row, now, timeZone) === "terminado")
    .reverse();
  const cards = (list: readonly EventRow[]) => list.map((row) => row.card);

  if (when === "pasados") {
    // Si alguien pidió ver lo que pasó, recortarle la lista es contestarle otra cosa.
    return {
      patrocinados: [],
      proximos: [],
      pasados: cards(terminados),
      rotularPasados: false,
      sinProximos: false,
    };
  }

  const vigentes = when === "mes" ? noTerminados.filter((r) => esDelMes(r, opciones)) : noTerminados;
  const pasados = when === "mes" ? [] : cards(terminados.slice(0, maxPasados));
  const { sponsored, rest } = extractSponsored([cards(vigentes)], boostedIds, maxPatrocinados);
  const [proximos] = rest;

  return {
    patrocinados: sponsored,
    proximos,
    pasados,
    rotularPasados: pasados.length > 0,
    sinProximos: pasados.length > 0 && sponsored.length === 0 && proximos.length === 0,
  };
}
