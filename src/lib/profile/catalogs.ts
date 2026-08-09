/**
 * Catálogos cerrados del perfil: país de residencia e idiomas.
 *
 * ── POR QUÉ LISTAS Y NO TEXTO LIBRE ──────────────────────────────────────────
 * Los dos campos son FILTRABLES: `profiles_private_ubicacion_idx` y el índice
 * GIN sobre `languages` (0062) existen para que el directorio pueda buscar por
 * ubicación y por idioma. Con texto libre, "Estados Unidos", "EEUU", "USA" y
 * "us" son cuatro países distintos y ningún índice arregla eso.
 *
 * ── POR QUÉ NO SE REUSA `countries.ts` ───────────────────────────────────────
 * `components/auth/countries.ts` son los 5 países de ORIGEN del onboarding (§4.a
 * del design brief): es una lista de identidad, corta y elegida a mano, con un
 * escape "OTRO". Residencia es otra pregunta —dónde estás HOY— y su respuesta
 * casi siempre es Estados Unidos. Mezclarlas obligaría a que agregar un país de
 * origen agregue también un país de residencia, que no tiene nada que ver.
 */

export interface CatalogOption {
  /** Lo que se persiste. Para países, ISO-3166 alpha-2. */
  code: string;
  label: string;
}

/**
 * País de residencia. Estados Unidos primero porque es la respuesta del 95% del
 * público (la plataforma es para comunidades latinas EN EE.UU.); el resto sigue
 * en orden alfabético para que se pueda barrer con la vista.
 */
export const RESIDENCE_COUNTRIES: readonly CatalogOption[] = [
  { code: "US", label: "Estados Unidos" },
  { code: "AR", label: "Argentina" },
  { code: "BO", label: "Bolivia" },
  { code: "BR", label: "Brasil" },
  { code: "CA", label: "Canadá" },
  { code: "CL", label: "Chile" },
  { code: "CO", label: "Colombia" },
  { code: "CR", label: "Costa Rica" },
  { code: "CU", label: "Cuba" },
  { code: "DO", label: "Rep. Dominicana" },
  { code: "EC", label: "Ecuador" },
  { code: "SV", label: "El Salvador" },
  { code: "ES", label: "España" },
  { code: "GT", label: "Guatemala" },
  { code: "HN", label: "Honduras" },
  { code: "HT", label: "Haití" },
  { code: "MX", label: "México" },
  { code: "NI", label: "Nicaragua" },
  { code: "PA", label: "Panamá" },
  { code: "PY", label: "Paraguay" },
  { code: "PE", label: "Perú" },
  { code: "PR", label: "Puerto Rico" },
  { code: "UY", label: "Uruguay" },
  { code: "VE", label: "Venezuela" },
  { code: "OTRO", label: "Otro país" },
] as const;

export const RESIDENCE_COUNTRY_CODES: readonly string[] = RESIDENCE_COUNTRIES.map((c) => c.code);

export function residenceCountryLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const match = RESIDENCE_COUNTRIES.find((c) => c.code === code.toUpperCase());
  return match && match.code !== "OTRO" ? match.label : null;
}

/**
 * Idiomas. Plural por contrato: la columna es `text[]`.
 *
 * La lista no es "los idiomas del mundo" sino los que de verdad se hablan en
 * esta diáspora, incluidos los que un desplegable genérico se olvida: el criollo
 * haitiano, el quechua, el garífuna, el mixteco. Que falte el idioma de alguien
 * en su propia comunidad es la clase de detalle que se nota.
 *
 * Tope de 10 ítems y 40 caracteres: es el CHECK `profiles_private_languages_ok`
 * (`app.short_text_array_ok(languages, 10, 40)`), no una elección de la UI.
 */
export const LANGUAGES: readonly CatalogOption[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "Inglés" },
  { code: "pt", label: "Portugués" },
  { code: "ht", label: "Criollo haitiano" },
  { code: "qu", label: "Quechua" },
  { code: "gn", label: "Guaraní" },
  { code: "ay", label: "Aymara" },
  { code: "cab", label: "Garífuna" },
  { code: "nah", label: "Náhuatl" },
  { code: "mix", label: "Mixteco" },
  { code: "quc", label: "K'iche'" },
  { code: "fr", label: "Francés" },
  { code: "it", label: "Italiano" },
] as const;

export const LANGUAGE_CODES: readonly string[] = LANGUAGES.map((l) => l.code);

/** Tope del CHECK `profiles_private_languages_ok` (0062). */
export const LANGUAGES_MAX = 10;

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/** Los nombres legibles de una selección, en el orden del catálogo. */
export function languageLabels(codes: readonly string[] | null | undefined): string[] {
  if (!codes || codes.length === 0) return [];
  const chosen = new Set(codes);
  return LANGUAGES.filter((l) => chosen.has(l.code)).map((l) => l.label);
}
