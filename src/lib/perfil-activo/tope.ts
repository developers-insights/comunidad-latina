/**
 * =============================================================================
 * CUÁNTOS PERFILES DE NEGOCIO PUEDE TENER UNA PERSONA
 * =============================================================================
 *
 * Pedido del cliente, textual: «Falta agregar otro negocio, ya que la persona
 * puede crear hasta 10 perfiles diferentes» (2026-08-26).
 *
 * ── ESTE NÚMERO NO AUTORIZA NADA ────────────────────────────────────────────
 * Quien decide es la base: el trigger `app.business_accounts_enforce_cap()` de
 * la migración 0121 cuenta las filas y rechaza la número once, tomando un
 * advisory lock para que dos altas simultáneas no se cuelen. Esto de acá es un
 * ESPEJO, y sirve para dos cosas y nada más:
 *
 *   1. decir "podés crear 3 más" antes de que la persona toque nada;
 *   2. no mandar a la base un alta que ya sabemos que va a rebotar.
 *
 * Si este número y el del SQL se separan, el peor caso es un cartel equivocado:
 * la persona ve "podés crear 3 más" y el alta número once igual se rechaza, con
 * el mensaje humano de `esErrorDeTope()`. Nunca al revés — la app no puede
 * conceder un lugar que la base no da.
 *
 * Se espeja con el mismo criterio que `VERTICALES_QUE_EXIGEN_IDENTIDAD` en
 * `src/lib/verificacion/gate.ts`: cuando el SQL y esto se contradigan, manda el
 * SQL, y que no se contradigan es responsabilidad de quien toque cualquiera de
 * los dos.
 *
 * ── ADMINISTRAR NEGOCIOS AJENOS NO CUENTA ───────────────────────────────────
 * El tope es sobre los negocios PROPIOS (`business_accounts.owner_id`). Ser
 * administrador de veinte negocios de otras personas no consume ni un lugar:
 * es la doctrina de la 0103 —lo que se limita es fabricar cuentas propias en
 * serie, «que es el vector de spam»— y por eso `lugaresDeNegocio()` cuenta
 * `esPropietario` y no la lista entera.
 */

/** Espejo de `app.tope_de_negocios()` (0121). Ver el encabezado. */
export const TOPE_DE_NEGOCIOS = 10;

/**
 * Prefijo del mensaje que levanta el trigger de la 0121. Es lo que permite
 * distinguir "llegaste al tope" de cualquier otro fallo: PostgREST devuelve el
 * `P0001` de un `raise exception` sin decir cuál fue, así que el código solo no
 * alcanza.
 */
const PREFIJO_TOPE = "TOPE_DE_NEGOCIOS";

/** Cuántos lugares hay, cuántos quedan y si se puede crear otro. */
export interface LugaresDeNegocio {
  /** Negocios PROPIOS que ya tiene en esta comunidad. */
  usados: number;
  /** El tope. Se devuelve para que la UI no tenga que importar la constante. */
  tope: number;
  /** Lugares libres. Nunca negativo. */
  restantes: number;
  /** ¿Puede crear otro? */
  puedeCrear: boolean;
}

/**
 * Las cuentas de una persona, en números.
 *
 * `usados` se clampea a [0, tope] a propósito: alguien puede tener HOY más
 * cuentas que el tope si el número se baja más adelante (la 0121 no aplica la
 * regla nueva hacia atrás, y avisa en el log si encuentra a alguien así).
 * Devolver `restantes: -2` haría que la UI dijera un disparate; devolver 0 dice
 * la verdad útil: no podés crear más.
 */
export function lugaresDeNegocio(
  negociosPropios: number,
  tope: number = TOPE_DE_NEGOCIOS,
): LugaresDeNegocio {
  const topeSano = Number.isFinite(tope) && tope > 0 ? Math.floor(tope) : TOPE_DE_NEGOCIOS;
  const usados = Number.isFinite(negociosPropios)
    ? Math.max(0, Math.floor(negociosPropios))
    : 0;
  const restantes = Math.max(0, topeSano - usados);
  return { usados, tope: topeSano, restantes, puedeCrear: restantes > 0 };
}

/**
 * Cuántos de estos negocios son PROPIOS.
 *
 * Toma la forma mínima —`{ esPropietario }`— para poder usarse tanto con las
 * identidades del servidor (`IdentidadNegocio`) como con las del cambiador
 * (`IdentidadNegocioUI`), que son la misma cosa con distinta cantidad de
 * campos. Una fila sin el dato NO cuenta: preferimos ofrecer un lugar de más
 * (la base lo rechaza con un mensaje humano) que decirle a alguien que llegó al
 * tope cuando no llegó.
 */
export function contarNegociosPropios(
  negocios: ReadonlyArray<{ esPropietario?: boolean }>,
): number {
  return negocios.reduce((total, negocio) => total + (negocio.esPropietario ? 1 : 0), 0);
}

/**
 * ¿Este error de PostgREST es el tope, y no otra cosa?
 *
 * Se pregunta por el PREFIJO del mensaje y no sólo por el código: `P0001` es el
 * código de cualquier `raise exception` de la base —lo usan también la guarda
 * de billing (0008) y la de columnas de reseñas (0093)—, así que confiar en él
 * solo haría que un error distinto se mostrara como "llegaste al tope".
 */
export function esErrorDeTope(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return typeof error.message === "string" && error.message.includes(PREFIJO_TOPE);
}
