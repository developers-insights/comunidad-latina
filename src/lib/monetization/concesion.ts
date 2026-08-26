import "server-only";

/**
 * =============================================================================
 * UNA CONCESIÓN POR PAGO — el gate de idempotencia de los productos por
 * suscripción
 * =============================================================================
 *
 * QUÉ PROBLEMA RESUELVE
 *
 * Los dos productos de pago único (impulso de aviso, campaña de post) gatean su
 * activación en el `WHERE` del UPDATE (`.eq("status","pending_payment")`), así
 * que dos entregas del mismo pago no duplican nada: Postgres serializa y la
 * segunda no matchea ninguna fila. Ver `activateBoost` en
 * `src/app/api/webhooks/stripe/route.ts`.
 *
 * Los TRES productos por suscripción no tenían ese gate. Cada uno hacía un
 * `upsert` a ciegas (`onConflict` sobre el sujeto) y seguía de largo hasta la
 * notificación y la fila de `audit_log`:
 *
 *   · premium de un aviso   → `listing_premiums`         (onConflict listing_id)
 *   · membresía de tienda   → `store_memberships`        (onConflict store_id)
 *   · check azul            → `verification_subscriptions` (onConflict profile_id)
 *
 * POR QUÉ `payment_events.event_id` NO ALCANZABA — es el mismo razonamiento que
 * ya está escrito en `activateBoost`, y aplica igual acá:
 *
 *   (1) DOS EVENTOS DISTINTOS, UNA MISMA CONCESIÓN. `checkout.session.completed`
 *       y `checkout.session.async_payment_succeeded` llaman al MISMO handler con
 *       la MISMA Session. Son dos `event.id` distintos, así que el índice UNIQUE
 *       sobre `event_id` los deja pasar a los dos.
 *   (2) EL ROUTE REPROCESA A PROPÓSITO. Ante un 23505 con `processed=false`
 *       —o sea, un intento anterior que murió a mitad— el webhook vuelve a
 *       correr el handler entero. Es lo correcto (si no, un fallo transitorio
 *       dejaría el beneficio sin conceder para siempre), pero significa que el
 *       handler SE VA A EJECUTAR DOS VECES sobre el mismo pago.
 *
 * Consecuencias concretas de la segunda pasada, con el `upsert` a ciegas: una
 * segunda notificación "ya está activo" a quien ya la recibió, una segunda fila
 * de auditoría para un solo pago, y —el caso caro— una entrega demorada del alta
 * que RESUCITA a `active` una suscripción que mientras tanto se canceló, con los
 * triggers espejo de 0048/0054/0101 volviendo a encender el beneficio en
 * `listings` / `profiles`.
 *
 * CÓMO LO RESUELVE
 *
 * Mueve el gate al `WHERE`, con el TOKEN DEL PAGO como predicado en vez del
 * estado (que en una suscripción no sirve: `active` es tanto el estado de
 * llegada como el de partida de una reactivación legítima).
 *
 *   1. RECLAMO — `update ... where sujeto = X and (pago is null or pago <> P)`.
 *      Si matchea, esta ejecución es la que concede. Una reactivación real
 *      (Checkout nuevo ⇒ Session/suscripción nueva) matchea, que es lo que tiene
 *      que pasar. Una re-entrega del MISMO pago no, porque la fila ya lleva P.
 *   2. ALTA — si el reclamo no matcheó ninguna fila, o bien no había fila (y
 *      entonces el `insert` es la concesión), o bien la fila ya lleva P. El
 *      `insert` distingue los dos casos por nosotros: entra, o choca 23505.
 *   3. DESAMBIGUACIÓN — ante el 23505 se relee la fila del sujeto. Si existe y
 *      lleva P, fue una re-entrega (`duplicado`). Si no existe, el choque fue
 *      contra el unique del PAGO: ese pago ya enciende OTRO sujeto
 *      (`pago_ya_usado`), que es un pago intentando comprar dos cosas.
 *
 * Se desambigua releyendo y NO parseando el texto del error a propósito: los
 * nombres de índice cambian con una migración y el `details` de PostgREST no
 * está garantizado. La relectura sólo ocurre en el camino raro (un 23505), y
 * para cuando ocurre el estado ya está decidido por el UPDATE serializado.
 *
 * NO ES UN REEMPLAZO DE LA CORRELACIÓN FISCAL. Este módulo responde "¿ya
 * concedí por este pago?", nada más. Que el monto, la moneda, el dueño y el
 * tenant sean los correctos lo sigue decidiendo cada handler ANTES de llamar
 * acá, con `pactado.ts`.
 */

/** Lo que devuelve PostgREST cuando algo sale mal. */
interface ErrorDb {
  code?: string;
  message?: string;
  details?: string;
}

export type ResultadoConcesion =
  /** Esta ejecución es la que concedió: notificar y auditar. */
  | { estado: "concedido" }
  /** Otra entrega del MISMO pago llegó primero: NO notificar ni auditar. */
  | { estado: "duplicado" }
  /** El pago ya enciende otro sujeto: no conceder y ALERTAR para reconciliar. */
  | { estado: "pago_ya_usado" }
  /** Fallo que un reintento SÍ puede arreglar: el caller tiene que lanzar. */
  | { estado: "error"; codigo?: string };

