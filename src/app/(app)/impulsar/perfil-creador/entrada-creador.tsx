import Link from "next/link";
import { CaretRight, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { ChipDeIcono } from "@/components/boosts";
import { cn } from "@/lib/utils";
import type { SituacionDelCreador } from "./modelo";

const ACENTO = "var(--accent-creadores)";

const COPY = {
  promocionarTitulo: "Promocioná tu perfil de creador",
  promocionarTexto: "Aparecé primero en el directorio cuando alguien busca a quién contratar.",
  activoTitulo: "Tu perfil está promocionado",
  activoTexto: (fecha: string) => `Aparecés primero en el directorio de creadores hasta el ${fecha}.`,
  enCaminoTitulo: "Tu solicitud de creador está en revisión",
  enCaminoTexto: "Cuando te aprueben, vas a poder promocionar tu perfil desde acá.",
  sumateTitulo: "¿Hacés contenido? Sumate como creador",
  sumateTexto: "Los creadores aprobados pueden promocionar su perfil para que los encuentren primero.",
} as const;

/**
 * La puerta de Boost para quien hace contenido. Existe porque el pedido del PM
 * (23/9) fue literal: un influencer entraba a Boost y no encontraba cómo
 * promocionarse — la única fila "de creadores" era publicar un trabajo, que es
 * la acción de quien CONTRATA.
 */
export function EntradaCreador({
  situacion,
  vigenteHasta,
  className,
}: {
  situacion: SituacionDelCreador;
  /** Fecha ya formateada del fin del impulso vigente, o null. */
  vigenteHasta: string | null;
  className?: string;
}) {
  if (situacion === "no_disponible") return null;

  const contenido =
    situacion === "aprobado"
      ? vigenteHasta
        ? { titulo: COPY.activoTitulo, texto: COPY.activoTexto(vigenteHasta), href: "/impulsar/perfil-creador" }
        : { titulo: COPY.promocionarTitulo, texto: COPY.promocionarTexto, href: "/impulsar/perfil-creador" }
      : situacion === "en_camino"
        ? { titulo: COPY.enCaminoTitulo, texto: COPY.enCaminoTexto, href: "/creadores/solicitud" }
        : { titulo: COPY.sumateTitulo, texto: COPY.sumateTexto, href: "/creadores/solicitud" };

  return (
    <Link
      href={contenido.href}
      className={cn(
        "block rounded-xl",
        "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <BezelCard coreClassName="flex items-center gap-3 px-4 py-3.5">
        <ChipDeIcono accent={ACENTO} Icon={Sparkle} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{contenido.titulo}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-foreground-secondary">
            {contenido.texto}
          </span>
        </span>
        <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </BezelCard>
    </Link>
  );
}
