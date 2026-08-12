/**
 * =============================================================================
 * ¿ESTÁ ABIERTO AHORA? — la única pregunta que un horario tiene que responder
 * =============================================================================
 *
 * ── LA REGLA QUE DECIDE TODO ────────────────────────────────────────────────
 * El horario se lee con el reloj del NEGOCIO, nunca con el de quien mira. Si un
 * local de Nueva York abre a las 9, alguien en Los Ángeles tiene que leer "9:00"
 * y ver "Abierto" a las 9 de Nueva York. Es exactamente al revés que las fechas
 * de publicación, donde manda el reloj de quien lee (`lib/time/viewer-zone.ts`,
 * migración 0067): un post ocurrió en un instante y se cuenta con el reloj de
 * cada uno, pero una persiana se levanta a una hora local y a nadie le importa
 * qué hora es en la casa del que consulta.
 *
 * Por eso `listing_hours.time_zone` es obligatoria en la base, y por eso todas
 * las funciones de acá piden la zona explícitamente: no hay default silencioso
 * que pueda estar mal.
 *
 * ── LOS BORDES ──────────────────────────────────────────────────────────────
 * El minuto de apertura ESTÁ dentro (a las 9:00 en punto está abierto). El
 * minuto de cierre NO (a las 18:00 en punto ya está cerrado). Es la convención
 * de intervalo semiabierto `[apertura, cierre)`, y está así porque la
 * alternativa deja un minuto en que el local está "abierto y cerrado" cuando un
 * tramo termina justo donde arranca el siguiente.
 *
 * ── SIN DEPENDENCIAS ────────────────────────────────────────────────────────
 * La conversión a la hora local del negocio sale de `Intl.DateTimeFormat`, que
 * ya trae la base de zonas del sistema. No entra ninguna librería de fechas por
 * esto.
 */

import {
  MINUTOS_POR_DIA,
  MINUTOS_POR_SEMANA,
  horaLegible,
  inicioEnSemana,
  tramoEnMinutos,
  type DiaSemana,
  type Tramo,
} from "./modelo";

/** Un instante ya traducido al reloj del negocio. */
export interface MomentoLocal {
  weekday: DiaSemana;
  /** Minutos desde la medianoche local. */
  minutos: number;
}

const DIA_POR_ABREVIATURA: Record<string, DiaSemana> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Un instante real → qué día y qué hora es en la zona del negocio.
 *
 * Se pide en `en-US` a propósito: las abreviaturas de día en ese locale son
 * estables y conocidas, y acá no se muestra nada de lo que devuelve —sólo se
 * usa para ubicar el momento en la semana—. El texto que ve la persona sale de
 * `modelo.ts`, en español.
 *
 * Devuelve `null` si la zona no existe: preferimos no decir nada antes que
 * decir "Abierto" con la hora equivocada.
 */
export function momentoEnZona(ahora: Date, timeZone: string): MomentoLocal | null {
  try {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(ahora);

    let weekday: DiaSemana | undefined;
    let horas: number | undefined;
    let minutos: number | undefined;

    for (const parte of partes) {
      if (parte.type === "weekday") weekday = DIA_POR_ABREVIATURA[parte.value];
      if (parte.type === "hour") horas = Number(parte.value);
      if (parte.type === "minute") minutos = Number(parte.value);
    }

    if (weekday === undefined || horas === undefined || minutos === undefined) return null;
    if (!Number.isInteger(horas) || !Number.isInteger(minutos)) return null;

    // `hourCycle: "h23"` da 00–23, pero algunos motores todavía devuelven "24"
    // para la medianoche. 24:00 del lunes es 00:00 del lunes, no del martes.
    const horasNormalizadas = horas % 24;

    return { weekday, minutos: horasNormalizadas * 60 + minutos };
  } catch {
    // Zona desconocida o entorno sin datos de zonas horarias. No se traga en
    // silencio: quien llama recibe null y muestra el horario sin el estado.
    return null;
  }
}

export type EstadoApertura =
  | { estado: "sin_horario" }
  | { estado: "zona_desconocida" }
  | { estado: "abierto"; cierraA: string; tramo: Tramo }
  | { estado: "cerrado"; abreA: string | null; abreDia: DiaSemana | null };

/**
 * El estado de apertura en un instante dado.
 *
 * `ahora` entra por parámetro y no se lee de `Date.now()` acá adentro: es lo que
 * permite testear la medianoche a las tres de la tarde.
 */
export function estadoDeApertura(
  tramos: readonly Tramo[],
  timeZone: string,
  ahora: Date,
): EstadoApertura {
  if (tramos.length === 0) return { estado: "sin_horario" };

  const momento = momentoEnZona(ahora, timeZone);
  if (!momento) return { estado: "zona_desconocida" };

  const ahoraEnSemana = momento.weekday * MINUTOS_POR_DIA + momento.minutos;

  let mejorEspera = Number.POSITIVE_INFINITY;
  let proximo: { minutos: number; weekday: DiaSemana } | null = null;

  for (const tramo of tramos) {
    const enMinutos = tramoEnMinutos(tramo);
    if (!enMinutos) continue;

    const inicio = inicioEnSemana(enMinutos);
    // Cuánto hace que arrancó este tramo, avanzando en el tiempo circular.
    const transcurrido = (ahoraEnSemana - inicio + MINUTOS_POR_SEMANA) % MINUTOS_POR_SEMANA;

    if (transcurrido < enMinutos.duracion) {
      const cierre = (momento.minutos + (enMinutos.duracion - transcurrido)) % MINUTOS_POR_DIA;
      return { estado: "abierto", cierraA: horaLegible(cierre), tramo };
    }

    const espera = (inicio - ahoraEnSemana + MINUTOS_POR_SEMANA) % MINUTOS_POR_SEMANA;
    if (espera < mejorEspera) {
      mejorEspera = espera;
      proximo = { minutos: enMinutos.desde, weekday: enMinutos.weekday };
    }
  }

  if (!proximo) return { estado: "cerrado", abreA: null, abreDia: null };

  return {
    estado: "cerrado",
    abreA: horaLegible(proximo.minutos),
    abreDia: proximo.weekday,
  };
}
