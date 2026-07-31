/**
 * NOTIFICACIONES — agrupación de interacciones repetidas (`group_key`, 0045).
 *
 * Veinte "me gusta" en un video son veinte filas o una que dice "y 18 personas
 * más". El contrato de la clave lo fija la base:
 *
 *     group_key = '<kind>:<sujeto_kind>:<sujeto_id>'      (3..200 caracteres)
 *
 * y el emisor BUSCA PRIMERO la fila viva (misma clave, sin leer y sin descartar)
 * para actualizarla. No hay upsert: el índice es parcial y a propósito no es
 * unique — PostgREST no sabe emitir ON CONFLICT contra un índice parcial, y un
 * unique convertiría cada carrera en una notificación perdida.
 *
 * NO HAY COLUMNA DE CONTADOR, y no se inventa una: el "18" se recalcula del
 * dato real del sujeto (`posts.like_count`) en el momento de emitir. Un contador
 * paralelo en la notificación se desincroniza el primer día que alguien saca su
 * me gusta.
 */

const GROUP_KEY_MIN = 3;
const GROUP_KEY_MAX = 200;

/**
 * Arma la clave. Devuelve `null` si alguna parte viene vacía o si el total se
 * pasa del CHECK: mejor una notificación sin agrupar que un insert que explota.
 */
export function buildGroupKey(
  kind: string,
  subjectKind: string,
  subjectId: string,
): string | null {
  const parts = [kind, subjectKind, subjectId].map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) return null;

  const key = parts.join(":");
  if (key.length < GROUP_KEY_MIN || key.length > GROUP_KEY_MAX) return null;
  return key;
}

export type ActorSummaryOptions = {
  /**
   * Total REAL de personas involucradas (`posts.like_count`, seguidores, …).
   * Si es menor que los nombres que llegaron, mandan los nombres.
   */
  total: number;
  /** Cuántos nombres se muestran antes del "y N más". */
  maxNames?: number;
};

/**
 * "María", "María y José", "María, José y 18 personas más".
 *
 * El singular está contemplado ("y 1 persona más"): "y 1 personas más" es el
 * detalle que hace que un producto se lea como una plantilla.
 */
export function summarizeActors(
  names: readonly string[],
  { total, maxNames = 2 }: ActorSummaryOptions,
): string {
  const clean = names.map((name) => name.trim()).filter((name) => name.length > 0);
  if (clean.length === 0) return "";

  const shown = clean.slice(0, Math.max(1, maxNames));
  const others = Math.max(0, total - shown.length);

  if (others === 0) {
    if (shown.length === 1) return shown[0];
    return `${shown.slice(0, -1).join(", ")} y ${shown[shown.length - 1]}`;
  }

  const people = others === 1 ? "1 persona más" : `${others} personas más`;
  return `${shown.join(", ")} y ${people}`;
}
