import { t } from "@/lib/i18n";

// Placeholder — el agente AUTH reemplaza esta página con el perfil real.

export const metadata = { title: "Perfil" };

export default function PerfilPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t("nav", "profile")}</h1>
      <div
        className="animate-pulse rounded-3xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-800"
        role="status"
        aria-label={t("common", "loading")}
      >
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-full bg-neutral-100 dark:bg-neutral-700" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 rounded-full bg-neutral-100 dark:bg-neutral-700" />
            <div className="h-3 w-1/3 rounded-full bg-neutral-100 dark:bg-neutral-700" />
          </div>
        </div>
        <div className="mt-6 space-y-2">
          <div className="h-3 w-full rounded-full bg-neutral-100 dark:bg-neutral-700" />
          <div className="h-3 w-4/5 rounded-full bg-neutral-100 dark:bg-neutral-700" />
        </div>
      </div>
    </>
  );
}
