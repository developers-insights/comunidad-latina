import Link from "next/link";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "./copy";

/**
 * TIENDA APAGADA (spec §7): la membresía venció o se canceló, y
 * `listings.store_active` quedó en `false`.
 *
 * Nunca un 500 ni una página muda — que es lo fácil de hacer mal acá, porque
 * la fila del listing SIGUE existiendo y la tentación es dejar que la página
 * renderice a medias.
 *
 * Dos mensajes para el mismo hecho, porque son dos personas distintas:
 *
 *  - **Visitante**: no le importa (ni le corresponde saber) que alguien no
 *    pagó. Le importa que la vidriera no está y qué puede hacer ahora. Cero
 *    detalle de facturación: el estado de pago de un negocio no es información
 *    pública.
 *  - **Dueño**: necesita saber exactamente qué pasó, que no perdió nada, y
 *    cómo volver — en un toque.
 */
export function StoreOffNotice({ isOwner }: { isOwner: boolean }) {
  if (isOwner) {
    return (
      <EmptyState
        icon={<Storefront />}
        title={COPY.store.offOwnerTitle}
        message={COPY.store.offOwnerMessage}
        action={
          <Link
            href="/marketplace/membresia"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.store.offOwnerCta}
          </Link>
        }
        className="py-16"
      />
    );
  }

  return (
    <EmptyState
      icon={<Storefront />}
      title={COPY.store.offVisitorTitle}
      message={COPY.store.offVisitorMessage}
      action={
        <Link
          href="/marketplace"
          className={buttonVariants({ variant: "outline", size: "md" })}
        >
          {COPY.store.offVisitorCta}
        </Link>
      }
      className="py-16"
    />
  );
}
