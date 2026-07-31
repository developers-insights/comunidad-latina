/**
 * =============================================================================
 * REQUISITOS PARA RECIBIR TRABAJOS (spec §6)
 * =============================================================================
 *
 * La spec pide cinco números: 1.000 seguidores · 20 videos · 50.000 vistas ·
 * 90 días de cuenta · Creator Score 70.
 *
 * Lo importante NO es el corte, es lo que se muestra cuando no se llega. Un
 * "no calificás" mudo es la peor pantalla posible para alguien que recién
 * empieza: no dice cuánto falta, no dice qué hacer, y la persona se va. Por eso
 * este módulo devuelve, requisito por requisito, el valor actual, el objetivo,
 * la fracción de avance y —cuando corresponde— cuánto falta exactamente.
 *
 * -----------------------------------------------------------------------------
 * DATOS QUE TODAVÍA NO SE MIDEN
 *
 * Un requisito puede estar en estado `unmeasured`: la app todavía no tiene de
 * dónde sacar ese número. No es cero (cero significaría "no tenés nada", que es
 * una acusación falsa) y no se inventa. Se muestra como "todavía no lo
 * medimos" y NO cuenta en contra: `meetsAll` ignora los no medidos.
 *
 * Hoy hay uno: el **Creator Score**. La tabla `creator_scores` existe en la
 * base (migración 0029) pero NO está en `src/lib/types/database.types.ts`, que
 * es el contrato tipado del que se leen todas las tablas y que este agente no
 * puede editar. Consumirla a ciegas sería mentirle al compilador; usar
 * `trust_scores` en su lugar sería peor, porque el propio gap-analysis del repo
 * dice explícitamente que el Creator Score NO se reusa del Trust Score. Cuando
 * los tipos se regeneren, alcanza con pasar `creatorScore` en el input.
 * -----------------------------------------------------------------------------
 */

export const REQUIREMENT_IDS = [
  "followers",
  "videos",
  "views",
  "accountAge",
  "creatorScore",
] as const;

export type RequirementId = (typeof REQUIREMENT_IDS)[number];

/** Los cortes de la spec. Fuente única: la UI y los tests leen de acá. */
export const REQUIREMENT_TARGETS: Record<RequirementId, number> = {
  followers: 1_000,
  videos: 20,
  views: 50_000,
  accountAge: 90,
  creatorScore: 70,
};

export type RequirementUnit = "count" | "days" | "score";

export interface Requirement {
  id: RequirementId;
  /** Etiqueta corta, en criollo. */
  label: string;
  /** Una línea que explica POR QUÉ el requisito existe. */
  hint: string;
  target: number;
  unit: RequirementUnit;
  /** null ⇒ todavía no lo medimos (ver cabecera). */
  current: number | null;
  /** true si `current` alcanza el objetivo. Siempre false si no se mide. */
  met: boolean;
  /** true si la app todavía no tiene este dato. */
  unmeasured: boolean;
  /** 0-1 para la barra. Un requisito no medido queda en 0 y se pinta neutro. */
  progress: number;
  /** Cuánto falta, o 0 si ya está / no se mide. */
  remaining: number;
}

export interface CreatorRequirementsInput {
  /** Seguidores del perfil dentro de la comunidad (`follows`). */
  followers?: number | null;
  /** Videos cortos publicados (`posts.video_type='short_video'`). */
  videos?: number | null;
  /** Vistas acumuladas de esos videos (suma de `posts.view_count`). */
  views?: number | null;
  /** Alta de la cuenta (`profiles.created_at`) — ISO o Date. */
  accountCreatedAt?: string | Date | null;
  /** Creator Score 0-100. Hoy siempre `null`: ver la cabecera del módulo. */
  creatorScore?: number | null;
  /** Inyectable para que los tests no dependan del reloj. */
  now?: Date;
}

export interface CreatorRequirementsResult {
  requirements: Requirement[];
  /** Cumple TODOS los que se pueden medir hoy. */
  meetsAll: boolean;
  /** Cuántos de los medibles ya cumple. */
  metCount: number;
  /** Cuántos se pueden medir hoy (el total es `REQUIREMENT_IDS.length`). */
  measurableCount: number;
  /** Los que la app todavía no puede calcular. */
  unmeasured: RequirementId[];
  /** 0-1: promedio del avance de los medibles. Para el anillo/barra de arriba. */
  overallProgress: number;
}

const MS_PER_DAY = 86_400_000;

/** Número finito y no negativo, o null. Un dato roto es "no medido", no 0. */
function asCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/** Días enteros desde el alta. null si la fecha no se puede leer. */
export function accountAgeInDays(
  createdAt: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!createdAt) return null;
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const time = created.getTime();
  if (!Number.isFinite(time)) return null;
  // Una fecha en el futuro (reloj corrido, dato sembrado) es 0 días, no negativa.
  return Math.max(0, Math.floor((now.getTime() - time) / MS_PER_DAY));
}

