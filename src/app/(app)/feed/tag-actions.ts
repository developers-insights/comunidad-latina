"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  MAX_POST_TAGS,
  MIN_TAG_QUERY_LENGTH,
  TAG_SEARCH_LIMIT,
  diffTagIds,
  type TaggedProfile,
} from "@/lib/social/post-tags";

/**
 * Server actions de ETIQUETAR PERSONAS (migración 0089).
 *
 * Reglas que gobiernan este archivo (las mismas que `engagement-actions.ts`):
 * - Zod PRIMERO (parseo puro, sin I/O), `requireTenantMatch()` DESPUÉS y ANTES
 *   de cualquier efecto colateral —incluido consumir el rate limit.
 * - Escritura SIEMPRE con el cliente del usuario: la RLS es la frontera real.
 *   El admin client aparece SOLO para emitir la notificación, que es su uso
 *   permitido (`notifications` tiene insert=false para usuarios).
 * - Sin `revalidatePath`: guardar etiquetas ocurre justo después de publicar, y
 *   el composer ya refresca el feed. Revalidar acá lo haría dos veces.
 *
 * POR QUÉ GUARDAR NO VIVE DENTRO DE `createPostAction`: la etiqueta necesita el
 * `post_id`, que recién existe cuando el post está insertado. La secuencia es
 * publicar → guardar etiquetas, y está pensada para que el segundo paso pueda
 * fallar sin dejar a nadie a ciegas: es IDEMPOTENTE (calcula el diff contra lo
 * que ya hay), así que reintentarlo es seguro, y devuelve exactamente qué quedó
 * guardado y qué no.
 */

const GENERIC_INVALID = "invalid" as const;

/** El código 42501 de Postgres: la RLS rechazó la fila. */
const RLS_DENIED = "42501";
/** 23505: la etiqueta ya existía (doble toque, dos pestañas). Éxito idempotente. */
const UNIQUE_VIOLATION = "23505";
/** 23514: el trigger app.post_tags_enforce_cap() cortó por el tope de 20. */
const CHECK_VIOLATION = "23514";

/**
 * `post_tags` y la RPC `search_taggable_members` llegan con la 0089 y todavía
 * no están en `database.types.ts` (ese archivo se regenera aparte) → cliente de
 * esquema abierto, mismo patrón que `saves` y `post_poll_votes`.
 */
type OpenClient = SupabaseClient;

// ---------------------------------------------------------------------------
// Buscar personas para etiquetar
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  query: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(MIN_TAG_QUERY_LENGTH).max(80)),
});

export type SearchTaggableResult =
  | { ok: true; people: TaggedProfile[] }
  | { ok: false; code: "invalid" | "unauthenticated" | "rate-limited" | "error" };

/**
 * Personas de la comunidad que se pueden etiquetar, filtradas por la base.
 *
 * TODO el criterio (comunidad, bloqueos, preferencia de privacidad, cuentas no
 * activas, acentos) vive en la RPC `search_taggable_members` — acá no se filtra
 * nada, porque un filtro en el cliente es una sugerencia. Lo único que hace
 * esta action es sanear la entrada y darle forma al resultado.
 *
 * Rate limit propio y generoso: el buscador dispara mientras se tipea, así que
 * el techo tiene que tolerar a alguien buscando de verdad (120/hora ≈ dos
 * búsquedas por minuto sostenidas) y aun así frenar un raspado de la lista de
 * miembros, que es el abuso que importa acá.
 */
export async function searchTaggableMembersAction(
  input: { query: string },
): Promise<SearchTaggableResult> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    // Divergencia de tenant incluida: sin comunidad resuelta no hay a quién
    // buscar, y la RPC devolvería vacío igual.
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    return { ok: false, code: "error" };
  }
  const { supabase, user } = guard;

  if (!limit(`tag-search:${user.id}`, 120, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const open = supabase as OpenClient;
  const { data, error } = await open.rpc("search_taggable_members", {
    q: parsed.data.query,
    max_results: TAG_SEARCH_LIMIT,
  });

  if (error) {
    console.warn("[etiquetas] búsqueda de personas falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  const rows = (data ?? []) as Array<{
    id: string;
    display_name: string;
    avatar_url: string | null;
  }>;
  return {
    ok: true,
    people: rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    })),
  };
}

