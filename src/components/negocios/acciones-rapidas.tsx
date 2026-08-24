"use client";

import { NavigationArrow, Phone } from "@phosphor-icons/react/dist/ssr";
import { recordCtaClickAction } from "@/lib/monetization/actions";
import { cn } from "@/lib/utils";

/**
 * "LLAMAR" Y "CÓMO LLEGAR" EN LA TARJETA DEL DIRECTORIO.
 *
 * ── LO QUE ESTE COMPONENTE NO DECIDE ────────────────────────────────────────
 * No decide si los botones existen. Eso lo decide el servidor con
 * `canUseActionButtons(tier)` + `ctaHref(kind, valor)` — los MISMOS dos
 * chequeos que usa `ListingActions` en la ficha, y por los mismos dos motivos:
 *
 *   1. Los botones de acción son una FEATURE PAGA (`listings.tier`, 0048). Un
 *      aviso gratuito se contacta por el chat, y punto. Regalarlos en la tarjeta
 *      del listado —donde se ven treinta veces— sería vaciar el plan por la
 *      puerta de al lado.
 *   2. Un botón sin valor detrás es un botón muerto. Si el negocio no cargó
 *      teléfono, "Llamar" no se pinta: no existe la versión gris que al tocarla
 *      no hace nada, ni la que abre una venta.
 *
 * Acá sólo llega lo que YA pasó los dos filtros, con su href ya saneado por
 * `safeExternalHref`.
 *
 * ── POR QUÉ ES UN CLIENT COMPONENT ──────────────────────────────────────────
 * Por una sola línea: `recordCtaClickAction`. Sin ella, el panel del dueño
 * contaría las llamadas de la ficha y no las del listado, y el número que ve
 * para decidir si renueva estaría mal por abajo. Es el mismo registro que hace
 * `ListingActions`, con el mismo `kind` de `cta_clicks` — así los dos lugares
 * suman al mismo contador en vez de inventar cada uno el suyo.
 *
 * ── LOS TRES/CUATRO BOTONES A 375 px ────────────────────────────────────────
 * No van en una fila con "Mensaje" y "Ver negocio": cuatro etiquetas en 303 px
 * de ancho útil dejan 68 px por botón y "Cómo llegar" se corta. La tarjeta los
 * reparte en filas (ver `business-card.tsx`), y esta grilla se adapta a CUÁNTOS
 * llegaron: uno solo ocupa el ancho completo en vez de quedar flotando a la
 * izquierda de un hueco.
 */

export interface AccionRapida {
  kind: "phone" | "directions";
  href: string;
  /** El valor legible, para el nombre accesible ("+1 305 555 0134"). */
  display: string;
}

export interface AccionesRapidasProps {
  listingId: string;
  /** Nombre del negocio: entra en el nombre accesible de cada botón. */
  subject: string;
  acciones: readonly AccionRapida[];
  className?: string;
}

const ICONO = { phone: Phone, directions: NavigationArrow } as const;

const COPY = {
  phone: {
    label: "Llamar",
    accessible: (negocio: string, numero: string) => `Llamar a ${negocio} al ${numero}`,
  },
  directions: {
    label: "Cómo llegar",
    accessible: (negocio: string, direccion: string) =>
      `Cómo llegar a ${negocio}, en ${direccion}`,
  },
} as const;

/** Una sola clase por cantidad: Tailwind necesita el nombre completo, no armado. */
const COLUMNAS = ["", "grid-cols-1", "grid-cols-2"] as const;

export function AccionesRapidas({
  listingId,
  subject,
  acciones,
  className,
}: AccionesRapidasProps) {
  if (acciones.length === 0) return null;

  return (
    <div className={cn("grid gap-2", COLUMNAS[acciones.length] ?? "grid-cols-2", className)}>
      {acciones.map((accion) => {
        const Icono = ICONO[accion.kind];
        const copy = COPY[accion.kind];
        return (
          <a
            key={accion.kind}
            href={accion.href}
            aria-label={copy.accessible(subject, accion.display)}
            // "Cómo llegar" sale del sitio (mapa); "Llamar" es un `tel:` y no
            // abre pestaña: abrirla dejaría una en blanco atrás del marcador.
            {...(accion.kind === "directions"
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            onClick={() => void recordCtaClickAction({ listingId, kind: accion.kind })}
            className={cn(
              // min-h-11 = 44px: el mínimo táctil, no una sugerencia.
              "flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2.5",
              "border-border-subtle bg-surface text-sm font-semibold text-foreground",
              "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:border-brand hover:bg-brand-tint hover:text-brand-ink active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <Icono size={17} weight="regular" aria-hidden="true" className="shrink-0 text-brand" />
            <span className="truncate">{copy.label}</span>
          </a>
        );
      })}
    </div>
  );
}
