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
