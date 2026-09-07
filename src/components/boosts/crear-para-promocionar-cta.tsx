import Link from "next/link";
import { CaretRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ChipDeIcono } from "./chip-de-icono";

/**
 * LA SALIDA HACIA CREAR, fija en la cabecera de Boost.
 *
 * Feedback del cliente con captura (2026-09-07): "en la sección de boost falta
 * el botón de poder crear una publicidad". En la captura tenía siete avisos
 * propios listados, cada uno con su "Promocionar", y ningún camino para hacer
 * uno nuevo. El camino existía —el CTA del `EmptyState`— pero vivía DENTRO del
 * vacío: aparecía sólo mientras no tuvieras nada y desaparecía justo cuando
 * empezabas a usar la pantalla.
 *
 * POR QUÉ VA ACÁ Y NO COMO PRIMER TILE DE LA LISTA. El índice no es una grilla:
 * son dos listas rotuladas ("Tus avisos" / "Tus publicaciones"). Un tile "Crear"
 * dentro de una de ellas miente sobre lo que la lista contiene (no es un aviso
 * tuyo), habría que repetirlo en las dos para cubrir los dos tipos, y en la
 * segunda queda debajo del pliegue apenas la primera tiene unas pocas filas —
 * que es exactamente el caso de la captura. En la cabecera no se mueve, no
 * depende del largo de la lista y es lo primero que se ve al entrar.
 *
 * POR QUÉ NO ES UN BOTÓN PRIMARIO. `buttonVariants.primary` está declarado
 * "1 por pantalla", y esta pantalla ya lo gasta en cada "Promocionar" de la
 * lista — que sigue siendo la acción principal de Boost. Esto es la salida
 * para cuando todavía no tenés qué promocionar, así que se distingue por
 * FORMA (tarjeta bezel de ancho completo) y no por peso de color.
 *
 * El acento es el dorado de `--color-sponsored`, el mismo con el que el menú
 * del "+" tiñe su tile de Boost: en esta app el dorado marca el espacio que se
 * paga. Va sólo en el ícono, nunca de fondo (§ globals.css, "el dorado nunca es
 * un fondo teñido").
 */
const COPY = {
  titulo: "Publicá algo nuevo",
  descripcion: "Elegí qué querés publicar y volvé acá para ponerle Boost.",
} as const;

export function CrearParaPromocionarCta({ className }: { className?: string }) {
  return (
    <Link
      href="/impulsar/crear"
      className={cn(
        "block rounded-xl",
        // Sólo transform: el card entero se hunde al tocarlo, como las filas de
        // la lista y las del menú del "+". Nada de animar la sombra del bezel.
        "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <BezelCard coreClassName="flex items-center gap-3 px-4 py-3.5">
        <ChipDeIcono accent="var(--color-sponsored)" Icon={Plus} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{COPY.titulo}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-foreground-secondary">
            {COPY.descripcion}
          </span>
        </span>
        <CaretRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-foreground-muted"
        />
      </BezelCard>
    </Link>
  );
}
