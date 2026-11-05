/**
 * =============================================================================
 * ¿EN QUÉ ESTADO ESTÁ UN EVENTO? — el único criterio de fecha del módulo
 * =============================================================================
 *
 * Había tres respuestas distintas a la misma pregunta: el listado y la ficha
 * miraban sólo el inicio con 6 horas de tolerancia (y un festival de dos días
 * pasaba a "Ya pasó" la primera noche), la sección de eventos del negocio miraba
 * el día calendario, y nadie leía `ends_at`. Listado, ficha, tarjeta y negocio
 * preguntan acá.
 *
 * ── EL CRITERIO ──────────────────────────────────────────────────────────────
 *   · Con hora de fin: termina en ese instante exacto. Es el mismo para todos.
 *   · Fecha sin hora (`2026-08-15`, o un fin escrito así): es un día del
 *     calendario y dura hasta la última hora de ese día.
 *   · SIN HORA DE FIN: termina cuando se cumplen las dos cosas, se acabó el día
 *     en que empezó Y pasaron 6 horas desde el inicio. El día evita que uno que
 *     arrancó a la mañana desaparezca a media tarde, y las 6 horas que una fiesta
 *     de las 23:30 se termine a los treinta minutos. Las 6 horas son las que ya
 *     usaba la app: no se inventa una duración nueva.
 *   · Un fin ilegible, o igual o anterior al inicio, no es un fin. El formulario
 *     no deja cargarlos, pero hay datos sembrados con los dos iguales.
 *
 * ── LA ZONA ──────────────────────────────────────────────────────────────────
 * Los eventos no guardan zona propia, así que el fin del día se cuenta en la de
 * quien mira, igual que `eventDateParts` y que el resto de las fechas del repo.
 * Sólo influye en los eventos sin hora de fin: quien va a un evento suele estar
 * en la misma zona que el evento. Nunca se usa la del servidor.
 *
 * Módulo PURO: sin I/O, y `now` entra por parámetro.
 */

export type EstadoEvento = "proximo" | "en_curso" | "terminado" | "sin_fecha";

export interface FechasDelEvento {
  startsAt: string | null | undefined;
  endsAt?: string | null;
}

const TOLERANCIA_SIN_FIN_MS = 6 * 60 * 60 * 1000;

function instante(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `true` si el valor es un día suelto y no un instante: `2026-08-15`, o su
 * equivalente `…T00:00:00Z`. La misma lectura que `formatDate` (lib/utils.ts).
 */
export function esFechaSinHora(iso: string): boolean {
  return !/T\d{2}:\d{2}/.test(iso) || /T00:00(?::00)?(?:[Z+-]|$)/.test(iso);
}

/**
 * "2026-08-26": el día calendario de `date` en `timeZone`. `en-CA` es el único
 * locale cuyo formato corto es `YYYY-MM-DD`, que ordena bien como texto.
 */
export function claveDeDia(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Un día suelto se lee en UTC: es la zona que devuelve el mismo día que entró. */
function diaDelValor(iso: string, date: Date, timeZone: string): string {
  return claveDeDia(date, esFechaSinHora(iso) ? "UTC" : timeZone);
}

export function estadoDelEvento(
  { startsAt, endsAt }: FechasDelEvento,
  now: Date,
  timeZone: string,
): EstadoEvento {
  const inicio = instante(startsAt);
  if (!startsAt || !inicio) return "sin_fecha";

  const hoy = claveDeDia(now, timeZone);
  const diaDeInicio = diaDelValor(startsAt, inicio, timeZone);
  const yaEmpezo = esFechaSinHora(startsAt) ? hoy >= diaDeInicio : now >= inicio;
  if (!yaEmpezo) return "proximo";

  const fin = instante(endsAt);
  if (endsAt && fin && fin > inicio) {
    const yaTermino = esFechaSinHora(endsAt)
      ? hoy > diaDelValor(endsAt, fin, timeZone)
      : now >= fin;
    return yaTermino ? "terminado" : "en_curso";
  }

  const pasoElDia = hoy > diaDeInicio;
  const pasoLaTolerancia = now.getTime() - inicio.getTime() >= TOLERANCIA_SIN_FIN_MS;
  return pasoElDia && pasoLaTolerancia ? "terminado" : "en_curso";
}

export function eventoTerminado(
  fechas: FechasDelEvento,
  now: Date,
  timeZone: string,
): boolean {
  return estadoDelEvento(fechas, now, timeZone) === "terminado";
}
