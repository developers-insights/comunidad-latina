import Link from "next/link";
import { Megaphone, RocketLaunch } from "@phosphor-icons/react/dist/ssr";
import { MONETIZATION_COPY } from "@/lib/monetization";
import { estadoDePromocion, puedePromocionarse } from "@/lib/boosts/estado-promocion";
import { cn } from "@/lib/utils";
import { VistaPreviaEnRevision } from "./vista-previa-en-revision";

/**
 * =============================================================================
 * "YA QUE PUBLICASTE, ¿LO IMPULSAMOS?" — el cierre de los wizards
 * =============================================================================
 *
 * EL PEDIDO, textual del cliente: "si quiero publicar una propiedad
 * normalmente, estaría bueno agregar la opción de poder agregarlo ya en un
 * boost (...) y Comunidad Latina pueda ganar dinero por parte de eso".
 *
 * DESPUÉS DE PUBLICAR, NUNCA ANTES. No es un paso del alta ni una casilla del
 * formulario: el aviso ya está creado y gratis cuando esto aparece. Meterlo
 * dentro del wizard convertiría una publicación gratuita en algo que se parece
 * a un cobro, que es exactamente el malentendido que este producto no se puede
 * permitir. Acá es una oferta, y no hacer nada es una salida válida y visible.
 *
 * UN AVISO RECIÉN CREADO PUEDE QUEDAR EN REVISIÓN, y entonces NO se ofrece
 * promocionar: las dos rutas de destino exigen `status = 'published'`, así que
 * el botón llevaría a una pantalla que contesta que no. Es el mismo bug que se
 * arregló en el índice de Boost el 2026-09-07, y por eso la regla se pregunta
 * con `puedePromocionarse` —la función de verdad— en vez de reescribir el
 * `status === "published"` en cuatro wizards distintos.
 *
 * Lo que SÍ recibe quien quedó en revisión es la vista previa: puede ver cómo
 * va a quedar mientras espera, que era el otro pedido del mismo video.
 *
 * Este componente no es `"use client"` a propósito: no tiene estado. Lo
 * renderizan pantallas de éxito que sí son de cliente, y eso funciona porque
 * todo lo que importa es serializable — `VistaPreviaEnRevision` trae su propio
 * `"use client"`. IMPORTARLO POR RUTA DIRECTA, no por el barril
 * `@/components/boosts`: ese barril exporta también la tira de otras
 * comunidades, que arrastra `lib/boosts/select` (server-only) y rompería
 * cualquier wizard de cliente que lo toque.
 */

const M = MONETIZATION_COPY;

const COPY = {
  /** Encabeza las dos ofertas para que no se lean como un paso obligatorio. */
  invitacion: "¿Querés que lo vea más gente?",
} as const;

export interface OfrecerImpulsoProps {
  listingId: string;
  /** `listings.status` tal cual lo devolvió la action que cerró la publicación. */
  status: string;
  /** Título y foto de lo recién publicado — sólo para la vista previa en revisión. */
  titulo: string;
  thumbnailUrl?: string | null;
  className?: string;
}

export function OfrecerImpulso({
  listingId,
  status,
  titulo,
  thumbnailUrl = null,
  className,
}: OfrecerImpulsoProps) {
  // `false` porque un aviso recién publicado no puede tener una promoción
  // vigente: el estado que interesa acá es "lista", no "activa".
  const estado = estadoDePromocion(status, false);

  if (!puedePromocionarse(estado)) {
    return (
      <div className={cn("flex flex-col items-center gap-3", className)}>
        <p className="text-center text-xs leading-relaxed text-foreground-muted">
          {M.success.laterNote}
        </p>
        <VistaPreviaEnRevision
          titulo={titulo}
          thumbnailUrl={thumbnailUrl}
          tipo="aviso"
          variante="bloque"
        />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <p className="text-sm font-semibold text-foreground">{COPY.invitacion}</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <TarjetaDeOferta
          href={`/impulsar/${listingId}`}
          icon={<RocketLaunch size={20} weight="fill" aria-hidden="true" />}
          title={M.success.boostCta}
          hint={M.success.boostHint}
        />
        <TarjetaDeOferta
          href={`/impulsar/${listingId}?modo=campana`}
          icon={<Megaphone size={20} weight="fill" aria-hidden="true" />}
          title={M.success.campaignCta}
          hint={M.success.campaignHint}
        />
      </div>
    </div>
  );
}

/**
 * Tarjeta de oferta. Es `PromoteCard`, que vivía dentro del wizard de
 * /publicar, movida tal cual: se extrajo cuando los otros tres wizards
 * tuvieron que ofrecer lo mismo, y se conserva su aspecto exacto para que la
 * pantalla que ya lo tenía no cambie.
 *
 * Se distingue por FORMA y no por peso de color: el primario de la pantalla de
 * éxito ya lo gasta "Ver mi aviso", que es lo que la persona vino a hacer. El
 * feedback del toque es movimiento —`active:scale`— y el del hover es fondo y
 * borde; nunca un halo teñido.
 */
function TarjetaDeOferta({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-11 items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4 text-left",
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:border-brand hover:bg-brand-tint active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span className="mt-0.5 shrink-0 text-brand" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground group-hover:text-brand-ink">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-foreground-secondary">
          {hint}
        </span>
      </span>
    </Link>
  );
}