const COPY: Record<RequirementId, { label: string; hint: string }> = {
  followers: {
    label: "Seguidores",
    hint: "Gente de la comunidad que sigue lo que publicás.",
  },
  videos: {
    label: "Videos publicados",
    hint: "Videos cortos tuyos, publicados y visibles.",
  },
  views: {
    label: "Vistas acumuladas",
    hint: "Todas las vistas que juntaron tus videos.",
  },
  accountAge: {
    label: "Antigüedad de tu cuenta",
    hint: "Los negocios contratan con más confianza a cuentas con recorrido.",
  },
  creatorScore: {
    label: "Creator Score",
    hint: "Tu puntaje como creador: entregas a tiempo, reseñas y actividad.",
  },
};

function buildRequirement(
  id: RequirementId,
  current: number | null,
  unit: RequirementUnit,
): Requirement {
  const target = REQUIREMENT_TARGETS[id];
  const unmeasured = current === null;
  const met = !unmeasured && current >= target;
  return {
    id,
    label: COPY[id].label,
    hint: COPY[id].hint,
    target,
    unit,
    current,
    met,
    unmeasured,
    progress: unmeasured ? 0 : Math.min(1, target > 0 ? current / target : 1),
    remaining: unmeasured || met ? 0 : target - current,
  };
}

/**
 * Calcula los cinco requisitos con los datos reales que se le pasen.
 *
 * Todo campo ausente cae en "todavía no lo medimos" en vez de en 0: la
 * diferencia importa, porque 0 le dice a la persona que no tiene nada y eso
 * puede ser falso.
 */
export function computeCreatorRequirements(
  input: CreatorRequirementsInput = {},
): CreatorRequirementsResult {
  const now = input.now ?? new Date();

  const requirements: Requirement[] = [
    buildRequirement("followers", asCount(input.followers), "count"),
    buildRequirement("videos", asCount(input.videos), "count"),
    buildRequirement("views", asCount(input.views), "count"),
    buildRequirement("accountAge", accountAgeInDays(input.accountCreatedAt, now), "days"),
    buildRequirement("creatorScore", asCount(input.creatorScore), "score"),
  ];

  const measurable = requirements.filter((requirement) => !requirement.unmeasured);
  const metCount = measurable.filter((requirement) => requirement.met).length;

  return {
    requirements,
    // Un requisito que no se puede medir no bloquea: no vamos a frenar a alguien
    // por un número que NOSOTROS todavía no calculamos.
    meetsAll: measurable.length > 0 && metCount === measurable.length,
    metCount,
    measurableCount: measurable.length,
    unmeasured: requirements
      .filter((requirement) => requirement.unmeasured)
      .map((requirement) => requirement.id),
    overallProgress:
      measurable.length === 0
        ? 0
        : measurable.reduce((sum, requirement) => sum + requirement.progress, 0) /
          measurable.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Formato                                                                    */
/* -------------------------------------------------------------------------- */

/** Miles con separador local — los números grandes se leen de un vistazo. */
export function formatRequirementNumber(value: number, locale = "es-US"): string {
  return value.toLocaleString(locale);
}

/** "820 de 1.000" · "45 de 90 días" · "—" si no se mide. */
export function formatRequirementValue(requirement: Requirement, locale = "es-US"): string {
  if (requirement.unmeasured) return "—";
  const current = formatRequirementNumber(requirement.current ?? 0, locale);
  const target = formatRequirementNumber(requirement.target, locale);
  if (requirement.unit === "days") return `${current} de ${target} días`;
  return `${current} de ${target}`;
}

/**
 * Qué le falta, dicho como se lo diría una persona. Nunca "no calificás":
 * siempre el número exacto que separa a alguien de poder trabajar.
 */
export function formatRequirementGap(requirement: Requirement, locale = "es-US"): string {
  if (requirement.unmeasured) return "Todavía no lo medimos";
  if (requirement.met) return "Listo";

  const missing = formatRequirementNumber(requirement.remaining, locale);
  switch (requirement.id) {
    case "followers":
      return requirement.remaining === 1
        ? "Te falta 1 seguidor"
        : `Te faltan ${missing} seguidores`;
    case "videos":
      return requirement.remaining === 1 ? "Te falta 1 video" : `Te faltan ${missing} videos`;
    case "views":
      return `Te faltan ${missing} vistas`;
    case "accountAge":
      return requirement.remaining === 1 ? "Te falta 1 día" : `Te faltan ${missing} días`;
    case "creatorScore":
      return `Te faltan ${missing} puntos`;
  }
}
