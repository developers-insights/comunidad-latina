import {
  Camera,
  Megaphone,
  PaintBrush,
  ShareNetwork,
  Sparkle,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";

/**
 * Categorías de un aviso del Creator Marketplace (attrs.category del listing
 * kind='creator_gig'). Los ids son EXACTOS a lo que guarda la DB (incluyen la ñ
 * de 'campaña' y 'diseño'). Cada una trae su ícono para el chip y el fallback
 * de la card. Sin dependencias de servidor.
 */

export type GigCategory = "video" | "foto" | "campaña" | "social" | "diseño" | "otro";

export interface GigCategoryMeta {
  id: GigCategory;
  /** Etiqueta humana para el chip y el selector. */
  label: string;
  Icon: typeof VideoCamera;
}

export const GIG_CATEGORIES: readonly GigCategoryMeta[] = [
  { id: "video", label: "Video", Icon: VideoCamera },
  { id: "foto", label: "Fotografía", Icon: Camera },
  { id: "campaña", label: "Campaña", Icon: Megaphone },
  { id: "social", label: "Redes sociales", Icon: ShareNetwork },
  { id: "diseño", label: "Diseño", Icon: PaintBrush },
  { id: "otro", label: "Otro", Icon: Sparkle },
] as const;

/**
 * Categorías que se ofrecen como FILTRO en el feed de Trabajos: es
 * `GIG_CATEGORIES` sin "otro". "Otro" es el cajón de sastre al publicar, no un
 * criterio de descubrimiento (nadie filtra por "algo que no encaja"); los avisos
 * con category="otro" siguen visibles dentro de "Todos", solo que no tienen chip
 * propio. `GIG_CATEGORIES` se mantiene COMPLETA (las 6) para el selector de
 * publicación y para el fallback de `gigCategoryMeta()` — no tocar esa lista.
 */
export const FILTERABLE_GIG_CATEGORIES: readonly GigCategoryMeta[] =
  GIG_CATEGORIES.filter((category) => category.id !== "otro");

const BY_ID = new Map<GigCategory, GigCategoryMeta>(
  GIG_CATEGORIES.map((category) => [category.id, category]),
);

export function isGigCategory(value: string | null | undefined): value is GigCategory {
  return typeof value === "string" && BY_ID.has(value as GigCategory);
}

/** Metadata de la categoría; degrada a "Otro" si el valor viene raro. */
export function gigCategoryMeta(value: string | null | undefined): GigCategoryMeta {
  const found = isGigCategory(value) ? BY_ID.get(value) : undefined;
  return found ?? BY_ID.get("otro")!;
}
