import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { getTenant } from "@/lib/tenant/resolve";
import { t } from "@/lib/i18n";

// Placeholder premium — el agente LANDING reemplaza esta página completa.

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  return {
    title: `${tenant.name} — Tu comunidad, verificada`,
    description: `La comunidad de ${tenant.name} para encontrar vivienda, gente y ayuda real — con verificación anti-estafa.`,
  };
}

export default async function MarketingHome() {
  const tenant = await getTenant();

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-24 text-center sm:py-32">
      <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        <ShieldCheck size={16} className="text-[var(--color-brand)]" aria-hidden />
        Comunidad con verificación anti-estafa
      </span>

      <h1 className="max-w-xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
        {tenant.name}
      </h1>

      <p className="mt-5 max-w-md text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
        Encontrá dónde vivir, gente de tu país y ayuda de verdad — sin miedo a que te estafen.
      </p>

      <Link
        href="/entrar"
        className="mt-10 flex min-h-12 items-center rounded-full bg-[var(--color-brand)] px-8 text-base font-semibold text-[var(--color-brand-foreground)] transition-transform duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
      >
        {t("common", "enter")}
      </Link>
    </section>
  );
}
