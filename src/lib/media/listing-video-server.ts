import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LISTING_VIDEO_COPY,
  evaluarVideoDeAviso,
  mensajeDeVideoDeAviso,
} from "./listing-video-policy";
import { isOwnPosterPath, isOwnVideoPath } from "./own-media-path";
import { POST_MEDIA_BUCKET } from "./upload-video";
import { MAX_VIDEO_BYTES, formatVideoTooBigMessage } from "./video-upload-limits";

export const listingVideoInputSchema = z
  .object({
    path: z.string().min(3).max(300),
    posterPath: z.string().min(3).max(300).nullish(),
    durationSeconds: z.coerce.number().finite().positive().max(36_000),
  })
  .nullish();

export type ListingVideoInput = {
  path: string;
  posterPath?: string | null;
  durationSeconds: number;
};

export interface ListingVideoColumns {
  video_path: string | null;
  video_poster_path: string | null;
  video_duration_seconds: number | null;
}

export const SIN_VIDEO: ListingVideoColumns = {
  video_path: null,
  video_poster_path: null,
  video_duration_seconds: null,
};

export type ValidarVideoResult =
  | { ok: true; columns: ListingVideoColumns | null }
  | { ok: false; error: string };

export interface ValidarVideoDeps {
  medirObjeto: (path: string) => Promise<number | null>;
}

async function medirEnStorage(path: string): Promise<number | null> {
  const carpeta = path.slice(0, path.lastIndexOf("/"));
  const archivo = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await createAdminClient()
    .storage.from(POST_MEDIA_BUCKET)
    .list(carpeta, { search: archivo, limit: 100 });
  if (error) return null;
  // `search` es un LIKE: "clip.mp4" también matchea "clip.mp4.bak".
  const objeto = (data ?? []).find((item) => item.name === archivo);
  const bytes = objeto?.metadata?.size;
  return typeof bytes === "number" ? bytes : null;
}

export async function validarVideoDeAviso(
  args: {
    input: ListingVideoInput | null | undefined;
    tenantId: string;
    userId: string;
    tier: unknown;
  },
  deps: ValidarVideoDeps = { medirObjeto: medirEnStorage },
): Promise<ValidarVideoResult> {
  const { input, tenantId, userId, tier } = args;
  if (!input) return { ok: true, columns: null };

  const posterPath = input.posterPath ?? null;
  if (
    !isOwnVideoPath(input.path, tenantId, userId) ||
    (posterPath !== null && !isOwnPosterPath(posterPath, tenantId, userId))
  ) {
    return { ok: false, error: LISTING_VIDEO_COPY.errorRuta };
  }

  const veredicto = evaluarVideoDeAviso(input.durationSeconds, tier);
  if (!veredicto.ok) return { ok: false, error: mensajeDeVideoDeAviso(veredicto) };

  let bytes: number | null;
  try {
    bytes = await deps.medirObjeto(input.path);
  } catch {
    return { ok: false, error: LISTING_VIDEO_COPY.errorGenerico };
  }
  if (bytes === null) return { ok: false, error: LISTING_VIDEO_COPY.errorRuta };
  if (bytes > MAX_VIDEO_BYTES) return { ok: false, error: formatVideoTooBigMessage(bytes) };

  return {
    ok: true,
    columns: {
      video_path: input.path,
      video_poster_path: posterPath,
      video_duration_seconds: veredicto.seconds,
    },
  };
}

export function errorDeVideoDeLaBase(error: { message?: string } | null | undefined): string | null {
  const message = error?.message ?? "";
  if (message.includes("LISTING_VIDEO_NEEDS_PREMIUM")) {
    return LISTING_VIDEO_COPY.motivos["necesita-premium"](null);
  }
  if (message.includes("LISTING_VIDEO_NOT_OWN")) return LISTING_VIDEO_COPY.errorRuta;
  return null;
}
