import { Info } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { cn } from "@/lib/utils";

/**
 * DE DÓNDE SALE ESTA INFORMACIÓN — el bloque que hace que Comunidad no se lea
 * como un consejo de la plataforma.
 *
 * ── POR QUÉ ES UN COMPONENTE Y NO UN PÁRRAFO SUELTO ─────────────────────────
 * Un descargo copiado a mano en tres pantallas se desincroniza a la segunda
 * edición, y la que quede vieja es exactamente la que alguien va a leer.
 * Además, tenerlo con nombre hace visible el día que una pantalla nueva se
 * olvida de ponerlo.
 *
 * ── POR QUÉ ARRIBA Y NO EN EL PIE ───────────────────────────────────────────
 * Es el mismo criterio que la declaración de originalidad
 * (`lib/integrity/declarations.ts`): «un modal de "aceptá los términos" se
 * cierra sin leer; una casilla al lado de las fotos se lee porque está donde la
 * persona ya está mirando». Acá vale igual — el aviso va antes del contenido,
 * no debajo de él, y NO es letra chica: se lee al mismo tamaño que el resto.
 *
 * ── LO QUE DICE, Y POR QUÉ ESE ORDEN ────────────────────────────────────────
 *   1. Quién lo publica (organismos y organizaciones, no nosotros).
 *   2. Qué hacemos nosotros (reunirlo, decir de dónde salió y cuándo se revisó).
 *   3. Qué NO somos (no prestamos el servicio, no asesoramos) y qué conviene
 *      hacer (confirmar en la fuente antes de moverse).
 * Primero el hecho, después el límite. Al revés se lee como descargo legal y se
 * saltea.
 */
export function OrigenNota({
  /** true en las pantallas donde el tema migratorio está presente. */
  incluirMigracion = false,
  className,
}: {
  incluirMigracion?: boolean;
  className?: string;
}) {
  const C = COMUNIDAD_COPY.disclaimer;

  return (
    <BezelCard
      variant="featured"
      className={className}
      coreClassName="flex gap-3 p-4 sm:p-5"
    >
      <Info
        size={20}
        weight="fill"
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-[var(--accent-comunidad)]"
      />
      <div className={cn("min-w-0 space-y-2")}>
        <h2 className="font-display text-base font-semibold leading-snug text-foreground">
          {C.title}
        </h2>
        <p className="text-sm leading-relaxed text-foreground-secondary">{C.body}</p>
        <p className="text-sm leading-relaxed font-medium text-foreground">{C.notAdvice}</p>
        {incluirMigracion && (
          <p className="text-sm leading-relaxed text-foreground-secondary">{C.migration}</p>
        )}
      </div>
    </BezelCard>
  );
}