export interface Concesion {
  /** Tabla donde vive el beneficio. Ej. `"listing_premiums"`. */
  tabla: string;
  /** Columna UNIQUE que identifica al sujeto. Ej. `"listing_id"`. */
  columnaSujeto: string;
  sujeto: string;
  /**
   * Columna que guarda el token del pago dentro de la fila — el identificador
   * de idempotencia. `"stripe_checkout_session_id"` donde existe (0054);
   * `"stripe_subscription_id"` donde no (0048, 0101), que sirve igual porque
   * cada Checkout de alta crea una suscripción nueva.
   */
  columnaPago: string;
  /**
   * Valor del token. `null` ⇒ no hay con qué distinguir dos entregas y se
   * concede como antes (el caller debería dejar rastro de por qué faltó).
   */
  pago: string | null;
  /** La fila completa a escribir. Incluye `columnaSujeto` y `columnaPago`. */
  valores: Record<string, unknown>;
}

/**
 * Un token que se puede meter en un filtro `or=(...)` de PostgREST sin cambiar
 * su significado.
 *
 * El filtro se manda como TEXTO: una coma abre otra condición, un paréntesis
 * cierra el grupo y una comilla rompe el parseo. Los ids de Stripe son
 * `[A-Za-z0-9_]` y nunca traen nada de eso — pero si algún día llegara un valor
 * de otra forma, degradar a "sin predicado" (que es el comportamiento viejo,
 * seguro aunque no idempotente) es preferible a mandar un filtro deformado, que
 * podría ampliar el `WHERE` y escribir de más.
 */
function tokenUsableEnFiltro(pago: string | null): pago is string {
  return typeof pago === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(pago);
}

// Superficie mínima del cliente que usa este módulo. `database.types.ts` se
// regenera desde la base y hoy no conoce estas tres tablas (ver premium-db.ts),
// así que el cast vive acá, una sola vez, en vez de en cada handler.
/* eslint-disable @typescript-eslint/no-explicit-any */
type ClienteMinimo = { from: (tabla: string) => any };
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Concede el beneficio UNA sola vez por pago, aunque el mismo pago llegue dos
 * veces (o dos veces a la vez). Ver el docblock del módulo para el porqué.
 */
export async function concederUnaSolaVez(
  admin: unknown,
  concesion: Concesion,
): Promise<ResultadoConcesion> {
  const cliente = admin as ClienteMinimo;
  const { tabla, columnaSujeto, sujeto, columnaPago, pago, valores } = concesion;

  // ---- 1. RECLAMO -----------------------------------------------------------
  let reclamo = cliente.from(tabla).update(valores).eq(columnaSujeto, sujeto);
  if (tokenUsableEnFiltro(pago)) {
    // `is.null` cubre las filas viejas escritas antes de que existiera el token:
    // en SQL `columna <> 'X'` con la columna en NULL da NULL, no true, y sin
    // esta rama esas filas no se reclamarían nunca.
    reclamo = reclamo.or(`${columnaPago}.is.null,${columnaPago}.neq.${pago}`);
  }
  const { data: reclamadas, error: errorReclamo } = (await reclamo.select(columnaSujeto)) as {
    data: unknown[] | null;
    error: ErrorDb | null;
  };

  if (errorReclamo) {
    // Un 23505 acá es el unique del PAGO: la fila del sujeto sí existía y se
    // podía escribir, pero el token ya está tomado por otro sujeto.
    if (errorReclamo.code === "23505") return { estado: "pago_ya_usado" };
    return { estado: "error", codigo: errorReclamo.code };
  }
  if ((reclamadas ?? []).length > 0) return { estado: "concedido" };

  // ---- 2. ALTA --------------------------------------------------------------
  const { error: errorAlta } = (await cliente.from(tabla).insert(valores)) as {
    error: ErrorDb | null;
  };
  if (!errorAlta) return { estado: "concedido" };
  if (errorAlta.code !== "23505") return { estado: "error", codigo: errorAlta.code };

  // ---- 3. DESAMBIGUACIÓN ----------------------------------------------------
  const { data: fila } = (await cliente
    .from(tabla)
    .select(columnaPago)
    .eq(columnaSujeto, sujeto)
    .maybeSingle()) as { data: Record<string, unknown> | null; error: ErrorDb | null };

  if (fila && pago !== null && fila[columnaPago] === pago) return { estado: "duplicado" };
  if (fila) {
    // Hay fila para el sujeto y NO lleva este pago — pero el reclamo del paso 1
    // no la matcheó. Sólo pasa si el token no era usable en el filtro (y
    // entonces el reclamo no llevaba predicado y debería haber matcheado) o si
    // otra entrega la escribió entre medio. Se trata como duplicado: no
    // conceder es siempre la salida segura.
    return { estado: "duplicado" };
  }
  return { estado: "pago_ya_usado" };
}
