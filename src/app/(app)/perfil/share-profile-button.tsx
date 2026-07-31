"use client";

import { useState } from "react";
import { ShareNetwork } from "@phosphor-icons/react";
import { Button, useToast } from "@/components/ui";

const COPY = {
  action: "Compartir perfil",
  /** Título del panel nativo de compartir. */
  shareTitle: (name: string) => `Perfil de ${name} en Comunidad Latina`,
  copied: "Listo, copiamos el enlace",
  copiedBody: "Ya lo podés pegar donde quieras.",
  failed: "No pudimos copiar el enlace",
  failedBody: "Probá de nuevo, o copialo desde la barra del navegador.",
} as const;

export interface ShareProfileButtonProps {
  /** Ruta del perfil ("/perfil/<id>"). Se absolutiza con el origin real. */
  path: string;
  displayName: string;
}

/**
 * "Compartir perfil" (contrato 2026-07-30 §B.5).
 *
 * Dos caminos, y el orden importa:
 *  1. `navigator.share` — en el teléfono abre la hoja del sistema (WhatsApp,
 *     mensajes, lo que la persona tenga). Es lo que el cliente espera cuando
 *     dice "compartir": el destino lo elige la gente, no nosotros.
 *  2. Portapapeles — el escritorio casi nunca tiene Web Share; ahí copiar el
 *     enlace y DECIRLO con un toast es la acción honesta.
 *
 * La URL se arma con `window.location.origin` y NO con una env var: la app es
 * multi-tenant por dominio, así que el enlace correcto es el del dominio por el
 * que la persona entró. Con `NEXT_PUBLIC_SITE_URL` compartiríamos el link de
 * otro tenant.
 *
 * `AbortError` es cuando la persona cierra la hoja del sistema. Eso NO es un
 * fallo y no dispara ningún toast: avisar "no se pudo compartir" porque alguien
 * se arrepintió es ruido.
 *
 * No lleva datos personales en la URL (§Privacidad): comparte la ruta pública
 * del perfil, la misma que ya es visible para cualquier miembro del tenant.
 */
export function ShareProfileButton({ path, displayName }: ShareProfileButtonProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function share() {
    if (busy) return;
    setBusy(true);
    const url = `${window.location.origin}${path}`;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: COPY.shareTitle(displayName), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: COPY.copied, description: COPY.copiedBody, variant: "success" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast({ title: COPY.failed, description: COPY.failedBody, variant: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="md" onClick={share} disabled={busy}>
      <ShareNetwork size={16} aria-hidden="true" />
      {COPY.action}
    </Button>
  );
}
