import Link from "next/link";
import { Briefcase, Users } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

// "contracts" se mantiene como CLAVE del tipo (no como etiqueta) porque
// /creadores/colaboraciones sigue pasando active="contracts" para resaltar —
// renombrar la clave no cambiaría nada visible y sí tocaría más archivos. La
// sección se llama "Colaboraciones" desde el 30/7 (pedido textual del cliente).
//
// Su acceso no vive en este nav: se llega desde "Mis colaboraciones" en
// /creadores/perfil y, si hay alguna, también desde /perfil (perfil general —
// feedback 27/7: el link en el perfil de creador no era descubrible si nunca
// entrabas ahí primero).
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
 * acceso a Colaboraciones se sacó de acá (feedback 26/7) — ver el comentario
 * de `CreatorsSection` arriba para dónde vive ahora.
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
              // Anillo propio: la pestaña activa lleva `shadow-xs`, y esa utility
              // escribe `box-shadow` — le gana al anillo global de globals.css,
              // que vive en un `:where(…)` de especificidad cero. Sin esto la
              // pestaña seleccionada, que es justo donde cae el foco al entrar,
              // queda sin indicador (WCAG 2.4.7).
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
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
