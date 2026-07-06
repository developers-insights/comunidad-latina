import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { getTenant } from "@/lib/tenant/resolve";
import { brandThemeToStyle } from "@/lib/tenant/brand-pipeline";
import { t } from "@/lib/i18n";

/** Layout público: header simple + footer con disclaimer legal breve. */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();

  return (
    <div
      style={brandThemeToStyle(tenant.brandHex) as CSSProperties}
      className="flex min-h-dvh flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50"
    >
      <header className="border-b border-neutral-200/70 bg-white/85 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/85">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
          <Link
            href="/"
            className="rounded-full text-lg font-bold tracking-tight text-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
          >
            {tenant.name}
          </Link>
          <Link
            href="/entrar"
            className="flex min-h-11 items-center rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-brand-foreground)] transition-transform duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
          >
            {t("common", "enter")}
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-neutral-200/70 py-8 dark:border-neutral-800">
        <div className="mx-auto w-full max-w-5xl space-y-2 px-4 text-xs text-neutral-500 dark:text-neutral-400">
          <p>
            La información de verificación describe registros públicos a una fecha determinada y
            no garantiza la conducta de ninguna persona. Nunca envíes dinero por adelantado.
          </p>
          <p>
            © {new Date().getFullYear()} {tenant.name} · Una comunidad de Comunidad Latina
          </p>
        </div>
      </footer>
    </div>
  );
}
