import { AccentLink, BezelCard, CardMedia } from "@/components/ui";
import { PhotoTap } from "@/components/media/photo-tap";
import { COPY } from "./copy";
import { categoryLabel, categoryShortLabel } from "./helpers";
import { SellerChip, type SellerView } from "./seller-chip";

/** Sin foto propia (og-default): composición abstracta de marca, neutral para cualquier rubro. */
const FALLBACK_PHOTO = "/images/og-default.png";

/** Acento verde del módulo (solo decorativo) para la píldora de acción. */
const ACCENT = "var(--accent-marketplace)";

export interface ProductCardModel {
  id: string;
  title: string;
  priceLabel: string | null;
  /** Valor crudo de attrs.category — la card lo traduce con categoryShortLabel() (chip) y categoryLabel() (aria-label). */
  category: string | null;
  photoUrl: string | null;
  /**
   * TODAS las fotos del producto ya resueltas (allPhotoUrls) — el visor las pasa
   * de una. Opcional: quien todavía no las manda cae a `photoUrl`.
   */
  photos?: string[];
  /** Tienda o particular — lo resuelve la página en batch (ver marketplace/page.tsx). */
  seller: SellerView;
}

/**
 * Card de producto del Marketplace (§ feedback cliente 2026-07-24: se siente RED
 * SOCIAL, no clasificado). Foto vertical 4:5 protagonista con el título y el
 * precio en una franja de VIDRIO encima (glass) y la categoría flotando arriba.
 * Debajo, el chip de la tienda (linkea a su vidriera) y una píldora con el
 * acento del módulo.
 *
 * DOS destinos, uno por gesto (feedback 2026-07-26): tocar la FOTO abre el visor
 * con todas las fotos del producto; la píldora "Ver producto" es la única que
 * navega al detalle.
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
  const photos = product.photos?.length
    ? product.photos
    : product.photoUrl
      ? [product.photoUrl]
      : [];

  return (
    <BezelCard coreClassName="flex h-full flex-col overflow-hidden p-0">
      <article aria-label={product.title} className="flex h-full flex-col">
        <PhotoTap
          photos={photos}
          label={COPY.list.openPhotos(product.title)}
          authorName={product.title}
        >
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
        </PhotoTap>

        {/* `gap-2.5 p-4` = el ritmo vertical de TODA tarjeta de listado
            (Propiedades, Negocios, Colaboraciones, Empleos). Acá era `gap-2 p-3`
            por la grilla de 2 columnas, y era justo lo que hacía que estas
            tarjetas se sintieran de otra familia — el pedido del cliente
            («todas las tarjetas de todos, el mismo tamaño») incluye el aire
            interno, no sólo la foto. */}
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          {/* Quién vende: tienda (con su acento y link a la vidriera) o particular. */}
          <SellerChip seller={product.seller} />

          <AccentLink
            accent={ACCENT}
            href={`/marketplace/${product.id}`}
            ariaLabel={product.title}
            className="mt-auto"
          >
            {COPY.list.viewProduct}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}
