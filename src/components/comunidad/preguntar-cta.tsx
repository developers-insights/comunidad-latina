import Link from "next/link";
import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr";
import { COMUNIDAD_COPY, isHelpTopic } from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import { accionPillClass, accionPillStyle } from "./acciones-de-tema";
import { COMUNIDAD_ACCENT_MANOS } from "./heading";

/**
 * =============================================================================
 * EL PUENTE DEL DIRECTORIO AL TABLÓN
 * =============================================================================
 *
 * ── QUÉ ERA ESTO ANTES ──────────────────────────────────────────────────────
 * Las dos puertas de "Ayuda mutua": «Quiero ayudar» y «Necesito manos», una al
 * lado de la otra. El cliente las sacó el 2026-09-03 —«necesito manos» para una
 * mudanza es responsabilidad legal de la plataforma si alguien se lastima, y el
 * flujo «Quiero ayudar → ¿sobre qué tema?» además lo confundió—. Los dos
 * botones no existen más en ningún lado de la app.
 *
 * ── EL RENOMBRE QUE FALTABA (0131) ──────────────────────────────────────────
 * Hasta acá el componente seguía llamándose `<OfrecerEnTema>` con una nota que
 * decía que había que renombrarlo cuando alguien tocara `recursos/page.tsx`.
 * Ese momento es éste: el archivo pasó a `preguntar-cta.tsx` y el componente a
 * `<PreguntarleALaComunidad>`, que es lo que hace. Un nombre que describe algo
 * que el componente dejó de hacer es peor que no tener nombre: manda a leer el
 * archivo equivocado a quien busca de dónde salió un botón.
 *
 * ── QUÉ HACE AHORA ──────────────────────────────────────────────────────────
 * Es el puente que le faltaba al directorio: alguien mira las fichas de un tema
 * y no encuentra lo suyo (o directamente no hay fichas cargadas — hoy el
 * directorio está vacío). En vez de un callejón, hay una puerta al tablón con
 * ese tema ya puesto.
 *
 * `isHelpTopic` decide si aparece. Devuelve `null` en los temas que el tablón
 * no acepta (migración, legal, emergencias, consulados, adicciones, medicinas),
 * y la pantalla no dibuja NINGÚN cartel explicando por qué: decirle a alguien
 * que está buscando una clínica que "acá no podés preguntar" sería contestarle
 * una pregunta que no hizo. Los motivos están en §2 de la 0130.
 */
export function PreguntarleALaComunidad({ topic, className }: { topic: string; className?: string }) {
  if (!isHelpTopic(topic)) return null;

  return (
    <Link
      href={`/comunidad/pedir-ayuda?tema=${topic}`}
      className={cn(accionPillClass(), className)}
      style={accionPillStyle(COMUNIDAD_ACCENT_MANOS)}
    >
      <ChatCircleDots size={18} weight="fill" aria-hidden="true" />
      {COMUNIDAD_COPY.pedirAyuda.desdeRecursos}
    </Link>
  );
}
