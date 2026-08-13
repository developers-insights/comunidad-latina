"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { canManagePost, postMenuDenialOf, type PostMenuDenial } from "@/lib/social/post-menu";

/**
 * =============================================================================
 * MENÚ ⋯ DE UNA PUBLICACIÓN — server actions (migración 0097)
 * =============================================================================
 *
 * Fijar, ocultar del feed, desactivar comentarios y eliminar un comentario.
 * Vive aparte de `post-edit-actions.ts` porque aquél es el camino de EDITAR y
 * ELIMINAR (moderación de texto, promociones pagas, cascadas) y acá no se
 * modera nada: se prenden y se apagan marcas de tiempo.
 *
 * -----------------------------------------------------------------------------
 * LO QUE NO SE NEGOCIA (las mismas reglas del resto del módulo)
 * -----------------------------------------------------------------------------
 * · Zod PRIMERO (parseo puro, sin I/O). `requireTenantMatch()` DESPUÉS y ANTES
 *   de cualquier efecto, incluido consumir el rate limit.
 * · La autorización se decide EN EL SERVIDOR y por partida triple: acá se relee
 *   el post y se compara autor + comunidad contra el JWT; las funciones de la
 *   0097 repiten el filtro en su WHERE; y la RLS de `posts_update` es la última
 *   línea. Que la UI no ofrezca el botón no cuenta como control.
 *   El porqué de la relectura es el mismo que explica `post-edit-actions.ts`:
 *   `posts_select` deja leer CUALQUIER post `published` de CUALQUIER comunidad
 *   —es contenido público, por SEO—, así que sin la comparación explícita un
 *   post ajeno llega hasta acá tan campante.
 * · Escritura SIEMPRE con el cliente del usuario. Nada de admin client.
 * · Nunca lanza: todo camino devuelve `{ ok: true }` o `{ ok: false, code,
 *   message }` con copy ya legible. Sin `catch {}` mudos.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ FIJAR VA POR RPC Y OCULTAR/CERRAR NO
 * -----------------------------------------------------------------------------
 * Fijar son DOS escrituras (bajar la anterior, subir ésta) y tienen que ser
 * atómicas o queda un instante sin nada fijado y una carrera contra el índice
 * único. Eso lo resuelve `public.fijar_publicacion` (0097), que es `security
 * invoker`: la RLS sigue aplicando, la función sólo aporta la transacción.
 *
 * Ocultar y cerrar comentarios son UNA escritura cada una: un UPDATE acotado por
 * id + autor + tenant alcanza y no hay nada que envolver. Sumarles una función
 * sería superficie de API sin ganancia.
 */

const GENERIC_INVALID = "invalid" as const;

/** Techo por hora. Son toggles baratos; el tope frena el ruido, no el uso real. */
const MENU_ACTIONS_PER_HOUR = 60;
/** Borrar comentarios de un hilo propio puede ser una tanda legítima. */
const COMMENT_DELETES_PER_HOUR = 60;

export type PostMenuErrorCode =
  | "invalid"
  | "unauthenticated"
  | "tenant-mismatch"
  /** Es de otra persona, de otra comunidad, o el estado no lo permite. */
  | "denied"
  | "not-found"
  | "rate-limited"
  | "error";

export type PostMenuResult =
  | { ok: true }
  | { ok: false; code: PostMenuErrorCode; message: string };

/**
 * `pinned_at`, `hidden_at` y `comments_locked_at` llegan con la 0097 y todavía
 * no están en `database.types.ts` (ese archivo se regenera aparte) → cliente de
 * esquema abierto, mismo patrón que `saves` y `post_poll_votes`.
 */
type OpenClient = SupabaseClient;

/** Las columnas mínimas para decidir. Ni una de más. */
const POST_STATE_COLUMNS =
  "id, author_id, tenant_id, status, pinned_at, hidden_at, comments_locked_at";

