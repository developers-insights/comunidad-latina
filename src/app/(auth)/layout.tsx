import type { ReactNode } from "react";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";
import { ThemeToggle } from "@/components/theme";
import { BrandLogo, LOGO_COLORS } from "@/components/auth/brand-logo";
import styles from "@/components/auth/auth-shell.module.css";

const COPY = {
  headline: "Tu comunidad, en tu idioma.",
  promise:
    "Vivienda, trabajo, negocios y gente de tu país, con verificación real para que nadie te estafe.",
} as const;

// El logo lleva a /guias y no a "/": `/` redirige a `/entrar`, así que desde la
// propia pantalla de entrar era un clic que no hacía nada (en un teléfono lento
// parece que la app se colgó). Las guías son lo único que se lee sin cuenta.
const brandHomeHref = "/guias";

const brandLinkClass =
  "rounded-2xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div aria-hidden="true" className={styles.backdrop} />

      {/* Primero en el DOM porque es lo primero que se lee arriba a la derecha;
          `top` respeta el notch (el root layout usa viewportFit: cover). */}
      <ThemeToggle className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10" />

      <div className="mx-auto grid w-full max-w-6xl flex-1 lg:grid-cols-2 lg:gap-16 lg:px-10">
        <aside className="hidden flex-col justify-center py-16 lg:flex lg:h-dvh lg:self-start">
          <Link href={brandHomeHref} aria-label={BRAND_NAME} className={`self-start ${brandLinkClass}`}>
            <BrandLogo animated className="h-28" />
          </Link>

          <div className="mt-10 flex items-center gap-3">
            <span aria-hidden="true" className="flex gap-1">
              {LOGO_COLORS.map((color) => (
                <span key={color} className="h-1 w-5 rounded-full" style={{ backgroundColor: color }} />
              ))}
            </span>
            <span className="font-display text-sm font-semibold tracking-tight text-foreground-secondary">
              {BRAND_NAME}
            </span>
          </div>

          <p className="mt-5 max-w-[12ch] font-display text-5xl font-semibold leading-[1.02] tracking-[-0.035em] text-foreground text-balance xl:text-6xl">
            {COPY.headline}
          </p>
          <p className="mt-6 max-w-[36ch] text-lg leading-relaxed text-foreground-secondary text-pretty">
            {COPY.promise}
          </p>
        </aside>

        <main className="flex min-w-0 flex-col items-center justify-center px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))] sm:py-12 lg:px-0 lg:py-8">
          <Link
            href={brandHomeHref}
            aria-label={BRAND_NAME}
            className={`mb-6 flex items-center gap-2.5 px-1 lg:hidden ${brandLinkClass}`}
          >
            <BrandLogo animated className="h-10" />
            <span className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
              {BRAND_NAME}
            </span>
          </Link>

          <div className="w-full max-w-[27rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}
