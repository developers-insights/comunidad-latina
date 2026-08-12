/**
 * =============================================================================
 * HORARIO DE ATENCIÓN — el modelo y sus reglas, sin nada de React ni de red
 * =============================================================================
 *
 * Espeja `listing_hours` + `listing_hours_slots` (migración 0093). Lo que la
 * base decidió y acá se respeta al pie de la letra:
 *
 *   · Un TRAMO es un día + hora de apertura + hora de cierre.
 *   · CERRADO no es una bandera: es un día SIN tramos. La ausencia es el dato.
 *   · El corte del mediodía son dos tramos del mismo día.
 *   · Si el cierre es MENOR que la apertura, el tramo cruza la medianoche
 *     (20:00 → 02:00 termina al día siguiente).
 *   · ABIERTO 24 H se escribe 00:00 → 24:00. `opens === closes` está prohibido
 *     porque sería ambiguo entre "cero minutos" y "todo el día".
 *
 * ── LOS DÍAS SE NUMERAN COMO EN JAVASCRIPT ───────────────────────────────────
 * 0 = domingo … 6 = sábado, igual que `Date#getDay()` y que la columna
 * `weekday` de la migración. Es la misma numeración en los tres lados a
 * propósito: cada conversión de índice de día es un bug de fin de semana
 * esperando a que alguien lo encuentre en producción un domingo.
 *
 * ── TODO ACÁ ES PURO ─────────────────────────────────────────────────────────
 * Ninguna función de este archivo lee el reloj ni la red. "Ahora" siempre entra
 * por parámetro (`apertura.ts`), que es lo que hace testeable el borde de la
 * medianoche sin esperar a la medianoche.
 */

/** Minutos que tiene un día. 24:00 es exactamente este número. */
export const MINUTOS_POR_DIA = 1440;

/** Minutos que tiene una semana — el lienzo sobre el que se resuelve todo. */
export const MINUTOS_POR_SEMANA = MINUTOS_POR_DIA * 7;

/** Techo de tramos por día: lo mismo que exige `app.listing_hours_slots_limite`. */
export const MAX_TRAMOS_POR_DIA = 3;

/** Un día de la semana, con la numeración de `Date#getDay()`. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DIAS_SEMANA: readonly DiaSemana[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * El orden en que se MUESTRA la semana. Empieza en lunes porque así se lee un
 * horario comercial; el índice sigue siendo el de JavaScript.
 */
export const ORDEN_SEMANA: readonly DiaSemana[] = [1, 2, 3, 4, 5, 6, 0];

export const NOMBRE_DIA: Record<DiaSemana, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
};

export const NOMBRE_DIA_CORTO: Record<DiaSemana, string> = {
  0: "Dom",
  1: "Lun",
  2: "Mar",
  3: "Mié",
  4: "Jue",
  5: "Vie",
  6: "Sáb",
};

/** Un tramo tal como viaja entre la base y la UI. Horas en formato "HH:MM". */
export interface Tramo {
  weekday: DiaSemana;
  /** "HH:MM" en la zona del negocio. Siempre menor a "24:00". */
  opensAt: string;
  /** "HH:MM" en la zona del negocio. "24:00" significa fin del día. */
  closesAt: string;
}

/** Un tramo ya resuelto a minutos, que es como se hacen las cuentas. */
export interface TramoEnMinutos {
  weekday: DiaSemana;
  /** Minutos desde la medianoche del día de apertura. */
  desde: number;
  /** Cuántos minutos dura. Siempre mayor a 0 y menor o igual a 1440. */
  duracion: number;
}

const HORA_RE = /^([0-9]{1,2}):([0-9]{2})$/;

/**
 * "HH:MM" → minutos desde la medianoche, o `null` si no es una hora.
 *
 * Acepta "24:00" —que es lo que la base guarda para el fin del día— y rechaza
 * "24:30", que no existe. También acepta lo que Postgres devuelve con segundos
 * ("09:00:00"), porque `time` se serializa así en PostgREST.
 */
export function minutosDeHora(valor: string | null | undefined): number | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().slice(0, 5);
  const match = HORA_RE.exec(limpio);
  if (!match) return null;
  const horas = Number(match[1]);
  const minutos = Number(match[2]);
  if (!Number.isInteger(horas) || !Number.isInteger(minutos)) return null;
  if (horas < 0 || horas > 24 || minutos < 0 || minutos > 59) return null;
  const total = horas * 60 + minutos;
  if (total > MINUTOS_POR_DIA) return null;
  return total;
}

/** Minutos desde la medianoche → "HH:MM". 1440 vuelve como "24:00". */
export function horaDeMinutos(minutos: number): string {
  const acotado = Math.max(0, Math.min(MINUTOS_POR_DIA, Math.round(minutos)));
  const horas = Math.floor(acotado / 60);
  const resto = acotado % 60;
  return `${String(horas).padStart(2, "0")}:${String(resto).padStart(2, "0")}`;
}

/**
 * Hora en formato de 12 h con am/pm, que es como la lee este público en EE. UU.
 * "24:00" se muestra como "12:00 am" del día siguiente sólo cuando corresponde;
 * para el cierre de un día completo la UI usa la etiqueta de 24 h y no llega acá.
 */
export function horaLegible(minutos: number): string {
  const acotado = ((Math.round(minutos) % MINUTOS_POR_DIA) + MINUTOS_POR_DIA) % MINUTOS_POR_DIA;
  const horas24 = Math.floor(acotado / 60);
  const resto = acotado % 60;
  const sufijo = horas24 < 12 ? "am" : "pm";
  const horas12 = horas24 % 12 === 0 ? 12 : horas24 % 12;
  return `${horas12}:${String(resto).padStart(2, "0")} ${sufijo}`;
}

