"use client";

import { useState, useTransition } from "react";
import { BottomSheet, Button, ProximamentePremium } from "@/components/ui";
import { abrirPortalPresencia } from "./actions";

const COPY = {
  cta: "Gestionar o cancelar mi plan",
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  proximamenteFeature: "la gestión de tu plan",
} as const;

export function GestionarPlan() {
  const [abriendo, setAbriendo] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [proximamenteOpen, setProximamenteOpen] = useState(false);

  function abrir() {
    if (abriendo) return;
    setError(null);
    setAbriendo(true);
    startTransition(async () => {
      try {
        const result = await abrirPortalPresencia();
        switch (result.status) {
          case "redirect":
            // Queda ocupado a propósito hasta que la navegación a Stripe se lleve la página.
            window.location.assign(result.url);
            return;
          case "sin_sesion":
            window.location.assign(`/entrar?next=${encodeURIComponent("/negocios/presencia")}`);
            return;
          case "no_configurado":
            setProximamenteOpen(true);
            break;
          case "error":
            setError(result.message);
            break;
        }
      } catch {
        setError(COPY.errorGenerico);
      }
      setAbriendo(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="lg" className="w-full" loading={abriendo} onClick={abrir}>
        {COPY.cta}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger-ink">
          {error}
        </p>
      )}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel="Gestión del plan disponible muy pronto"
      >
        <ProximamentePremium feature={COPY.proximamenteFeature} />
      </BottomSheet>
    </div>
  );
}
