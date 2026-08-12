/**
 * =============================================================================
 * RESEÑAS — lógica pura: promedio, distribución y validación
 * =============================================================================
 *
 * Nada de acá lee la red ni el reloj. Todo entra por parámetro para que el borde
 * que importa —qué se muestra cuando NO hay reseñas— se pueda testear sin base.
 *
 * ── LA DECISIÓN QUE ATRAVIESA TODO EL ARCHIVO ────────────────────────────────
 * "Sin reseñas" NO es cero. Un negocio nuevo con 0 reseñas no vale menos que uno
 * con dos estrellas: no se sabe nada de él, que es otra cosa. Por eso el
 * promedio es `number | null` y nunca 0, y por eso `etiquetaPromedio()` devuelve
 * el texto de ausencia en vez de "0,0". Es el mismo criterio que `RatingStars`
 * de Colaboraciones, que muestra "Nuevo" en vez de cinco estrellas vacías.
 */

import { PUNTAJES, PUNTAJE_MAX, PUNTAJE_MIN, type ResumenPuntaje } from "./types";

/**
 * `listing_review_stats` viene de PostgREST con `rating_avg` como `numeric`, que
 * el driver serializa a string. Esto lo normaliza sin confundir "no hay reseñas"
 * (null) con "el promedio es cero" (que no puede pasar: el mínimo es 1).
 */
export function leerPromedio(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero)) return null;
  if (numero < PUNTAJE_MIN || numero > PUNTAJE_MAX) return null;
  return numero;
}

/** El resumen tal como lo consume la UI, tolerante a que la fila no exista. */
export function resumenDeStats(
  fila: { rating_avg: number | string | null; rating_count: number } | null | undefined,
): ResumenPuntaje {
  const cantidad = Math.max(0, Math.trunc(fila?.rating_count ?? 0));
  const promedio = cantidad > 0 ? leerPromedio(fila?.rating_avg) : null;
  return { promedio, cantidad };
}

/**
 * El promedio con UNA decimal y coma, que es como se escribe un decimal en
 * español. Devuelve `null` cuando no hay nada que promediar — quien llama
 * decide qué decir en ese caso, y nunca es "0".
 */
export function formatearPromedio(promedio: number | null): string | null {
  if (promedio === null) return null;
  return promedio.toFixed(1).replace(".", ",");
}

/**
 * Cuántas estrellas se pintan llenas. Se redondea al entero más cercano: 4,4 → 4
 * y 4,5 → 5. La cifra exacta va al lado en número, así que el redondeo es
 * decoración y no información.
 */
export function estrellasLlenas(promedio: number | null): number {
  if (promedio === null) return 0;
  return Math.min(PUNTAJE_MAX, Math.max(0, Math.round(promedio)));
}

/**
 * Distribución de puntajes (cuántas de 5, cuántas de 4…) con su porcentaje.
 * Se devuelve de mayor a menor porque es el orden en que se lee una barra de
 * reseñas en cualquier producto del mundo.
 */
export function distribucion(
  puntajes: readonly number[],
): { puntaje: number; cantidad: number; porcentaje: number }[] {
  const validos = puntajes.filter(
    (p) => Number.isInteger(p) && p >= PUNTAJE_MIN && p <= PUNTAJE_MAX,
  );
  const total = validos.length;

  return [...PUNTAJES]
    .sort((a, b) => b - a)
    .map((puntaje) => {
      const cantidad = validos.filter((p) => p === puntaje).length;
      return {
        puntaje,
        cantidad,
        porcentaje: total === 0 ? 0 : Math.round((cantidad / total) * 100),
      };
    });
}

/** ¿Es un puntaje que la base va a aceptar? Mismo rango que el CHECK. */
export function esPuntajeValido(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= PUNTAJE_MIN &&
    valor <= PUNTAJE_MAX
  );
}

/**
 * ¿Esta persona puede reseñar este aviso?
 *
 * OJO CON LO QUE ESTO ES Y LO QUE NO ES: es la versión de la UI, para decidir si
 * se muestra el formulario. La defensa real vive en `app.can_review_listing()`
 * (0093), que además excluye a los administradores del negocio consultando
 * `business_members`. Acá sólo se evita ofrecer un formulario que la base va a
 * rechazar — nunca al revés.
 */
export function puedeOfrecerseElFormulario(params: {
  usuarioId: string | null;
  publicadoPor: string | null;
  administraElAviso: boolean;
  estadoDelAviso: string;
}): boolean {
  const { usuarioId, publicadoPor, administraElAviso, estadoDelAviso } = params;
  if (!usuarioId) return false;
  if (estadoDelAviso !== "published") return false;
  if (publicadoPor === usuarioId) return false;
  if (administraElAviso) return false;
  return true;
}
