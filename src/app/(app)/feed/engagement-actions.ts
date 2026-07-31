"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * Server actions de ENGAGEMENT (migraciones 0038 y 0050): guardar, vistas de
 * post y de aviso, voto de encuesta y compartir un aviso.
 *
 * Vive en `feed/` porque `saves` es polimórfica (post | listing) y este módulo
 * es su dueño: el detalle de un aviso ya importaba `toggleSaveAction` desde
 * acá, y partir el engagement de los avisos en otro archivo dejaría la misma
 * mecánica escrita dos veces. Lo que sí vive en `lib/monetization` es lo que
 * PAGA (los clics de los botones premium); esto es gratuito y de todos.
 *
 * Reglas que gobiernan este archivo:
 * - Zod PRIMERO (parseo puro, sin I/O), `requireTenantMatch()` DESPUÉS y ANTES
 *   de cualquier efecto: si el JWT y el header apuntan a comunidades distintas,
 *   la RLS iba a rechazar igual — cortamos antes de gastar el intento.
 * - Escritura SIEMPRE con el cliente del usuario: RLS es la frontera real.
 *   Nada de admin client acá.
 * - Sin `revalidatePath`: las dos acciones son de estado optimista en el
 *   cliente (el corazón/marcador ya cambió). Revalidar la ruta re-renderizaría
 *   el feed entero por cada tap — justo lo que hace que la app se sienta lenta.
 */

// ---------------------------------------------------------------------------
// Guardar / quitar de guardados (post o aviso)
// ---------------------------------------------------------------------------

const toggleSaveSchema = z.object({
  subjectKind: z.enum(["post", "listing"]),
  subjectId: z.uuid(),
  save: z.boolean(),
});

export type ToggleSaveInput = {
  subjectKind: "post" | "listing";
  subjectId: string;
  save: boolean;
};

export type ToggleSaveResult =
  | { ok: true; saved: boolean }
  | {
      ok: false;
      code: "unauthenticated" | "tenant-mismatch" | "invalid" | "error";
      message?: string;
    };

/** Violación de unique (`saves_one_per_subject`): ya estaba guardado. */
const UNIQUE_VIOLATION = "23505";

export async function toggleSaveAction(
  input: ToggleSaveInput,
): Promise<ToggleSaveResult> {
  const parsed = toggleSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { subjectKind, subjectId, save } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (save) {
    // RLS: valida dueño, tenant y que el sujeto exista published en este tenant.
    const { error } = await supabase.from("saves").insert({
      tenant_id: tenant.id,
      subject_kind: subjectKind,
      subject_id: subjectId,
      profile_id: user.id,
    });
    // Doble tap / dos pestañas: ya estaba guardado. El resultado que el usuario
    // pidió YA es verdad — es éxito idempotente, no un error que mostrarle.
    if (error && error.code !== UNIQUE_VIOLATION) {
      console.warn("[engagement] insert de guardado falló", { code: error.code });
      return { ok: false, code: "error" };
    }
    return { ok: true, saved: true };
  }

  const { error } = await supabase
    .from("saves")
    .delete()
    .eq("subject_kind", subjectKind)
    .eq("subject_id", subjectId)
    .eq("profile_id", user.id);

  if (error) {
    console.warn("[engagement] borrado de guardado falló", { code: error.code });
    return { ok: false, code: "error" };
  }
  return { ok: true, saved: false };
}

// ---------------------------------------------------------------------------
// Votar en la encuesta Sí/No de una pregunta (contrato 0041)
// ---------------------------------------------------------------------------

const votePollSchema = z.object({
  postId: z.uuid(),
  /** true = Sí · false = No. El check de la DB solo conoce este formato. */
  choice: z.boolean(),
});

export type VotePostPollInput = { postId: string; choice: boolean };

export type VotePostPollResult =
  | {
      ok: true;
      choice: boolean;
      /** Contadores frescos del trigger. null si no se pudieron releer. */
      yes: number | null;
      no: number | null;
    }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "invalid"
        /** El post no existe, no es pregunta, o no tiene encuesta. */
        | "not-poll"
        | "error";
      message?: string;
    };

/**
 * Registra —o CAMBIA— el voto del usuario en la encuesta de una pregunta.
 *
 * Reglas duras:
 * - Zod primero, guard de tenant después y ANTES de cualquier escritura.
 * - El post se re-lee del servidor para confirmar que es `kind='question'` CON
 *   `poll_kind='yes_no'`: el cliente no decide dónde se puede votar. Un post
 *   común, una pregunta sin encuesta o un post de otra comunidad se rechazan
 *   acá, antes de tocar `post_poll_votes` (la RLS es la última línea, no la
 *   única).
 * - Un voto por persona, cambiable: es un UPSERT sobre la PK (post_id,
 *   voter_id). Cambiar de opinión no crea una fila nueva ni infla contadores.
 * - Los contadores los mantiene el TRIGGER. Acá solo se releen para devolver la
 *   verdad y que la UI optimista no quede desfasada.
 */
