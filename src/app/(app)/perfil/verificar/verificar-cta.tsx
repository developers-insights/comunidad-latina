"use client";

import { useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import {
  BottomSheet,
  Button,
  ProximamentePremium,
  useToast,
} from "@/components/ui";
import { crearSesionIdentidad } from "./actions";

/** Copy local del módulo IDENTIDAD — no toca src/lib/i18n (compartido). */
const COPY = {
  cta: "Verificar mi identidad",
  ariaProximamente: "Verificación disponible muy pronto",
  proximamenteFeature: "la verificación de identidad",
  yaVerificado: "¡Tu identidad ya está verificada! Recargá la página para ver el tilde.",
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
} as const;

export function VerificarCta({ stripeConfigured }: { stripeConfigured: boolean }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [proximamenteOpen, setProximamenteOpen] = useState(false);

  async function verificar() {
    if (loading) return;
    if (!stripeConfigured) {
      // HOY: Stripe no está → feedback premium inmediato; el intento se
      // registra en server (console.info) en paralelo.
      void crearSesionIdentidad();
      setProximamenteOpen(true);
      return;
    }
    setLoading(true);
    try {
      const result = await crearSesionIdentidad();
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return; // mantiene el spinner hasta que navega a Stripe
      }
      if (result.status === "sin_sesion") {
        window.location.assign("/entrar?next=/perfil/verificar");
        return;
      }
      if (result.status === "no_configurado") {
        setProximamenteOpen(true);
      } else if (result.status === "ya_verificado") {
        toast({ title: COPY.yaVerificado, variant: "success" });
      } else {
        toast({ title: result.message, variant: "danger" });
      }
    } catch {
      toast({ title: COPY.errorGenerico, variant: "danger" });
    }
    setLoading(false);
  }

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={loading}
        onClick={verificar}
      >
        <ShieldCheck size={20} aria-hidden="true" />
        {COPY.cta}
      </Button>

      {/* Stripe sin configurar (HOY) → estado premium, nunca un error crudo */}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel={COPY.ariaProximamente}
      >
        <ProximamentePremium feature={COPY.proximamenteFeature} />
      </BottomSheet>
    </>
  );
}
