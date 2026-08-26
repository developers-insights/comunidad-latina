"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getCaraActiva } from "@/lib/perfil-activo/cara";
import { puedeFirmarComo } from "@/lib/feed/autoria";
import {
  TIER_AUTO,
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
} from "@/lib/moderation";
import { COPY } from "@/components/marketplace/copy";
import { firstPhotoUrl } from "@/components/listings/helpers";

/**
 * Server actions de COMENTARIOS DE AVISOS (migración 0038, tabla
 * listing_comments). Espejo EXACTO del hilo de posts (feed/actions.ts +
 * components/feed/comments-sheet.tsx) contra listings:
 *
 * - Lectura: solo `published`, orden cronológico (created_at, id) y filtrado en
 *   memoria de los autores que el lector bloqueó — la RLS de user_blocks ya
 *   limita esa consulta a las filas del propio lector, así que no hace falta
 *   pasarle su id. Sin guard: leer no tiene efectos y el contenido published es
 *   público a propósito.
 * - Escritura: zod → `requireTenantMatch()` ANTES de moderar (sin coincidencia
 *   de tenant la RLS iba a rechazar igual: no gastamos la llamada a OpenAI) →
 *   moderación → insert con el cliente del USUARIO.
 *
 * DESVÍO HEREDADO (gana el contrato de la DB, igual que en el feed): la policy
 * listing_comments_insert solo permite nacer 'published'. Un comentario flagged
 * NO se inserta: el intento se encola en la cola humana (único uso del admin
 * client acá — moderation_queue tiene insert=false para usuarios, §6) y el
 * autor recibe un aviso cálido para reformular.
 */

const GENERIC_INVALID = "invalid" as const;

/** Igual que el hilo de posts: cronológico, los más viejos arriba. */
const COMMENTS_LIMIT = 50;

export type ListingCommentItem = {
  id: string;
  authorId: string | null;
  authorName: string;
  avatarUrl: string | null;
  /**
   * Ficha que firmó el comentario (0117), ya resuelta. Cuando viene, la hoja
   * pinta el NEGOCIO —su nombre, su foto y la insignia de local— en vez de la
   * persona. `null` = lo dijo la persona.
   */
  entity: ComentarioFicha | null;
  body: string;
  createdAt: string;
};

export type FetchListingCommentsResult =
  | { ok: true; items: ListingCommentItem[]; nextCursor: string | null }
  | { ok: false; code: "invalid" | "error"; message?: string };

const fetchSchema = z.object({
  listingId: z.uuid(),
  // v1 trae el hilo completo (50): se acepta para no romper al cliente que lo
  // mande, pero `nextCursor` siempre vuelve null — nadie pagina todavía.
  cursor: z.string().max(100).nullish(),
});

export async function fetchListingCommentsAction(input: {
  listingId: string;
  cursor?: string | null;
}): Promise<FetchListingCommentsResult> {
  const parsed = fetchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { listingId } = parsed.data;

  const supabase = await createClient();

  const [commentsResult, blocksResult] = await Promise.all([
    supabase
      .from("listing_comments")
      .select("id, body, created_at, author_id, entity_listing_id")
      .eq("listing_id", listingId)
      .eq("status", "published")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(COMMENTS_LIMIT),
    // RLS de user_blocks ya limita a blocker_id = auth.uid(): traemos SOLO los
    // bloqueos del lector sin pasar su id (anónimo → set vacío).
    supabase.from("user_blocks").select("blocked_id"),
  ]);

  if (commentsResult.error) {
    console.warn("[marketplace] fetch de comentarios falló", {
      code: commentsResult.error.code,
    });
    return { ok: false, code: "error" };
  }

  const blocked = new Set((blocksResult.data ?? []).map((row) => row.blocked_id));
  const rows = (commentsResult.data ?? []).filter(
    (row) => !row.author_id || !blocked.has(row.author_id),
  );

  const [authors, fichas] = await Promise.all([
    fetchAuthors(
      supabase,
      rows.map((row) => row.author_id),
    ),
    // Las fichas que firman comentarios, en una consulta para el hilo entero
    // (0117). Se resuelven ACÁ y no en el cliente porque este hilo ya viaja
    // resuelto —nombre y foto ya vienen planos—: devolver un id suelto obligaría
    // a la hoja a hacer un viaje más sólo para esta superficie.
    fetchFichas(
      supabase,
      rows.map((row) => row.entity_listing_id),
    ),
  ]);

  return {
    ok: true,
    items: rows.map((row) => {
      const ficha = row.entity_listing_id ? fichas.get(row.entity_listing_id) : undefined;
      return {
        id: row.id,
        authorId: row.author_id,
        authorName: authors.get(row.author_id ?? "")?.name ?? COPY.detail.communityMember,
        avatarUrl: authors.get(row.author_id ?? "")?.avatarUrl ?? null,
        // Firmado por un negocio: la hoja lo pinta con el nombre y la foto del
        // local. Si la ficha ya no resuelve (se despublicó), vuelve a verse a
        // nombre de la persona — que es quien lo escribió.
        entity: ficha ?? null,
        body: row.body,
        createdAt: row.created_at,
      };
    }),
    nextCursor: null,
  };
}

type AuthorRow = { name: string; avatarUrl: string | null };

/** La ficha que firma un comentario, ya resuelta a nombre + foto pública. */
export interface ComentarioFicha {
  nombre: string;
  avatarUrl: string | null;
}

