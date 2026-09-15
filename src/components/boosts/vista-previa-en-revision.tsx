"use client";

import { useState } from "react";
import { Eye, HourglassMedium, Megaphone, Play } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Chip } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * "ASÍ VA A QUEDAR" — la previsualización de lo que todavía está en revisión
 * =============================================================================
 *
 * EL PEDIDO, textual del cliente: "si yo quiero ver una campaña que estoy en
 * revisión, pues no la puedo ver, ¿entendés? No sé cómo se va a ver la
 * campaña."
 *
 * LO QUE ESTO NO ES. No es devolver el botón "Promocionar" a las filas en
 * revisión. Eso ya se probó y se sacó el 2026-09-07 (ver el docblock de
 * `puedePromocionarse` en `lib/boosts/estado-promocion.ts`): el botón llevaba a
 * una pantalla que exige `status = 'published'` sólo para contestar que no.
 * Quien esperaba, seguía esperando, pero además había tocado un botón que le
 * prometió algo. La regla de no promocionar lo no aprobado NO se toca: lo que
 * faltaba era poder MIRAR, que es otra cosa.
 *
 * POR QUÉ UNA HOJA Y NO UNA RUTA. Todo lo que se dibuja acá ya está en la fila
 * que la abre —foto, título, tipo—, así que la hoja abre en el mismo frame del
 * toque, sin una consulta y sin un esqueleto. Una ruta nueva pagaría un viaje a
 * la base para mostrar exactamente los mismos tres datos.
 *
 * LO QUE SE MUESTRA ES LA TARJETA PAGA, no el aviso. Es la pregunta que hizo el
 * cliente: no "cómo se ve mi aviso" (eso ya lo vio al crearlo) sino "cómo se va
 * a ver la campaña" — o sea, el aviso ya con el distintivo de publicidad y en
 * el lugar que compró. Por eso el `Chip` dorado de patrocinado y la línea que
 * dice dónde aparece.
 *
 * El chip se redeclara acá en vez de importar `AdChip` de `components/feed`:
 * ese archivo es del módulo del feed y esto es una MAQUETA, no la tarjeta real
 * — si mañana el feed cambia su chip, esta vista previa tiene que seguir
 * mostrando el estado en el que va a salir, no arrastrar el cambio sin querer.
 */

const COPY = {
  abrir: "Ver cómo va a quedar",
  titulo: "Así va a quedar",
  aclaracion:
    "Es una muestra de cómo se va a ver cuando lo promociones. Todavía no está en pantalla de nadie.",
  patrocinado: "Patrocinado",
  dondeAviso: "Va a aparecer primero en los resultados, con este distintivo.",
  dondePublicacion: "Va a aparecer en el feed de la comunidad, con este distintivo.",
  esperaTitulo: "Falta que lo aprobemos",
  esperaCuerpo:
    "Lo estamos revisando. Te avisamos apenas se apruebe y ahí sí lo vas a poder promocionar.",
  sinFoto: "Sin foto",
} as const;

export interface VistaPreviaEnRevisionProps {
  titulo: string;
  thumbnailUrl: string | null;
  thumbnailIsVideo?: boolean;
  tipo: "aviso" | "publicacion";
  /** Estilo del disparador. `fila` va dentro de una fila de lista; `bloque` ocupa el ancho. */
  variante?: "fila" | "bloque";
  className?: string;
}

export function VistaPreviaEnRevision({
  titulo,
  thumbnailUrl,
  thumbnailIsVideo = false,
  tipo,
  variante = "fila",
  className,
}: VistaPreviaEnRevisionProps) {
  const [abierta, setAbierta] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className={cn(
          "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold",
          "border border-border-subtle bg-surface text-foreground",
          // Sólo transform: el feedback lo da el movimiento, nunca un brillo.
          "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.97]",
          "hover:bg-surface-subtle",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          variante === "bloque" ? "w-full" : "shrink-0",
          className,
        )}
      >
        <Eye size={16} aria-hidden="true" />
        {COPY.abrir}
      </button>

      <BottomSheet open={abierta} onClose={() => setAbierta(false)} title={COPY.titulo}>
        <div className="flex flex-col gap-4 pb-4">
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {COPY.aclaracion}
          </p>

          {/* LA MAQUETA. Anillo dorado + chip de patrocinado: el mismo idioma
              visual con el que esta app marca todo lo que se paga. */}
          <div className="rounded-xl border-[1.5px] border-sponsored p-1.5">
            <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
              <div className="relative flex aspect-[4/3] items-center justify-center bg-surface-subtle">
                {thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- maqueta de una sola imagen ya cargada por la fila que abre la hoja
                  <img src={thumbnailUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-xs text-foreground-muted">{COPY.sinFoto}</span>
                )}
                {thumbnailIsVideo && thumbnailUrl && (
                  <span className="cl-print-fill absolute inset-0 flex items-center justify-center bg-media-scrim">
                    <Play size={28} weight="fill" className="text-on-media" />
                  </span>
                )}
                <Chip
                  variant="neutral"
                  size="sm"
                  className="absolute left-2.5 top-2.5 border-[1.5px] border-sponsored bg-surface text-sponsored-ink shadow-sm"
                >
                  <Megaphone size={14} weight="fill" aria-hidden="true" />
                  {COPY.patrocinado}
                </Chip>
              </div>
              <p className="line-clamp-2 px-3.5 py-3 text-sm font-semibold text-foreground">
                {titulo}
              </p>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-foreground-muted">
            {tipo === "aviso" ? COPY.dondeAviso : COPY.dondePublicacion}
          </p>

          {/* La espera, dicha sin prometer un botón que no existe todavía. */}
          <div className="flex items-start gap-2.5 rounded-lg bg-warning-bg px-3.5 py-3">
            <HourglassMedium
              size={18}
              weight="fill"
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-warning-ink"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-warning-ink">{COPY.esperaTitulo}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
                {COPY.esperaCuerpo}
              </p>
            </div>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
