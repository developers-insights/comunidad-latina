import Image from "next/image";
import Link from "next/link";
import type { Tenant } from "@/lib/tenant/resolve";
import { HeaderActions } from "@/components/shell/header-actions";

const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** ¿El src puede pasar por next/image? (local o del Storage de Supabase). */
function isOptimizableSrc(src: string): boolean {
  return (
    src.startsWith("/") ||
    (SUPABASE_ORIGIN.length > 0 && src.startsWith(`${SUPABASE_ORIGIN}/`))
  );
}

/**
 * Header del shell autenticado: zona de logo del tenant (única zona de marca
 * masiva permitida), selector de ubicación y campana de notificaciones
 * (placeholders con feedback inmediato — los cablean SOCIAL/notificaciones).
 */
export function Header({ tenant, className }: { tenant: Tenant; className?: string }) {
  const headerClass = [
    "sticky top-0 z-40 border-b border-neutral-200/70 bg-white/85 backdrop-blur-md",
    "dark:border-neutral-800 dark:bg-neutral-900/85",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClass}>
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-4">
        <Link
          href="/feed"
          className="flex min-h-11 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
          aria-label={tenant.name}
        >
          {tenant.logoUrl ? (
            isOptimizableSrc(tenant.logoUrl) ? (
              <Image
                src={tenant.logoUrl}
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 rounded-full object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- logo en un dominio ajeno al allowlist de next/image (tenant custom)
              <img src={tenant.logoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
            )
          ) : null}
          <span className="text-base font-bold tracking-tight text-[var(--color-brand)]">
            {tenant.name}
          </span>
        </Link>

        <HeaderActions />
      </div>
    </header>
  );
}