/** ¿El índice es un día de la semana válido? */
export function esDiaSemana(valor: unknown): valor is DiaSemana {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= 6;
}

/**
 * Tramo → minutos. Devuelve `null` si el tramo es inválido (hora ilegible,
 * apertura igual al cierre, apertura en "24:00").
 *
 * La duración es lo que resuelve el cruce de medianoche sin ramas por todos
 * lados después: un tramo pasa a ser "empieza en X, dura N minutos", y a partir
 * de ahí da lo mismo si cruza el día o no.
 */
export function tramoEnMinutos(tramo: Tramo): TramoEnMinutos | null {
  if (!esDiaSemana(tramo.weekday)) return null;
  const desde = minutosDeHora(tramo.opensAt);
  const hasta = minutosDeHora(tramo.closesAt);
  if (desde === null || hasta === null) return null;
  if (desde >= MINUTOS_POR_DIA) return null;
  if (desde === hasta) return null;

  const duracion = hasta > desde ? hasta - desde : MINUTOS_POR_DIA - desde + hasta;
  return { weekday: tramo.weekday, desde, duracion };
}

/** ¿Este tramo es cargable? Mismo criterio que los CHECK de la 0093. */
export function esTramoValido(tramo: Tramo): boolean {
  return tramoEnMinutos(tramo) !== null;
}

/** ¿Es un tramo de 24 horas (00:00 → 24:00)? */
export function esVeinticuatroHoras(tramo: Tramo): boolean {
  const enMinutos = tramoEnMinutos(tramo);
  return enMinutos !== null && enMinutos.desde === 0 && enMinutos.duracion === MINUTOS_POR_DIA;
}

/**
 * Minuto absoluto dentro de la semana en que arranca el tramo.
 * El lienzo va de 0 (domingo 00:00) a 10079 (sábado 23:59).
 */
export function inicioEnSemana(tramo: TramoEnMinutos): number {
  return tramo.weekday * MINUTOS_POR_DIA + tramo.desde;
}

/**
 * ¿Dos tramos se pisan?
 *
 * Se comparan como intervalos sobre la semana entera y en módulo, así que el
 * cruce de medianoche —y el cruce de sábado a domingo, que es el mismo problema
 * corrido— sale gratis. Tocarse en el borde NO es solaparse: un tramo que cierra
 * 13:00 y otro que abre 13:00 son válidos (y son, de hecho, el mismo negocio
 * partiendo el día por otra razón).
 */
export function tramosSeSolapan(a: Tramo, b: Tramo): boolean {
  const ma = tramoEnMinutos(a);
  const mb = tramoEnMinutos(b);
  if (!ma || !mb) return false;

  const inicioA = inicioEnSemana(ma);
  const inicioB = inicioEnSemana(mb);

  // Distancia de B respecto de A, avanzando en el tiempo circular de la semana.
  const offset = (inicioB - inicioA + MINUTOS_POR_SEMANA) % MINUTOS_POR_SEMANA;
  const offsetInverso = (MINUTOS_POR_SEMANA - offset) % MINUTOS_POR_SEMANA;

  return offset < ma.duracion || offsetInverso < mb.duracion;
}

/** El primer par de tramos que se pisa, o `null` si el horario es consistente. */
export function primerSolapamiento(tramos: readonly Tramo[]): [Tramo, Tramo] | null {
  for (let i = 0; i < tramos.length; i += 1) {
    for (let j = i + 1; j < tramos.length; j += 1) {
      if (tramosSeSolapan(tramos[i], tramos[j])) return [tramos[i], tramos[j]];
    }
  }
  return null;
}

export type ErrorHorario =
  | { codigo: "tramo_invalido"; tramo: Tramo }
  | { codigo: "demasiados_tramos"; weekday: DiaSemana }
  | { codigo: "solapado"; tramos: [Tramo, Tramo] };

/**
 * Valida un horario completo antes de mandarlo a guardar. Es la misma vara que
 * la base, adelantada al formulario para que el error se lea en español y no
 * como un 23514 de Postgres.
 */
export function validarHorario(tramos: readonly Tramo[]): ErrorHorario[] {
  const errores: ErrorHorario[] = [];

  for (const tramo of tramos) {
    if (!esTramoValido(tramo)) errores.push({ codigo: "tramo_invalido", tramo });
  }
  if (errores.length > 0) return errores;

  for (const dia of DIAS_SEMANA) {
    const delDia = tramos.filter((t) => t.weekday === dia);
    if (delDia.length > MAX_TRAMOS_POR_DIA) {
      errores.push({ codigo: "demasiados_tramos", weekday: dia });
    }
  }

  const solapado = primerSolapamiento(tramos);
  if (solapado) errores.push({ codigo: "solapado", tramos: solapado });

  return errores;
}

/** Los tramos de un día, ordenados por hora de apertura. */
export function tramosDelDia(tramos: readonly Tramo[], weekday: DiaSemana): Tramo[] {
  return tramos
    .filter((tramo) => tramo.weekday === weekday)
    .sort((a, b) => (minutosDeHora(a.opensAt) ?? 0) - (minutosDeHora(b.opensAt) ?? 0));
}

/** La semana entera lista para pintar, en orden de lunes a domingo. */
export function semanaOrdenada(
  tramos: readonly Tramo[],
): { weekday: DiaSemana; nombre: string; tramos: Tramo[] }[] {
  return ORDEN_SEMANA.map((weekday) => ({
    weekday,
    nombre: NOMBRE_DIA[weekday],
    tramos: tramosDelDia(tramos, weekday),
  }));
}