// ---------------------------------------------------------------------------
// Guardar las etiquetas de una publicación
// ---------------------------------------------------------------------------

const saveSchema = z.object({
  postId: z.uuid(),
  profileIds: z
    .array(z.uuid())
    // Duplicados fuera ANTES de contar: 25 ids con 6 repetidos son 19
    // personas, y rechazar eso sería mentirle a la persona sobre su propio tope.
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.uuid()).max(MAX_POST_TAGS)),
});

export type SaveTagsResult =
  | {
      ok: true;
      /** Ids que quedaron etiquetados de verdad, leídos del resultado real. */
      tagged: string[];
      /**
       * Ids que la base rechazó de a uno (bloqueo nuevo, preferencia cambiada
       * entre la búsqueda y el guardado, cuenta dada de baja). No es un error:
       * el resto SÍ se guardó y la persona merece saber cuál no entró.
       */
      rejected: string[];
    }
  | {
      ok: false;
      code: "invalid" | "unauthenticated" | "rate-limited" | "error";
      /** Lo que quedó guardado pese al fallo — para no perder el trabajo hecho. */
      tagged?: string[];
    }
  /** El JWT y el header apuntan a comunidades distintas — copy ya resuelto. */
  | { ok: false; code: "tenant-mismatch"; message: string };

/**
 * Deja las etiquetas de un post EXACTAMENTE como dice `profileIds`.
 *
 * Idempotente por diseño: lee lo que ya hay, calcula el diff y sólo toca la
 * diferencia. Eso es lo que permite reintentarla sin efectos raros —volver a
 * llamarla con la misma lista no inserta nada ni vuelve a notificar a nadie— y
 * es también lo que hace que "editar etiquetas" y "guardar etiquetas al
 * publicar" sean la misma operación.
 *
 * Quién puede llamarla: sólo el AUTOR del post. No se chequea acá con una
 * lectura previa —sería una carrera— sino en `post_tags_insert`, que exige
 * `posts.author_id = auth.uid()`. Si no sos el autor, no se inserta nada.
 */
