"use client";

import { useState, useTransition } from "react";
import { NavigationArrow, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Spinner } from "@/components/ui";
import { usarMiUbicacion } from "@/lib/zona/actions";
import { ZONA_COPY as C } from "@/lib/zona";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * "USAR MI UBICACIÓN" — el atajo, no un canal nuevo de datos
 * =============================================================================
 *
 * Pedido del cliente: «en la ubicación, hace falta el compartir la ubicación».
 *
 * Lo que hace este botón es exactamente lo que la persona podría hacer sola:
 * elegir su barrio de la lista de abajo. Le ahorra buscarlo entre setenta
 * nombres, y nada más. Esa equivalencia es la que permite que la feature exista
 * sin tocar el diseño de privacidad de la app.
 *
 * ── LA PRECISIÓN SE BAJA ACÁ, ANTES DE SALIR DEL TELÉFONO ───────────────────
 * `enableHighAccuracy: false` y redondeo a tres decimales (~110 m). Los dos son
 * decisiones, no defaults por comodidad:
 *
 *   · el GPS fino tarda más, gasta batería y contesta con precisión de metros
 *     para una pregunta cuya respuesta más chica es un BARRIO. Pedirlo sería
 *     cobrarle a la persona una precisión que no vamos a usar.
 *   · redondear antes del `fetch` significa que la coordenada de tu casa no
 *     viaja por la red ni siquiera hacia nuestro propio servidor. El servidor la
 *     descarta igual (ver `usarMiUbicacion`), pero la defensa que no depende de
 *     que el otro lado se porte bien es la que vale.
 *
 * Tres decimales sobran para esto: los centroides del catálogo están a millas
 * unos de otros, así que 110 m no cambian nunca cuál queda más cerca.
 *
 * ── EL ERROR SE MUESTRA, SIEMPRE ────────────────────────────────────────────
 * Un permiso denegado con `catch {}` mudo es un botón que no hace nada: la
 * persona lo toca tres veces y concluye que la app está rota. Cada causa tiene
 * su mensaje, dice qué pasó y dónde se arregla, y la lista de barrios sigue
 * abierta abajo — la salida a mano nunca desaparece.
 */

/** El estado del pedido. `error` guarda el mensaje ya resuelto, no un código. */
type Estado =
  | { tipo: "idle" }
  | { tipo: "buscando" }
  | { tipo: "error"; mensaje: string };

/** Cuánto esperamos una posición antes de rendirnos y ofrecer la lista. */
const TIMEOUT_MS = 10_000;

/**
 * Una posición vieja de hasta cinco minutos sirve perfecto: nadie cambia de
 * barrio en cinco minutos, y reusar la del sistema evita encender el GPS.
 */
const MAX_AGE_MS = 5 * 60 * 1000;

/** ~110 m. Ver el docblock: es toda la precisión que esta feature necesita. */
const DECIMALES = 3;

function redondear(valor: number): number {
  const factor = 10 ** DECIMALES;
  return Math.round(valor * factor) / factor;
}

/**
 * `getCurrentPosition` con forma de promesa.
 *
 * Rechaza con el MENSAJE ya elegido —no con el error crudo del navegador— para
 * que el componente no tenga que conocer los códigos del `GeolocationError`, y
 * para que ningún objeto del navegador con la coordenada adentro sobreviva al
 * borde de esta función.
 */
function pedirPosicion(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // También cae acá un contexto inseguro (http://): el navegador ni expone
      // la API. El mensaje sirve igual — no hay nada que la persona pueda
      // activar, así que se la manda directo a la lista.
      reject(new Error(C.ubicacion.error.sinSoporte));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        resolve({
          lat: redondear(posicion.coords.latitude),
          lng: redondear(posicion.coords.longitude),
        });
      },
      (error) => {
        // Los códigos son los del estándar (1/2/3). Se leen de las constantes
        // del propio error y no a mano, que es lo que las hace legibles.
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error(C.ubicacion.error.denegado));
        } else if (error.code === error.TIMEOUT) {
          reject(new Error(C.ubicacion.error.demoro));
        } else {
          reject(new Error(C.ubicacion.error.noDisponible));
        }
      },
      {
        enableHighAccuracy: false,
        timeout: TIMEOUT_MS,
        maximumAge: MAX_AGE_MS,
      },
    );
  });
}

