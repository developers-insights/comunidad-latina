import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Banner, EmptyState, buttonVariants } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import {
  COPY,
  CommentComposer,
  PostCard,
  PostMenu,
} from "@/components/feed";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { timeAgo } from "@/lib/utils";
import {
  POST_COLUMNS,
  authorViewOf,
  fetchAuthorViews,
  fetchBlockedIds,
  fetchViewerLikes,
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
  if (!postRow) {
    return (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={COPY.detail.notFoundTitle}
        message={COPY.detail.notFoundMessage}
        action={
          <Link href="/feed" className={buttonVariants({ variant: "secondary", size: "md" })}>
            <ArrowLeft size={16} aria-hidden="true" />
            {COPY.detail.backToFeed}
          </Link>
        }
      />
    );
  }

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
  const [authors, likedIds] = await Promise.all([
    fetchAuthorViews(supabase, authorIds),
    fetchViewerLikes(supabase, viewerId, [post.id]),
  ]);

  const postModel = toPostCardModel(post, authors, likedIds, now);
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

      <PostCard
        post={postModel}
        tenantId={tenant.id}
        viewerId={viewerId}
        isDetail
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
            {comments.map((comment) => {
              const author = authorViewOf(authors, comment.author_id);
              return (
                <li key={comment.id} className="flex items-start gap-2.5">
                  <Avatar size="sm" name={author.displayName} src={author.avatarUrl} />
                  <div className="min-w-0 flex-1 rounded-lg bg-surface-subtle px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {author.displayName}
                      </span>
                      {author.profileId && (
                        <PublisherTrust
                          displayName={author.displayName}
                          firstName={firstNameOf(author.displayName)}
                          score={author.score}
                          level={author.level}
                          signals={author.signals}
                          size="inline"
                        />
                      )}
                      <span className="text-xs text-foreground-muted">
                        · {timeAgo(comment.created_at, now)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {comment.body}
                    </p>
                  </div>
                </li>
              );
            })}
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
