import { BezelCard } from "@/components/ui";
import {
  ETIQUETA_VERTICAL,
  etiquetaDeOrigen,
  type CasoDeSeguridad,
} from "@/lib/escudo/casos";

/**
 * Un caso de seguridad, anonimizado.
 *
 * ── EL ORDEN DE LOS CUATRO BLOQUES ES EL CONTENIDO ──────────────────────────
 * Qué pasó → qué lo delató → qué hizo el sistema → qué hacer si te pasa. La
 * SEÑAL va antes que la respuesta de la plataforma a propósito: lo que se lleva
 * puesto quien lee no es qué hicimos nosotros, es qué mirar la próxima vez. Y
 * "qué hizo el sistema" incluye "nada" cuando ésa es la verdad — el caso donde
 * la plataforma no llegó es el que hace creíbles a los otros tres.
 *
 * ── EL RÓTULO DE ARRIBA NO ES DECORACIÓN ────────────────────────────────────
 * `etiquetaDeOrigen` separa el patrón documentado del hecho puntual con palabras
 * distintas y fijas. Sin ese renglón, cuatro relatos bien escritos se leen como
 * cuatro estafas frenadas la semana pasada, y la pantalla que existe para no
 * inventar evidencia estaría inventándola.
 */
export function CasoCard({ caso }: { caso: CasoDeSeguridad }) {
  return (
    <BezelCard coreClassName="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="rounded-full bg-brand-tint px-2.5 py-0.5 font-semibold text-brand-ink">
            {ETIQUETA_VERTICAL[caso.vertical]}
          </span>
          <span className="text-foreground-muted">{etiquetaDeOrigen(caso)}</span>
        </div>
        <h3 className="font-display text-base font-semibold text-foreground">{caso.titulo}</h3>
      </div>

      <p className="text-sm text-foreground-secondary">{caso.resumen}</p>

      {/* La señal, tratada como la cita del caso: es lo único que se reconoce
          después en otro lado. Barra a la izquierda y no una caja amarilla —
          el ámbar en este producto ya significa "aviso anti-estafa"
          (ScamShieldNotice) y duplicar ese significado lo gasta. */}
      <div className="border-l-2 border-brand-ink pl-3.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Qué lo delató
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">{caso.senal}</p>
      </div>

      <div className="rounded-lg bg-surface-subtle px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Qué hizo el sistema
        </p>
        <p className="mt-1 text-sm text-foreground-secondary">{caso.respuesta}</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Si te pasa a vos
        </p>
        <p className="mt-1 text-sm text-foreground-secondary">{caso.consejo}</p>
      </div>
    </BezelCard>
  );
}