interface PostState {
  id: string;
  author_id: string | null;
  tenant_id: string;
  status: string;
  pinned_at: string | null;
  hidden_at: string | null;
  comments_locked_at: string | null;
}

/**
 * Copy de los rechazos. Se importa dentro de cada action y no arriba del archivo
 * porque `components/feed/copy.ts` es un módulo de cliente-y-servidor: traerlo
 * acá es gratis, pero mantenerlo local a la función deja explícito que lo único
 * que cruza la frontera es texto.
 */
async function copy() {
  const { COPY } = await import("@/components/feed/copy");
  return COPY.postMenu;
}

/** Preludio común: guard de tenant + rate limit + relectura autorizada del post. */
type Prelude =
  | {
      ok: true;
      post: PostState;
      supabase: OpenClient;
      user: { id: string };
      tenantId: string;
    }
  | { ok: false; result: PostMenuResult };

async function openPost(postId: string, bucket: string, perHour: number): Promise<Prelude> {
  const texts = await copy();

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return {
        ok: false,
        result: { ok: false, code: "unauthenticated", message: texts.needsAuth },
      };
    }
    if (guard.reason === "tenant-mismatch") {
      return {
        ok: false,
        result: { ok: false, code: "tenant-mismatch", message: guard.message },
      };
    }
    return { ok: false, result: { ok: false, code: "error", message: texts.errorBody } };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`${bucket}:${user.id}`, perHour, HOUR_MS).ok) {
    return {
      ok: false,
      result: { ok: false, code: "rate-limited", message: texts.rateLimited },
    };
  }

  const open = supabase as OpenClient;
  const { data, error } = await open
    .from("posts")
    .select(POST_STATE_COLUMNS)
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    console.warn("[feed] no se pudo leer la publicación del menú", { code: error.code });
    return { ok: false, result: { ok: false, code: "error", message: texts.errorBody } };
  }
  if (!data) {
    return {
      ok: false,
      result: { ok: false, code: "not-found", message: texts.denial["no-disponible"] },
    };
  }

  const post = data as PostState;
  const allowed = canManagePost(
    { authorId: post.author_id, tenantId: post.tenant_id, status: post.status },
    { id: user.id, tenantId: tenant.id },
  );
  if (!allowed.ok) {
    return {
      ok: false,
      result: { ok: false, code: "denied", message: texts.denial[allowed.reason] },
    };
  }

  return { ok: true, post, supabase: open, user, tenantId: tenant.id };
}

/** Refresca las dos superficies donde se nota el cambio. */
function revalidatePost(postId: string) {
  revalidatePath("/feed");
  revalidatePath(`/feed/${postId}`);
}

// ---------------------------------------------------------------------------
// Fijar / dejar de fijar
// ---------------------------------------------------------------------------

const pinSchema = z.object({ postId: z.uuid(), pin: z.boolean() });

/**
 * Fija o desfija una publicación propia. Una fijada por persona y por comunidad:
 * fijar la segunda BAJA la primera, y las dos escrituras viajan juntas dentro de
 * `public.fijar_publicacion` (ver el docblock del archivo).
 *
 * La UI no tiene que preguntar "¿ya tenés una fijada?" ni ofrecer desfijar la
 * anterior: fijar significa "que sea ésta", y eso es lo que hace.
 */
export async function togglePinPostAction(input: {
  postId: string;
  pin: boolean;
}): Promise<PostMenuResult> {
  const texts = await copy();
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: GENERIC_INVALID, message: texts.errorBody };
  }
  const { postId, pin } = parsed.data;

  const prelude = await openPost(postId, "post-pin", MENU_ACTIONS_PER_HOUR);
  if (!prelude.ok) return prelude.result;

  const { data, error } = await prelude.supabase.rpc("fijar_publicacion", {
    p_post: postId,
    p_fijar: pin,
  });

  if (error) {
    console.warn("[feed] fijar_publicacion falló", { code: error.code });
    return { ok: false, code: "error", message: texts.errorBody };
  }

  const outcome = postMenuDenialOf(typeof data === "string" ? data : null);
  if (!outcome.ok) return denialToResult(outcome, texts);

  revalidatePost(postId);
  // El perfil es DONDE se ve el resultado de fijar: sin esto la persona vuelve a
  // su perfil y la publicación sigue en su lugar viejo, que se lee como que el
  // botón no hizo nada.
  revalidatePath("/perfil");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ocultar del feed / volver a mostrar
