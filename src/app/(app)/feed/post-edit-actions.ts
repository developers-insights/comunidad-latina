"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  TIER_AUTO,
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
} from "@/lib/moderation";
import {
  POST_EDIT_COPY,
  bodyIsPublishable,
  canDeletePost,
  canEditPost,
  postBodySchema,
} from "@/lib/social/post-editing";

/**
 * =============================================================================
 * EDITAR Y ELIMINAR UNA PUBLICACIÓN PROPIA — server actions
 * =============================================================================
 *
 * Vive fuera de `feed/actions.ts` a propósito: aquel archivo es el camino de
 * CREACIÓN (storage, huellas de integridad, declaración de licencia) y ya es
 * grande. Acá sólo se toca texto y se borran filas.
 *
 * LO QUE NO SE NEGOCIA
 * --------------------
 * · La autorización se decide EN EL SERVIDOR. Que la RLS también la cubra no
 *   alcanza: `posts_select` deja leer cualquier post `published` de cualquier
 *   comunidad (es contenido público, por SEO), así que si esta action confiara
 *   en que "la base va a rebotar lo que no corresponde" estaría delegando en
 *   una policy que ni siquiera se aplica al paso de lectura. Se lee el post, se
 *   compara `author_id` con el usuario del JWT y `tenant_id` con el tenant del
 *   guard, y recién ahí se escribe — con el cliente del usuario, para que la
 *   RLS sea la segunda línea y no la única.
 * · Nunca lanza. Todo camino devuelve `{ ok: true, … }` o
 *   `{ ok: false, code, message }` con copy ya legible.
 * · El texto editado VUELVE A MODERARSE con las mismas reglas que al publicar.
 *   Sin eso, editar sería el agujero: publicás algo inocuo, pasa el filtro, y
 *   después lo cambiás por lo que quieras.
 * · Las FOTOS Y EL VIDEO NO SE TOCAN. El porqué —la fila de `content_assets`
 *   con su `first_uploaded_at` es evidencia y no se puede desincronizar del
 *   contenido que describe— está desarrollado en `lib/social/post-editing.ts`.
 *   Este archivo simplemente no acepta archivos ni escribe `posts.media`.
 *
 * QUÉ PASA AL ELIMINAR (todo por contrato de la base, nada acá)
 * ------------------------------------------------------------
 * · comments  → `on delete cascade` (0007). Se van.
 * · reactions → `app.cleanup_reactions('post')` (0007). Se van.
 * · saves     → `app.cleanup_saves('post')` (0038). Se van.
 * · post_views / post_poll_votes / post_reach → cascade (0038 / 0041 / 0023).
 * · campaigns y post_promotions → cascade (0048 / 0023). POR ESO se bloquea el
 *   borrado con una promoción ACTIVA: borrar el post se llevaría puesto el
 *   registro de algo que alguien pagó.
 * · moderation_queue y content_integrity_alerts → NO tienen FK al post: quedan.
 *   Borrar la publicación no borra el expediente.
 * · content_assets → NO se borran nunca (0069 los deja fuera de toda purga).
 *   Son el libro de procedencia: la fecha de primera carga de cada archivo es
 *   lo que defiende a quien subió primero si mañana alguien lo reclama.
 * · Los archivos del bucket `post-media` quedan huérfanos: limpiarlos es una
 *   tarea programada aparte y NO puede hacerse acá — el hash de
 *   `content_assets` apunta a ese objeto, y borrarlo en el mismo request
 *   vaciaría la evidencia que la fila promete conservar.
 */

const GENERIC_INVALID = "invalid" as const;

/** Techo por hora. Editar es barato, pero `moderateText` llama a OpenAI. */
const EDITS_PER_HOUR = 20;
const DELETES_PER_HOUR = 20;

export type PostEditErrorCode =
  /** El payload no pasa el esquema (o el texto no es publicable). */
  | "invalid"
  | "unauthenticated"
  | "tenant-mismatch"
  /** Es de otra persona o de otra comunidad. */
  | "forbidden"
  /**
   * Es suya, pero el ESTADO no lo permite: en revisión, retirada, o con una
   * promoción paga corriendo. Se separa de `forbidden` porque la salida para la
   * persona es distinta: acá no hizo nada mal, tiene que esperar.
   */
  | "blocked"
  | "not-found"
  | "rate-limited"
  | "error";

/** Un motivo de rechazo de las reglas puras → el código que ve el cliente. */
function denialCode(reason: "not-author" | "other-community" | string): PostEditErrorCode {
  return reason === "not-author" || reason === "other-community" ? "forbidden" : "blocked";
}

