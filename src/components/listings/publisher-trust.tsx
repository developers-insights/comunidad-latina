"use client";

import { useState } from "react";
import Link from "next/link";
import { UserCircle } from "@phosphor-icons/react/dist/ssr";
import {
  TrustScoreBadge,
  TrustScoreSheet,
  type TrustLevel,
  type TrustSignal,
} from "@/components/trust";
import { buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";

const COPY = {
  /** Pedido textual de la call (1:02:24): "debería también salir ahí, ver perfil". */
  viewProfile: (firstName: string) => `Ver el perfil de ${firstName}`,
} as const;

export interface PublisherTrustProps {
  /** Nombre completo — el sheet usa el nombre de pila. */
  displayName: string;
  firstName: string;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
  size?: "inline" | "card";
  /**
   * Perfil de quien publica. SIN id no hay botón: un aviso de fuente externa
   * (seed/API) no tiene cuenta detrás, y un link a `/perfil/null` sería un 404
   * disfrazado de función.
   */
  profileId?: string | null;
  /**
   * VETO de privacidad, no afirmación — mismo patrón que
   * `eligible_for_short_feed`: el default es "se puede ver" y lo único que hace
   * esta bandera es APAGARLO. Es lo que pidió el cliente en la call: *"si ella
   * pone que no vean el perfil cuando pone anuncio, pues no va a salir"*.
   *
   * Modelarlo como veto y no como permiso importa: si fuera un permiso, una
   * pantalla que se olvidara de pasarlo escondería el botón en silencio y
   * nadie se enteraría. Como veto, olvidarse deja el comportamiento por
   * defecto —visible— y esconderlo requiere decirlo explícitamente.
   *
   * QUIÉN LO PASA: la pantalla que ya leyó el perfil de quien publica. Hoy
   * ninguna columna de `profiles` guarda esta preferencia (el módulo de
   * privacidad del perfil todavía no la creó); cuando exista, se cablea acá y
   * en ningún otro lado.
   */
  profileVisible?: boolean;
  className?: string;
}

/**
 * TrustScoreBadge del publicador + su desglose (TrustScoreSheet).
 * El badge SIEMPRE explica — nunca un número mudo (§3.3).
 *
 * El desglose termina con "Ver el perfil de…" (call del 29/7, 1:02:24). Ya NO
 * es el único camino al perfil: desde el 2026-09-30 el nombre y el avatar de
 * una persona llevan a su perfil en toda la app (`ProfileLink`), como en
 * cualquier red social. El botón de la hoja se queda porque en la card de un
 * aviso no hay nombre tocable —el badge convive con precio y CTA— y porque
 * llega justo después de leer por qué el número es el que es.
 */
export function PublisherTrust({
  firstName,
  score,
  level,
  signals,
  size = "inline",
  profileId = null,
  profileVisible = true,
  className,
}: PublisherTrustProps) {
  const [open, setOpen] = useState(false);
  const showProfileLink = Boolean(profileId) && profileVisible;

  return (
    <>
      <TrustScoreBadge
        score={score}
        level={level}
        size={size}
        onClick={() => setOpen(true)}
        className={className}
      />
      <TrustScoreSheet
        open={open}
        onClose={() => setOpen(false)}
        name={firstName}
        score={score}
        level={level}
        signals={signals}
        footer={
          showProfileLink ? (
            <Link
              href={`/perfil/${profileId}`}
              // Cerrar la hoja al tocar: la navegación desmonta esta card, pero
              // si el usuario vuelve con "atrás" la hoja no puede reaparecer
              // abierta sobre un aviso que él ya había dejado.
              onClick={() => setOpen(false)}
              className={cn(
                buttonVariants({ variant: "outline", size: "md" }),
                "w-full",
              )}
            >
              <UserCircle size={18} aria-hidden="true" />
              {COPY.viewProfile(firstName)}
            </Link>
          ) : null
        }
      />
    </>
  );
}
