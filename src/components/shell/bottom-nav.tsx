"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Buildings,
  ChatCircle,
  HouseSimple,
  ShieldCheck,
  UserCircle,
  type Icon,
} from "@phosphor-icons/react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: Icon };

const ITEMS: NavItem[] = [
  { href: "/feed", label: t("nav", "feed"), icon: HouseSimple },
  { href: "/propiedades", label: t("nav", "properties"), icon: Buildings },
  { href: "/escudo", label: t("nav", "shield"), icon: ShieldCheck },
  { href: "/mensajes", label: t("nav", "messages"), icon: ChatCircle },
  { href: "/perfil", label: t("nav", "profile"), icon: UserCircle },
];

/**
 * Bottom nav del shell (mobile-first). Activo = color de marca + peso Fill.
 * Targets ≥44px, safe-area para notch, ícono + texto siempre (nunca solo ícono).
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("nav", "mainNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200/70 bg-white/92 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/92"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex w-full max-w-lg items-stretch">
        {ITEMS.map(({ href, label, icon: IconComponent }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5",
                  "text-[11px] font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--color-brand-200)]",
                  active
                    ? "text-[var(--color-brand)]"
                    : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200",
                )}
              >
                <IconComponent size={24} weight={active ? "fill" : "regular"} aria-hidden />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