export type EditPostResult =
  | {
      ok: true;
      /** `pending_review` = el texto nuevo se guardó pero espera revisión. */
      status: "published" | "pending_review";
      /** El cuerpo tal como quedó guardado (ya normalizado). */
      body: string;
    }
  | { ok: false; code: PostEditErrorCode; message: string };

export type DeletePostResult =
  | { ok: true }
  | { ok: false; code: PostEditErrorCode; message: string };

const editSchema = z.object({
  postId: z.uuid(),
  body: postBodySchema,
});

/**
 * El borrado exige que el cliente diga EXPLÍCITAMENTE que confirmó. No es
 * seguridad —quien llama a la action pone lo que quiere— sino un seguro contra
 * el peor bug posible de esta pantalla: un `onClick` mal cableado que elimine
 * sin que se haya abierto el diálogo. Con `z.literal(true)`, una llamada sin
 * confirmación es `invalid` y no borra nada.
 */
const deleteSchema = z.object({
  postId: z.uuid(),
  confirmed: z.literal(true),
});

/** Fila mínima del post para decidir. Se pide sólo lo que las reglas usan. */
const POST_COLUMNS = "id, author_id, tenant_id, status, body, media";

export async function editPostAction(input: {
  postId: string;
  body: string;
}): Promise<EditPostResult> {
  // 1 · Zod puro primero: un payload roto no gasta guard, ni base, ni OpenAI.
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    // Un id roto es un problema nuestro; un texto largo es algo que la persona
    // puede arreglar. Decirle "contanos un poquito más" por un uuid inválido la
    // mandaría a corregir lo único que estaba bien.
    const bodyFailed = parsed.error.issues.some((issue) => issue.path[0] === "body");
    return {
      ok: false,
      code: GENERIC_INVALID,
      message: bodyFailed ? POST_EDIT_COPY.edit.emptyBody : POST_EDIT_COPY.error.generic,
    };
  }
  const { postId, body } = parsed.data;

  // 2 · Guard ANTES de cualquier efecto (regla de `lib/tenant/guard.ts`).
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return {
        ok: false,
        code: "unauthenticated",
        message: POST_EDIT_COPY.error.unauthenticated,
      };
    }
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: POST_EDIT_COPY.error.generic };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`post-edit:${user.id}`, EDITS_PER_HOUR, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited", message: POST_EDIT_COPY.error.rateLimited };
  }

  // 3 · Leer el post. Con el cliente del USUARIO: si no lo puede ver, no existe.
  const { data: post, error: readError } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", postId)
    .maybeSingle();

  if (readError) {
    console.warn("[feed] no se pudo leer el post a editar", { code: readError.code });
    return { ok: false, code: "error", message: POST_EDIT_COPY.error.generic };
  }
  if (!post) {
    return { ok: false, code: "not-found", message: POST_EDIT_COPY.error.notFound };
  }

  // 4 · Autorización en el servidor. `posts_select` deja leer contenido público
  // de otras comunidades: sin esta comparación explícita, un post ajeno
  // published llegaría hasta acá tan campante.
  const allowed = canEditPost(
    { authorId: post.author_id, tenantId: post.tenant_id, status: post.status },
    { id: user.id, tenantId: tenant.id },
  );
  if (!allowed.ok) {
    return {
      ok: false,
      code: denialCode(allowed.reason),
      message: POST_EDIT_COPY.denial[allowed.reason],
    };
  }

  // 5 · Sin cambios: se sale sin moderar ni escribir. No es una optimización
  // caprichosa — un UPDATE con el mismo texto igual dispara el trigger de
  // `updated_at` y dejaría el post marcado como editado sin que nadie lo haya
  // editado, que es justo la mentira que la marca tiene que evitar.
  if (body === post.body) {
    return { ok: true, status: "published", body };
  }

  const hasMedia = Array.isArray(post.media) && post.media.length > 0;
  if (!bodyIsPublishable(body, hasMedia)) {
    return { ok: false, code: GENERIC_INVALID, message: POST_EDIT_COPY.edit.emptyBody };
  }

  // 6 · Moderación del texto NUEVO, con el mismo ruteo que al publicar (§8).
  const moderation = await moderateText(body);
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);
  const nextStatus: "published" | "pending_review" =
    moderation.flagged || tier === TIER_HUMAN ? "pending_review" : "published";
  /** Igual que en `createPostAction`: "no había texto" ≠ "no se pudo moderar". */
  const textUnmoderated = body.length > 0 && moderation.skipped;

  // 7 · UPDATE acotado por id + autor + tenant (defensa en profundidad sobre la
  // policy `posts_update`). Sólo viajan `body` y, si hace falta, `status`:
  // `media` no se toca ni por accidente.
  const { data: updated, error: updateError } = await supabase
    .from("posts")
    .update({ body, status: nextStatus })
    .eq("id", postId)
    .eq("author_id", user.id)
    .eq("tenant_id", tenant.id)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.warn("[feed] update de post falló", { code: updateError.code });
    return { ok: false, code: "error", message: POST_EDIT_COPY.error.generic };
  }
  // Sin fila devuelta la RLS rechazó la escritura (o el post cambió de estado
  // entre la lectura y el update). No se dice "listo" sobre algo que no pasó.
  if (!updated) {
    return { ok: false, code: "forbidden", message: POST_EDIT_COPY.denial["not-author"] };
  }

  // 8 · Cola de moderación. `post_edit` viaja siempre como motivo: quien revisa
  // tiene que saber que está mirando un texto que cambió DESPUÉS de publicarse.
  if (moderation.flagged || textUnmoderated || tier > TIER_AUTO) {
    try {
      const outcome = await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "post",
        subjectId: postId,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons: [
          "post_edit",
          ...(textUnmoderated ? ["moderation_skipped"] : moderation.categories),
        ],
        tier: nextStatus === "pending_review" ? TIER_HUMAN : TIER_REVIEW,
      });
      if (!outcome.ok) {
        console.warn("[feed] no se pudo encolar la edición del post", { postId });
      }
    } catch {
      console.warn("[feed] admin client no disponible para encolar la edición");
    }
  }

  revalidatePath("/feed");
  revalidatePath(`/feed/${postId}`);
  return { ok: true, status: nextStatus, body };
}

