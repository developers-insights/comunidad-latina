import Link from "next/link";
import { CaretDown, Storefront } from "@phosphor-icons/react/dist/ssr";
import { PostCard, type PostCardModel } from "@/components/feed";
import { EmptyState, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Pestaña "Publicaciones" de Negocios (spec cliente: «el newsfeed sólo de
 * contenido comercial — fotos, videos, textos, menús, productos y servicios,
 * anuncios, y tarjetas de eventos y de empleos vinculadas a sus módulos»).
 *
 * Renderiza con el MISMO `<PostCard>` que el feed principal. Cero UI nueva
 * inventada para leer una publicación, y las tarjetas embebidas de evento o de
 * empleo que pide la spec llegan gratis: `PostCard` ya sabe pintar la ficha
 * vinculada de un post, y cualquier mejora futura de esa tarjeta aparece acá sin
 * que nadie la porte.
 *
 * ── EL VACÍO ES ESPERADO HOY, Y ESTÁ BIEN ────────────────────────────────────
 * El composer que escribe `posts.entity_listing_id` desde un negocio se está
 * cableando en paralelo, así que con datos reales esta pestaña nace vacía. El
 * vacío cuenta qué va a aparecer ahí y ofrece el camino que SÍ existe hoy —el
 * directorio— en vez de prometer un "Publicar como mi negocio" que todavía no
 * es una pantalla.
 */

const COPY = {
  vacioTitulo: "Todavía no hay publicaciones de negocios",
  vacioMensaje:
    "Acá van a aparecer las novedades que compartan los comercios de tu comunidad: fotos y videos, menús del día, productos y servicios, y los eventos y empleos que publiquen.",
  vacioCta: "Ver los negocios",
  verMas: "Ver más publicaciones",
} as const;

export interface PublicacionesPanelProps {
  posts: PostCardModel[];
  tenantId: string;
  viewerId: string | null;
  /** Href de la próxima página (keyset), o null si no hay más. */
  nextHref: string | null;
  className?: string;
}

export function PublicacionesPanel({
  posts,
  tenantId,
  viewerId,
  nextHref,
  className,
}: PublicacionesPanelProps) {
  if (posts.length === 0) {
    return (
      <EmptyState
        className={className}
        icon={<Storefront />}
        title={COPY.vacioTitulo}
        message={COPY.vacioMensaje}
        action={
          <Link href="/negocios" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {COPY.vacioCta}
          </Link>
        }
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} tenantId={tenantId} viewerId={viewerId} />
      ))}

      {nextHref && (
        <Link
          href={nextHref}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          {COPY.verMas}
          <CaretDown size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
