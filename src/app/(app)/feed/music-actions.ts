"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  MUSIC_CATEGORIES,
  MUSIC_LICENSE_KINDS,
  clampStartSeconds,
  musicTrackUrl,
  type MusicCategory,
  type MusicLicenseKind,
  type MusicTrackView,
} from "@/lib/media/audio-track";

/**
 * Server actions de MÚSICA EN PUBLICACIONES (migración 0090).
 *
 * POR QUÉ ESTÁN ACÁ Y NO EN `actions.ts`
 * --------------------------------------
 * La pista se asocia DESPUÉS de que la publicación existe, con una action
 * propia. No es una decisión estética: `createPostAction` recibe un FormData con
 * las fotos y devuelve el `postId` recién creado; la música necesita ese id.
 * La secuencia real del composer es:
 *
 *   1. `createPostAction(formData)` → `{ ok: true, postId }`
 *   2. si la persona eligió pista → `attachPostMusicAction({ postId, trackId, startSeconds })`
 *
 * Next despacha las server actions de un mismo cliente DE A UNA (ver
 * `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`), así que el
 * paso 2 arranca con el post ya creado sin que el composer tenga que coordinar
 * nada.
 *
 * QUÉ PASA SI EL PASO 2 FALLA
 * ---------------------------
 * La publicación YA está publicada y se queda sin música. Es la degradación
 * correcta y la razón de que el orden sea ése: al revés —música primero— habría
 * que inventar una fila huérfana o retener la publicación por un adorno.
 * El composer tiene que avisar que la publicación salió pero sin la canción
 * (copy: `MUSIC_COPY.attachFailed`) y ofrecer reintentar desde la publicación,
 * NUNCA fallar la publicación entera ni reintentar en silencio.
 *
 * Reglas del repo que se respetan acá:
 *  - Zod PRIMERO (parseo puro, sin I/O), `requireTenantMatch()` DESPUÉS y antes
 *    de cualquier escritura.
 *  - Escritura siempre con el cliente del usuario: la RLS de `post_music` (0090)
 *    es la frontera real. Nada de admin client.
 *  - Sin rate limit propio: el gasto está en crear la publicación, que ya lo
 *    tiene. Asociar música es una fila por post y la PK lo hace idempotente.
 */

/**
 * `music_tracks` y `post_music` llegan con la 0090 y todavía no están en
 * `database.types.ts` → cliente de schema abierto. Mismo patrón que `saves` en
 * queries.ts y `post_poll_votes` en engagement-actions.ts. Al regenerar los
 * tipos, este alias se borra.
 */
type OpenClient = SupabaseClient;

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type ListMusicTracksResult =
  | { ok: true; tracks: MusicTrackView[] }
  | { ok: false; code: "unauthenticated" | "error" }
  | { ok: false; code: "tenant-mismatch"; message: string };

/** Fila cruda del catálogo, tal como la devuelve PostgREST. */
interface MusicTrackRow {
  id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  storage_path: string;
  license_kind: string;
  attribution_required: boolean;
  attribution_text: string | null;
  category: string;
}

const TRACK_COLUMNS =
  "id, title, artist, duration_seconds, storage_path, license_kind, attribution_required, attribution_text, category";

function licenseKindOf(raw: string): MusicLicenseKind {
  return (MUSIC_LICENSE_KINDS as readonly string[]).includes(raw)
    ? (raw as MusicLicenseKind)
    : "licensed"; // Un valor desconocido se trata como el más restrictivo.
}

function categoryOf(raw: string): MusicCategory {
  return (MUSIC_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as MusicCategory)
    : "general";
}

function toTrackView(row: MusicTrackRow): MusicTrackView {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSeconds: row.duration_seconds,
    previewUrl: musicTrackUrl(row.storage_path),
    licenseKind: licenseKindOf(row.license_kind),
    attributionRequired: row.attribution_required,
    attributionText: row.attribution_text,
    category: categoryOf(row.category),
  };
}

/**
 * El catálogo que esta persona puede elegir.
 *
 * `is_active` se filtra ACÁ además de en la policy: la policy es la frontera,
 * pero un `select` que no lo diga dependería de que nadie afloje esa policy
 * nunca. Las pistas de otra comunidad no se filtran acá porque no hay forma de
 * pedirlas — la policy no las devuelve (`tenant_id is null or tenant_id = …`).
 *
 * Devuelve lista VACÍA cuando no hay catálogo cargado. No es un error: es el
 * estado real de la feature hasta que alguien consiga las licencias, y el
 * picker tiene un estado vacío que lo dice.
 */