export interface ZonaUbicacionProps {
  /** Se llama con el barrio resuelto. La hoja lo usa para cerrarse y avisar. */
  onUbicado: (zona: string) => void;
  /** `true` mientras otra fila de la hoja está escribiendo la zona. */
  deshabilitada: boolean;
}

export function ZonaUbicacion({ onUbicado, deshabilitada }: ZonaUbicacionProps) {
  const [estado, setEstado] = useState<Estado>({ tipo: "idle" });
  const [, startTransition] = useTransition();

  const buscando = estado.tipo === "buscando";

  function ubicar() {
    setEstado({ tipo: "buscando" });
    startTransition(async () => {
      let punto: { lat: number; lng: number };
      try {
        punto = await pedirPosicion();
      } catch (error) {
        setEstado({
          tipo: "error",
          mensaje: error instanceof Error ? error.message : C.ubicacion.error.generico,
        });
        return;
      }

      const resultado = await usarMiUbicacion(punto);
      if (!resultado.ok) {
        setEstado({ tipo: "error", mensaje: resultado.mensaje });
        return;
      }
      setEstado({ tipo: "idle" });
      onUbicado(resultado.zona);
    });
  }

  return (
    <div className="mb-3">
      {/*
        Cápsula teñida y no un `<Button>` suelto: este control tiene la jerarquía
        más alta de la hoja —es el atajo que la hace valer la pena— pero no es la
        acción destructiva ni irreversible que justificaría el botón primario
        lleno. El tinte de marca lo separa de las filas neutras de abajo sin
        gritar. Los tokens salen del sistema (`brand-tint` / `brand-ink`); acá no
        se inventa ningún color.
      */}
      <button
        type="button"
        onClick={ubicar}
        disabled={deshabilitada || buscando}
        aria-label={C.ubicacion.boton}
        className={cn(
          "group flex min-h-11 w-full items-center gap-3 rounded-xl p-2.5 text-left",
          "bg-brand-tint ring-1 ring-brand-subtle",
          "transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-brand-tint/70 active:scale-[0.99]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          "disabled:pointer-events-none disabled:opacity-60",
        )}
      >
        {/*
          El ícono adentro de su propio círculo, igual que la anatomía de
          `FilaZona`: las dos listas de esta hoja tienen que leerse como una
          sola, y un ícono suelto acá rompería la columna de círculos.
        */}
        {/*
          Círculo BLANCO con la tinta de marca adentro, y no un relleno saturado
          con `text-brand-foreground`. Sobre la cápsula teñida, el blanco
          contrasta más que el brand lleno y se lee como una pastilla física
          apoyada encima — y de paso evita la tinta clara que en papel quedaría
          invisible (ver `src/test/print-contract.test.ts`).
        */}
        <span
          aria-hidden="true"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            "bg-surface text-brand-ink ring-1 ring-brand-subtle",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            "group-hover:scale-105",
          )}
        >
          {buscando ? <Spinner size={16} /> : <NavigationArrow size={18} weight="fill" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-brand-ink">
            {buscando ? C.ubicacion.buscando : C.ubicacion.boton}
          </span>
          {/*
            La ayuda contesta, sin que nadie tenga que preguntar, lo único que
            frena a alguien frente a este botón: qué se guarda. Va SIEMPRE
            visible y no detrás de un "?" — una promesa de privacidad escondida
            no tranquiliza a nadie.
          */}
          <span className="block text-xs leading-snug text-foreground-secondary">
            {C.ubicacion.ayuda}
          </span>
        </span>
      </button>

      {/*
        `aria-live="polite"`: el error aparece sin mover el foco, y el lector de
        pantalla lo anuncia igual. Sin esto, quien navega con VoiceOver toca el
        botón, no pasa nada audible y se queda sin saber que hubo un error.
      */}
      <p aria-live="polite" className="sr-only">
        {estado.tipo === "error" ? estado.mensaje : ""}
      </p>

      {estado.tipo === "error" && (
        <div
          className={cn(
            "mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2",
            "bg-danger-bg text-xs leading-relaxed text-danger",
          )}
        >
          <WarningCircle size={16} weight="fill" aria-hidden="true" className="mt-px shrink-0" />
          <span>{estado.mensaje}</span>
        </div>
      )}
    </div>
  );
}
