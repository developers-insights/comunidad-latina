import { cn } from "@/lib/utils";
import styles from "./auth-shell.module.css";

export const authLinkClass =
  "rounded-sm font-semibold text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring";

export const authTitleClass =
  "font-display text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground text-balance";

// Tailwind 4 escribe `translate` y `scale` como propiedades propias, no dentro
// de `transform`: sin listarlas acá, el levantar del hover y el hundir del press
// saltan de golpe en vez de interpolar.
export const authSubmitClass =
  "mt-2 w-full transition-[translate,scale,background-color,opacity] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0";

export const authSubtitleClass = "text-[0.9375rem] leading-relaxed text-foreground-secondary text-pretty";

// Sombras negras a propósito: una sombra teñida con el color de marca se lee
// como neón (veto del dueño, 2026-09-07). La elevación la da el negro sutil.
export function AuthCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        styles.enter,
        "w-full rounded-[1.75rem] bg-bezel-shell/70 p-1.5 ring-1 ring-border-subtle",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-24px_rgba(0,0,0,0.16)]",
        className,
      )}
    >
      <div className="rounded-[calc(1.75rem-6px)] bg-surface px-5 py-7 shadow-[inset_0_1px_0_var(--cl-bezel-highlight)] ring-1 ring-border-subtle sm:px-8 sm:py-9">
        {children}
      </div>
    </div>
  );
}

export function AuthHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className={authTitleClass}>{title}</h1>
      {subtitle ? <p className={authSubtitleClass}>{subtitle}</p> : null}
    </header>
  );
}

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
      <span className="text-xs font-medium tracking-wide text-foreground-muted">{label}</span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
    </div>
  );
}
