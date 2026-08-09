/**
 * =============================================================================
 * BÚSQUEDA DE UN TRABAJO POR SU CÓDIGO (Job ID)
 * =============================================================================
 *
 * La migración 0065 cambió el formato del Job ID de `CL-2026-0001` a
 * `CL-CM-2026-000001` y migró los 11 contratos vivos, guardando el código
 * anterior en `gig_contracts.code_legacy`.
 *
 * El punto es este: **el código viejo ya salió de la app**. Está impreso en
 * recibos, citado en correos, sacado en capturas y anotado en papel. Si el
 * buscador solo mirara `code`, todos esos contratos se volverían inencontrables
 * justo por el número que la gente tiene a mano — y del lado de quien busca no
 * se vería como un cambio de formato, se vería como que el trabajo desapareció.
 *
 * Por eso toda búsqueda por código mira LAS DOS columnas, y además traduce entre
 * formatos: quien pega el código nuevo encuentra el contrato aunque tenga el
 * viejo guardado, y al revés.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ VALIDA EL FORMATO SI SOLO COMPARA STRINGS
 *
 * Hoy `matchesJobCode` compara en memoria y no hay inyección posible. Pero un
 * código normalizado es exactamente el tipo de valor que termina, tarde o
 * temprano, dentro de un filtro `.or()`/`.in()` de PostgREST —que se arma
 * concatenando texto—. `normalizeJobCode` deja pasar SOLO `[A-Z0-9-]` y
 * `jobCodeVariants` devuelve `[]` ante cualquier otra cosa, así que ninguna
 * coma, paréntesis o comilla de un usuario puede sobrevivir hasta ahí. La
 * garantía se paga una vez, acá, y no en cada call site.
 * =============================================================================
 */

/** Formato del pliego (0065): CL-CM-<año>-<6 dígitos>. */
const NEW_FORMAT = /^CL-CM-(\d{4})-(\d+)$/;
/** Formato anterior (0024): CL-<año>-<4 dígitos o más>. */
const LEGACY_FORMAT = /^CL-(\d{4})-(\d+)$/;
/** Lo único que puede llegar a un filtro de PostgREST. */
const SAFE_CODE = /^[A-Z0-9-]{3,32}$/;

/**
 * Deja el código como lo escribe la base a partir de lo que escribió una
 * persona: minúsculas, espacios en vez de guiones, el guión largo que mete
 * Word, un salto de línea pegado desde un correo.
 */
export function normalizeJobCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .toUpperCase()
    // Guión medio/largo, guión bajo, el signo menos Unicode y cualquier espacio
    // pasan a ser el separador canónico.
    .replace(/[\s_‐-―−]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Todos los códigos con los que ese contrato pudo haber quedado guardado.
 *
 * Devuelve `[]` cuando lo escrito no puede ser un código: sin candidatos, quien
 * llama no consulta nada (y la pantalla dice que no encontró, que es la verdad).
 */
export function jobCodeVariants(raw: string | null | undefined): string[] {
  const code = normalizeJobCode(raw);
  if (!SAFE_CODE.test(code)) return [];

  const variants = new Set<string>([code]);

  const asNew = NEW_FORMAT.exec(code);
  if (asNew) {
    const [, year, digits] = asNew;
    const n = Number(digits);
    if (Number.isSafeInteger(n)) {
      // El backfill de 0065 fue 1-a-1 conservando el número de secuencia, así
      // que el código viejo de este contrato era el mismo número con 4 dígitos.
      variants.add(`CL-${year}-${String(n).padStart(4, "0")}`);
    }
  }

  const asLegacy = LEGACY_FORMAT.exec(code);
  if (asLegacy) {
    const [, year, digits] = asLegacy;
    const n = Number(digits);
    if (Number.isSafeInteger(n)) {
      variants.add(`CL-CM-${year}-${String(n).padStart(6, "0")}`);
    }
  }

  return [...variants].filter((variant) => SAFE_CODE.test(variant));
}

/**
 * ¿Esta fila es el contrato que buscan? Mira `code` Y `code_legacy`.
 *
 * Es el ÚNICO criterio de coincidencia del repo, a propósito: si la búsqueda de
 * la app y la de un panel se implementaran por separado, una de las dos se
 * olvidaría del código viejo — y ese olvido no se ve hasta que alguien no
 * encuentra su contrato.
 */
export function matchesJobCode(
  row: { code: string | null; code_legacy?: string | null },
  raw: string | null | undefined,
): boolean {
  const variants = jobCodeVariants(raw);
  if (variants.length === 0) return false;
  const candidates = new Set(variants);
  return (
    (row.code !== null && row.code !== undefined && candidates.has(normalizeJobCode(row.code))) ||
    (row.code_legacy !== null &&
      row.code_legacy !== undefined &&
      candidates.has(normalizeJobCode(row.code_legacy)))
  );
}

/**
 * Cómo mostrar el código de un contrato: el vigente, y el anterior entre
 * paréntesis cuando existe. Sin esto, alguien con el recibo viejo en la mano no
 * tiene forma de saber que está mirando su propio contrato.
 */
export function formatJobCode(row: { code: string; code_legacy?: string | null }): string {
  return row.code_legacy ? `${row.code} (antes ${row.code_legacy})` : row.code;
}
