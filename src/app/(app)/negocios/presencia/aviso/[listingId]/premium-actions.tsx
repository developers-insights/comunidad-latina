"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet, Button, ProximamentePremium } from "@/components/ui";
import { MONETIZATION_COPY } from "@/lib/monetization";
import { abrirPortalPremiumAviso, activarPremiumAviso } from "./actions";

/**
 * Botonera del premium de un aviso: pasar a premium / volver a premium, y ver
 * los pagos.
 *
 * Client component mínimo — todo lo que se puede pintar en el servidor (estado,
 * fecha, qué incluye, el precio) lo pinta la página. Acá vive sólo lo que
 * necesita un evento de la persona.
 *
 * Degradación elegante (§5.6): sin credenciales de Stripe la action devuelve
 * `no_configurado` y se abre `<ProximamentePremium>`. HOY eso NO es un caso
 * teórico —producción no tiene ninguna variable de Stripe—, así que este es
 * literalmente el camino que la gente va a ver: el botón nunca rompe, nunca
 * queda muerto y nunca muestra un error técnico.
 *
 * "Cancelar" no vive acá adentro: se hace en el portal de Stripe, que es donde
 * la persona también cambia la tarjeta y reanuda. Prometemos "cancelás cuando
 * quieras", así que la salida está a un toque y con ese nombre.
 */
export function PremiumActions({
  listingId,
  canActivate,
  canManage,
  activateLabel,
}: {
  listingId: string;
  /** Ofrecer un Checkout NUEVO (lo decide `premiumPresentation`). */
  canActivate: boolean;
  /** Ya hay un customer en Stripe ⇒ tiene sentido ofrecer el portal. */
  canManage: boolean;
  activateLabel: string;
}) {
  const router = useRouter();
  const C = MONETIZATION_COPY.premium;
  const [proximamenteOpen, setProximamenteOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"activate" | "manage" | null>(null);
  const [, startTransition] = useTransition();

  function run(action: "activate" | "manage") {
    if (pendingAction) return;
    setErrorMessage(null);
    setPendingAction(action);

    startTransition(async () => {
      const result =
        action === "activate"
          ? await activarPremiumAviso({ listingId })
          : await abrirPortalPremiumAviso({ listingId });

      switch (result.status) {
        case "redirect":
          // Se sale a Stripe: no se limpia `pendingAction` a propósito, el botón
          // queda ocupado hasta que la navegación se lleva la página.
          window.location.assign(result.url);
          return;
        case "no_configurado":
          setProximamenteOpen(true);
          break;
        case "sin_sesion":
          router.push(
            `/entrar?next=${encodeURIComponent(`/negocios/presencia/aviso/${listingId}`)}`,
          );
          return;
        case "error":
          setErrorMessage(result.message);
          break;
      }
      setPendingAction(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {errorMessage && (
        <p role="alert" className="text-sm font-medium text-danger-ink">
          {errorMessage}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canActivate && (
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            loading={pendingAction === "activate"}
            onClick={() => run("activate")}
          >
            {activateLabel}
          </Button>
        )}
        {canManage && (
          <Button
            variant="outline"
            size="lg"
            className="flex-1"
            loading={pendingAction === "manage"}
            onClick={() => run("manage")}
          >
            {C.manageCta}
          </Button>
        )}
      </div>

      {canManage && <p className="text-xs text-foreground-muted">{C.manageHint}</p>}

      {/* Stripe sin configurar (HOY, en producción) → estado premium, nunca un
          error crudo. */}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel="Los pagos, muy pronto"
      >
        <ProximamentePremium feature={C.proximamenteFeature} />
      </BottomSheet>
    </div>
  );
}
