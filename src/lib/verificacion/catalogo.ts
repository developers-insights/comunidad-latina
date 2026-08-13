/**
 * =============================================================================
 * CHECK AZUL — los tres escalones y qué significa cada uno
 * =============================================================================
 *
 * MÓDULO PURO a propósito (sin `server-only`, sin Supabase, sin Stripe): lo lee
 * la pantalla de contratación (client component), la insignia, el respaldo de
 * precios (`src/lib/pricing/defaults.ts`) y los tests. Mismo criterio que
 * `src/lib/boosts/scope.ts`.
 *
 * LOS MONTOS NO SE COBRAN DESDE ACÁ. Viven en `tenant_prices` (0072) y cada
 * comunidad los edita desde el panel; estas constantes son el RESPALDO para que
 * nunca exista un tenant sin precio, y la semilla de la 0101 las copia centavo
 * a centavo (hay un test que compara los dos lados).
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES Y QUÉ NO ES ESTA INSIGNIA — leer antes de tocar cualquier copy
 *
 * El check azul acredita DOS cosas, las dos verdaderas y las dos dichas en voz
 * alta en la UI:
 *   1. La identidad de la cuenta está confirmada con documento (Stripe
 *      Identity, §5.4). Eso es un HECHO comprobado por un tercero, y es el
 *      requisito previo para poder contratar.
 *   2. La cuenta paga una suscripción mensual activa.
 *
 * Y NO acredita, en ningún caso:
 *   · Que el negocio sea bueno, honesto, o esté habilitado. Eso es
 *     `verification_checks` (§11), que se comprueba contra registros oficiales
 *     y se muestra con descriptor literal y fecha.
 *   · Reputación. Pagar NO suma Trust Score (§7, no negociable).
 *
 * Escribir copy que sugiera lo contrario —"cuenta de confianza", "negocio
 * verificado por nosotros", "comprá seguro"— no es una licencia poética: es
 * exactamente lo que §11 prohíbe, porque crea un deber de cuidado sobre algo
 * que la plataforma no comprobó.
 * -----------------------------------------------------------------------------
 */

/** A quién se le vende el check. Espeja el CHECK de `subject_type` en 0101. */
export const VERIFICACION_TIERS = ["persona", "negocio", "profesional"] as const;
export type VerificacionTier = (typeof VERIFICACION_TIERS)[number];

export function isVerificacionTier(raw: unknown): raw is VerificacionTier {
  return VERIFICACION_TIERS.includes(raw as VerificacionTier);
}

export interface VerificacionPlan {
  id: VerificacionTier;
  /** Cómo se nombra en la pantalla. Nunca el identificador crudo. */
  nombre: string;
  /** USD por mes. Precio [EJEMPLO §18] — el que rige sale de `tenant_prices`. */
  precioMensualUsd: number;
  /** Para quién es, en una línea. Ayuda a elegir escalón sin leer la tabla. */
  paraQuien: string;
  /**
   * Lo que se lleva. HONESTO: describe lo que la plataforma hace, no lo que la
   * gente va a sentir. Nada de "más confianza" ni "más ventas".
   */
  incluye: string[];
  destacado: boolean;
}

/**
 * [EJEMPLO §18] Los tres precios textuales del cliente: «$6.99 para el check
 * azul», «para que un negocio tenga el check azul verificado saldría $9.99»,
 * «los profesionales para que tengan el check azul saldría $19.99».
 *
 * Terminan en .99 porque así los dijo. Un precio es una decisión comercial y no
 * se "redondea para que quede prolijo" desde el código.
 */
export const VERIFICACION_PLANES: Record<VerificacionTier, VerificacionPlan> = {
  persona: {
    id: "persona",
    nombre: "Cuenta personal",
    precioMensualUsd: 6.99,
    paraQuien: "Para vos, que usás la app para vender o hacer negocios.",
    incluye: [
      "El check azul al lado de tu nombre en toda la comunidad",
      "Un impulso de 7 días de regalo cada mes, para el aviso que vos elijas",
      "Tu identidad ya confirmada con documento, visible junto al check",
    ],
    destacado: false,
  },
  negocio: {
    id: "negocio",
    nombre: "Negocio",
    precioMensualUsd: 9.99,
    paraQuien: "Para negocios con local, tienda o servicio a la comunidad.",
    incluye: [
      "El check azul al lado del nombre de tu negocio",
      "Un impulso de 7 días de regalo cada mes, para el aviso que vos elijas",
      "Tu identidad ya confirmada con documento, visible junto al check",
    ],
    destacado: true,
  },
  profesional: {
    id: "profesional",
    nombre: "Profesional",
    precioMensualUsd: 19.99,
    paraQuien: "Para quien ofrece servicios profesionales: oficios, salud, legales.",
    incluye: [
      "El check azul al lado de tu nombre profesional",
      "Un impulso de 7 días de regalo cada mes, para el aviso que vos elijas",
      "Tu identidad ya confirmada con documento, visible junto al check",
    ],
    destacado: false,
  },
};

/** Orden canónico de render en la pantalla de contratación. */
export const VERIFICACION_TIER_IDS: readonly VerificacionTier[] = [
  "persona",
  "negocio",
  "profesional",
];

/**
 * Monto de respaldo en centavos.
 *
 * `Math.round` y no una multiplicación pelada: `6.99 * 100` da 698.9999...
 * en punto flotante, y `Math.trunc` de eso cobra USD 6.98. Es el mismo motivo
 * por el que la base guarda centavos enteros y nunca un float (ver el comentario
 * de `tenant_prices.amount_cents` en 0072).
 */
export function verificacionMontoCentavos(plan: VerificacionPlan): number {
  return Math.round(plan.precioMensualUsd * 100);
}

/** Días del impulso de regalo. Textual del cliente: «(7 días) un boost». */
export const VERIFICACION_BOOST_DIAS = 7;

/**
 * El paquete de `boosts` que representa el regalo. Tiene que existir en el
 * CHECK de `boosts.package` (0016) — por eso es '7d' y no un valor nuevo: el
 * regalo es un impulso normal, no una cuarta clase de impulso.
 */
export const VERIFICACION_BOOST_PACKAGE = "7d" as const;
