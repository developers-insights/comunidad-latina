import Link from "next/link";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, CardMedia, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { categoryLabel, categoryShortLabel } from "./helpers";

/** Sin foto propia (og-default): composición abstracta de marca, neutral para cualquier rubro. */
const FALLBACK_PHOTO = "/images/og-default.png";

export interface ProductCardModel {
  id: string;
  title: string;
  priceLabel: string | null;
  /** Valor crudo de attrs.category — la card lo traduce con categoryShortLabel() (chip) y categoryLabel() (aria-label). */
  category: string | null;
  photoUrl: string | null;
  store: { id: string; name: string } | null;
}

/**
 * Card de producto del Marketplace (§ feedback cliente 2026-07-19): misma
 * gramática que ListingCard (BezelCard + foto grande + precio destacado) pero
 * en grilla 2-col — foto cuadrada vía CardMedia con la categoría flotando
 * sobre la foto (overlay, vidrio oscuro) y chip de tienda que linkea a su
 * vidriera.
 *
 * El chip de categoría (§ feedback cliente 2026-07-20 — cards rotas a 170px):
 * usa `categoryShortLabel` (1 sola palabra, cabe en la grilla 2-col) en vez
 * del label largo de los filtros, en una línea fija (`truncate` como red de
 * seguridad si algún día el fallback capitalizado fuera largo) y con el
 * mismo lenguaje de "vidrio oscuro" (`bg-media-scrim` + `backdrop-blur-sm` +
 * `text-on-media`) que ya usan gig-card/creator-card/product-gallery — no el
 * verde saturado de `--accent-marketplace`, que sobre una foto real pelea con
 * el producto. El `aria-label` lleva el label LARGO: quien usa lector de
 * pantalla no pierde contexto por la abreviación visual.
 */
export function ProductCard({ product }: { product: ProductCardModel }) {
  const categoryFull = categoryLabel(product.category);
  const categoryShort = categoryShortLabel(product.category);

  return (
    <BezelCard coreClassName="flex h-full flex-col overflow-hidden p-0">
      <article aria-label={product.title} className="flex h-full flex-col">
        <CardMedia
          src={product.photoUrl}
          fallbackSrc={FALLBACK_PHOTO}
          aspect="square"
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
        />

        <div className="flex flex-1 flex-col gap-2 p-3">
          <h3 className="line-clamp-2 min-h-11 text-[15px] font-semibold leading-snug text-foreground">
            {product.title}
          </h3>

          {product.priceLabel && (
            <p className="numeric text-xl font-bold text-brand">{product.priceLabel}</p>
          )}

          {product.store && (
            <Link
              href={`/marketplace/tienda/${product.store.id}`}
              aria-label={COPY.list.storeLinkLabel(product.store.name)}
              className={cn(
                "inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-border-subtle bg-surface-subtle px-2.5 py-1",
                "text-xs font-medium text-foreground-secondary",
                "transition-colors duration-(--duration-fast) hover:border-border-strong hover:text-foreground",
              )}
            >
              <Storefront size={13} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 truncate">{product.store.name}</span>
            </Link>
          )}

          <Link
            href={`/marketplace/${product.id}`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-auto w-full")}
          >
            {COPY.list.viewProduct}
          </Link>
        </div>
      </article>
    </BezelCard>
  );
}
