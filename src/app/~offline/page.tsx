import type { Metadata } from "next";
import {
  ChatCircleDots,
  ClockCounterClockwise,
  BookOpenText,
} from "@phosphor-icons/react/dist/ssr";
import { RetryButton } from "@/components/pwa/retry-button";
import { ThemeToggle } from "@/components/theme";

/**
 * /~offline — fallback del service worker (módulo PWA, §3.4 del design brief).
 * Se precachea en la instalación del SW y se sirve cuando una navegación
 * falla sin red y sin cache. Sin datos dinámicos: tiene que renderizar
 * completa sin conexión.
 *
 * Es la pantalla donde el usuario SE QUEDA cuando no hay red, y la única del
 * proyecto sin header ni layout de grupo: sin este toggle, quedarse sin señal
 * era quedarse también sin poder cambiar el tema. El botón sí funciona offline
 * — los chunks del build entran en el precache del SW (src/app/sw.ts), igual
 * que los del <RetryButton /> que ya vivía acá.
 */

const COPY = {
  title: "Sin conexión",
  message:
    "Sin conexión — mostrando lo último guardado. Apenas vuelva la señal, seguís donde estabas.",
  worksTitle: "Mientras tanto, esto sigue funcionando:",
  works: [
    {
      icon: ClockCounterClockwise,
      text: "Lo último que viste del feed y de los avisos queda guardado en tu teléfono.",
    },
    {
      icon: BookOpenText,
      text: "Las guías que ya abriste se pueden leer completas, sin señal.",
    },
    {
      icon: ChatCircleDots,
      text: "Tus conversaciones recientes quedan visibles — los mensajes nuevos salen cuando vuelva la conexión.",
    },
  ],
  retry: "Reintentar",
} as const;

export const metadata: Metadata = {
  title: COPY.title,
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    // El wrapper `relative` existe sólo para anclar el toggle al borde de la
    // VENTANA: `main` es `mx-auto max-w-lg`, así que un `absolute` adentro lo
    // dejaría flotando en el borde de la columna en pantallas anchas.
    <div className="relative">
      {/* Primero en el DOM porque es lo primero que se lee arriba a la derecha;
          `top` respeta el notch (el root layout usa viewportFit: cover). */}
      <ThemeToggle className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10" />
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center px-6 py-12 text-center">
        {/* img plano (no next/image): el optimizador /_next/image no está
            precacheado; este PNG sí, así la ilustración aparece sin red. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- asset precacheado por el SW, debe cargar offline */}
        <img
          src="/images/empty-state-search.png"
          alt=""
          aria-hidden="true"
          className="h-36 w-auto"
        />

        <h1 className="mt-6 font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h1>
        <p className="mt-2 max-w-sm text-base text-foreground-secondary">
          {COPY.message}
        </p>

        <section
          aria-label={COPY.worksTitle}
          className="mt-8 w-full rounded-xl bg-surface-subtle p-5 text-left"
        >
          <h2 className="text-sm font-semibold text-foreground">
            {COPY.worksTitle}
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {COPY.works.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon
                  size={20}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-foreground-muted"
                />
                <span className="text-sm text-foreground-secondary">{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-8">
          <RetryButton label={COPY.retry} />
        </div>
      </main>
    </div>
  );
}
