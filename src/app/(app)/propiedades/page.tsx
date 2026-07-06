import { t } from "@/lib/i18n";

// Placeholder — el agente VIVIENDA reemplaza esta página con búsqueda + lista real.

export const metadata = { title: "Propiedades" };

export default function PropiedadesPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t("listings", "title")}</h1>
      <div className="space-y-4" role="status" aria-label={t("common", "loading")}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-3xl border border-neutral-200 bg-white p-1.5 dark:border-neutral-800 dark:bg-neutral-800"
          >
            <div className="h-40 rounded-[22px] bg-neutral-100 dark:bg-neutral-700" />
            <div className="space-y-2 p-4">
              <div className="h-4 w-2/3 rounded-full bg-neutral-100 dark:bg-neutral-700" />
              <div className="h-3 w-1/3 rounded-full bg-neutral-100 dark:bg-neutral-700" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
