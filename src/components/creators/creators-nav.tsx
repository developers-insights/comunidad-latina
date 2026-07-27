import Link from "next/link";
import { Briefcase, Users } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

// "contracts" se mantiene en el tipo porque /creadores/contratos sigue
// existiendo y sigue pasando active="contracts" para resaltar (ver esa
// página) — el acceso de Contratos ya no vive en este nav, se llega desde
// "Mis contratos" en el perfil del creador (pedido del cliente 26/7).
export type CreatorsSection = "gigs" | "creators" | "contracts";

const ITEMS: ReadonlyArray<{
  key: CreatorsSection;
  href: string;
  label: string;
  Icon: typeof Briefcase;
}> = [
  { key: "gigs", href: "/creadores", label: COPY.nav.gigs, Icon: Briefcase },
  { key: "creators", href: "/creadores/buscar", label: COPY.nav.creators, Icon: Users },
];

/**
 * Segmented control del módulo: Trabajos · Creadores. Server component
 * (Links reales — navegable sin JS); el activo lo dice cada página. El
 * acceso a Contratos se sacó de acá (feedback 26/7) — ahora se llega desde
 * "Mis contratos" en /creadores/perfil.
 */
export function CreatorsNav({ active }: { active: CreatorsSection }) {
  return (
    <nav
      aria-label="Secciones de creadores"
      className="mb-5 flex gap-1 rounded-lg bg-surface-subtle p-1"
    >
      {ITEMS.map(({ key, href, label, Icon }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold",
              "transition-colors duration-(--duration-fast)",
              isActive
                ? "bg-surface text-foreground shadow-xs"
                : "text-foreground-secondary hover:text-foreground",
            )}
          >
            <Icon size={16} weight={isActive ? "fill" : "regular"} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
