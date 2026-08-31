import { ChatCircleDots, HandCoins, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Bubble } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import { COMUNIDAD_ACCENT_MANOS } from "./heading";

const C = COMUNIDAD_COPY.ayudaMutua.reglas;

/**
 * =============================================================================
 * LAS REGLAS DEL TABLÓN, ARRIBA Y EN CASTELLANO
 * =============================================================================
 *
 * Tres cosas que hay que saber antes de usar esta sección: que acá no se mueve
 * plata, que no se dejan datos de contacto, y que lo mira una persona antes de
 * publicarse.
 *
 * ── POR QUÉ NO ES UN MODAL DE TÉRMINOS NI UNA LETRA CHICA ───────────────────
 * Es la misma doctrina que `<OrigenNota>` en el resto del módulo: un descargo
 * que hay que ir a buscar es un descargo que nadie leyó, y uno que aparece
 * DESPUÉS de mandar el formulario llega tarde para lo único que importa —que la
 * persona no escriba su teléfono—. Va arriba, en la pantalla, en el tamaño en
 * el que se lee el resto.
 *
 * ── POR QUÉ SUENA A CUIDADO Y NO A ADVERTENCIA ──────────────────────────────
 * Del otro lado hay alguien que vino a ofrecer un rato de su tiempo. Un cartel
 * que arranca con "queda prohibido" espanta exactamente a esa persona y no
 * frena a la que vino a estafar. Cada regla dice qué pasa en lugar de qué está
 * prohibido: "te escriben por mensaje privado" en vez de "no publique su
 * teléfono".
 *
 * `variante`:
 *  · "completa" (el alta) — las tres, porque quien escribe necesita saber las
 *    tres ANTES de escribir.
 *  · "lectura" (el tablón) — sólo la de la plata, que es la única que le habla
 *    a quien viene a LEER: es lo que tiene que reconocer si alguien se lo pide
 *    por mensaje.
 */
export function ReglasDeAyuda({
  variante = "completa",
  className,
}: {
  variante?: "completa" | "lectura";
  className?: string;
}) {
  const reglas =
    variante === "lectura"
      ? [{ icon: <HandCoins size={18} weight="fill" aria-hidden="true" />, ...C.plata }]
      : [
          { icon: <HandCoins size={18} weight="fill" aria-hidden="true" />, ...C.plata },
          { icon: <ChatCircleDots size={18} weight="fill" aria-hidden="true" />, ...C.contacto },
          { icon: <SealCheck size={18} weight="fill" aria-hidden="true" />, ...C.revision },
        ];

  return (
    <Bubble
      accent={COMUNIDAD_ACCENT_MANOS}
      tone="accentSoft"
      shape="tile"
      size="none"
      className={cn("space-y-3 p-4", className)}
    >
      {reglas.map((regla) => (
        <div key={regla.title} className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[var(--bubble-ink)]"
          >
            {regla.icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{regla.title}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
              {regla.body}
            </p>
          </div>
        </div>
      ))}
    </Bubble>
  );
}
