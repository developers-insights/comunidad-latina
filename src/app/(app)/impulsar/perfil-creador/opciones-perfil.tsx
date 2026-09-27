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
import { formatCents } from "@/lib/pricing";
import type { BoostId } from "@/lib/stripe";
import { crearImpulsoDePerfilCheckout } from "./actions";

const COPY = {
  pagoUnico: "pago único",
  recomendado: "El más elegido",
  elegir: (nombre: string) => `Promocionar ${nombre}`,
  ariaProximamente: "La promoción de perfiles llega muy pronto",
  proximamenteFeature: "la promoción de tu perfil",
  errorGenerico: "No pudimos abrir el pago. Revisá tu conexión y probá de nuevo.",
} as const;

export interface PaquetePerfil {
  id: BoostId;
  nombre: string;
  descripcion: string;
  recomendado: boolean;
  amountCents: number | null;
  currency: string;
}

export function OpcionesPerfil({
  paquetes,
  stripeConfigured,
}: {
  paquetes: PaquetePerfil[];
  stripeConfigured: boolean;
}) {
  const { toast } = useToast();
  const [cargando, setCargando] = useState<BoostId | null>(null);
  const [proximamente, setProximamente] = useState(false);

  async function elegir(paquete: BoostId) {
    if (cargando) return;
    if (!stripeConfigured) {
      void crearImpulsoDePerfilCheckout({ paquete });
      setProximamente(true);
      return;
    }
    setCargando(paquete);
    try {
      const result = await crearImpulsoDePerfilCheckout({ paquete });
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return;
      }
      if (result.status === "sin_sesion") {
        window.location.assign("/entrar?next=/impulsar/perfil-creador");
        return;
      }
      if (result.status === "no_configurado") setProximamente(true);
      else toast({ title: result.message, variant: "danger" });
    } catch {
      toast({ title: COPY.errorGenerico, variant: "danger" });
    }
    setCargando(null);
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {paquetes.map((paquete) => (
          <BezelCard
            key={paquete.id}
            variant={paquete.recomendado ? "featured" : "default"}
            coreClassName="flex flex-col gap-4 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-foreground">{paquete.nombre}</h3>
                <p className="mt-0.5 text-sm text-foreground-secondary">{paquete.descripcion}</p>
              </div>
              {paquete.recomendado && (
                <Badge variant="brand" className="shrink-0">
                  <Star size={12} weight="fill" aria-hidden="true" />
                  {COPY.recomendado}
                </Badge>
              )}
            </div>

            {paquete.amountCents !== null && (
              <p className="flex items-baseline gap-1.5">
                <span className="numeric font-display text-3xl font-bold text-foreground">
                  {formatCents(paquete.amountCents, paquete.currency)}
                </span>
                <span className="text-sm text-foreground-secondary">{COPY.pagoUnico}</span>
              </p>
            )}

            <Button
              variant={paquete.recomendado ? "primary" : "outline"}
              size="lg"
              className="w-full"
              loading={cargando === paquete.id}
              disabled={cargando !== null && cargando !== paquete.id}
              onClick={() => elegir(paquete.id)}
            >
              {COPY.elegir(paquete.nombre)}
            </Button>
          </BezelCard>
        ))}
      </div>

      <BottomSheet
        open={proximamente}
        onClose={() => setProximamente(false)}
        ariaLabel={COPY.ariaProximamente}
      >
        <ProximamentePremium feature={COPY.proximamenteFeature} />
      </BottomSheet>
    </>
  );
}
