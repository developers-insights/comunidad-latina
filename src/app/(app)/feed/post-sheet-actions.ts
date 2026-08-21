"use server";

import type {
  PostCardModel,
  PostEntityView,
  PostPollView,
} from "@/components/feed";
import { fetchTagsForPost } from "@/lib/social/post-tags";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import {
  POST_COLUMNS,
  fetchActivePromotions,
  fetchAuthorViews,
  fetchEntityViews,
  fetchPostMusic,
  fetchPostPolls,
  fetchViewerLikes,
  fetchViewerSaves,
  toPostCardModel,
  type PostRow,
} from "./queries";

/**
 * UNA publicación, armada para la HOJA que la abre sin sacarte de donde estás
 * (feedback cliente 2026-08-20: "cuando querés comentar una publicación no te
 * tiene que mover a otra publicación; ahí nomás dentro de pantalla se tiene que
 * fluir sin sacarte del feed. Mientras menos pasos mejor").
 *
 * POR QUÉ EXISTE ESTA ACTION Y NO SE REUSÓ OTRA. Las que había arman PÁGINAS del
 * feed (`fetchFeedPageAction`) o hilos de comentarios: ninguna sabe traer la
 * publicación N por su id. Lo único que sabía hacerlo era el render de
 * `/feed/[id]`, y eso no es reutilizable desde el navegador — es una página.
 * Así que esto NO es un camino nuevo: es EL MISMO de `[id]/page.tsx`, pelado de
 * JSX y de comentarios (el hilo lo trae la hoja de comentarios, que ya existe).
 * Si cambia lo que la tarjeta necesita, los dos lugares se tocan juntos.
 *
 * SEGURIDAD (guía server-actions.md): es un POST alcanzable por cualquiera, no
 * sólo por el toque en la miniatura. Por eso NUNCA acepta tenantId ni viewerId
 * del caller —los resuelve acá adentro— y la visibilidad la sigue decidiendo la
 * RLS de `posts`, igual que en el detalle: published para todos; pending/removed
 * sólo para su autor y el staff del tenant. Es una LECTURA: no muta ni revalida.
 *
 * DELIBERADAMENTE NO filtra `hidden_at`: el detalle tampoco lo hace. Una
 * publicación oculta del feed sigue siendo alcanzable por su link, y la hoja
 * tiene que mostrar exactamente lo mismo que mostraría `/feed/[id]` — si no,
 * "abrir" y "abrir en otra pestaña" darían resultados distintos sobre la misma
 * publicación.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Todo lo que la hoja necesita para montar la tarjeta REAL, no una pobre. */
export interface PostSheetPayload {
  post: PostCardModel;
  /** Lo pide `PostCard` para las acciones (me gusta, guardar, comentar). */
  tenantId: string;
  /** null = anónimo. Decide qué se le ofrece hacer, no qué puede ver (eso es RLS). */
  viewerId: string | null;
}

/**
 * Tres finales distintos y no dos, porque la hoja dice cosas distintas: "ya no
 * está" (se borró, o nunca fue visible para vos) no es "no pudimos traerla"
 * (conexión). Mezclarlos haría que un problema de red parezca un borrado.
 */
export type PostSheetResult =
  | { ok: true; data: PostSheetPayload }
  | { ok: false; reason: "not-found" | "error" };

export async function fetchPostForSheetAction(input: {
  postId: string;
}): Promise<PostSheetResult> {
  // Un id con otra forma no llega a la DB: no hay publicación posible y el
  // error de PostgREST sería ruido en los logs.
  if (!UUID_RE.test(input.postId)) return { ok: false, reason: "not-found" };

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  // Verificación LOCAL del JWT, sin round-trip al Auth server: esto se dispara
  // con cada toque en una miniatura y la RLS es la que decide de verdad. Mismo
  // criterio que la paginación del feed.
  const viewerId = await getAuthUserId();

  const { data, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", input.postId)
    .maybeSingle();

  if (error) {
    console.warn("[feed] la hoja no pudo leer la publicación", {
      code: error.code,
    });
    return { ok: false, reason: "error" };
  }
  if (!data) return { ok: false, reason: "not-found" };

  const post = data as PostRow;
  const now = new Date();

  const [
    authors,
    likedIds,
    savedIds,
    pollByPostId,
    entityById,
    promoResult,
    promotions,
    tagged,
    musicByPostId,
  ] = await Promise.all([
    fetchAuthorViews(
      supabase,
      [post.author_id].filter((value): value is string => Boolean(value)),
    ),
    fetchViewerLikes(supabase, viewerId, [post.id]),
    fetchViewerSaves(supabase, viewerId, [post.id]),
    // Sólo una pregunta puede tener encuesta (0041): en un post común la query
    // ni sale.
    post.kind === "question"
      ? fetchPostPolls(supabase, viewerId, [post.id])
      : Promise.resolve(new Map<string, PostPollView>()),
    post.entity_listing_id
      ? fetchEntityViews(supabase, [post.entity_listing_id])
      : Promise.resolve(new Map<string, PostEntityView>()),
    // Campaña vigente: de acá sale el chip honesto de "Publicidad".
    supabase
      .from("post_promotions")
      .select("ends_at")
      .eq("post_id", post.id)
      .eq("status", "active")
      .gt("ends_at", now.toISOString())
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchActivePromotions(supabase, tenant.id),
    fetchTagsForPost(supabase, post.id),
    fetchPostMusic(supabase, [post.id]),
  ]);

  const isPromoted = Boolean(promoResult.data?.ends_at);

  return {
    ok: true,
    data: {
      post: toPostCardModel(post, authors, likedIds, now, {
        entity: post.entity_listing_id
          ? (entityById.get(post.entity_listing_id) ?? null)
          : null,
        isPromoted,
        savedByViewer: savedIds.has(post.id),
        poll: pollByPostId.get(post.id) ?? null,
        ctaWhatsapp: isPromoted
          ? (promotions.whatsappByPostId.get(post.id) ?? null)
          : null,
        taggedPeople: tagged,
        music: musicByPostId.get(post.id) ?? null,
      }),
      tenantId: tenant.id,
      viewerId,
    },
  };
}
