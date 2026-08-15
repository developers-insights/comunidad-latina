import { MAX_AMOUNT_CENTS, parseAmountToCents } from "@/lib/pricing/money";

/**
 * =============================================================================
 * PAQUETES DE SERVICIO DEL CREADOR — reglas puras (0102)
 * =============================================================================
 *
 * MÓDULO PURO y SIN `server-only`: los mismos límites tienen que regir en el
 * formulario (para no hacer escribir de más) y en la server action (que es la
 * frontera de verdad). Tenerlos en dos lados distintos es cómo se llega a un
 * formulario que deja escribir 300 caracteres y un servidor que rechaza a los
 * 80 sin decir por qué.
 *
 * LOS NÚMEROS SON LOS DE LA BASE. Cada límite de acá tiene su CHECK gemelo en
 * `0102_paquetes_de_servicio.sql`. Si alguno cambia, cambian los dos: la app
 * valida para poder dar un mensaje cálido, la base valida para que sea verdad.
 *
 * EL PRECIO NO SE PARSEA ACÁ. Se delega en `parseAmountToCents`
 * (src/lib/pricing/money.ts), que es el único lugar del repo donde un texto
 * tipeado por una persona se convierte en centavos — con aritmética de enteros
 * y sin flotantes de por medio. Duplicar ese parseo sería exactamente el bug de
 * un centavo que ese módulo existe para no tener.
 */

/** Tope de paquetes por creador. Lo enforcea el trigger `creator_service_packages_cap`. */
export const MAX_PACKAGES = 6;

/** Renglones del "incluye" y su largo — CHECK `app.short_text_array_ok(includes, 8, 80)`. */
export const MAX_INCLUDES = 8;
export const MAX_INCLUDE_LENGTH = 80;

export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 2000;

export const DELIVERY_DAYS_MIN = 1;
export const DELIVERY_DAYS_MAX = 365;

/** El mismo techo que `gig_contracts.amount_cents`: un paquete que no se pueda contratar sería una trampa. */
export const MAX_PRICE_CENTS = MAX_AMOUNT_CENTS;

export interface ServicePackage {
  id: string;
  title: string;
  description: string;
  includes: string[];
  priceCents: number;
  currency: string;
  deliveryDays: number;
  active: boolean;
  sortOrder: number;
}

/* -------------------------------------------------------------------------- */
/* Normalización                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Deja el "incluye" listo para guardar: sin espacios de sobra, sin vacíos, sin
 * repetidos (comparando sin distinguir mayúsculas) y recortado al tope.
 *
 * Los repetidos se sacan acá y no en la base porque un array de Postgres no
 * tiene UNIQUE por elemento, y dos renglones idénticos en una lista de "qué
 * incluye" leen como un error de quien la escribió.
 */
export function normalizeIncludes(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = item.trim().slice(0, MAX_INCLUDE_LENGTH);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_INCLUDES) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Precio                                                                     */
/* -------------------------------------------------------------------------- */

export type PriceError = "vacio" | "formato" | "cero" | "demasiado_grande";

export type PriceResult = { ok: true; cents: number } | { ok: false; reason: PriceError };

/**
 * Texto tipeado → centavos, con la regla propia de los paquetes: **cero no es
 * un precio válido acá**.
 *
 * `parseAmountToCents` acepta 0 a propósito (para el resto de la app, gratis es
 * un precio). Un paquete de servicio a 0 sería otra cosa: la base lo prohíbe
 * (`price_cents > 0`) porque un contrato por 0 no tiene qué poner en garantía y
 * la comisión sobre 0 es 0 — o sea, un acuerdo sin nada que proteger. Quien
 * quiera trabajar gratis lo arregla por mensaje, no por un paquete.
 */
export function parsePackagePrice(raw: string): PriceResult {
  const parsed = parseAmountToCents(raw);
  if (!parsed.ok) {
    switch (parsed.reason) {
      case "vacio":
        return { ok: false, reason: "vacio" };
      case "demasiado_grande":
        return { ok: false, reason: "demasiado_grande" };
      default:
        return { ok: false, reason: "formato" };
    }
  }
  if (parsed.cents <= 0) return { ok: false, reason: "cero" };
  if (parsed.cents > MAX_PRICE_CENTS) return { ok: false, reason: "demasiado_grande" };
  return { ok: true, cents: parsed.cents };
}

/* -------------------------------------------------------------------------- */
/* Del paquete al contrato                                                    */
/* -------------------------------------------------------------------------- */

/**
 * El alcance (`scope`) con el que se prellena la propuesta de contrato.
 *
 * Es la descripción del paquete más su "incluye" como viñetas: lo que el
 * creador ya escribió, sin que nadie lo reescriba y sin agregarle promesas que
 * él no hizo. Quien propone el contrato lo puede editar antes de enviarlo — es
 * un punto de partida, no un acuerdo cerrado.
 *
 * Se recorta a `DESCRIPTION_MAX` porque es el techo que acepta
 * `proposeContract`: un scope de 2001 caracteres haría fallar la propuesta con
 * un error genérico y nadie entendería por qué.
 */
export function buildPackageScope(pkg: Pick<ServicePackage, "description" | "includes">): string {
  const bullets = pkg.includes.map((item) => `• ${item}`).join("\n");
  const full = bullets ? `${pkg.description.trim()}\n\n${bullets}` : pkg.description.trim();
  return full.slice(0, DESCRIPTION_MAX);
}

/* -------------------------------------------------------------------------- */
/* Orden                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reasigna `sort_order` como 0,1,2… siguiendo el orden en que llegan los ids.
 *
 * Se renumera SIEMPRE desde cero en vez de intercambiar dos valores: con
 * intercambios, seis reordenamientos seguidos dejan huecos (0,3,7,…) y el día
 * que dos filas empatan el orden depende de `created_at`, o sea del azar. Una
 * lista corta —seis como mucho— se puede renumerar entera sin pensarlo.
 */
export function reindexOrder(ids: readonly string[]): { id: string; sortOrder: number }[] {
  return ids.map((id, index) => ({ id, sortOrder: index }));
}

/*
 * Acá vivía `comparePackages(a, b) => a.sortOrder - b.sortOrder`. Se borró en
 * la auditoría 2026-08-13: nadie la llamaba. El orden ya llega resuelto desde
 * la base (`order by sort_order`), que es donde corresponde ordenar una lista
 * que igual hay que traer completa — un comparador en memoria sólo agregaba un
 * segundo lugar donde el orden podía divergir. Nota del docstring original, que
 * NO se cumplía en el código borrado y sí lo cumple el `order by`: los empates
 * se desempatan por antigüedad.
 */
