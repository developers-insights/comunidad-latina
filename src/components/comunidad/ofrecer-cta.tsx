import Link from "next/link";
import { HandHeart, HandsClapping } from "@phosphor-icons/react/dist/ssr";
import { COMUNIDAD_COPY, HELP_DIRECTION_COPY, isHelpTopic } from "@/lib/comunidad";
import { cn } from "@/lib/utils";

const C = COMUNIDAD_COPY.ayudaMutua;

/**
 * =============================================================================
 * EL BOTÓN QUE PEDÍA EL CLIENTE
 * =============================================================================
 *
 * «Falta un botón en la parte de comunidad, en casi todas las opciones, para
 * que la gente pueda aplicar a bancos de comida si quiere ofrecer sus
 * servicios — voluntarios si quieren ofrecer sus servicios — centro de acopio
 * lo mismo.»
 *
 * De ahí las dos formas de este archivo, que son la misma acción a dos escalas:
 *
 *  · `<OfrecerEnFicha>` — vive DENTRO de una ficha del directorio. Lleva el
 *    `resource_id` puesto: quien lo toca ya eligió el lugar.
 *  · `<OfrecerEnTema>` — vive en la cabecera de un tema. No lleva lugar: es
 *    para quien quiere ayudar "con comida" sin tener un comedor en la cabeza, y
 *    para el otro lado del pedido —«o el lugar donde necesita prestar los
 *    servicios»—, que ahí sí muestra las dos puertas.
 *
 * ── NO APARECE EN TODOS LOS TEMAS ───────────────────────────────────────────
 * `isHelpTopic` decide, y devuelve `null` cuando el tema no acepta avisos. La
 * pantalla no dibuja NINGÚN cartel explicando por qué: decirle a alguien que
 * está buscando una clínica que "acá no podés ofrecer ayuda" sería contestarle
 * una pregunta que no hizo. Los motivos de cada exclusión están en §5 de
 * `0120_ayuda_mutua.sql`.
 */

const RUTA = "/comunidad/ayuda-mutua/publicar";

const LINK_BASE = cn(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3",
  "text-sm font-semibold",
  "transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
  "active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

const LINK_ACENTO = cn(
  LINK_BASE,
  "border-[color-mix(in_oklab,var(--accent-comunidad-manos)_40%,transparent)]",
  "bg-[color-mix(in_oklab,var(--accent-comunidad-manos)_14%,var(--color-surface))]",
  "text-foreground hover:bg-[color-mix(in_oklab,var(--accent-comunidad-manos)_22%,var(--color-surface))]",
);

const LINK_NEUTRO = cn(
  LINK_BASE,
  "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle hover:text-foreground",
);

/**
 * CTA de UNA ficha del directorio.
 *
 * El contador es social proof honesto y opcional: si la consulta no pudo
 * correr —lo más común es que quien mira no tenga sesión, porque el tablón
 * pide cuenta— simplemente no se muestra. Nunca un "0 personas se ofrecieron",
 * que diría algo que no sabemos.
 */
export function OfrecerEnFicha({
  topic,
  resourceId,
  ofrecimientos,
  className,
}: {
  topic: string;
  resourceId: string;
  ofrecimientos?: number;
  className?: string;
}) {
  if (!isHelpTopic(topic)) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Link
        href={`${RUTA}?modo=offer&tema=${topic}&lugar=${resourceId}`}
        className={cn(LINK_ACENTO, "w-full")}
      >
        <HandHeart size={18} weight="fill" aria-hidden="true" />
        {C.ficha.cta}
      </Link>
      {typeof ofrecimientos === "number" && ofrecimientos > 0 && (
        <p className="text-xs text-foreground-muted">{C.ficha.contador(ofrecimientos)}</p>
      )}
    </div>
  );
}

/**
 * Las DOS puertas de un tema. Es donde el pedido del cliente se ve entero:
 * ofrecerse y pedir manos, uno al lado del otro, con el mismo peso visual.
 * Poner una arriba de la otra habría dicho que una es la principal.
 */
export function OfrecerEnTema({ topic, className }: { topic: string; className?: string }) {
  if (!isHelpTopic(topic)) return null;

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row", className)}>
      <Link href={`${RUTA}?modo=offer&tema=${topic}`} className={cn(LINK_ACENTO, "flex-1")}>
        <HandHeart size={18} weight="fill" aria-hidden="true" />
        {HELP_DIRECTION_COPY.offer.elegir}
      </Link>
      <Link href={`${RUTA}?modo=need&tema=${topic}`} className={cn(LINK_NEUTRO, "flex-1")}>
        <HandsClapping size={18} weight="fill" aria-hidden="true" />
        {HELP_DIRECTION_COPY.need.elegir}
      </Link>
    </div>
  );
}
