import { ChatCircleDots, Info, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { Bubble } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import { COMUNIDAD_ACCENT_MANOS } from "./heading";

const C = COMUNIDAD_COPY.pedirAyuda.reglas;

/**
 * =============================================================================
 * LAS REGLAS DEL TABLÓN, ARRIBA Y EN CASTELLANO
 * =============================================================================
 *
 * Tres cosas que hay que saber antes de usar esta sección: qué clase de ayuda
 * circula acá, que no se dejan datos personales, y —la que más importa— que
 * quien contesta es un vecino y no Comunidad Latina.
 *
 * ── POR QUÉ NO ES UN MODAL DE TÉRMINOS NI UNA LETRA CHICA ───────────────────
 * Es la misma doctrina que `<OrigenNota>` en el resto del módulo: un descargo
 * que hay que ir a buscar es un descargo que nadie leyó, y uno que aparece
 * DESPUÉS de mandar el formulario llega tarde para lo único que importa. Va
 * arriba, en la pantalla, en el tamaño en el que se lee el resto.
 *
 * ── LA TERCERA REGLA ES LA QUE SOSTIENE EL MÓDULO ENTERO ────────────────────
 * "Quien te contesta es un vecino." Sin esa línea, un dato equivocado que
 * escribió un desconocido se lee como información de la plataforma — que es
 * exactamente la línea del §11 que este módulo existe para no cruzar. Está
 * escrita sin asustar y sin desalentar la respuesta, porque el valor de toda la
 * sección es que la gente conteste.
 *
 * `variante`:
 *  · "completa" (el alta y el detalle) — las tres.
 *  · "lectura" (el tablón) — sólo la tercera, que es la única que le habla a
 *    quien viene a LEER lo que otros contestaron.
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
      ? [{ icon: <UsersThree size={18} weight="fill" aria-hidden="true" />, ...C.responden }]
      : [
          { icon: <Info size={18} weight="fill" aria-hidden="true" />, ...C.informacion },
          { icon: <ChatCircleDots size={18} weight="fill" aria-hidden="true" />, ...C.datos },
          { icon: <UsersThree size={18} weight="fill" aria-hidden="true" />, ...C.responden },
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
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--bubble-ink)]">
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
