"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AppleLogo, GoogleLogo } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { startOAuthAction } from "@/app/(auth)/oauth-actions";
import { OAUTH_LABEL, type OAuthProvider } from "@/lib/auth/oauth-providers";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui";

/**
 * Entrar con Google o con Apple.
 *
 * ── SIN CREDENCIALES, EL BOTÓN NO EXISTE ─────────────────────────────────────
 * `providers` llega desde el servidor (`availableOAuthProviders()`), que mira
 * las env vars. Un array vacío devuelve `null` y la pantalla queda exactamente
 * como estaba. NO se dibuja un botón deshabilitado ni uno con "próximamente":
 * un método de entrada que se ve pero no entra es peor que no ofrecerlo, porque
 * la persona lo intenta primero y recién después busca el formulario.
 *
 * ── EL AVISO LEGAL VA ACÁ, NO EN UNA CASILLA ─────────────────────────────────
 * El alta por email tiene dos checkboxes (18+ y condiciones) porque ahí la
 * persona está completando un formulario y tildar es parte del gesto. Con OAuth
 * el gesto es UN toque que se va a otra pantalla: meter dos casillas antes
 * rompería lo único que estos botones aportan. Va entonces el patrón estándar —
 * la declaración visible, con los tres enlaces reales, pegada a los botones— y
 * el sello legal se escribe en el servidor al crear el perfil, con el mismo
 * formato que el alta por email (ver lib/auth/provision.ts).
 */

const COPY = {
  divider: "o",
  legalPrefix: "Al continuar confirmás que tenés 18 años o más y aceptás los",
  legalTerms: "Términos",
  legalPrivacyJoin: ", la",
  legalPrivacy: "Política de Privacidad",
  legalNormsJoin: "y las",
  legalNorms: "Normas de la Comunidad",
} as const;

const PROVIDER_ICON: Record<OAuthProvider, Icon> = {
  google: GoogleLogo,
  apple: AppleLogo,
};

const legalLinkClass =
  "rounded-sm font-medium text-brand-ink underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring";

export interface OAuthButtonsProps {
  /** Los que tienen credenciales HOY. Vacío = no se dibuja nada. */
  providers: readonly OAuthProvider[];
  /** Ruta interna a la que aterriza al volver. */
  next?: string;
  /** Separador "o" arriba de los botones. Se apaga cuando van solos. */
  withDivider?: boolean;
}

export function OAuthButtons({ providers, next, withDivider = true }: OAuthButtonsProps) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) return null;

  function go(provider: OAuthProvider) {
    setError(null);
    setBusy(provider);
    startTransition(async () => {
      const result = await startOAuthAction({ provider, ...(next ? { next } : {}) });
      if (!result.ok) {
        setBusy(null);
        setError(result.message);
        return;
      }
      // Navegación DURA y no `router.push`: el destino es el dominio del
      // proveedor, o sea fuera de la app. `assign` y no `replace` para que el
      // botón "atrás" del teléfono devuelva a la pantalla de entrada, que es lo
      // que espera quien se arrepiente a mitad de camino.
      window.location.assign(result.url);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {withDivider && (
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-border-subtle" />
          <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            {COPY.divider}
          </span>
          <span className="h-px flex-1 bg-border-subtle" />
        </div>
      )}

      <FormError>{error}</FormError>

      <div className="flex flex-col gap-2">
        {providers.map((provider) => {
          const ProviderIcon = PROVIDER_ICON[provider];
          return (
            <Button
              key={provider}
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              loading={pending && busy === provider}
              // Los demás quedan bloqueados mientras uno está en vuelo: dos
              // pedidos de OAuth en paralelo pisan el mismo code verifier de
              // PKCE en la cookie y el segundo rompe al primero.
              disabled={pending && busy !== provider}
              onClick={() => go(provider)}
            >
              <ProviderIcon size={20} weight="fill" aria-hidden="true" />
              {OAUTH_LABEL[provider]}
            </Button>
          );
        })}
      </div>

      <p className="text-center text-xs leading-relaxed text-foreground-muted">
        {COPY.legalPrefix}{" "}
        <Link href="/legal/terminos" target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
          {COPY.legalTerms}
        </Link>
        {COPY.legalPrivacyJoin}{" "}
        <Link href="/legal/privacidad" target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
          {COPY.legalPrivacy}
        </Link>{" "}
        {COPY.legalNormsJoin}{" "}
        <Link href="/legal/normas" target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
          {COPY.legalNorms}
        </Link>
        .
      </p>
    </div>
  );
}
