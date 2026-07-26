import Link from "next/link";
import { AccentLink, BezelCard, CardMedia } from "@/components/ui";
import { COPY } from "./copy";
import { categoryLabel, categoryShortLabel } from "./helpers";
import { SellerChip, type SellerView } from "./seller-chip";

/** Sin foto propia (og-default): composición abstracta de marca, neutral para cualquier rubro. */
const FALLBACK_PHOTO = "/images/og-default.png";

/** Acento verde del módulo (solo decorativo) para la píldora de acción. */
const ACCENT = "var(--accent-marketplace)";

const MEDIA_LINK =
  "group block focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]";

export interface ProductCardModel {
  id: string;
  title: string;
  priceLabel: string | null;
  /** Valor crudo de attrs.category — la card lo traduce con categoryShortLabel() (chip) y categoryLabel() (aria-label). */
  category: string | null;
  photoUrl: string | null;
  /** Tienda o particular — lo resuelve la página en batch (ver marketplace/page.tsx). */
  seller: SellerView;
}

/**
 * Card de producto del Marketplace (§ feedback cliente 2026-07-24: se siente RED
 * SOCIAL, no clasificado). Foto vertical 4:5 protagonista con el título y el
 * precio en una franja de VIDRIO encima (glass) y la categoría flotando arriba.
 * Tap en la foto abre el producto; debajo, el chip de la tienda (linkea a su
 * vidriera) y una píldora con el acento del módulo.
 *
 * El chip de categoría usa `categoryShortLabel` (1 palabra, cabe en la grilla
 * 2-col) con "vidrio oscuro" (`bg-media-scrim` + `backdrop-blur-sm` +
 * `text-on-media`) — no el verde saturado del acento, que sobre una foto real
 * pelea con el producto. El `aria-label` lleva el label LARGO para lectores de
 * pantalla.
 */
export function ProductCard({ product }: { product: ProductCardModel }) {
  const categoryFull = categoryLabel(product.category);
  const categoryShort = categoryShortLabel(product.category);

  return (
    <BezelCard coreClassName="flex h-full flex-col overflow-hidden p-0">
      <article aria-label={product.title} className="flex h-full flex-col">
        <Link href={`/marketplace/${product.id}`} aria-label={product.title} className={MEDIA_LINK}>
          <CardMedia
            src={product.photoUrl}
            fallbackSrc={FALLBACK_PHOTO}
            aspect="portrait"
            overlayTopLeft={
              categoryShort ? (
                // cl-print-fill: text-on-media es clara por definición — sin forzar
                // el relleno a imprimirse, el chip queda blanco sobre papel blanco.
                <span
                  aria-label={categoryFull ?? undefined}
                  className="cl-print-fill inline-flex min-w-0 max-w-full items-center rounded-full bg-media-scrim px-2.5 py-1 text-[11px] font-semibold text-on-media backdrop-blur-sm"
                >
                  <span aria-hidden="true" className="min-w-0 truncate">
                    {categoryShort}
                  </span>
                </span>
              ) : undefined
            }
            overlayBottom={
              <div>
                <h3 className="font-display text-sm font-bold leading-snug line-clamp-2">
                  {product.title}
                </h3>
                {product.priceLabel && (
                  <p className="numeric mt-0.5 text-lg font-bold">{product.priceLabel}</p>
                )}
              </div>
            }
          />
        </Link>

        <div className="flex flex-1 flex-col gap-2 p-3">
          {/* Quién vende: tienda (con su acento y link a la vidriera) o particular. */}
          <SellerChip seller={product.seller} />

          <AccentLink accent={ACCENT} href={`/marketplace/${product.id}`} className="mt-auto">
            {COPY.list.viewProduct}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}
