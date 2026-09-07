import Link from "next/link";
import {
  Briefcase,
  CalendarBlank,
  CaretRight,
  ChatCircle,
  House,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { ChipDeIcono } from "./chip-de-icono";
import type {
  GrupoDeCreacion,
  OpcionParaPromocionar,
} from "./opciones-para-promocionar";

/**
 * Las opciones de /impulsar/crear, agrupadas como las lista Boost.
 *
 * Los dos grupos son los dos que el índice ya muestra ("Tus avisos" / "Tus
 * publicaciones"): lo que se crea de cada lado es lo que después aparece de ese
 * lado. Servidor puro — un `<Link>` por fila, sin estado ni handlers.
 *
 * El ícono se resuelve por `id` de opción y NO se guarda en el catálogo:
 * `opciones-para-promocionar.ts` se testea en node y los íconos son componentes
 * de React.
 *
 * Ojo con `professional` y `job`: acá van UserGear y Briefcase, que es el par
 * que ya usa el índice de Boost (`LISTING_ICON` en impulsar/page.tsx). El menú
 * del "+" los tiene cruzados al revés (Briefcase para profesionales, Wrench
 * para empleos); entre parecerse a la otra pantalla del mismo módulo o a una
 * hoja de otro, gana el módulo — es la que la persona acaba de dejar.
 */
const ICONO: Record<string, Icon> = {
  property: House,
  business: Storefront,
  professional: UserGear,
  event: CalendarBlank,
  job: Briefcase,
  product: ShoppingBagOpen,
  creatorGig: Sparkle,
  post: ChatCircle,
};

const TITULO_DE_GRUPO: Record<GrupoDeCreacion, string> = {
  aviso: "Avisos",
  publicacion: "Publicaciones",
};

const ORDEN_DE_GRUPOS: readonly GrupoDeCreacion[] = ["aviso", "publicacion"];

export function SelectorDeCreacion({
  opciones,
}: {
  opciones: readonly OpcionParaPromocionar[];
}) {
  return (
    <div className="flex flex-col gap-6">
      {ORDEN_DE_GRUPOS.map((grupo) => {
        const delGrupo = opciones.filter((opcion) => opcion.grupo === grupo);
        if (delGrupo.length === 0) return null;

        return (
          <section key={grupo} aria-label={TITULO_DE_GRUPO[grupo]} className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold text-foreground">
              {TITULO_DE_GRUPO[grupo]}
            </h2>
            <ul className="flex flex-col gap-2.5">
              {delGrupo.map((opcion) => (
                <FilaDeOpcion key={opcion.id} opcion={opcion} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function FilaDeOpcion({ opcion }: { opcion: OpcionParaPromocionar }) {
  return (
    <li>
      <Link
        href={opcion.href}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3",
          // Propiedades enumeradas, nunca `transition: all`.
          "transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-subtle active:scale-[0.99]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <ChipDeIcono accent={opcion.accentVar} Icon={ICONO[opcion.id] ?? ChatCircle} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{opcion.titulo}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-foreground-secondary">
            {opcion.descripcion}
          </span>
        </span>
        <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </Link>
    </li>
  );
}