/**
 * ¿Hay una promoción paga corriendo sobre este post?
 *
 * FAIL-CLOSED a propósito: si la consulta falla, se responde `true` (hay
 * promoción) y el borrado se frena. Eliminar es irreversible y arrastraría por
 * cascade el registro de un pago; ante la duda, no se borra. La contracara
 * —alguien no puede borrar su post durante un rato— se arregla reintentando.
 */
async function hasActivePromotion(
  supabase: Awaited<ReturnType<typeof requireTenantMatch>>["supabase"],
  postId: string,
): Promise<boolean> {
  const [promotion, campaign] = await Promise.all([
    supabase
      .from("post_promotions")
      .select("id")
      .eq("post_id", postId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("campaigns")
      .select("id")
      .eq("post_id", postId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  if (promotion.error || campaign.error) {
    console.warn("[feed] no se pudo verificar promociones del post", {
      promotion: promotion.error?.code ?? null,
      campaign: campaign.error?.code ?? null,
    });
    return true;
  }
  return Boolean(promotion.data) || Boolean(campaign.data);
}

export async function deletePostAction(input: {
  postId: string;
  confirmed: true;
}): Promise<DeletePostResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: GENERIC_INVALID, message: POST_EDIT_COPY.error.generic };
  }
  const { postId } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return {
        ok: false,
        code: "unauthenticated",
        message: POST_EDIT_COPY.error.unauthenticated,
      };
    }
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: POST_EDIT_COPY.error.generic };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`post-delete:${user.id}`, DELETES_PER_HOUR, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited", message: POST_EDIT_COPY.error.rateLimited };
  }

  const { data: post, error: readError } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", postId)
    .maybeSingle();

  if (readError) {
    console.warn("[feed] no se pudo leer el post a eliminar", { code: readError.code });
    return { ok: false, code: "error", message: POST_EDIT_COPY.error.generic };
  }
  if (!post) {
    return { ok: false, code: "not-found", message: POST_EDIT_COPY.error.notFound };
  }

  // Pertenencia PRIMERO: no se consulta la promoción de un post ajeno.
  const owned = canDeletePost(
    { authorId: post.author_id, tenantId: post.tenant_id, status: post.status },
    { id: user.id, tenantId: tenant.id },
    { hasActivePromotion: false },
  );
  if (!owned.ok) {
    return {
      ok: false,
      code: denialCode(owned.reason),
      message: POST_EDIT_COPY.denial[owned.reason],
    };
  }

  const allowed = canDeletePost(
    { authorId: post.author_id, tenantId: post.tenant_id, status: post.status },
    { id: user.id, tenantId: tenant.id },
    { hasActivePromotion: await hasActivePromotion(supabase, postId) },
  );
  if (!allowed.ok) {
    return {
      ok: false,
      code: denialCode(allowed.reason),
      message: POST_EDIT_COPY.denial[allowed.reason],
    };
  }

  const { error: deleteError } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", user.id)
    .eq("tenant_id", tenant.id);

  if (deleteError) {
    console.warn("[feed] delete de post falló", { code: deleteError.code });
    return { ok: false, code: "error", message: POST_EDIT_COPY.error.generic };
  }

  revalidatePath("/feed");
  revalidatePath(`/feed/${postId}`);
  return { ok: true };
}
