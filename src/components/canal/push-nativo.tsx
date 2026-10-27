"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Push de la app de iOS. La web no importa @capacitor/*: el WKWebView de
 * Capacitor inyecta `window.Capacitor` con los plugins nativos registrados en
 * `ios-app/`, así que en el navegador común esto no hace nada y no suma peso
 * al bundle.
 *
 * Se monta sólo con sesión (layout de la app). El permiso se pide una vez; si
 * la persona dice que no, iOS no vuelve a mostrar el cartel y `register()` no
 * entrega token, que es lo correcto.
 */

type PushListener = { remove: () => Promise<void> };
type PushPlugin = {
  checkPermissions: () => Promise<{ receive: string }>;
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  addListener: (event: string, cb: (data: unknown) => void) => Promise<PushListener>;
};
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { PushNotifications?: PushPlugin };
};

function nativePush(): { plugin: PushPlugin; platform: "ios" | "android" } | null {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const platform = cap.getPlatform?.();
  const plugin = cap.Plugins?.PushNotifications;
  if (!plugin || (platform !== "ios" && platform !== "android")) return null;
  return { plugin, platform };
}

function hrefFromAction(data: unknown): string | null {
  const href = (data as { notification?: { data?: { href?: unknown } } })?.notification?.data?.href;
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//") ? href : null;
}

export function PushNativo() {
  const router = useRouter();

  useEffect(() => {
    const native = nativePush();
    if (!native) return;
    const { plugin, platform } = native;
    const listeners: Promise<PushListener>[] = [];
    let cancelled = false;

    listeners.push(
      plugin.addListener("registration", (data) => {
        const token = (data as { value?: string })?.value;
        if (!token || cancelled) return;
        // Siempre se reenvía (sin cache local): si en el teléfono cambió la
        // cuenta, el upsert por token es lo que pasa los avisos a la nueva.
        void fetch("/api/push/dispositivos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, platform }),
        }).catch(() => {});
      }),
    );

    listeners.push(
      plugin.addListener("pushNotificationActionPerformed", (data) => {
        const href = hrefFromAction(data);
        if (href) router.push(href);
      }),
    );

    void (async () => {
      let { receive } = await plugin.checkPermissions();
      if (receive === "prompt" || receive === "prompt-with-rationale") {
        ({ receive } = await plugin.requestPermissions());
      }
      if (receive === "granted" && !cancelled) await plugin.register();
    })().catch(() => {});

    return () => {
      cancelled = true;
      listeners.forEach((listener) => void listener.then((l) => l.remove()).catch(() => {}));
    };
  }, [router]);

  return null;
}
