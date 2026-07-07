/**
 * Países del onboarding "Recién Llegado" (§4.a del design brief).
 * Sin emoji de bandera como único indicador: código país estilizado + nombre.
 * `code` es lo que se persiste en profiles.country_origin (ISO-3166 alpha-2,
 * salvo el escape "OTRO").
 */
export interface CountryOption {
  code: string;
  /** Código corto estilizado que se muestra grande en la tarjeta. */
  short: string;
  name: string;
}

export const COUNTRY_OPTIONS: readonly CountryOption[] = [
  { code: "DO", short: "RD", name: "Rep. Dominicana" },
  { code: "CO", short: "CO", name: "Colombia" },
  { code: "MX", short: "MX", name: "México" },
  { code: "VE", short: "VE", name: "Venezuela" },
  { code: "PR", short: "PR", name: "Puerto Rico" },
  { code: "OTRO", short: "+", name: "Otro país" },
] as const;

export const COUNTRY_CODES = COUNTRY_OPTIONS.map((c) => c.code);

/** Nombre legible para perfiles ("DO" → "Rep. Dominicana"). */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const match = COUNTRY_OPTIONS.find((c) => c.code === code.toUpperCase());
  return match && match.code !== "OTRO" ? match.name : null;
}