// ---------------------------------------------------------------------------

const hideSchema = z.object({ postId: z.uuid(), hide: z.boolean() });

/**
 * Oculta la publicación de las superficies de descubrimiento, o la devuelve.
 *
 * OCULTAR DESFIJA EN LA MISMA SENTENCIA. No es una cortesía: fijar es poner algo
 * arriba de todo y ocultar es sacarlo de la vista, así que convivir es un estado
 * imposible —y el CHECK `posts_pin_no_convive_con_oculto` (0097) lo rechazaría
 * con un error que no le dice nada a nadie. Se resuelve acá, en el mismo UPDATE,
 * para que no haya ni un instante con las dos marcas puestas.
 *
 * Volver a mostrar NO vuelve a fijar. Si alguien ocultó su publicación fijada,
 * al mostrarla otra vez recupera su lugar por fecha: restaurar el pin sería
 * decidir por ella algo que no pidió, y encima podría bajar la que fijó mientras
 * tanto.
 */
export async function toggleHidePostAction(input: {
  postId: string;
  hide: boolean;
}): Promise<PostMenuResult> {
  const texts = await copy();
  const parsed = hideSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: GENERIC_INVALID, message: texts.errorBody };
  }
  const { postId, hide } = parsed.data;

  const prelude = await openPost(postId, "post-hide", MENU_ACTIONS_PER_HOUR);
  if (!prelude.ok) return prelude.result;

  const { data, error } = await prelude.supabase
    .from("posts")
    .update(
      hide
        ? { hidden_at: new Date().toISOString(), pinned_at: null }
        : { hidden_at: null },
    )
    .eq("id", postId)
    .eq("author_id", prelude.user.id)
    .eq("tenant_id", prelude.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[feed] ocultar publicación falló", { code: error.code });
    return { ok: false, code: "error", message: texts.errorBody };
  }
  // Sin fila devuelta la RLS rechazó la escritura (o el post cambió de estado
  // entre la lectura y el update). No se dice "listo" sobre algo que no pasó.
  if (!data) {
    return { ok: false, code: "denied", message: texts.denial["no-disponible"] };
  }

  revalidatePost(postId);
  revalidatePath("/perfil");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Desactivar / activar comentarios
// ---------------------------------------------------------------------------

const lockSchema = z.object({ postId: z.uuid(), lock: z.boolean() });

/**
 * Cierra o abre los comentarios de una publicación propia.
 *
 * Lo que se escribe acá es la marca; QUIEN LA HACE CUMPLIR es la policy
 * `comments_insert` (0097), que exige `comments_locked_at is null` sobre el post
 * antes de aceptar una fila. Por eso esta action no tiene que hacer nada más:
 * aunque alguien se saltee la UI, Postgres rechaza el comentario.
 *
 * Los comentarios que ya estaban no se tocan. Cerrar la puerta no es quemar la
 * conversación que ya ocurrió, y borrarlos sería una sanción que nadie pidió.
 */
