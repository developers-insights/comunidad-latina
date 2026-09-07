"use client";

import {
  Camera,
  CaretRight,
  IdentificationCard,
  ImagesSquare,
  LinkSimple,
  MapPin,
  Paperclip,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import { COPY_COMPOSER } from "./copy-composer";

/**
 * EL MENÚ DEL BOTÓN + — lista vertical que sube desde abajo.
 *
 * ─── POR QUÉ ES UNA LISTA Y NO UNA CUADRÍCULA ───────────────────────────────
 * El cliente comparó las dos y eligió ésta (lámina "Compartir desde el chat").
 * Sus motivos, textuales en la decisión y no reinterpretados acá: la cuadrícula
 * grande al centro tapa la conversación, obliga a leer más para ver todas las
 * opciones y cuesta acertar; la lista se recorre de una pasada, se llega con
 * el pulgar de la misma mano que sostiene el teléfono, y crece hacia abajo el
 * día que aparezca una opción más. Si alguien vuelve a proponer la cuadrícula,
 * esto es lo que hay que discutir primero.
 *
 * ─── EL AUDIO NO ESTÁ ACÁ, Y ES A PROPÓSITO ─────────────────────────────────
 * El cliente lo marcó dos veces y subrayado: el micrófono vive en la barra de
 * mensaje, al lado del campo de texto. Meterlo en esta hoja sería agregarle dos
 * toques a la acción más frecuente del chat.
 *
 * ─── SIN ENTRADA ESCALONADA DE LAS FILAS ────────────────────────────────────
 * La hoja ya entra deslizándose. Animar además cada fila es dos entradas
 * compitiendo por el mismo momento: cuando el panel llega, su contenido tiene
 * que estar ahí. La personalidad va en la física del toque, no en un desfile.
 */

export type OpcionDeAdjunto =
  | "camara"
  | "galeria"
  | "archivo"
  | "enlace"
  | "ubicacion"
  | "perfil";

interface Fila {
  opcion: OpcionDeAdjunto;
  icono: Icon;
  etiqueta: string;
  detalle: string;
  /** Fondo + tinta del azulejo. Pares del sistema, ya validados en contraste. */
  tono: string;
}

const O = COPY_COMPOSER.adjuntar.opciones;

/** El ORDEN es el que pidió el cliente. No se reordena por estética. */
const FILAS: readonly Fila[] = [
  {
    opcion: "camara",
    icono: Camera,
    etiqueta: O.camara.etiqueta,
    detalle: O.camara.detalle,
    tono: "bg-brand-tint text-brand-ink",
  },
  {
    opcion: "galeria",
    icono: ImagesSquare,
    etiqueta: O.galeria.etiqueta,
    detalle: O.galeria.detalle,
    tono: "bg-info-bg text-info-ink",
  },
  {
    opcion: "archivo",
    icono: Paperclip,
    etiqueta: O.archivo.etiqueta,
    detalle: O.archivo.detalle,
    tono: "bg-surface-subtle text-foreground-secondary",
  },
  {
    opcion: "enlace",
    icono: LinkSimple,
    etiqueta: O.enlace.etiqueta,
    detalle: O.enlace.detalle,
    tono: "bg-warning-bg text-warning-ink",
  },
  {
    opcion: "ubicacion",
    icono: MapPin,
    etiqueta: O.ubicacion.etiqueta,
    detalle: O.ubicacion.detalle,
    tono: "bg-success-bg text-success-ink",
  },
  {
    opcion: "perfil",
    icono: IdentificationCard,
    etiqueta: O.perfil.etiqueta,
    detalle: O.perfil.detalle,
    tono: "bg-gold/20 text-gold-ink",
  },
];

export interface AttachMenuProps {
  open: boolean;
  onClose: () => void;
  /** La hoja no sabe qué hace cada opción: sólo avisa cuál se tocó. */
  onElegir: (opcion: OpcionDeAdjunto) => void;
}

export function AttachMenu({ open, onClose, onElegir }: AttachMenuProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={COPY_COMPOSER.adjuntar.titulo}
      bodyClassName="overflow-y-auto px-3 pb-2 pt-3"
    >
      <ul className="flex flex-col">
        {FILAS.map((fila, indice) => {
          const Icono = fila.icono;
          return (
            <li key={fila.opcion}>
              <button
                type="button"
                onClick={() => {
                  onElegir(fila.opcion);
                  onClose();
                }}
                className={cn(
                  "group flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left",
                  "min-h-14",
                  "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
                  "hover:bg-surface-hover active:scale-[0.985] active:bg-surface-hover",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  "motion-reduce:transition-none motion-reduce:active:scale-100",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-[14px]",
                    // Aro interior con TOKEN y no con `dark:`: el token ya
                    // voltea solo (misma razón que documenta `ui/bubble.tsx` —
                    // una regla `dark:` acá quedaría desincronizada del tema).
                    "ring-1 ring-inset ring-border-subtle",
                    "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
                    "group-active:scale-90 motion-reduce:transition-none motion-reduce:group-active:scale-100",
                    fila.tono,
                  )}
                >
                  <Icono size={21} weight="duotone" />
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {fila.etiqueta}
                  </span>
                  <span className="truncate text-xs text-foreground-muted">
                    {fila.detalle}
                  </span>
                </span>

                <CaretRight
                  size={16}
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 text-foreground-muted/60",
                    "transition-transform duration-(--duration-fast) ease-(--ease-out-premium)",
                    "group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0",
                  )}
                />
              </button>
              {indice < FILAS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="ml-[4.375rem] block h-px bg-border-subtle"
                />
              )}
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