/**
 * Las fichas que firman comentarios del hilo, en UNA consulta. La RLS de
 * `listings` ya limita a lo publicado (o propio): una ficha despublicada
 * simplemente no resuelve y su comentario vuelve a verse a nombre de la persona.
 * Nunca lanza — un hilo no puede caerse porque no se pueda pintar un logo.
 */
async function fetchFichas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listingIds: (string | null)[],
): Promise<Map<string, ComentarioFicha>> {
  const ids = [...new Set(listingIds.filter((id): id is string => Boolean(id)))];
  const byId = new Map<string, ComentarioFicha>();
  if (ids.length === 0) return byId;
  const { data } = await supabase
    .from("listings")
    .select("id, title, photos")
    .in("id", ids);
  for (const row of data ?? []) {
    byId.set(row.id, { nombre: row.title, avatarUrl: firstPhotoUrl(row.photos) });
  }
  return byId;
}

/**
 * Perfiles de los autores en UNA consulta (espejo de fetchAuthorViewsClient de
 * la hoja del feed, sin Trust Score: la tarjeta de comentario de un aviso solo
 * muestra nombre y foto). Nunca lanza: autor sin fila queda anónimo.
 */
async function fetchAuthors(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authorIds: Array<string | null>,
): Promise<Map<string, AuthorRow>> {
  const ids = [...new Set(authorIds.filter((id): id is string => Boolean(id)))];
  const byId = new Map<string, AuthorRow>();
  if (ids.length === 0) return byId;

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);

  for (const profile of data ?? []) {
    byId.set(profile.id, {
      name: profile.display_name,
      avatarUrl: profile.avatar_url,
    });
  }
  return byId;
}

// ---------------------------------------------------------------------------
// Crear comentario — misma moderación que el hilo de posts
// ---------------------------------------------------------------------------

const createSchema = z.object({
  listingId: z.uuid(),
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(1000)),
});

export type CreateListingCommentResult =
  | { ok: true; comment: ListingCommentItem }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "invalid"
        | "moderation"
        | "error";
      message?: string;
    };

export async function createListingCommentAction(input: {
  listingId: string;
  body: string;
}): Promise<CreateListingCommentResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { listingId, body } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  const moderation = await moderateText(body);

  if (moderation.flagged) {
    // El comentario NO se inserta (la policy solo permite 'published'): queda el
    // intento en la cola humana con el texto en `reasons`.
    try {
      const admin = createAdminClient();
      const { error: queueError } = await admin.from("moderation_queue").insert({
        tenant_id: tenant.id,
        subject_kind: "comment",
        subject_id: crypto.randomUUID(), // nunca se insertó: id sintético del intento
        tier: TIER_HUMAN,
        ai_score: moderation.score,
        reasons: {
          source: "openai_omni_moderation",
          categories: moderation.categories,
          body,
          listing_id: listingId,
          author_id: user.id,
        },
      });
      if (queueError) {
        console.warn("[marketplace] no se pudo encolar comentario flagged", {
          code: queueError.code,
        });
      }
    } catch {
      console.warn("[marketplace] admin client no disponible para encolar comentario");
    }
    return { ok: false, code: "moderation" };
  }

  const cara = await getCaraActiva();
  const entityListingId =
    cara.firmaListingId &&
    (await puedeFirmarComo(supabase, {
      tenantId: tenant.id,
      userId: user.id,
      listingId: cara.firmaListingId,
    }))
      ? cara.firmaListingId
      : null;

  // RLS: valida autor, tenant, que el aviso exista published en este tenant y
  // —desde la 0117— que la ficha con la que se firma sea propia y publicada.
  const { data: created, error: insertError } = await supabase
    .from("listing_comments")
    .insert({
      tenant_id: tenant.id,
      listing_id: listingId,
      author_id: user.id,
      body,
      status: "published",
      // Misma regla que el feed (0116/0117): la decide el servidor desde la
      // identidad activa y la vuelve a validar contra la base. El cliente no
      // manda a nombre de quién comenta.
      entity_listing_id: entityListingId,
    })
    .select("id, created_at")
    .single();

  if (insertError || !created) {
    console.warn("[marketplace] insert de comentario falló", {
      code: insertError?.code,
    });
    return { ok: false, code: "error" };
  }

  // Score intermedio o moderación saltada → publica pero entra a monitoreo.
  const tier = moderationTier(moderation.score);
  if (moderation.skipped || tier > TIER_AUTO) {
    try {
      await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "comment",
        subjectId: created.id,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons: moderation.skipped ? ["moderation_skipped"] : moderation.categories,
        tier: TIER_REVIEW,
      });
    } catch {
      console.warn("[marketplace] admin client no disponible para encolar comentario");
    }
  }

  const authors = await fetchAuthors(supabase, [user.id]);

  revalidatePath(`/marketplace/${listingId}`);
  return {
    ok: true,
    comment: {
      id: created.id,
      authorId: user.id,
      authorName: authors.get(user.id)?.name ?? COPY.detail.communityMember,
      avatarUrl: authors.get(user.id)?.avatarUrl ?? null,
      // El comentario recién creado vuelve con la MISMA firma con la que quedó
      // guardado, no con la que el cliente creía tener: la hoja lo pinta con eso
      // y así el optimista y la fila de la base nunca dicen cosas distintas.
      entity:
        entityListingId && cara.negocio
          ? { nombre: cara.negocio.nombre, avatarUrl: cara.negocio.avatarUrl }
          : null,
      body,
      createdAt: created.created_at,
    },
  };
}
