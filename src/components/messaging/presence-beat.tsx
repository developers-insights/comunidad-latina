"use client";

import { useEffect } from "react";
import { MINIMO_ENTRE_TOQUES_MS } from "@/lib/messaging/presencia";
import { tocarPresenciaAction } from "@/app/(app)/mensajes/presencia-actions";

/**
 * EL LATIDO DE PRESENCIA — "esta persona está usando la app ahora".
 *
 * ─── EL RELOJ VIVE EN EL MÓDULO, NO EN EL COMPONENTE ────────────────────────
 * Y es la única razón por la que este archivo no es tres líneas. Con el último
 * toque guardado en un `useRef`, cada navegación entre pantallas de mensajería
 * monta un componente nuevo con el reloj en cero y dispara otro request: pasar
 * seis veces por la bandeja en un minuto serían seis viajes para un dato que
 * cambia una vez por minuto. En el módulo el reloj sobrevive al desmontaje, así
 * que el techo de "uno por minuto" es real y no por pantalla.
 *
 * ─── SÓLO CON LA PESTAÑA VISIBLE ────────────────────────────────────────────
 * Una pestaña olvidada en segundo plano seguiría diciendo "en línea" durante
 * horas. Eso no es un dato impreciso: es mentira sobre una persona, y la
 * mentira la paga quien del otro lado decide si escribe o no.
 */

let ultimoToque = 0;

function latir() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

  const ahora = Date.now();
  if (ahora - ultimoToque < MINIMO_ENTRE_TOQUES_MS) return;

  // Se marca ANTES de esperar la respuesta: si se marcara después, dos latidos
  // disparados con poca diferencia pasarían los dos el control mientras el
  // primero sigue viajando.
  ultimoToque = ahora;
  void tocarPresenciaAction().catch(() => {
    // Fallar acá no tiene remedio en el cliente. El próximo latido reintenta.
  });
}

export function PresenceBeat({
  intervalMs = MINIMO_ENTRE_TOQUES_MS,
}: {
  intervalMs?: number;
}) {
  useEffect(() => {
    latir();

    const id = window.setInterval(latir, intervalMs);
    // Volver a la pestaña es la señal más fuerte de que alguien está acá, y no
    // se puede esperar hasta el próximo tic: quien vuelve después de veinte
    // minutos figuraría desconectado durante el minuto que más importa.
    document.addEventListener("visibilitychange", latir);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", latir);
    };
  }, [intervalMs]);

  return null;
}
