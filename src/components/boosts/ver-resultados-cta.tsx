import Link from "next/link";
import { CaretRight, ChartLineUp } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ChipDeIcono } from "./chip-de-icono";

/**
 * LA ENTRADA A "CÓMO VAN TUS PROMOCIONES", en la cabecera de Boost.
 *
 * Pedido del cliente (video de seguimiento): poder ver el rendimiento de la
 * publicidad sin entrar aviso por aviso. Las métricas ya existían, pero sólo
 * dentro de `/impulsar/[listingId]/estadisticas` — o sea, había que saber de
 * antemano cuál aviso mirar y entrar uno por uno.
 *
 * SÓLO SE RENDERIZA SI HAY ALGO QUE VER. El índice decide: sin una sola
 * campaña comprada, esta tarjeta llevaría a una pantalla vacía y sería una fila
 * de relleno en la cabecera de la pantalla de compra. Con campañas, es lo
 * primero que busca quien ya gastó plata.
 *
 * Gemela de `CrearParaPromocionarCta` a propósito: las dos son salidas de la
 * cabecera de Boost y comparten forma (tarjeta bezel de ancho completo) para no
 * competir con el "Promocionar" de cada fila, que sigue siendo el primario de
 * la pantalla. El acento acá es el de marca y no el dorado: el dorado marca el
 * espacio que se PAGA, y esto no cobra nada — sólo muestra lo ya pagado.
 */
const COPY = {
  titulo: "Cómo van tus promociones",
  descripcion: "Mirá cuánta gente vio lo que promocionaste, todo junto.",
} as const;

export function VerResultadosCta({ className }: { className?: string }) {
  return (
    <Link
      href="/impulsar/resultados"
      className={cn(
        "block rounded-xl",
        "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <BezelCard coreClassName="flex items-center gap-3 px-4 py-3.5">
        <ChipDeIcono accent="var(--color-brand)" Icon={ChartLineUp} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{COPY.titulo}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-foreground-secondary">
            {COPY.descripcion}
          </span>
        </span>
        <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </BezelCard>
    </Link>
  );
}
