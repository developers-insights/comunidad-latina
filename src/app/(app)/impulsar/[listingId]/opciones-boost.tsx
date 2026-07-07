"use client";

import { useState } from "react";
import { Star } from "@phosphor-icons/react/dist/ssr";
import {
  Badge,
  BezelCard,
  BottomSheet,
  Button,
  ProximamentePremium,
  useToast,
} from "@/components/ui";
import type { BoostId, BoostPackage } from "@/lib/stripe";
import { formatMoney } from "@/lib/utils";
import { crearBoostCheckout } from "./actions";

/** Copy local del módulo BOOST — no toca src/lib/i18n (compartido). */
const COPY = {
  pagoUnico: "pago único",
  recomendado: "El más elegido",
  elegir: (nombre: string) => `Impulsar por ${nombre}`,
  ariaProximamente: "Impulsos disponibles muy pronto",
  proximamenteFeature: "los impulsos",
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
} as const;

export function OpcionesBoost({
  listingId,
  paquetes,
  stripeConfigured,
}: {
  listingId: string;
  paquetes: BoostPackage[];
  stripeConfigured: boolean;
}) {
  const { toast } = useToast();
  const [loadingPaquete, setLoadingPaquete] = useState<BoostId | null>(null);
  const [proximamenteOpen, setProximamenteOpen] = useState(false);

  async function elegir(paquete: BoostId) {
    if (loadingPaquete) return;
    if (!stripeConfigured) {
      // HOY: Stripe no está → feedback premium inmediato; el intento se
      // registra en server (console.info) en paralelo.
      void crearBoostCheckout({ listingId, paquete });
      setProximamenteOpen(true);
      return;
    }
    setLoadingPaquete(paquete);
    try {
      const result = await crearBoostCheckout({ listingId, paquete });
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return; // mantiene el spinner hasta que navega
      }
      if (result.status === "sin_sesion") {
        window.location.assign(`/entrar?next=/impulsar/${listingId}`);
        return;
      }
      if (result.status === "no_configurado") {
        setProximamenteOpen(true);
      } else {
        toast({ title: result.message, variant: "danger" });
      }
    } catch {
      toast({ title: COPY.errorGenerico, variant: "danger" });
    }
    setLoadingPaquete(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {paquetes.map((paquete) => (
        <BezelCard
          key={paquete.id}
          variant={paquete.recomendado ? "featured" : "default"}
          coreClassName="flex flex-col gap-4 p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">
                {paquete.nombre}
              </h2>
              <p className="mt-0.5 text-sm text-foreground-secondary">
                {paquete.descripcion}
              </p>
            </div>
            {paquete.recomendado && (
              <Badge variant="brand" className="shrink-0">
                <Star size={12} weight="fill" aria-hidden="true" />
                {COPY.recomendado}
              </Badge>
            )}
          </div>

          <p className="flex items-baseline gap-1.5">
            <span className="numeric font-display text-3xl font-bold text-foreground">
              {formatMoney(paquete.precioUsd)}
            </span>
            <span className="text-sm text-foreground-secondary">{COPY.pagoUnico}</span>
          </p>

          <Button
            variant={paquete.recomendado ? "primary" : "outline"}
            size="lg"
            className="w-full"
            loading={loadingPaquete === paquete.id}
            onClick={() => elegir(paquete.id)}
          >
            {COPY.elegir(paquete.nombre)}
          </Button>
        </BezelCard>
      ))}

      {/* Stripe sin configurar (HOY) → estado premium, nunca un error crudo */}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel={COPY.ariaProximamente}
      >
        <ProximamentePremium feature={COPY.proximamenteFeature} />
      </BottomSheet>
    </div>
  );
}
