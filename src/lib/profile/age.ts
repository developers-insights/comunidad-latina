/**
 * Edad a partir de la fecha de nacimiento.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE Y NO ES UNA FUNCIÓN MÁS EN `actions.ts` ──────
 * Un módulo `"use server"` SÓLO puede exportar funciones async. Un helper puro
 * exportado de ahí hace que Next tire "Server Actions must be async functions" y
 * rompe la build entera — y no lo agarra `tsc`, sólo `npm run build`. Ya pasó en
 * este repo (`toModuleColumns`, 2026-07-27) y por eso existe
 * `src/app/admin/use-server-exports.test.ts`.
 *
 * ── POR QUÉ LA VALIDACIÓN DE EDAD NO VIVE EN LA BASE ─────────────────────────
 * El CHECK `profiles_private_birthdate_sane` (0062) sólo ataja el dedazo grosero
 * (año 1300, año 2999) porque un CHECK tiene que ser INMUTABLE y `current_date`
 * no lo es: Postgres rechaza de plano `check (birthdate < current_date)`. La
 * edad mínima, entonces, se valida en la app — acá.
 */

/** Edad mínima de la plataforma. La misma que atestigua el checkbox del alta. */
export const MIN_AGE = 18;

/**
 * Años cumplidos. Todo en UTC a propósito: una fecha de nacimiento es un DÍA
 * DEL CALENDARIO, no un instante, y compararla contra un reloj con huso haría
 * que alguien cumpliera años un día antes o después según dónde esté parado.
 *
 * Devuelve `null` si la fecha no se puede leer.
 */
export function ageFromBirthdate(birthdate: string, today: Date = new Date()): number | null {
  const born = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }
  return age;
}