export async function toggleCommentsLockedAction(input: {
  postId: string;
  lock: boolean;
}): Promise<PostMenuResult> {
  const texts = await copy();
  const parsed = lockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: GENERIC_INVALID, message: texts.errorBody };
  }
  const { postId, lock } = parsed.data;

  const prelude = await openPost(postId, "post-comments-lock", MENU_ACTIONS_PER_HOUR);
  if (!prelude.ok) return prelude.result;

  const { data, error } = await prelude.supabase
    .from("posts")
    .update({ comments_locked_at: lock ? new Date().toISOString() : null })
    .eq("id", postId)
    .eq("author_id", prelude.user.id)
    .eq("tenant_id", prelude.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[feed] cerrar comentarios falló", { code: error.code });
    return { ok: false, code: "error", message: texts.errorBody };
  }
  if (!data) {
    return { ok: false, code: "denied", message: texts.denial["no-disponible"] };
  }

  revalidatePost(postId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Eliminar un comentario
// ---------------------------------------------------------------------------

const deleteCommentSchema = z.object({
  commentId: z.uuid(),
  /**
   * Mismo seguro que `deletePostAction`: el cliente tiene que decir
   * EXPLÍCITAMENTE que confirmó. No es seguridad —quien llama a la action pone
   * lo que quiere— sino un cortafuegos contra el peor bug de esta pantalla: un
   * `onClick` mal cableado que borre sin que se haya abierto el diálogo.
   */
  confirmed: z.literal(true),
});

export type DeleteCommentResult =
  | { ok: true }
  | { ok: false; code: PostMenuErrorCode; message: string };

/**
 * Elimina un comentario.
 *
 * QUIÉN PUEDE: su autor, el AUTOR DE LA PUBLICACIÓN donde está, y el staff de esa
 * comunidad. Lo decide íntegramente la policy `comments_delete` (0007 + 0097) y
 * esta action NO la duplica con una lectura previa — sería una carrera y, peor,
 * una segunda definición de "quién puede" que el día de mañana puede divergir de
 * la de la base. Acá se arma el DELETE acotado y se lee cuántas filas volvieron.
 *
 * El motivo de sumar al autor de la publicación está en la cabecera de la 0097:
 * hasta hoy, su única salida frente a un comentario que no quería en su
 * publicación era eliminar la publicación entera, llevándose puestos los
 * comentarios de todas las demás personas.
 *
 * CERO FILAS ES UN RECHAZO, no un éxito silencioso. A diferencia de quitar una
 * etiqueta —donde "ya no está" es el resultado que la persona pidió— acá no
 * poder distinguir "no te correspondía" de "ya no estaba" haría que la UI
 * dijera "eliminado" sobre un comentario que sigue en pantalla.
 */
export async function deleteCommentAction(input: {
  commentId: string;
  confirmed: true;
}): Promise<DeleteCommentResult> {
  const { COPY } = await import("@/components/feed/copy");
  const texts = COPY.commentMenu;

  const parsed = deleteCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: GENERIC_INVALID, message: texts.errorBody };
  }
  const { commentId } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.postMenu.needsAuth };
    }
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: texts.errorBody };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`comment-delete:${user.id}`, COMMENT_DELETES_PER_HOUR, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited", message: COPY.postMenu.rateLimited };
  }

  const { data, error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)
    // Redundante con la policy y explícito igual, en línea con el resto del
    // módulo: el filtro de comunidad se escribe donde se lee la query.
    .eq("tenant_id", tenant.id)
    .select("id");

  if (error) {
    console.warn("[feed] borrado de comentario falló", { code: error.code });
    return { ok: false, code: "error", message: texts.errorBody };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, code: "denied", message: texts.forbidden };
  }

  revalidatePath("/feed");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */

/** Un rechazo de la RPC → el resultado con el copy que le corresponde. */
function denialToResult(
  outcome: Exclude<ReturnType<typeof postMenuDenialOf>, { ok: true }>,
  texts: { denial: Record<PostMenuDenial, string>; needsAuth: string; errorBody: string },
): PostMenuResult {
  if (outcome.kind === "unauthenticated") {
    return { ok: false, code: "unauthenticated", message: texts.needsAuth };
  }
  if (outcome.kind === "denial") {
    return { ok: false, code: "denied", message: texts.denial[outcome.reason] };
  }
  return { ok: false, code: "error", message: texts.errorBody };
}
