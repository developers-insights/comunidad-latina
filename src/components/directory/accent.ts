/**
 * Acentos por módulo del directorio (feedback cliente 2026-07-19: "todos los
 * módulos con la estética de propiedades, con color por módulo"). Las custom
 * properties viven en globals.css (`--accent-eventos` etc., NO se tocan acá).
 *
 * SIEMPRE decorativos — bordes, chips cápsula, gradientes de cabecera,
 * íconos. El texto de contenido usa tokens neutros (-foreground); nunca el
 * acento crudo como color de texto (WCAG, §2.8 del brief).
 *
 * Mapas de clases LITERALES a propósito (no template strings interpolando el
 * nombre del acento): Tailwind v4 solo genera la utility de valor arbitrario
 * si la clase completa aparece como string literal en el código fuente — una
 * clase armada en runtime (`` `bg-[var(--accent-${accent})]` ``) no la ve el
 * compilador y queda sin estilo en build.
 */
export type ModuleAccent = "eventos" | "negocios" | "profesionales";

/** Gradiente suave del fallback de foto (sin foto real todavía). */
export const ACCENT_MEDIA_BG: Record<ModuleAccent, string> = {
  eventos: "bg-gradient-to-br from-[var(--accent-eventos)]/16 via-surface-subtle to-surface-subtle",
  negocios: "bg-gradient-to-br from-[var(--accent-negocios)]/16 via-surface-subtle to-surface-subtle",
  profesionales:
    "bg-gradient-to-br from-[var(--accent-profesionales)]/16 via-surface-subtle to-surface-subtle",
};

/** Ícono decorativo grande del fallback — ÚNICO lugar donde el acento pinta texto/ícono. */
export const ACCENT_ICON_CLASS: Record<ModuleAccent, string> = {
  eventos: "text-[var(--accent-eventos)]",
  negocios: "text-[var(--accent-negocios)]",
  profesionales: "text-[var(--accent-profesionales)]",
};

/** Chip cápsula con tinte del acento (categoría, rubro) — texto siempre -foreground. */
export const ACCENT_CHIP_CLASS: Record<ModuleAccent, string> = {
  eventos: "border-[var(--accent-eventos)]/30 bg-[var(--accent-eventos)]/10 text-foreground",
  negocios: "border-[var(--accent-negocios)]/40 bg-[var(--accent-negocios)]/15 text-foreground",
  profesionales: "border-[var(--accent-profesionales)]/30 bg-[var(--accent-profesionales)]/10 text-foreground",
};
