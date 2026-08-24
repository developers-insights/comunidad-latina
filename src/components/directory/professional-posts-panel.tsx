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
 * ── EL VACÍO SIGUE SIENDO POSIBLE, PERO YA NO ES ESTRUCTURAL ────────────────
 * Este bloque decía que ningún composer escribía `posts.entity_listing_id` y
 * que publicar "como" profesional no existía en ninguna pantalla. Ya no es así:
 * el selector de autoría del composer permite firmar con una ficha propia,
 * `AUTORIA_KINDS` (`lib/feed/autoria.ts`) incluye `professional`, y `crearPost`
 * guarda el vínculo después de verificar contra la base que la ficha es tuya.
 *
 * El vacío se mantiene porque una comunidad nueva lo va a ver de todos modos, y
 * sigue sin ofrecer el atajo de publicar: el composer vive en el feed y esa
 * firma sólo aparece para quien administra una ficha.
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
