import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/feed";

/**
 * 404 del detalle de post. Es la MISMA pantalla que antes devolvía el page.tsx
 * como JSX ("esta publicación ya no está" + volver al feed), pero servida por
 * el boundary de `notFound()`: se conserva el copy específico del feed —el 404
 * global manda a /propiedades y /guias, que acá no viene al caso— y además el
 * status HTTP es 404 de verdad.
 */
export default function PostNotFound() {
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