export async function votePostPollAction(
  input: VotePostPollInput,
): Promise<VotePostPollResult> {
  const parsed = votePollSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { postId, choice } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { supabase, user } = guard;

  // `poll_kind` llega con la 0041 y todavía no está en database.types.ts →
  // cliente de schema abierto (mismo patrón que `saves` en queries.ts).
  const open = supabase as unknown as SupabaseClient;

  const { data: post, error: readError } = await open
    .from("posts")
    .select("id, kind, poll_kind")
    .eq("id", postId)
    .maybeSingle();

  if (readError) {
    console.warn("[engagement] lectura de la pregunta falló", { code: readError.code });
    return { ok: false, code: "error" };
  }
  // RLS mediante: si no se ve, para este usuario no existe.
  if (!post || post.kind !== "question" || post.poll_kind !== "yes_no") {
    return { ok: false, code: "not-poll" };
  }

  const { error: voteError } = await open
    .from("post_poll_votes")
    .upsert({ post_id: postId, voter_id: user.id, choice }, { onConflict: "post_id,voter_id" });

  if (voteError) {
    console.warn("[engagement] upsert de voto falló", { code: voteError.code });
    return { ok: false, code: "error" };
  }

  // Contadores frescos (los escribió el trigger en la misma transacción). Si la
  // relectura falla, el voto YA quedó: se devuelve ok y la UI conserva su
  // estimación optimista en vez de mentir un fracaso.
  const { data: counts } = await open
    .from("posts")
    .select("poll_yes_count, poll_no_count")
    .eq("id", postId)
    .maybeSingle();

  return {
    ok: true,
    choice,
    yes: typeof counts?.poll_yes_count === "number" ? counts.poll_yes_count : null,
    no: typeof counts?.poll_no_count === "number" ? counts.poll_no_count : null,
  };
}

// ---------------------------------------------------------------------------
// Registrar una vista de video (reel)
// ---------------------------------------------------------------------------

const recordPostViewSchema = z.object({ postId: z.uuid() });

export type RecordPostViewInput = { postId: string };

/**
 * Registra una vista de video. Fire-and-forget: jamás lanza, jamás bloquea UI.
 *
 * `post_views` deduplica por (post, persona, DÍA) con su primary key, así que
 * volver a mirar el mismo reel no infla el contador: el 23505 es el caso
 * ESPERADO, no una falla. Anónimos y divergencia de tenant salen en silencio
 * (`ok: false`) — una vista no registrada no merece un cartel de error.
 */
export async function recordPostViewAction(
  input: RecordPostViewInput,
): Promise<{ ok: boolean }> {
  try {
    const parsed = recordPostViewSchema.safeParse(input);
    if (!parsed.success) return { ok: false };

    const guard = await requireTenantMatch();
    if (!guard.ok) return { ok: false };
    const { tenant, supabase, user } = guard;

    const { error } = await supabase.from("post_views").insert({
      tenant_id: tenant.id,
      post_id: parsed.data.postId,
      viewer_id: user.id,
    });

    if (error && error.code !== UNIQUE_VIOLATION) return { ok: false };
    return { ok: true };
  } catch {
    // Ni un error inesperado (red, cookies raras) puede romper la reproducción.
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Registrar la vista de un AVISO
// ---------------------------------------------------------------------------

const recordListingViewSchema = z.object({ listingId: z.uuid() });

export type RecordListingViewInput = { listingId: string };

/**
 * Registra que alguien abrió el detalle de un aviso (`listing_views`, 0050).
 * Mismo contrato que `recordPostViewAction`, y por las mismas razones:
 *
 *  - La PK deduplica por (aviso, persona, DÍA): volver a abrir el mismo aviso
 *    no infla `listings.view_count`, y el 23505 es el caso ESPERADO — de hecho
 *    es el más frecuente de todos, porque el detalle se revisita.
 *  - Fire-and-forget: sin sesión, con tenant divergente o con la base caída
 *    sale `ok: false` en silencio. Nadie merece un cartel de error porque una
 *    métrica no se registró.
 *
 * El dueño que mira su propio aviso TAMBIÉN cuenta, igual que el autor de un
 * reel en `post_views`. Excluirlo obligaría a leer `created_by` antes de cada
 * vista y el número que se protegería es el que esa persona se muestra a sí
 * misma; no vale una query por visita.
 */
export async function recordListingViewAction(
  input: RecordListingViewInput,
): Promise<{ ok: boolean }> {
  try {
    const parsed = recordListingViewSchema.safeParse(input);
    if (!parsed.success) return { ok: false };

    const guard = await requireTenantMatch();
    if (!guard.ok) return { ok: false };
    const { tenant, supabase, user } = guard;

    const { error } = await supabase.from("listing_views").insert({
      tenant_id: tenant.id,
      listing_id: parsed.data.listingId,
      viewer_id: user.id,
    });

    if (error && error.code !== UNIQUE_VIOLATION) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Registrar que se compartió un AVISO
// ---------------------------------------------------------------------------

const recordListingShareSchema = z.object({ listingId: z.uuid() });

export type RecordListingShareInput = { listingId: string };

/**
 * Suma 1 al contador diario de compartidas de un aviso.
 *
 * Va por RPC (`record_listing_share`, 0050) y no por un insert: las policies de
 * escritura de `listing_shares` están en `false` justamente para que el
 * contador no se pueda escribir con un número elegido por el cliente.
 *
 * Se llama DESPUÉS de que el share nativo/copiar-link resolvió bien, nunca
 * antes: contar la intención en vez del hecho convertiría cada cancelación del
 * diálogo del sistema en una compartida que no ocurrió. Y devuelve `void`
 * porque el resultado no cambia nada en pantalla — compartir tiene que
 * funcionar aunque la métrica falle.
 */
export async function recordListingShareAction(
  input: RecordListingShareInput,
): Promise<void> {
  try {
    const parsed = recordListingShareSchema.safeParse(input);
    if (!parsed.success) return;

    const guard = await requireTenantMatch();
    // Sin sesión no hay métrica: la RPC exige auth.uid() y devolvería
    // AUTH_REQUIRED. Se sale en silencio — compartir ya funcionó.
    if (!guard.ok) return;

    const { error } = await guard.supabase.rpc("record_listing_share", {
      p_listing_id: parsed.data.listingId,
    });
    if (error) {
      console.warn("[engagement] record_listing_share falló", { code: error.code });
    }
  } catch {
    // Silencio deliberado: ver el comentario de arriba.
  }
}
