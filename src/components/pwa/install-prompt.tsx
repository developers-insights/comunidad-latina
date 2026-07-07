"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DeviceMobile,
  Export,
  PlusSquare,
  X,
} from "@phosphor-icons/react";
import { Banner, BottomSheet, Button } from "@/components/ui";

/**
 * InstallPrompt (módulo PWA) — invita a instalar la app tras la 2ª visita.
 *
 * - Chrome/Edge/Android: captura `beforeinstallprompt` y dispara el prompt
 *   nativo con un botón "Instalar".
 * - iOS/Safari (sin beforeinstallprompt): abre un sheet con los 2 pasos
 *   (Compartir → Agregar a pantalla de inicio).
 * - Nunca aparece dentro de la app ya instalada (display-mode standalone),
 *   ni antes de la 2ª visita, ni durante el snooze tras descartarlo.
 */

const COPY = {
  title: "Instalá la app — sin App Store, gratis",
  body: "Queda en tu pantalla de inicio y abre al toque, hasta con mala señal.",
  install: "Instalar",
  how: "Ver cómo",
  dismiss: "Cerrar aviso de instalación",
  iosTitle: "Agregala a tu inicio",
  iosIntro:
    "En iPhone se instala desde Safari, en dos pasos. No pasa por la App Store y no ocupa casi espacio:",
  iosStep1: "Tocá el botón Compartir (el cuadradito con la flecha, abajo al medio).",
  iosStep2: "Elegí “Agregar a pantalla de inicio” y confirmá.",
  iosDone: "Listo — la vas a ver junto a tus otras apps.",
} as const;

const VISITS_KEY = "cl-pwa-visits";
const SESSION_KEY = "cl-pwa-visit-counted";
const DISMISSED_KEY = "cl-pwa-install-dismissed";
const INSTALLED_KEY = "cl-pwa-installed";
const SNOOZE_DAYS = 14;
const MIN_VISITS = 2;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  const classic = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ se presenta como Mac, pero con pantalla táctil.
  const modernIpad = /macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1;
  return classic || modernIpad;
}

/** localStorage puede fallar (modo privado viejo, cuota): nunca romper por eso. */
function safeStorage(fn: () => string | null): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // sin storage no hay conteo de visitas — simplemente no mostramos nada
  }
}

function eligibleNow(): boolean {
  if (isStandalone()) return false;
  if (safeStorage(() => window.localStorage.getItem(INSTALLED_KEY))) return false;

  const dismissedAt = Number(
    safeStorage(() => window.localStorage.getItem(DISMISSED_KEY)) ?? 0,
  );
  if (dismissedAt && Date.now() - dismissedAt < SNOOZE_DAYS * 24 * 60 * 60 * 1000) {
    return false;
  }

  // Contar la visita una sola vez por sesión de navegador.
  let visits = Number(safeStorage(() => window.localStorage.getItem(VISITS_KEY)) ?? 0);
  const counted = safeStorage(() => window.sessionStorage.getItem(SESSION_KEY));
  if (!counted) {
    visits += 1;
    safeSet(VISITS_KEY, String(visits));
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // idem: sin sessionStorage, como mucho contamos de más — inofensivo
    }
  }
  return visits >= MIN_VISITS;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [eligible, setEligible] = useState(false);
  const [ios, setIos] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    // Diferido: no ensuciar el primer paint con el banner (y evitar setState
    // sincrónico en el effect). 1.5s deja que la pantalla respire primero.
    const timer = window.setTimeout(() => {
      setEligible(eligibleNow());
      setIos(isIos());
    }, 1500);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      safeSet(INSTALLED_KEY, "1");
      setDeferred(null);
      setEligible(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    safeSet(DISMISSED_KEY, String(Date.now()));
    setEligible(false);
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") safeSet(INSTALLED_KEY, "1");
      else safeSet(DISMISSED_KEY, String(Date.now()));
    } catch {
      // el prompt nativo puede fallar si ya se usó — nunca romper la UI
    }
    setDeferred(null);
    setEligible(false);
  }, [deferred]);

  // Sin evento capturado y sin iOS no hay nada instalable que ofrecer.
  const show = eligible && (deferred !== null || ios);
  if (!show) return null;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="pointer-events-auto mx-auto max-w-lg overflow-hidden rounded-xl bg-surface-raised shadow-lg ring-1 ring-border">
          <Banner
            variant="info"
            icon={<DeviceMobile size={20} className="text-brand" />}
            action={
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={ios && !deferred ? () => setSheetOpen(true) : install}
                >
                  {ios && !deferred ? COPY.how : COPY.install}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={COPY.dismiss}
                  onClick={dismiss}
                  className="px-2"
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </div>
            }
          >
            <p className="font-semibold text-foreground">{COPY.title}</p>
            <p className="mt-0.5 text-foreground-secondary">{COPY.body}</p>
          </Banner>
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={COPY.iosTitle}
      >
        <div className="flex flex-col gap-4 pb-4">
          <p className="text-sm text-foreground-secondary">{COPY.iosIntro}</p>
          <ol className="flex flex-col gap-3">
            <li className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle">
                <Export size={18} aria-hidden="true" className="text-brand" />
              </span>
              <span className="pt-1 text-sm text-foreground">{COPY.iosStep1}</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle">
                <PlusSquare size={18} aria-hidden="true" className="text-brand" />
              </span>
              <span className="pt-1 text-sm text-foreground">{COPY.iosStep2}</span>
            </li>
          </ol>
          <p className="text-sm text-foreground-secondary">{COPY.iosDone}</p>
        </div>
      </BottomSheet>
    </>
  );
}
