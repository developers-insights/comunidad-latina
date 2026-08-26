import Link from "next/link";
import { Ticket } from "@phosphor-icons/react/dist/ssr";
import { PostSheetTrigger } from "@/components/feed";
import { InlineMessageCta } from "@/components/listings/inline-message-cta";
import { Badge, BezelCard, Chip, buttonVariants } from "@/components/ui";
import { OFERTA_TIPO_LABEL, type OfertaVista } from "@/lib/negocios/ofertas-modelo";
import { cn } from "@/lib/utils";
import { GuardarOferta } from "./guardar-oferta";

/**
 * TARJETA DE OFERTA (spec cliente: descuentos, cupones, promos por tiempo
 * limitado, menús y paquetes, con fecha de vencimiento y los botones
 * "Ver oferta · Guardar · Contactar").
 *
 * ── ES LA MISMA PUBLICACIÓN, NO UNA COPIA ───────────────────────────────────
 * "Ver oferta" NO navega a una pantalla de oferta: abre la HOJA de la
 * publicación (`PostSheetTrigger`), que monta la `PostCard` real con su texto,
 * sus fotos, sus comentarios y su menú. Es literalmente la misma fila de `posts`
 * que se ve en la pestaña Publicaciones — que es lo que pidió el cliente y lo
 * que la 0106 hizo cierto en la base. Y encima resuelve sin sacar a nadie de la
 * lista (2026-08-20: "mientras menos pasos mejor").
 *
 * ── EL VENCIMIENTO ES LO QUE LA HACE UNA OFERTA ─────────────────────────────
 * `expires_at` es NOT NULL en la 0106 porque una promoción sin fecha de fin es
 * un precio. Por eso la fecha va SIEMPRE visible y no escondida en la letra
 * chica, y por eso cuando queda poco cambia de tono (ámbar) además de cambiar de
 * palabra: el color acompaña, la palabra informa.
 *
 * ── LOS TRES BOTONES A 375 px ───────────────────────────────────────────────
 * "Ver oferta" ocupa el ancho completo —es la acción principal y la que abre
 * todo lo demás—; "Guardar" y "Contactar" van debajo en dos columnas. Tres en
 * fila dejaban 95px por botón y "Contactar" con el composer adentro no entra en
 * una celda de ese ancho. Cada uno con su `min-h-11`.
 *
 * "Contactar" sólo aparece si el negocio tiene dueño con cuenta: una ficha de
 * fuente externa no tiene a quién escribirle, y un botón que abre un composer
 * hacia nadie es peor que no tenerlo.
 */

const COPY = {
  verOferta: "Ver oferta",
  verOfertaAria: (titulo: string) => `Ver la oferta: ${titulo}`,
  contactarPlaceholder: "Hola, vi esta oferta y quería consultarte.",
  contactar: "Contactar",
  cupon: "Código:",
  deQuien: (negocio: string) => `Oferta de ${negocio}`,
  verNegocio: "Ver el negocio",
} as const;

export interface OfertaCardProps {
  oferta: OfertaVista;
  /** `null` = sin sesión. Decide si Guardar/Contactar abren la hoja de sesión. */
  viewerId: string | null;
  guardada?: boolean;
  className?: string;
}

export function OfertaCard({ oferta, viewerId, guardada = false, className }: OfertaCardProps) {
  const negocio = oferta.negocio;
  const porVencer = oferta.vencimiento.estado === "por_vencer";

  return (
    <BezelCard className={className} coreClassName="overflow-hidden p-0">
      <article aria-label={oferta.titulo}>
        {oferta.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto del bucket público, sin optimizador
          <img
            src={oferta.fotoUrl}
            alt=""
            aria-hidden="true"
            className="aspect-video w-full object-cover"
          />
        ) : null}

        <div className="flex flex-col gap-2.5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Chip variant="brand" size="sm" icon={<Ticket weight="fill" />}>
              {OFERTA_TIPO_LABEL[oferta.tipo]}
            </Chip>
            {/* Ámbar cuando queda poco, neutro cuando sobra tiempo. La palabra
                dice el dato en los dos casos: nadie tiene que ver el color. */}
            <Badge variant={porVencer ? "warning" : "neutral"}>
              {oferta.vencimiento.etiqueta}
            </Badge>
          </div>

          <h3 className="font-display text-lg font-bold leading-snug text-foreground">
            {oferta.titulo}
          </h3>

          {oferta.valorEtiqueta && (
            <p className="numeric font-display text-xl font-bold leading-none text-brand-ink">
              {oferta.valorEtiqueta}
            </p>
          )}

          {negocio && (
            <Link
              href={`/negocios/${negocio.id}`}
              className={cn(
                "flex min-h-11 min-w-0 items-center gap-2 self-start rounded-lg pr-2 text-sm text-foreground-secondary",
                "transition-colors duration-(--duration-fast) hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
              aria-label={`${COPY.verNegocio}: ${negocio.nombre}`}
            >
              {negocio.fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura del bucket público
                <img
                  src={negocio.fotoUrl}
                  alt=""
                  aria-hidden="true"
                  className="size-8 shrink-0 rounded-full object-cover"
                />
              ) : null}
              <span className="truncate">{COPY.deQuien(negocio.nombre)}</span>
            </Link>
          )}

          {oferta.cuerpo && (
            <p className="line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
              {oferta.cuerpo}
            </p>
          )}

          {oferta.codigoCupon && (
            <p className="text-sm text-foreground">
              <span className="text-foreground-secondary">{COPY.cupon} </span>
              {/* `numeric` = tabular: un código alfanumérico se lee y se copia
                  mejor con anchos parejos. */}
              <span className="numeric font-semibold tracking-wide">{oferta.codigoCupon}</span>
            </p>
          )}

          {/* La letra chica al lado del precio, que es para lo que la 0106 le dio
              columna propia. Enterrada en el cuerpo del post nadie la podía
              mostrar acá. */}
          {oferta.terminos && (
            <p className="text-xs leading-relaxed text-foreground-muted">{oferta.terminos}</p>
          )}

          {/* "Ver oferta" y "Guardar" comparten renglón: el primero se estira
              con lo que sobre, el segundo ocupa lo que mide su etiqueta. A
              375 px son ~185 px y ~110 px — los dos cómodos, ninguno cortado.
              "Contactar" baja a su propio renglón de ancho completo porque al
              tocarlo se convierte en un composer con textarea: media columna de
              147 px lo dejaría inescribible. */}
          <div className="mt-1 flex gap-2">
            <PostSheetTrigger
              postId={oferta.postId}
              ariaLabel={COPY.verOfertaAria(oferta.titulo)}
              className={cn(
                buttonVariants({ variant: "primary", size: "md" }),
                "min-w-0 flex-1",
              )}
            >
              <span className="truncate">{COPY.verOferta}</span>
            </PostSheetTrigger>
            <GuardarOferta
              postId={oferta.postId}
              guardadaInicialmente={guardada}
              viewerId={viewerId}
              className="shrink-0"
            />
          </div>

          {negocio?.duenoId && negocio.duenoId !== viewerId ? (
            <InlineMessageCta
              listingId={negocio.id}
              isLoggedIn={Boolean(viewerId)}
              nextPath="/negocios?t=ofertas"
              label={COPY.contactar}
              placeholder={COPY.contactarPlaceholder}
            />
          ) : null}
        </div>
      </article>
    </BezelCard>
  );
}
