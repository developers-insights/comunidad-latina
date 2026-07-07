import Image from "next/image";
import Link from "next/link";
import type { Tenant } from "@/lib/tenant/resolve";
import { createClient } from "@/lib/supabase/server";
import { HeaderActions } from "@/components/shell/header-actions";
import { NotificationBell } from "@/components/notifications";

const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** ¿El src puede pasar por next/image? (local o del Storage de Supabase). */
function isOptimizableSrc(src: string): boolean {
  return (
    src.startsWith("/") ||
    (SUPABASE_ORIGIN.length > 0 && src.startsWith(`${SUPABASE_ORIGIN}/`))
  );
}

/** Count de notificaciones sin leer del usuario (RLS: solo las propias). */
async function getUnreadCount(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    return !error && typeof count === "number" ? count : 0;
  } catch {
    return 0; // Sin sesión o sin DB: campana sin badge, nunca un error.
  }
}

/**
 * Header del shell autenticado: zona de logo del tenant (única zona de marca
 * masiva permitida), selector de ubicación (placeholder, lo cablea SOCIAL)
 * y campana de notificaciones real (módulo NOTIFICACIONES).
 */
export async function Header({ tenant, className }: { tenant: Tenant; className?: string }) {
  const unread = await getUnreadCount();
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
        <NotificationBell initialUnread={unread} />
      </div>
    </header>
  );
}
