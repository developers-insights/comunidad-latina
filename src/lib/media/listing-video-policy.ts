import { isPremium, maxVideoSecondsFor } from "@/lib/monetization/tier";
import {
  PREMIUM_DETAIL_MAX_SECONDS,
  SHORT_VIDEO_MAX_SECONDS,
  formatDuration,
  normalizeDeclaredDuration,
} from "./video-policy";

export const LISTING_VIDEO_CARD_CAP_SECONDS = SHORT_VIDEO_MAX_SECONDS;
export const LISTING_VIDEO_MAX_SECONDS = PREMIUM_DETAIL_MAX_SECONDS;

const LISTING_VIDEO_BUCKET = "post-media";

export type MotivoVideoDeAviso = "duracion-desconocida" | "supera-5-minutos" | "necesita-premium";

export type VeredictoVideoDeAviso =
  | { ok: true; seconds: number; largo: boolean }
  | { ok: false; motivo: MotivoVideoDeAviso; seconds: number | null };

export function evaluarVideoDeAviso(rawSeconds: unknown, tier: unknown): VeredictoVideoDeAviso {
  const seconds = normalizeDeclaredDuration(rawSeconds);
  if (seconds === null) return { ok: false, motivo: "duracion-desconocida", seconds: null };
  if (seconds > LISTING_VIDEO_MAX_SECONDS) {
    return { ok: false, motivo: "supera-5-minutos", seconds };
  }
  if (seconds > maxVideoSecondsFor(tier)) {
    return { ok: false, motivo: "necesita-premium", seconds };
  }
  return { ok: true, seconds, largo: seconds > LISTING_VIDEO_CARD_CAP_SECONDS };
}

export function esVideoLargoDeAviso(args: {
  durationSeconds: number | null | undefined;
  tier: unknown;
}): boolean {
  const seconds = args.durationSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return false;
  return seconds > LISTING_VIDEO_CARD_CAP_SECONDS && isPremium(args.tier);
}

export const LISTING_VIDEO_COPY = {
  campo: "Video",
  campoAyuda:
    "Opcional. Hasta 90 segundos gratis; con tu aviso en premium, hasta 5 minutos.",
  elegir: "Sumar un video",
  cambiar: "Cambiar el video",
  quitar: "Quitar el video",
  midiendo: "Revisando el video…",
  subiendo: (pct: number) => `Subiendo el video… ${pct}%`,
  duracion: (seconds: number) => `Dura ${formatDuration(seconds) ?? `${seconds} s`}`,
  resumen: (seconds: number) => `Con un video de ${formatDuration(seconds) ?? `${seconds} s`}`,
  largoPremium:
    "En el feed se ven los primeros 90 segundos y después aparece «Ver video completo».",
  verPremium: "Ver qué incluye premium",
  errorSubida: "No pudimos subir el video. Revisá tu conexión y probá de nuevo.",
  errorGenerico: "No pudimos guardar el video. Probá de nuevo en un ratito.",
  errorRuta: "Ese video no es tuyo o ya no está. Elegilo de nuevo.",
  motivos: {
    "duracion-desconocida":
      "No pudimos leer cuánto dura ese video. Probá con otro archivo (MP4 funciona siempre).",
    "supera-5-minutos": (seconds: number | null) =>
      `Este video dura ${formatDuration(seconds) ?? "más de 5 minutos"} y el máximo son 5 minutos. Recortalo y volvé a elegirlo.`,
    "necesita-premium": (seconds: number | null) =>
      `Este video dura ${formatDuration(seconds) ?? "más de 90 segundos"}. Gratis podés subir hasta 90 segundos; los videos de hasta 5 minutos son para avisos premium. Publicá con un video más corto y, cuando pases tu aviso a premium, subí el completo desde Editar.`,
  },
  verCompleto: "Ver video completo",
  verCompletoLabel: (title: string) => `Ver el video completo de ${title}`,
  reproducir: (title: string) => `Ver el video de ${title}`,
  chipVideo: "Video",
} as const;

export function mensajeDeVideoDeAviso(
  veredicto: Extract<VeredictoVideoDeAviso, { ok: false }>,
): string {
  const motivo = LISTING_VIDEO_COPY.motivos[veredicto.motivo];
  return typeof motivo === "string" ? motivo : motivo(veredicto.seconds);
}

export interface ListingVideoRow {
  id: string;
  video_path?: string | null;
  video_poster_path?: string | null;
  video_duration_seconds?: number | null;
  tier?: string | null;
}

export interface ListingVideoView {
  url: string;
  posterUrl: string | null;
  durationSeconds: number;
  fullVideoHref: string | null;
}

export function listingVideoPublicUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${LISTING_VIDEO_BUCKET}/${path}`;
}

export function longVideoHrefForListing(listingId: string): string {
  return `/videos/largos/aviso/${listingId}`;
}

export function toListingVideoView(row: ListingVideoRow): ListingVideoView | null {
  const path = row.video_path?.trim();
  const seconds = row.video_duration_seconds;
  if (!path || typeof seconds !== "number" || seconds <= 0) return null;
  return {
    url: listingVideoPublicUrl(path),
    posterUrl: row.video_poster_path ? listingVideoPublicUrl(row.video_poster_path) : null,
    durationSeconds: seconds,
    fullVideoHref: esVideoLargoDeAviso({ durationSeconds: seconds, tier: row.tier })
      ? longVideoHrefForListing(row.id)
      : null,
  };
}

export const LISTING_VIDEO_COLUMNS =
  "video_path, video_poster_path, video_duration_seconds, tier";
