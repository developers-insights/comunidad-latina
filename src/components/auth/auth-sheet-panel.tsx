"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { availableOAuthProviders } from "@/app/(auth)/oauth-actions";
import type { OAuthProvider } from "@/lib/auth/oauth-providers";
import { CheckEmail } from "./check-email";
import { LoginForm } from "./login-form";
import { OAuthButtons } from "./oauth-buttons";
import { RegisterForm } from "./register-form";
import { AUTH_SHEET_COPY, type AuthSheetStep } from "./auth-sheet-copy";

/**
 * El CONTENIDO de la hoja de entrada — todo lo pesado vive acá.
 *
 * Está separado del provider a propósito, y el provider lo carga con
 * `React.lazy` recién cuando la hoja se abre. Sin ese corte, el `useRequireAuth`
 * de una card del feed arrastraría al bundle inicial los dos formularios de
 * auth, los botones de OAuth y sus server actions — para una pantalla que la
 * mayoría de las visitas (las que ya tienen sesión) no ve nunca.
 *
 * ── CERO AUTH PROPIA ─────────────────────────────────────────────────────────
 * Ni una llamada a Supabase acá adentro: se montan los formularios que ya
 * existen y hablan con las server actions de siempre. Un segundo camino de
 * credenciales sería un segundo lugar donde arreglar un bug de seguridad, y el
 * segundo siempre se olvida.
 */

const dividerLine = "h-px flex-1 bg-border-subtle";
const inlineLinkClass =
  "rounded-sm font-semibold text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring";

export interface AuthSheetPanelProps {
  step: AuthSheetStep;
  onStepChange: (step: AuthSheetStep) => void;
  /** Ruta interna a la que se vuelve por los caminos que salen del navegador. */
  destination: string;
  /** Sesión creada adentro de la hoja: cerrar, refrescar y reanudar. */
  onAuthenticated: () => void;
  /** Cerrar sin sesión. */
  onDismiss: () => void;
  registeredEmail?: string;
  onRegistered: (email: string) => void;
  /**
   * Proveedores ya resueltos por el servidor. Si no vienen, el panel los pide
   * al montarse — que es exactamente cuando la hoja se abre.
   */
  oauthProviders?: readonly OAuthProvider[];
}

export function AuthSheetPanel({
  step,
  onStepChange,
  destination,
  onAuthenticated,
  onDismiss,
  registeredEmail,
  onRegistered,
  oauthProviders,
}: AuthSheetPanelProps) {
  const [providers, setProviders] = useState<readonly OAuthProvider[]>(
    oauthProviders ?? [],
  );
  const asked = useRef(false);

  // Qué proveedor está disponible sale de env vars del SERVIDOR, así que hay
  // que preguntarlo. Se pregunta una sola vez, al abrir la hoja: en el arranque
  // de la app sería un round-trip que la enorme mayoría de las sesiones —las
  // que ya están adentro— no llega a usar.
  useEffect(() => {
    if (oauthProviders || asked.current) return;
    asked.current = true;
    void availableOAuthProviders()
      .then(setProviders)
      // Sin respuesta se queda vacío: la hoja pierde Google/Apple pero el
      // formulario de siempre sigue entero. Nunca un botón que no entra.
      .catch(() => undefined);
  }, [oauthProviders]);

  /**
   * Google y Apple ARRIBA — al revés que en /entrar, donde van abajo porque
   * quien llega ahí fue a entrar y la mayoría tiene contraseña. Acá la persona
   * no vino a entrar: vino a comentar y se topó con la puerta. Un toque es el
   * camino más corto que existe y el único que no le pide recordar nada.
   */
  const oauthBlock = providers.length > 0 && (
    <>
      <OAuthButtons providers={providers} next={destination} withDivider={false} />
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className={dividerLine} />
        <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          {AUTH_SHEET_COPY.or}
        </span>
        <span className={dividerLine} />
      </div>
    </>
  );

  if (step === "register") {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-foreground-secondary">
          {AUTH_SHEET_COPY.registerPromise}
        </p>
        {oauthBlock}
        <RegisterForm
          next={destination}
          // El link "¿Ya tenés cuenta?" navega a /entrar y sacaría a la persona
          // de la hoja: acá el cambio es de PASO, en la misma pantalla.
          hideLoginLink
          onSuccess={onRegistered}
        />
        <p className="text-center text-sm text-foreground-secondary">
          {AUTH_SHEET_COPY.toLoginPrompt}{" "}
          <button
            type="button"
            onClick={() => onStepChange("login")}
            className={inlineLinkClass}
          >
            {AUTH_SHEET_COPY.toLoginAction}
          </button>
        </p>
      </div>
    );
  }

  // Cuenta creada pero SIN sesión: Supabase la deja afuera hasta que toque el
  // enlace del correo. La acción pendiente ya se descartó — prometerle que la
  // retomamos sería mentirle: el enlace abre una pestaña nueva y este árbol de
  // React ya no existe cuando vuelve.
  if (step === "check-email") {
    return (
      <div className="flex flex-col gap-4">
        <CheckEmail email={registeredEmail} />
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={onDismiss}
        >
          {AUTH_SHEET_COPY.checkEmailBack}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-foreground-secondary">
        {AUTH_SHEET_COPY.promise}
      </p>
      {oauthBlock}
      <LoginForm
        next={destination}
        // Vacío a propósito: los botones ya se dibujaron arriba y LoginForm los
        // volvería a poner abajo.
        oauthProviders={[]}
        hideHeader
        onSuccess={onAuthenticated}
        onGoRegister={() => onStepChange("register")}
      />
    </div>
  );
}

export default AuthSheetPanel;
