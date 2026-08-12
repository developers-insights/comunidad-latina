import Image from "next/image";
import Link from "next/link";
import {
  CalendarBlank,
  CheckCircle,
  MagnifyingGlass,
  MapPin,
  HandHeart,
} from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import { isOptimizableSrc } from "@/components/listings";
import {
  COMUNIDAD_COPY,
  LOST_FOUND_CATEGORY_LABEL,
  type LostFoundCase,
} from "@/lib/comunidad";
import { cn, formatDate } from "@/lib/utils";

const C = COMUNIDAD_COPY.perdidos.card;

/**
 * Card de un caso de Perdido y encontrado.
 *
 * ── LAS TRES COSAS QUE SE LEEN EN UN SEGUNDO ────────────────────────────────
 *   1. ¿Es "se perdió" o "se encontró"?  → chip de color CON texto e ícono
 *      distintos, nunca sólo color (daltonismo, §accesibilidad).
 *   2. ¿Dónde?                            → la zona, con ícono de pin.
 *   3. ¿Sigue abierto?                    → el caso resuelto se atenúa y gana
 *      un chip "Ya apareció".
 *
 * ── POR QUÉ EL RESUELTO NO SE ESCONDE ───────────────────────────────────────
 * Porque "esto ya apareció" es información útil para todo el mundo: le ahorra
 * el mensaje a quien iba a escribir y le muestra a quien recién llega que la
 * sección sirve. Se atenúa (opacidad + orden al final de la página), que es
 * distinto de ocultar.
 *
 * La foto NO abre visor acá: tocar cualquier parte de la card lleva al caso, y
 * dos destinos táctiles superpuestos en una card de 375px es una mis-tap
 * garantizada. La galería completa vive en el detalle.
 */
export function CasoCard({ caso }: { caso: LostFoundCase }) {
  const resuelto = caso.resolvedAt !== null;
  const foto = caso.photos[0] ?? null;
  const esEncontrado = caso.type === "found";

  return (
    <Link
      href={`/comunidad/perdidos/${caso.id}`}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm",
        "transition-[box-shadow,transform,opacity] duration-(--duration-base) ease-(--ease-out-premium)",
        "hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        resuelto && "opacity-70 hover:opacity-100",
      )}
    >
      {foto ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-subtle">
          <Image
            src={foto}
            alt=""
            fill
            unoptimized={!isOptimizableSrc(foto)}
            sizes="(min-width: 640px) 45vw, 90vw"
            className="object-cover transition-transform duration-(--duration-slow) ease-(--ease-out-premium) group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-[color-mix(in_oklab,var(--accent-comunidad)_14%,var(--color-surface))] to-surface-subtle"
        >
          {esEncontrado ? (
            <HandHeart size={40} weight="light" className="text-[var(--accent-comunidad)]" />
          ) : (
            <MagnifyingGlass
              size={40}
              weight="light"
              className="text-[var(--accent-comunidad)]"
            />
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            size="sm"
            variant={esEncontrado ? "success" : "warning"}
            icon={
              esEncontrado ? (
                <HandHeart size={14} weight="fill" aria-hidden="true" />
              ) : (
                <MagnifyingGlass size={14} weight="bold" aria-hidden="true" />
              )
            }
          >
            {esEncontrado ? C.foundBadge : C.lostBadge}
          </Chip>

          {caso.category && (
            <Chip size="sm">{LOST_FOUND_CATEGORY_LABEL[caso.category]}</Chip>
          )}

          {resuelto && (
            <Chip
              size="sm"
              variant="info"
              icon={<CheckCircle size={14} weight="fill" aria-hidden="true" />}
            >
              {C.resolvedBadge}
            </Chip>
          )}
        </div>

        <h3 className="font-display text-base font-semibold leading-snug text-foreground">
          {caso.title}
        </h3>

        <p className="flex items-start gap-1.5 text-sm text-foreground-secondary">
          <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0">{caso.areaLabel ?? C.noArea}</span>
        </p>

        {caso.happenedOn && (
          <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
            <CalendarBlank size={16} aria-hidden="true" />
            {C.happenedOn(formatDate(caso.happenedOn, { style: "medium" }))}
          </p>
        )}

        <p className="mt-auto pt-2 text-xs text-foreground-muted">{caso.publishedAtLabel}</p>
      </div>
    </Link>
  );
}