export async function saveTagsAction(
  input: { postId: string; profileIds: string[] },
): Promise<SaveTagsResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { postId, profileIds } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  // Mismo techo que publicar (30/hora): etiquetar es parte del mismo acto y
  // cada etiqueta nueva dispara una notificación a otra persona, que es lo que
  // hay que racionar.
  if (!limit(`post-tags:${user.id}`, 30, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const open = supabase as OpenClient;

  // ---- Lo que ya hay ------------------------------------------------------
  const { data: existingRows, error: readError } = await open
    .from("post_tags")
    .select("profile_id")
    .eq("post_id", postId);

  if (readError) {
    console.warn("[etiquetas] lectura de etiquetas falló", { code: readError.code });
    return { ok: false, code: "error" };
  }
  const current = ((existingRows ?? []) as Array<{ profile_id: string }>).map(
    (row) => row.profile_id,
  );

  const { toAdd, toRemove } = diffTagIds(current, profileIds);

  // ---- Quitar las que sobran ---------------------------------------------
  if (toRemove.length > 0) {
    const { error: deleteError } = await open
      .from("post_tags")
      .delete()
      .eq("post_id", postId)
      .in("profile_id", toRemove);
    if (deleteError) {
      console.warn("[etiquetas] borrado de etiquetas falló", { code: deleteError.code });
      return { ok: false, code: "error", tagged: current };
    }
  }

  const saved = current.filter((id) => !toRemove.includes(id));
  const rejected: string[] = [];

  // ---- Sumar las nuevas ---------------------------------------------------
  //
  // Primero EN LOTE, que es una sola ida. Si la RLS rechaza el lote, el
  // problema es de UNA fila pero Postgres tira todo el INSERT: ahí se reintenta
  // de a una para no castigar a las 19 personas que sí podían etiquetarse por
  // culpa de la que cambió su preferencia hace diez segundos. Es el caso raro,
  // así que paga el costo sólo cuando ocurre.
  if (toAdd.length > 0) {
    const rows = toAdd.map((profileId) => ({
      tenant_id: tenant.id,
      post_id: postId,
      profile_id: profileId,
      tagged_by: user.id,
    }));

    const { error: insertError } = await open.from("post_tags").insert(rows);

    if (!insertError) {
      saved.push(...toAdd);
    } else if (insertError.code === RLS_DENIED || insertError.code === CHECK_VIOLATION) {
      for (const row of rows) {
        const { error: rowError } = await open.from("post_tags").insert(row);
        if (!rowError || rowError.code === UNIQUE_VIOLATION) {
          saved.push(row.profile_id);
        } else {
          rejected.push(row.profile_id);
        }
      }
    } else {
      console.warn("[etiquetas] insert de etiquetas falló", { code: insertError.code });
      return { ok: false, code: "error", tagged: saved };
    }
  }

  // ---- Avisar a quienes se sumaron (best-effort, jamás rompe el flujo) ----
  const notified = saved.filter((id) => toAdd.includes(id) && id !== user.id);
  if (notified.length > 0) {
    await notifyTagged(supabase, {
      tenantId: tenant.id,
      postId,
      authorId: user.id,
      profileIds: notified,
    });
  }

  return { ok: true, tagged: saved, rejected };
}

/**
 * Notifica a las personas recién etiquetadas.
 *
 * `createNotification` ya respeta las preferencias de la persona (categoría
 * `social`) y nunca lanza. La categoría va EXPLÍCITA en vez de dejarla salir
 * del fallback de `categoryForKind`: el kind `tag` es nuevo y el fallback
 * acierta por casualidad, no por contrato.
 *
 * `dedupeUnread` compara kind + href: si el autor edita la lista tres veces
 * antes de que la persona abra la app, le llega UN aviso, no tres.
 *
 * Nunca se auto-notifica al autor — el filtro está en el caller, que es donde
 * se sabe quién firma la publicación.
 */
async function notifyTagged(
  supabase: SupabaseClient,
  input: { tenantId: string; postId: string; authorId: string; profileIds: string[] },
): Promise<void> {
  try {
    const { data: author } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", input.authorId)
      .maybeSingle();
    const authorName = (author as { display_name?: string } | null)?.display_name?.trim();

    const admin = createAdminClient();
    const title = authorName
      ? `${authorName} te etiquetó en una publicación`
      : "Te etiquetaron en una publicación";

    await Promise.all(
      input.profileIds.map((profileId) =>
        createNotification(admin, {
          tenantId: input.tenantId,
          profileId,
          kind: "tag",
          category: "social",
          title,
          body: "Tocá para verla. Podés quitarte cuando quieras.",
          href: `/feed/${input.postId}`,
          dedupeUnread: true,
        }),
      ),
    );
  } catch {
    // Sin admin client (env incompleta) o con la base caída: la etiqueta YA
    // quedó guardada. Un aviso perdido no puede desandar el guardado.
    console.warn("[etiquetas] no se pudo avisar a las personas etiquetadas");
  }
}

// ---------------------------------------------------------------------------
// Quitar UNA etiqueta
// ---------------------------------------------------------------------------

const removeSchema = z.object({
  postId: z.uuid(),
  /** Ausente = quitarme a mí. Es el camino que usa la persona etiquetada. */
  profileId: z.uuid().optional(),
});

export type RemoveTagResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unauthenticated" | "error" }
  | { ok: false; code: "tenant-mismatch"; message: string };

/**
 * Quita una etiqueta. Dos personas pueden hacerlo y por motivos distintos:
 * el AUTOR corrige su publicación, y la persona ETIQUETADA ejerce un derecho
 * sobre un dato que habla de ella. La policy `post_tags_delete` habilita a las
 * dos; acá no se decide nada, sólo se arma el `delete` acotado.
 *
 * Sin `profileId` se asume "quitarme a mí": es el caso que llega desde la card,
 * y así el cliente no tiene que mandar su propio id para ejercer su derecho.
 *
 * Cero filas borradas NO es un error: puede que la etiqueta ya no estuviera (el
 * autor la sacó primero, o el botón se tocó dos veces). El resultado que la
 * persona pidió ya es verdad.
 */
export async function removeTagAction(
  input: { postId: string; profileId?: string },
): Promise<RemoveTagResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { supabase, user } = guard;

  const open = supabase as OpenClient;
  const { error } = await open
    .from("post_tags")
    .delete()
    .eq("post_id", parsed.data.postId)
    .eq("profile_id", parsed.data.profileId ?? user.id);

  if (error) {
    console.warn("[etiquetas] quitar etiqueta falló", { code: error.code });
    return { ok: false, code: "error" };
  }
  return { ok: true };
}
