"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Script from "next/script";
import { Spinner } from "@/components/ui";
import { useTheme } from "@/components/theme";
import { createClient } from "@/lib/supabase/client";
import { finalizeGoogleSignInAction } from "@/app/(auth)/oauth-actions";
import { randomNonce, sha256Hex, supportsGoogleIdentity } from "./google-nonce";
import styles from "./oauth-buttons.module.css";

/**
 * "Continuar con Google" con Google Identity Services. El flujo corre en
 * NUESTRO origen, así que la pantalla de Google muestra comunidadlatina.com y
 * no `<ref>.supabase.co` (que es lo que muestra el redirect de
 * `signInWithOAuth`, porque el redirect_uri es el de Supabase).
 *
 * Si GIS no carga (bloqueador, red, navegador sin `crypto.subtle`) en
 * `LOAD_TIMEOUT_MS`, queda el botón de siempre (`fallback`), que usa el
 * redirect. El login nunca depende de este script.
 */

const GSI_SRC = "https://accounts.google.com/gsi/client";
const LOAD_TIMEOUT_MS = 4000;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

const COPY = {
  signing: "Entrando con Google…",
  providerFailed:
    "Google no pudo confirmarnos quién sos. Probá de nuevo, o entrá con tu email y contraseña.",
  finalizeFailed:
    "No pudimos terminar de entrar. Probá de nuevo en un momento, o entrá con tu email.",
} as const;

interface CredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize: (config: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  cancel: () => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

const noopSubscribe = () => () => {};

function gisApi(): GoogleAccountsId | null {
  return typeof window === "undefined" ? null : (window.google?.accounts?.id ?? null);
}

type Status = "loading" | "ready" | "failed";

export interface GoogleIdentityButtonProps {
  clientId: string;
  /** Ya saneado del lado del servidor; la action lo vuelve a sanear. */
  next?: string;
  /** El botón por redirect: se ve mientras GIS carga y queda si GIS falla. */
  fallback: ReactNode;
  /** Otro proveedor está en vuelo: este no acepta toques. */
  blocked?: boolean;
  onPendingChange: (pending: boolean) => void;
  onError: (message: string | null) => void;
}

export function GoogleIdentityButton({
  clientId,
  next,
  fallback,
  blocked = false,
  onPendingChange,
  onError,
}: GoogleIdentityButtonProps) {
  const { resolvedTheme } = useTheme();
  const slotRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rawNonceRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const [scriptLoaded, setScriptLoaded] = useState(() => gisApi() !== null);
  // El servidor no sabe si el navegador soporta GIS: asume que sí y la
  // hidratación corrige sin mismatch.
  const supported = useSyncExternalStore(noopSubscribe, supportsGoogleIdentity, () => true);
  const [status, setStatus] = useState<Status>("loading");
  const [pending, setPending] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  const setBusy = useCallback(
    (value: boolean) => {
      inFlightRef.current = value;
      setPending(value);
      onPendingChange(value);
    },
    [onPendingChange],
  );

  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      if (inFlightRef.current) return;
      const rawNonce = rawNonceRef.current;
      if (!response.credential || !rawNonce) {
        onError(COPY.providerFailed);
        return;
      }
      onError(null);
      setBusy(true);

      const supabase = createClient();
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
        nonce: rawNonce,
      });
      if (error) {
        console.error("[auth] google gis: signInWithIdToken falló", { code: error.code });
        setBusy(false);
        onError(COPY.providerFailed);
        // El nonce ya viajó en un token: el próximo intento usa uno nuevo.
        setRenderKey((k) => k + 1);
        return;
      }

      let result: Awaited<ReturnType<typeof finalizeGoogleSignInAction>>;
      try {
        result = await finalizeGoogleSignInAction(next ? { next } : {});
      } catch (thrown) {
        console.error("[auth] google gis: la action no respondió", {
          message: thrown instanceof Error ? thrown.message : "desconocido",
        });
        await supabase.auth.signOut();
        setBusy(false);
        onError(COPY.finalizeFailed);
        setRenderKey((k) => k + 1);
        return;
      }

      if (!result.ok) {
        setBusy(false);
        onError(result.message);
        setRenderKey((k) => k + 1);
        return;
      }
      // Navegación dura: las cookies de sesión recién escritas tienen que llegar
      // al servidor en el próximo render, y el `busy` queda puesto hasta que la
      // página se vaya (sin esto, un segundo toque dispara otra vuelta).
      window.location.assign(result.redirectTo);
    },
    [next, onError, setBusy],
  );

  const handleCredentialRef = useRef(handleCredential);
  useEffect(() => {
    handleCredentialRef.current = handleCredential;
  }, [handleCredential]);

  useEffect(() => {
    if (status !== "loading" || !supported) return;
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "failed" : current));
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [status, supported]);

  useEffect(() => {
    const api = gisApi();
    const slot = slotRef.current;
    const host = hostRef.current;
    if (!supported || !scriptLoaded || status === "failed" || !api || !slot || !host) return;

    let cancelled = false;
    const rawNonce = randomNonce();

    void sha256Hex(rawNonce)
      .then((hashedNonce) => {
        if (cancelled) return;
        rawNonceRef.current = rawNonce;
        api.initialize({
          client_id: clientId,
          nonce: hashedNonce,
          callback: (response: CredentialResponse) => void handleCredentialRef.current(response),
          ux_mode: "popup",
          context: "signin",
          itp_support: true,
          use_fedcm_for_prompt: true,
          use_fedcm_for_button: true,
        });
        const width = Math.round(
          Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, slot.getBoundingClientRect().width)),
        );
        host.replaceChildren();
        api.renderButton(host, {
          type: "standard",
          theme: resolvedTheme === "dark" ? "filled_black" : "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          locale: "es",
          width,
        });
        setStatus(host.childElementCount > 0 ? "ready" : "failed");
      })
      .catch((thrown: unknown) => {
        console.error("[auth] google gis: no se pudo inicializar", {
          message: thrown instanceof Error ? thrown.message : "desconocido",
        });
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
    // `status` no va: cambiar a "ready" no tiene que volver a dibujar el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, scriptLoaded, clientId, resolvedTheme, renderKey]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof ResizeObserver === "undefined") return;
    let lastWidth = slot.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? lastWidth;
      if (Math.abs(width - lastWidth) < 16 || inFlightRef.current) return;
      lastWidth = width;
      setRenderKey((k) => k + 1);
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => gisApi()?.cancel(), []);

  if (!supported || status === "failed") return <>{fallback}</>;

  const ready = status === "ready";

  return (
    <>
      <Script
        src={GSI_SRC}
        strategy="afterInteractive"
        onReady={() => setScriptLoaded(true)}
        onError={() => setStatus("failed")}
      />
      <div ref={slotRef} className={styles.gisSlot} aria-busy={pending || undefined}>
        {!ready && fallback}
        <div
          ref={hostRef}
          className={ready ? styles.gisHost : styles.gisHostLoading}
          aria-hidden={ready ? undefined : true}
          inert={!ready || pending || blocked}
        />
        {pending && (
          <div className={styles.gisPending} role="status">
            <Spinner size={20} />
            <span>{COPY.signing}</span>
          </div>
        )}
      </div>
    </>
  );
}
