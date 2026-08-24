import Link from "next/link";
import { Article, CaretDown } from "@phosphor-icons/react/dist/ssr";
import { PostCard, type PostCardModel } from "@/components/feed";
import { EmptyState, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Pestaña "Publicaciones" del directorio (spec cliente: "el newsfeed de los
 * profesionales — contenido educativo, consejos, artículos, fotografías y
 * videos, anuncios profesionales, información de su industria").
 *
 * Renderiza con el MISMO `<PostCard>` que usa el feed principal — cero UI
 * nueva inventada para leer un post, y cualquier mejora futura de la tarjeta
 * (encuestas, música, menú ⋯) llega acá gratis.
 *
 * ── EL VACÍO ES ESPERADO HOY, Y ESTÁ BIEN ────────────────────────────────────
 * Ningún composer escribe todavía `posts.entity_listing_id` (se está cableando
 * en paralelo), así que con datos reales esta pestaña nace vacía. El vacío
 * cuenta qué va a aparecer ahí — nunca promete un botón que hoy no hace lo que
 * dice: publicar "como" un profesional todavía no es un camino que exista en
 * ninguna pantalla, así que este estado no ofrece ese atajo.
 */

const COPY = {
  emptyTitle: "Todavía no hay publicaciones de profesionales",
  emptyMessage:
    "Acá van a aparecer los consejos, artículos, fotos de trabajos y novedades que los profesionales compartan desde su ficha.",
  loadMore: "Ver más publicaciones",
} as const;

export interface ProfessionalPostsPanelProps {
  posts: PostCardModel[];
  tenantId: string;
  viewerId: string | null;
  /** Href de la próxima página (keyset), o null si no hay más. */
  nextHref: string | null;
}

export function ProfessionalPostsPanel({
  posts,
  tenantId,
  viewerId,
  nextHref,
}: ProfessionalPostsPanelProps) {
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={<Article />}
        title={COPY.emptyTitle}
        message={COPY.emptyMessage}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} tenantId={tenantId} viewerId={viewerId} />
      ))}

      {nextHref && (
        <Link
          href={nextHref}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          {COPY.loadMore}
          <CaretDown size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
