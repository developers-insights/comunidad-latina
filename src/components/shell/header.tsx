import Link from "next/link";
import { Bell, CaretDown, MapPin } from "@phosphor-icons/react/dist/ssr";
import type { Tenant } from "@/lib/tenant/resolve";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Header del shell autenticado: zona de logo del tenant (única zona de marca
 * masiva permitida), selector de ubicación (placeholder — lo cablea SOCIAL) y
 * campana de notificaciones (placeholder — lo cablea el módulo de notificaciones).
 */
export function Header({ tenant, className }: { tenant: Tenant; className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-neutral-200/70 bg-white/85 backdrop-blur-md",
        "dark:border-neutral-800 dark:bg-neutral-900/85",
        className,
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-4">
        <Link
          href="/feed"
          className="flex min-h-11 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
          aria-label={tenant.name}
        >
          {tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo remoto por tenant, dominio no conocido en build
            <img src={tenant.logoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : null}
          <span className="text-base font-bold tracking-tight text-[var(--color-brand)]">
            {tenant.name}
          </span>
        </Link>

        <button
          type="button"
          className="ml-auto flex min-h-11 items-center gap-1 rounded-full px-3 text-sm text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)] dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label={t("nav", "chooseLocation")}
        >
          <MapPin size={20} aria-hidden />
          <span className="max-w-28 truncate">{t("nav", "locationPlaceholder")}</span>
          <CaretDown size={12} aria-hidden />
        </button>

        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)] dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label={t("nav", "notifications")}
        >
          <Bell size={22} aria-hidden />
        </button>
      </div>
    </header>
  );
}
