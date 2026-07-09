"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { m } from "motion/react";
import { GlobeHemisphereWest, ShieldCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

/**
 * Navegación del panel admin (§12): Moderación para todo el staff,
 * Dominio para domain_admin+, Global solo global_admin.
 * Patrón de tabs con underline de marca — denso pero con los tokens (§1.1.④:
 * esta es la única superficie "power user" del producto).
 */

type StaffRole = "moderator" | "domain_admin" | "global_admin";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  minRank: number;
}

const RANK: Record<StaffRole, number> = {
  moderator: 1,
  domain_admin: 2,
  global_admin: 3,
};

const ITEMS: NavItem[] = [
  {
    href: "/admin/moderacion",
    label: "Moderación",
    icon: <ShieldCheck size={18} aria-hidden="true" />,
    minRank: 1,
  },
  {
    href: "/admin/dominio",
    label: "Dominio",
    icon: <Storefront size={18} aria-hidden="true" />,
    minRank: 2,
  },
  {
    href: "/admin/global",
    label: "Global",
    icon: <GlobeHemisphereWest size={18} aria-hidden="true" />,
    minRank: 3,
  },
];

export function AdminNav({
  role,
  pendingCount,
}: {
  role: StaffRole;
  /** Ítems pendientes en la cola de moderación (contador del nav). */
  pendingCount: number;
}) {
  const pathname = usePathname();
  const visible = ITEMS.filter((item) => RANK[role] >= item.minRank);

  return (
    <nav aria-label="Secciones del panel" className="border-b border-border-subtle">
      <div className="mx-auto flex w-full max-w-3xl gap-1 overflow-x-auto px-4 scrollbar-none">
        {visible.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-1.5 whitespace-nowrap px-4 text-sm font-medium",
                "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                active
                  ? "text-foreground"
                  : "text-foreground-secondary hover:text-foreground",
              )}
            >
              {item.icon}
              {item.label}
              {item.href === "/admin/moderacion" && pendingCount > 0 && (
                <span
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold tabular-nums text-brand-foreground"
                  aria-label={`${pendingCount} pendientes`}
                >
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
              {active && (
                <m.span
                  layoutId="admin-nav-underline"
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
                  transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
