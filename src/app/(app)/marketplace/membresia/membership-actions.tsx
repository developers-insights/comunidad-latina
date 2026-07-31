"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet, Button, ProximamentePremium } from "@/components/ui";
import { COPY } from "@/components/marketplace";
import { activarMembresiaTienda, abrirPortalMembresia } from "./actions";

/**
 * Botonera de la membresía: activar / reactivar y gestionar-o-cancelar.
 *
 * Client component mínimo — todo lo que se puede pintar en el servidor (estado,
 * fecha, qué incluye) lo pinta `<MembershipStatusCard>`. Acá vive sólo lo que
 * necesita un evento del usuario.
 *
 * Degradación elegante (§5.6): sin credenciales de Stripe la action devuelve
 * `no_configurado` y se abre `<ProximamentePremium>` — el botón NUNCA rompe ni
 * muestra un error técnico. Es exactamente el mismo camino que usa /impulsar.
 *
 * "Cancelar" no vive acá adentro: se hace en el portal de Stripe, que es donde
 * la persona también cambia la tarjeta. Prometemos "cancelás cuando quieras",
 * así que la salida está a un toque y con ese nombre — no escondida.
 */
export function MembershipActions({
  storeId,
  canActivate,
  hasBilling,
}: {
  storeId: string;
  /** Ofrecer activar/reactivar (lo decide `membershipPresentation`). */
  canActivate: boolean;
  /** Ya existe un customer en Stripe ⇒ tiene sentido ofrecer el portal. */
  hasBilling: boolean;
}) {
  const router = useRouter();
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
          ? await activarMembresiaTienda({ storeId })
          : await abrirPortalMembresia({ storeId });

      switch (result.status) {
        case "redirect":
          // Se sale a Stripe: no se limpia `pendingAction` a propósito, el
          // botón queda ocupado hasta que la navegación se lleva la página.
          window.location.assign(result.url);
          return;
        case "no_configurado":
          setProximamenteOpen(true);
          break;
        case "sin_sesion":
          router.push(`/entrar?next=${encodeURIComponent("/marketplace/membresia")}`);
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
            size="md"
            className="flex-1"
            loading={pendingAction === "activate"}
            onClick={() => run("activate")}
          >
            {hasBilling ? COPY.membership.reactivateCta : COPY.membership.activateCta}
          </Button>
        )}
        {hasBilling && (
          <Button
            variant="outline"
            size="md"
            className="flex-1"
            loading={pendingAction === "manage"}
            onClick={() => run("manage")}
          >
            {COPY.membership.manageCta}
          </Button>
        )}
      </div>

      {hasBilling && (
        <p className="text-xs text-foreground-muted">{COPY.membership.manageHint}</p>
      )}

      {/* Stripe sin configurar (HOY) → estado premium, nunca un error crudo. */}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel="Los pagos, muy pronto"
      >
        <ProximamentePremium feature="los pagos de la membresía" />
      </BottomSheet>
    </div>
  );
}
