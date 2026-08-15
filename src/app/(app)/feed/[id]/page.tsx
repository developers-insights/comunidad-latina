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
import { CommentMenu } from "@/components/feed/comment-menu";
import { COMMENT_THREAD_COPY } from "@/components/feed/helpers";
import { decodeCursor, encodeCursor } from "@/components/listings";
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
  fetchPostMusic,
  fetchPostPolls,
  fetchViewerLikes,
  fetchViewerSaves,
  toPostCardModel,
  type PostRow,
} from "../queries";
import { fetchTagsForPost } from "@/lib/social/post-tags";

export const metadata = { title: "Publicación" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Cuántos comentarios trae CADA tanda del hilo. Es un tamaño de PÁGINA, no un
 * techo: antes eran 200 sin cursor y el comentario 201 no existía para nadie —
 * ni para quien lo escribió. Y como el orden era ascendente, lo que se perdía
 * era lo más NUEVO: justo la conversación viva. Una publicación viral alcanzaba
 * ese techo el primer día.
 */
const COMMENTS_PAGE_SIZE = 200;

/** Cursor keyset del hilo: `?antes=` trae la tanda anterior (más vieja). */
const OLDER_PARAM = "antes";

/**
 * Detalle de post (§4.b → destino de la card): post completo + hilo de
 * comentarios + composer con la misma moderación + like optimista +
 * Reportar (⋯, primera opción SIEMPRE).
 */
export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(id)) notFound();

  // Cursor del hilo. `decodeCursor` valida forma (ISO + uuid) y devuelve null
  // ante cualquier otra cosa: lo que se interpola abajo en el filtro de
  // PostgREST nunca es texto libre de la URL.
  const olderThan = decodeCursor(
    typeof sp[OLDER_PARAM] === "string" ? sp[OLDER_PARAM] : undefined,
  );

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

  // Comentarios published del hilo. Se LEEN descendentes (los más nuevos
  // primero) y se pintan ascendentes: así la tanda que siempre está garantizada
  // es la de la conversación viva, y "ver anteriores" va hacia atrás con keyset
  // — nunca un OFFSET, que en un hilo que crece mientras se lee repite y
  // saltea filas.
  //
  // `tenant_id` va en el WHERE aunque el `post_id` ya sea único: es la columna
  // LÍDER de `comments_post_thread_idx (tenant_id, post_id, created_at, id)`, y
  // la policy no lo aporta como qual (lo tiene dentro de un OR, y un OR no se
  // convierte en condición de índice). Sin él el plan cae a `comments_post_fk_idx`
  // + Sort en memoria: leer y ordenar los 5.000 comentarios de un hilo para
  // devolver 200, en cada apertura. Verificado con EXPLAIN: con tenant_id es
  // "Index Scan Backward using comments_post_thread_idx" y sin Sort.
  let commentsQuery = supabase
    .from("comments")
    .select("id, body, created_at, author_id, status")
    .eq("tenant_id", tenant.id)
    .eq("post_id", post.id)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // +1 para saber si HAY tanda anterior sin pagar una segunda consulta.
    .limit(COMMENTS_PAGE_SIZE + 1);

  if (olderThan) {
    commentsQuery = commentsQuery.or(
      `created_at.lt."${olderThan.createdAt}",and(created_at.eq."${olderThan.createdAt}",id.lt."${olderThan.id}")`,
    );
  }

  const { data: commentRows, error: commentsError } = await commentsQuery;
  if (commentsError) {
    console.warn("[feed] query del hilo falló", { code: commentsError.code });
  }

  const fetched = commentRows ?? [];
  const pageRows = fetched.slice(0, COMMENTS_PAGE_SIZE);
  const hasOlder = fetched.length > COMMENTS_PAGE_SIZE;
  // El cursor sale de la última fila LEÍDA, no de la última visible: si el
  // filtro de bloqueados de abajo se come la más vieja, la tanda siguiente
  // tiene que arrancar igual donde terminó ésta.
  const oldestRow = pageRows[pageRows.length - 1];
  const olderHref =
    hasOlder && oldestRow
      ? `/feed/${post.id}?${OLDER_PARAM}=${encodeCursor(oldestRow.created_at, oldestRow.id)}`
      : null;

  // Filtro barato en memoria (§ contrato bloqueo): sin comentarios de gente
  // que el viewer bloqueó. Un solo select liviano, reutilizado del módulo FEED.
  const blockedIds = await fetchBlockedIds(supabase, viewerId);
  const comments = pageRows
    .filter((comment) => !comment.author_id || !blockedIds.has(comment.author_id))
    // De vuelta a ascendente: la LECTURA del hilo no cambia (el más viejo
    // arriba), sólo cambió qué tanda se trae.
    .reverse();

  // Batch: autores del post + comentarios, y estado de like del viewer.
  const authorIds = [
    post.author_id,
    ...comments.map((comment) => comment.author_id),
  ].filter((value): value is string => Boolean(value));

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
  ] =
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
      // Etiquetados de ESTA publicación (0089).
      fetchTagsForPost(supabase, post.id),
      // Música de ESTA publicación (0090). Batch de un solo id, mismo helper
      // que usa el feed — una sola fuente de verdad para el mapeo.
      fetchPostMusic(supabase, [post.id]),
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
    taggedPeople: tagged,
    music: musicByPostId.get(post.id) ?? null,
  });
  const isPublished = post.status === "published";
  /** Comentarios cerrados por su autor (0097). Vale también para él. */
  const commentsLocked = Boolean(post.comments_locked_at);

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
        menu={
          <PostMenu
            postId={post.id}
            authorId={post.author_id}
            viewerId={viewerId}
            // Sin estos datos el menú no podía ofrecer editar (necesita el texto
            // de partida) ni nombrar lo que se pierde al eliminar. Ya viajaban
            // en la fila; sólo faltaba pasarlos.
            postBody={post.body}
            postStatus={post.status}
            hasMedia={post.media.length > 0}
            media={post.media}
            commentCount={post.comment_count}
            likeCount={post.like_count}
            pinnedAt={post.pinned_at}
            hiddenAt={post.hidden_at}
            commentsLockedAt={post.comments_locked_at}
            // Al eliminar hay que SALIR: esta página deja de existir.
            redirectAfterDelete="/feed"
          />
        }
      />

      <section aria-label={COPY.comments.title} className="mt-6">
        <h2 className="font-display text-lg font-bold text-foreground">
          {COPY.comments.title}{" "}
          <span className="numeric font-semibold text-foreground-muted">
            ({post.comment_count})
          </span>
        </h2>

        {/* Tanda ANTERIOR (más vieja). Va arriba del hilo porque es hacia
            arriba que se va al pasado: el orden de lectura es ascendente. */}
        {olderHref && (
          <div className="mt-4">
            <Link
              href={olderHref}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {COMMENT_THREAD_COPY.older}
            </Link>
          </div>
        )}

        {comments.length === 0 ? (
          // El vacío honesto es sólo el del hilo SIN cursor. Una tanda vacía
          // más atrás no significa "nadie comentó todavía": significa que ahí
          // se terminó el hilo, y para eso está el link de volver al final.
          !olderThan && (
            <EmptyState
              className="py-8"
              title={COPY.comments.emptyTitle}
              message={COPY.comments.emptyMessage}
            />
          )
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {comments.map((comment) => {
              const author = authorViewOf(authors, comment.author_id);
              // Borran su autor y quien publicó (0097). Esto NO es el permiso
              // —lo decide la policy `comments_delete` y la server action lee
              // cuántas filas volvieron—: es para no ofrecer un menú que va a
              // rebotar.
              const isOwnComment = Boolean(viewerId && comment.author_id === viewerId);
              const canDelete = isOwnComment || isAuthor;
              return (
                <CommentItem
                  key={comment.id}
                  author={author}
                  body={comment.body}
                  timeAgoLabel={timeAgo(comment.created_at, now)}
                  menu={
                    canDelete ? (
                      <CommentMenu
                        commentId={comment.id}
                        authorName={author.displayName}
                        isOwnComment={isOwnComment}
                      />
                    ) : undefined
                  }
                />
              );
            })}
          </ul>
        )}

        {/* Con el hilo corrido hacia atrás, abajo está la salida: volver al
            final, que es donde sigue la conversación. */}
        {olderThan && (
          <div className="mt-4">
            <Link
              href={`/feed/${post.id}`}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {COMMENT_THREAD_COPY.newest}
            </Link>
          </div>
        )}

        {isPublished && (
          <div className="mt-5">
            {commentsLocked ? (
              // Comentarios cerrados por su autor (0097). Se dice en el lugar
              // donde estaría el campo de escribir: un espacio vacío se lee
              // como que la app se rompió. El candado real lo pone la policy
              // `comments_insert`, no este `if`.
              <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">
                {COPY.postMenu.commentsClosedNotice}
              </p>
            ) : viewerId ? (
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
