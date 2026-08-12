"use client";

import { useEffect, useState } from "react";
import { CheckCircle, MoonStars } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import {
  HORARIO_COPY as C,
  NOMBRE_DIA,
  esVeinticuatroHoras,
  estadoDeApertura,
  type EstadoApertura,
  type Tramo,
} from "@/lib/horarios";
import { cn } from "@/lib/utils";

export interface HorarioEstadoProps {
  tramos: readonly Tramo[];
  timeZone: string;
  /** Calculado en el servidor: evita el parpadeo y el desajuste de hidratación. */
  estadoInicial: EstadoApertura;
  className?: string;
}

/** Un minuto: el estado cambia en el minuto, no antes. */
const REFRESCO_MS = 60_000;

/**
 * "Abierto ahora" / "Cerrado ahora".
 *
 * ── POR QUÉ ES UN COMPONENTE DE CLIENTE ─────────────────────────────────────
 * El estado lo calcula el servidor y llega ya resuelto, así que la primera
 * pintura no depende de JavaScript. Pero una ficha abierta en un teléfono queda
 * horas en pantalla, y a las 18:01 tiene que dejar de decir "Abierto". El
 * intervalo de un minuto recalcula con la MISMA función pura del servidor
 * (`lib/horarios`), no con una copia paralela de la regla.
 *
 * ── EL COLOR NO ES EL DATO ──────────────────────────────────────────────────
 * Verde y gris acompañan, no informan: cada estado lleva su palabra y su ícono.
 * Alguien que no distingue esos dos colores lee exactamente lo mismo.
 */
export function HorarioEstado({
  tramos,
  timeZone,
  estadoInicial,
  className,
}: HorarioEstadoProps) {
  const [estado, setEstado] = useState<EstadoApertura>(estadoInicial);

  useEffect(() => {
    const recalcular = () => setEstado(estadoDeApertura(tramos, timeZone, new Date()));
    recalcular();
    const id = window.setInterval(recalcular, REFRESCO_MS);
    return () => window.clearInterval(id);
  }, [tramos, timeZone]);

  if (estado.estado === "sin_horario" || estado.estado === "zona_desconocida") return null;

  if (estado.estado === "abierto") {
    const todoElDia = esVeinticuatroHoras(estado.tramo);
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <Chip variant="success" icon={<CheckCircle weight="fill" />}>
          {C.abierto}
        </Chip>
        <span className="text-sm text-foreground-secondary">
          {todoElDia ? C.veinticuatroHoras : C.cierraA(estado.cierraA)}
        </span>
      </div>
    );
  }

  const hoy = estado.abreDia !== null ? NOMBRE_DIA[estado.abreDia] : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Chip variant="neutral" icon={<MoonStars />}>
        {C.cerrado}
      </Chip>
      {estado.abreA && hoy && (
        <span className="text-sm text-foreground-secondary">{C.abreA(hoy, estado.abreA)}</span>
      )}
    </div>
  );
}
