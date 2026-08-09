import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Megaphone } from "@phosphor-icons/react/dist/ssr";
import { Banner, EmptyState, buttonVariants } from "@/components/ui";
import {
  COPY,
  CommentComposer,
  PostCard,
  PostMenu,
  type PostEntityView,
  type PostPollView,
} from "@/components/feed";
// Import por path directo (el barrel del feed es de otro agente): el item del
// comentario es fuente única compartida con la hoja del feed.
import { CommentItem } from "@/components/feed/comment-item";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { timeAgo } from "@/lib/utils";
import {
  POST_COLUMNS,
  authorViewOf,
  fetchActivePromotions,
  fetchAuthorViews,
  fetchBlockedIds,
  fetchEntityViews,
  fetchPostPolls,
  fetchViewerLikes,
  fetchViewerSaves,
  toPostCardModel,
  type PostRow,
} from "../queries";

export const metadata = { title: "Publicación" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENTS_LIMIT = 200;

/**
 * Detalle de post (§4.b → destino de la card): post completo + hilo de
 * comentarios + composer con la misma moderación + like optimista +
 * Reportar (⋯, primera opción SIEMPRE).
 */
export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  // RLS decide la visibilidad: published para todos; pending/removed solo
  // para el autor y staff del tenant.
  const { data: postRow, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("[feed] query de detalle falló", { code: error.code });
  }
  // Post inexistente (o invisible por RLS) → notFound(), NO un return con la
  // UI de vacío: devolviendo JSX el status quedaba en 200 y un link muerto
  // parecía una página válida para crawlers y analytics. La misma pantalla
  // —"volvé al feed"— vive ahora en ./not-found.tsx, que Next renderiza con
  // 404 de verdad.
  if (!postRow) notFound();

  const post = postRow as PostRow;

  // Comentarios published del hilo, ascendente (lectura natural).
  const { data: commentRows } = await supabase
    .from("comments")
    .select("id, body, created_at, author_id, status")
    .eq("post_id", post.id)
    .eq("status", "published")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(COMMENTS_LIMIT);

  // Filtro barato en memoria (§ contrato bloqueo): sin comentarios de gente
  // que el viewer bloqueó. Un solo select liviano, reutilizado del módulo FEED.
  const blockedIds = await fetchBlockedIds(supabase, viewerId);
  const comments = (commentRows ?? []).filter(
    (comment) => !comment.author_id || !blockedIds.has(comment.author_id),
  );

  // Batch: autores del post + comentarios, y estado de like del viewer.
  const authorIds = [
    post.author_id,
    ...comments.map((comment) => comment.author_id),
  ].filter((value): value is string => Boolean(value));

  const now = new Date();
  const [authors, likedIds, savedIds, pollByPostId, entityById, promoResult, promotions] =
    await Promise.all([
      fetchAuthorViews(supabase, authorIds),
      fetchViewerLikes(supabase, viewerId, [post.id]),
      fetchViewerSaves(supabase, viewerId, [post.id]),
      // Solo las preguntas pueden tener encuesta (0041): en un post común la
      // query ni sale.
      post.kind === "question"
        ? fetchPostPolls(supabase, viewerId, [post.id])
        : Promise.resolve(new Map<string, PostPollView>()),
      post.entity_listing_id
        ? fetchEntityViews(supabase, [post.entity_listing_id])
        : Promise.resolve(new Map<string, PostEntityView>()),
      // Campaña activa del post: público sabe que es "Publicidad"; solo el autor
      // ve hasta cuándo (badge más abajo). Sigue siendo la fuente de isPromoted.
      supabase
        .from("post_promotions")
        .select("ends_at")
        .eq("post_id", post.id)
        .eq("status", "active")
        .gt("ends_at", now.toISOString())
        .order("ends_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Solo para el teléfono del CTA de WhatsApp: cta_whatsapp (0038) no está
      // en database.types.ts y el helper ya resuelve el cast + el respaldo si la
      // columna todavía no existe. Query chica (single-community) y en paralelo.
      fetchActivePromotions(supabase, tenant.id),
    ]);

  const entity = post.entity_listing_id
    ? (entityById.get(post.entity_listing_id) ?? null)
    : null;
  const promoEndsAt = promoResult.data?.ends_at ?? null;
  const isPromoted = Boolean(promoEndsAt);
  const isAuthor = Boolean(viewerId && post.author_id === viewerId);

  // "Tu campaña llega hasta el …": es plata, y el día que se lee tiene que ser
  // el día del reloj de quien la pagó, no el de la costa este por decreto.
  const formatDate = await getViewerFormatDate();

  const postModel = toPostCardModel(post, authors, likedIds, now, {
    entity,
    isPromoted,
    savedByViewer: savedIds.has(post.id),
    poll: pollByPostId.get(post.id) ?? null,
    ctaWhatsapp: isPromoted
      ? (promotions.whatsappByPostId.get(post.id) ?? null)
      : null,
  });
  const isPublished = post.status === "published";

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href="/feed"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {COPY.detail.backToFeed}
        </Link>
      </div>

      {post.status === "pending_review" && (
        <Banner variant="warning" className="mb-4 rounded-lg">
          {COPY.post.inReviewBanner}
        </Banner>
      )}
      {post.status === "removed" && (
        <Banner variant="info" className="mb-4 rounded-lg">
          {COPY.post.removedBanner}
        </Banner>
      )}

      {/* Estado de campaña — solo el autor ve hasta cuándo (feedback 2026-07-19). */}
      {isAuthor && promoEndsAt && (
        <Banner
          variant="info"
          className="mb-4 rounded-lg"
          icon={<Megaphone size={20} weight="fill" className="text-brand" />}
        >
          {COPY.post.campaignActiveBadge(
            formatDate(promoEndsAt, { locale: tenant.locale, style: "long" }),
          )}
        </Banner>
      )}

      <PostCard
        post={postModel}
        tenantId={tenant.id}
        viewerId={viewerId}
        isDetail
        // El reel vertical infinito existe SÓLO en /feed y /videos. Acá se ve UNA
        // publicación —y se llega desde el perfil de alguien o desde las
        // novedades de un evento—, así que tocar el video lo abre a pantalla
        // completa y el "atrás" devuelve a donde estabas, en vez de mandarte a
        // scrollear videos ajenos (feedback cliente 2026-07-27). El valor es el
        // NO_REEL_SCOPE de components/feed/card-video.tsx (literal acá porque
        // esto es un server component y ese módulo es "use client").
        videoScope="sin-reel"
        menu={<PostMenu postId={post.id} authorId={post.author_id} viewerId={viewerId} />}
      />

      <section aria-label={COPY.comments.title} className="mt-6">
        <h2 className="font-display text-lg font-bold text-foreground">
          {COPY.comments.title}{" "}
          <span className="numeric font-semibold text-foreground-muted">
            ({post.comment_count})
          </span>
        </h2>

        {comments.length === 0 ? (
          <EmptyState
            className="py-8"
            title={COPY.comments.emptyTitle}
            message={COPY.comments.emptyMessage}
          />
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                author={authorViewOf(authors, comment.author_id)}
                body={comment.body}
                timeAgoLabel={timeAgo(comment.created_at, now)}
              />
            ))}
          </ul>
        )}

        {isPublished && (
          <div className="mt-5">
            {viewerId ? (
              <CommentComposer postId={post.id} />
            ) : (
              <Link
                href={`/entrar?next=${encodeURIComponent(`/feed/${post.id}`)}`}
                className={buttonVariants({ variant: "outline", size: "md" })}
              >
                {COPY.comments.signInPrompt}
              </Link>
            )}
          </div>
        )}
      </section>
    </>
  );
}