export async function listMusicTracksAction(): Promise<ListMusicTracksResult> {
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }

  const open = guard.supabase as unknown as OpenClient;
  const { data, error } = await open
    .from("music_tracks")
    .select(TRACK_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true })
    .limit(200);

  if (error) {
    console.warn("[musica] lectura del catálogo falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  const rows = (data ?? []) as MusicTrackRow[];
  return { ok: true, tracks: rows.map(toTrackView) };
}

// ---------------------------------------------------------------------------
// Asociar una pista a una publicación
// ---------------------------------------------------------------------------

const attachSchema = z.object({
  postId: z.uuid(),
  trackId: z.uuid(),
  /**
   * Desde qué segundo arranca el recorte. Techo de 900 s = el mismo del check
   * de la columna (0090); el techo REAL sale de la duración de la pista y se
   * aplica abajo con `clampStartSeconds`, que es la misma función que usa el
   * picker: el cliente y el servidor no pueden discrepar sobre qué es válido.
   */
  startSeconds: z.number().int().min(0).max(900).optional(),
});

export type AttachPostMusicInput = {
  postId: string;
  trackId: string;
  startSeconds?: number;
};

export type AttachPostMusicResult =
  | { ok: true; startSeconds: number }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "invalid"
        /** La pista no existe, está apagada o no es de esta comunidad. */
        | "track-unavailable"
        /** La publicación no existe para esta persona, o no es suya. */
        | "post-unavailable"
        | "error";
      message?: string;
    }
  | { ok: false; code: "tenant-mismatch"; message: string };

/**
 * Le pone música a una publicación propia (o le cambia la que tenía).
 *
 * Es un UPSERT sobre la PK `post_id`: elegir otra canción no crea una segunda
 * fila ni deja dos pistas sonando. Y volver a mandar lo mismo —dos toques, dos
 * pestañas— termina en el mismo estado, que es el que la persona pidió.
 *
 * El `start_seconds` que se guarda es el CORREGIDO contra la duración real de
 * la pista, no el que mandó el cliente: un offset pasado del final se acomoda al
 * último arranque posible en vez de rebotar con un error por algo que la
 * persona no puede entender ni arreglar.
 */
export async function attachPostMusicAction(
  input: AttachPostMusicInput,
): Promise<AttachPostMusicResult> {
  const parsed = attachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { postId, trackId } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, user } = guard;
  const open = guard.supabase as unknown as OpenClient;

  // La pista: tiene que existir, estar activa y ser visible para esta persona.
  // La RLS ya la esconde si es de otra comunidad; se relee igual porque hace
  // falta su `duration_seconds` para acomodar el recorte.
  const { data: track, error: trackError } = await open
    .from("music_tracks")
    .select("id, duration_seconds, is_active")
    .eq("id", trackId)
    .maybeSingle();

  if (trackError) {
    console.warn("[musica] lectura de la pista falló", { code: trackError.code });
    return { ok: false, code: "error" };
  }
  if (!track || track.is_active !== true) return { ok: false, code: "track-unavailable" };

  // La publicación: mía, de esta comunidad y no moderada. La RLS de
  // `post_music_insert` lo vuelve a exigir; leerlo acá permite devolver el
  // motivo exacto en vez de un 42501 que el composer no sabría explicar.
  const { data: post, error: postError } = await open
    .from("posts")
    .select("id, author_id, tenant_id, status")
    .eq("id", postId)
    .maybeSingle();

  if (postError) {
    console.warn("[musica] lectura de la publicación falló", { code: postError.code });
    return { ok: false, code: "error" };
  }
  if (
    !post ||
    post.author_id !== user.id ||
    post.tenant_id !== tenant.id ||
    post.status === "removed"
  ) {
    return { ok: false, code: "post-unavailable" };
  }

  const startSeconds = clampStartSeconds(
    parsed.data.startSeconds ?? 0,
    typeof track.duration_seconds === "number" ? track.duration_seconds : 0,
  );

  const { error } = await open.from("post_music").upsert(
    {
      post_id: postId,
      tenant_id: tenant.id,
      track_id: trackId,
      start_seconds: startSeconds,
    },
    { onConflict: "post_id" },
  );

  if (error) {
    console.warn("[musica] upsert de la pista falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  revalidatePath("/feed");
  return { ok: true, startSeconds };
}

// ---------------------------------------------------------------------------
// Sacarle la música a una publicación
// ---------------------------------------------------------------------------

const detachSchema = z.object({ postId: z.uuid() });

export type DetachPostMusicInput = { postId: string };

export type DetachPostMusicResult =
  | { ok: true }
  | { ok: false; code: "unauthenticated" | "invalid" | "error"; message?: string }
  | { ok: false; code: "tenant-mismatch"; message: string };

/**
 * Saca la pista de una publicación. Idempotente: borrar algo que ya no está es
 * el resultado que la persona pidió, no un error que mostrarle.
 *
 * Quién puede: el autor, o la moderación de la comunidad (policy
 * `post_music_delete`, 0090). Lo segundo hace falta de verdad — si una licencia
 * se cae hay que poder retirar la canción sin depender de que el autor
 * aparezca. Acá no se filtra por autor a propósito: la policy decide, y
 * duplicar la regla en el servidor le sacaría a la moderación su camino.
 */
export async function detachPostMusicAction(
  input: DetachPostMusicInput,
): Promise<DetachPostMusicResult> {
  const parsed = detachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const open = guard.supabase as unknown as OpenClient;

  const { error } = await open.from("post_music").delete().eq("post_id", parsed.data.postId);

  if (error) {
    console.warn("[musica] borrado de la pista falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  revalidatePath("/feed");
  return { ok: true };
}
