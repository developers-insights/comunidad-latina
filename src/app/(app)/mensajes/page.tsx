import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr";
import { t } from "@/lib/i18n";

// Placeholder — el agente MENSAJES reemplaza esta página con el inbox real.

export const metadata = { title: "Mensajes" };

export default function MensajesPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t("nav", "messages")}</h1>
      <div className="flex flex-col items-center rounded-3xl border border-neutral-200 bg-white px-6 py-14 text-center dark:border-neutral-800 dark:bg-neutral-800">
        <ChatCircleDots size={32} className="text-neutral-300 dark:text-neutral-600" aria-hidden />
        <p className="mt-4 max-w-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          Tus conversaciones van a aparecer acá.
        </p>
      </div>
    </>
  );
}
