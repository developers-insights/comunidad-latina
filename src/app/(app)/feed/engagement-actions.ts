"use server";

import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * Server actions de ENGAGEMENT del feed (migración 0038): guardar y vistas.
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
