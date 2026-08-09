import { z } from "zod";

/**
 * =============================================================================
 * DECLARACIÓN DE ORIGINALIDAD Y DE LICENCIAS
 * =============================================================================
 *
 * El pliego las exige y la base ya las guarda (`content_assets.originality_*` y
 * `license_*`, migración 0061). Acá vive lo que la app necesita: el esquema, las
 * opciones y el copy — una sola vez, para que el formulario de vivienda, el de
 * marketplace y el panel de moderación digan exactamente lo mismo.
 *
 * DOS DECISIONES QUE NO SON DE ESTILO:
 *
 * 1. VA DENTRO DEL FORMULARIO, NO EN UN MODAL APARTE. Un modal de "aceptá los
 *    términos" se cierra sin leer; una casilla al lado de las fotos se lee
 *    porque está donde la persona ya está mirando. Además un modal separado
 *    obligaría a decidir qué pasa si lo cancelás, y la respuesta honesta
 *    ("igual publicás, pero sin declarar") es peor que no tener modal.
 *
 * 2. `desconocido` ES EL DEFAULT Y NO SE MUEVE. No declarar nada no puede
 *    leerse como "es mío" — lo dice la propia migración. La UI nunca preselecciona
 *    "es mío" por conveniencia: eso sería poner una afirmación en boca de alguien
 *    que no la hizo.
 *
 * Y LO QUE ESTO NO ES: una verificación. Es lo que la persona AFIRMA. El mismo
 * criterio legal que `verification_checks` (§11 del plan): jamás mostrarlo en
 * UI como si la plataforma lo hubiera comprobado.
 */

/** Espeja el CHECK de `content_assets.license_kind` (0061). */
export const LICENSE_KINDS = [
  "propio",
  "licencia_comercial",
  "creative_commons",
  "dominio_publico",
  "con_permiso",
  "desconocido",
] as const;

export type LicenseKind = (typeof LICENSE_KINDS)[number];

export interface LicenseOption {
  value: LicenseKind;
  /** Lo que se lee en el selector. Primera persona, como habla quien publica. */
  label: string;
}

/**
 * El orden importa: primero lo más frecuente y más simple de entender, último
 * el "prefiero no decirlo" — que es el default y tiene que quedar como salida
 * digna, no como castigo.
 */
export const LICENSE_OPTIONS: readonly LicenseOption[] = [
  { value: "propio", label: "Es material mío" },
  { value: "con_permiso", label: "Tengo permiso de quien lo hizo" },
  { value: "licencia_comercial", label: "Lo compré o tengo licencia" },
  { value: "creative_commons", label: "Es Creative Commons" },
  { value: "dominio_publico", label: "Es de dominio público" },
  { value: "desconocido", label: "Prefiero no aclararlo ahora" },
] as const;

/** Copy en español rioplatense-neutro. Sin jerga legal, sin letra chica. */
export const DECLARATION_COPY = {
  sectionTitle: "Sobre las fotos",
  sectionIntro:
    "Contanos de dónde salió el material. Nos ayuda a resolver rápido si alguien reclama que es suyo.",
  originalityLabel: "Las fotos son mías o tengo permiso para usarlas",
  originalityHint:
    "Marcalo solo si es así. Si no estás seguro, dejalo sin marcar y lo vemos juntos.",
  licenseLabel: "¿De dónde salió el material?",
  licenseStatementLabel: "Algo más que quieras aclarar (opcional)",
  licenseStatementPlaceholder: "Ej.: me las pasó el fotógrafo del local",
  licenseUrlLabel: "Link a la licencia o a la fuente (opcional)",
  licenseUrlPlaceholder: "https://",
  /** Se muestra debajo del bloque. Es la parte que NO se puede suavizar. */
  disclaimer:
    "Esto es lo que nos contás vos: no lo verificamos y no equivale a un certificado de propiedad.",
} as const;

/**
 * Esquema del borde. Todo opcional salvo el tipo de licencia, que siempre tiene
 * un valor porque `desconocido` ES un valor.
 *
 * `licenseUrl` acepta la cadena vacía además de una URL: un input opcional que
 * la persona no tocó manda `""`, y rechazar la publicación por eso sería
 * absurdo. Se normaliza a null en `normalizeDeclaration`.
 */
const TRUTHY = new Set(["true", "on", "1", "si", "sí", "yes"]);

export const declarationSchema = z.object({
  /**
   * Llega como booleano (llamada directa) o como el `"on"` de un checkbox de
   * FormData. `z.coerce.boolean()` NO sirve acá: convierte la cadena `"false"`
   * en `true`, que es exactamente el error que no podemos cometer con una
   * afirmación legal.
   */
  originalityDeclared: z
    .union([z.boolean(), z.string()])
    .nullish()
    .transform((value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return TRUTHY.has(value.trim().toLowerCase());
      return false;
    }),
  licenseKind: z
    .enum(LICENSE_KINDS)
    .nullish()
    .transform((value) => value ?? "desconocido"),
  licenseStatement: z.string().trim().max(500).nullish(),
  licenseUrl: z.union([z.literal(""), z.url().max(500)]).nullish(),
});

export type DeclarationInput = z.input<typeof declarationSchema>;

/** Lo que el pipeline persiste en `content_assets`. */
export interface ContentDeclaration {
  originalityDeclared: boolean;
  licenseKind: LicenseKind;
  licenseStatement: string | null;
  licenseUrl: string | null;
}

/** Declaración de quien no declaró nada. NO es "es propio" — es "no dijo". */
export const EMPTY_DECLARATION: ContentDeclaration = {
  originalityDeclared: false,
  licenseKind: "desconocido",
  licenseStatement: null,
  licenseUrl: null,
};

/**
 * Normaliza lo que llegó del formulario. Nunca lanza: una declaración
 * malformada degrada a "no declaró nada", que es la lectura conservadora
 * correcta — jamás inventa una afirmación que la persona no hizo.
 */
export function normalizeDeclaration(raw: unknown): ContentDeclaration {
  const parsed = declarationSchema.safeParse(raw ?? {});
  if (!parsed.success) return EMPTY_DECLARATION;
  const value = parsed.data;

  // Coherencia: declarar originalidad y elegir "prefiero no aclararlo" es
  // contradictorio. Gana lo que la persona MARCÓ explícitamente.
  const licenseKind =
    value.originalityDeclared && value.licenseKind === "desconocido"
      ? "propio"
      : value.licenseKind;

  return {
    originalityDeclared: value.originalityDeclared,
    licenseKind,
    licenseStatement: value.licenseStatement?.trim() || null,
    licenseUrl: value.licenseUrl?.trim() || null,
  };
}

/** Etiqueta legible de una licencia, para el panel de moderación. */
export function licenseLabel(kind: string | null | undefined): string {
  const option = LICENSE_OPTIONS.find((entry) => entry.value === kind);
  return option?.label ?? "Sin aclarar";
}
