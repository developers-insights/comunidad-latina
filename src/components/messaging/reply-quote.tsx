"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { ACCIONES_COPY } from "./copy-acciones";

/**
 * =============================================================================
 * RESPONDER CITANDO — la cita, y el contrato que consume el composer
 * =============================================================================
 *
 * Tres piezas que van juntas:
 *
 *   · `ResponderProvider` / `useResponder` — quién está siendo citado ahora
 *     mismo. Vive en un contexto porque quien ELIGE responder (el menú de un
 *     mensaje, en el medio del hilo) y quien lo USA (el composer, abajo de
 *     todo) son dos islas lejanas: pasarlo por props significaría atravesar la
 *     página entera con un estado que sólo le importa a dos componentes.
 *   · `ComposerReplyBar` — la tira de "Respondiendo a…" con su X. La monta el
 *     composer arriba del campo de texto.
 *   · `ReplyQuote` — la cita adentro de la burbuja ya enviada. Tocarla lleva al
 *     mensaje original.
 *
 * ─── EL MENSAJE CITADO TIENE QUE SER DEL MISMO HILO ─────────────────────────
 * Lo exigen los triggers `app.validar_respuesta_de_mensaje_*` (0136 §4). Acá no
 * se vuelve a chequear porque no se puede: el contexto sólo conoce el mensaje
 * que se tocó, y ese siempre es del hilo que está en pantalla. Si alguna vez
 * llegara uno de otro, la base lo rechaza con `REPLY_OUT_OF_THREAD`.
 */

export interface MensajeCitado {
  /** Va tal cual a `reply_to`. */
  id: string;
  autorNombre: string;
  /** Lo escribí yo: cambia el encabezado ("tu mensaje" en vez del nombre). */
  esPropio: boolean;
  /** Una línea de lo que dice. Ya resumido — ver `resumenDeMensaje`. */
  resumen: string;
}

interface ResponderState {
  citado: MensajeCitado | null;
  responderA: (mensaje: MensajeCitado) => void;
  cancelar: () => void;
}

const ResponderContext = createContext<ResponderState | null>(null);

/**
 * Lo monta la PÁGINA del hilo, envolviendo la lista de mensajes y el composer.
 * Fuera del provider, `useResponder()` devuelve null y el menú simplemente no
 * ofrece "Responder": ninguna pantalla se rompe por no montarlo.
 */
export function ResponderProvider({ children }: { children: ReactNode }) {
  const [citado, setCitado] = useState<MensajeCitado | null>(null);

  const responderA = useCallback((mensaje: MensajeCitado) => {
    setCitado(mensaje);
    /**
     * El foco va al campo de texto en el mismo gesto: elegir "Responder" y
     * tener que tocar el composat después son dos toques para una intención.
     * Se busca por `data-composer` para no atarse al id que genere el composer,
     * que es de otro dueño.
     */
    requestAnimationFrame(() => {
      const campo = document.querySelector<HTMLElement>("[data-composer-input]");
      campo?.focus();
    });
  }, []);

  const cancelar = useCallback(() => setCitado(null), []);

  const valor = useMemo(
    () => ({ citado, responderA, cancelar }),
    [cancelar, citado, responderA],
  );

  return <ResponderContext.Provider value={valor}>{children}</ResponderContext.Provider>;
}

export function useResponder(): ResponderState | null {
  return useContext(ResponderContext);
}

// ---------------------------------------------------------------------------
// Cómo se resume un mensaje citado
// ---------------------------------------------------------------------------

/** Cuántos caracteres del original entran en la cita. */
export const MAX_RESUMEN = 120;

/**
 * QUÉ SE LEE EN LA CITA cuando el mensaje no es texto. Un mensaje de foto tiene
 * `body` vacío por contrato (0136 §2), así que sin esto la cita de una foto
 * sería una tira en blanco.
 */
export function resumenDeMensaje(kind: string, body: string, bajado = false): string {
  if (bajado) return ACCIONES_COPY.responder.resumenBajado;

  const texto = body.trim().replace(/\s+/g, " ");
  if (texto) {
    return texto.length > MAX_RESUMEN ? `${texto.slice(0, MAX_RESUMEN - 1)}…` : texto;
  }

  switch (kind) {
    case "imagen":
      return ACCIONES_COPY.responder.resumenFoto;
    case "video":
      return ACCIONES_COPY.responder.resumenVideo;
    case "audio":
      return ACCIONES_COPY.responder.resumenAudio;
    case "archivo":
      return ACCIONES_COPY.responder.resumenArchivo;
    case "ubicacion":
      return ACCIONES_COPY.responder.resumenUbicacion;
    case "perfil":
      return ACCIONES_COPY.responder.resumenPerfil;
    default:
      return ACCIONES_COPY.responder.resumenContenido;
  }
}

/**
 * El `id` del DOM de una burbuja. Lo pone la burbuja y lo busca la cita: es el
 * único acuerdo entre las dos, y por eso vive en una función y no escrito a
 * mano en los dos lados.
 */
export function anclaDeMensaje(mensajeId: string): string {
  return `mensaje-${mensajeId}`;
}

/**
 * Lleva al mensaje original y lo marca un momento.
 *
 * El destaque es un atributo (`data-destacado`) y no una animación: la burbuja
 * ya trae el estilo, aparece y se va. Lo que SÍ se anima es un latido de escala
 * —sólo `transform`, vía WAAPI para que el navegador lo limpie solo— y se apaga
 * entero con `prefers-reduced-motion`, donde el destaque alcanza.
 */
export function irAlMensaje(mensajeId: string): boolean {
  if (typeof document === "undefined") return false;
  const destino = document.getElementById(anclaDeMensaje(mensajeId));
  if (!destino) return false;

  destino.scrollIntoView({ behavior: "smooth", block: "center" });
  destino.dataset.destacado = "true";
  window.setTimeout(() => {
    delete destino.dataset.destacado;
  }, 1400);

  const quietito = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!quietito) {
    destino.animate?.(
      [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }],
      { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// La cita adentro de la burbuja
// ---------------------------------------------------------------------------

/**
 * LO QUE SE RESPONDIÓ, ARRIBA DE LA RESPUESTA.
 *
 * Es un `<button>` y no un `<div>` con `onClick`: se llega con Tab, se activa
 * con Enter, y un lector de pantalla lo anuncia como lo que es. Tocarlo sube al
 * original — que es lo que la gente intenta hacer aunque nadie se lo diga.
 */
export function ReplyQuote({
  citado,
  isOwn,
  className,
}: {
  citado: MensajeCitado;
  isOwn: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => irAlMensaje(citado.id)}
      aria-label={ACCIONES_COPY.responder.irAlOriginal(
        citado.esPropio ? ACCIONES_COPY.reacciones.vos : citado.autorNombre,
      )}
      className={cn(
        "mb-1.5 flex w-full items-stretch gap-2 overflow-hidden rounded-lg py-1 pl-0 pr-2 text-left",
        "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        isOwn ? "bg-canvas/45 hover:bg-canvas/65" : "bg-canvas/55 hover:bg-canvas/75",
        className,
      )}
    >
      {/* La barrita de la izquierda es lo que hace que se lea como una cita
          antes de leer una sola palabra. */}
      <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full bg-brand" />
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block truncate text-[11px] font-semibold text-brand-ink">
          {citado.esPropio ? ACCIONES_COPY.reacciones.vos : citado.autorNombre}
        </span>
        <span className="block truncate text-xs text-foreground-secondary">
          {citado.resumen}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// La tira de "Respondiendo a…" para el composer
// ---------------------------------------------------------------------------

/**
 * LO ÚNICO QUE EL COMPOSER TIENE QUE MONTAR.
 *
 * Se dibuja sola cuando hay un mensaje citado y desaparece cuando no. El
 * composer no necesita saber nada más que esto y `useResponder().citado?.id`
 * para mandarlo como `reply_to`.
 */
export function ComposerReplyBar({ className }: { className?: string }) {
  const responder = useResponder();
  const reduceMotion = useReducedMotion();
  const citado = responder?.citado ?? null;

  return (
    <AnimatePresence initial={false}>
      {citado && (
        <m.div
          key={citado.id}
          // Alto animado con `height: auto` de motion: es la única forma de que
          // el composer no salte cuando la tira aparece. Se anima el contenedor,
          // no su contenido (una entrada por contenedor, dice la doctrina).
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, y: 6 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto", y: 0 }}
          exit={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, height: 0, y: 4, transition: { duration: 0.16 } }
          }
          transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.7 }}
          className="overflow-hidden"
        >
          <div
            className={cn(
              "mb-1.5 flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-subtle px-2 py-1.5",
              className,
            )}
          >
            <span aria-hidden="true" className="w-[3px] shrink-0 self-stretch rounded-full bg-brand" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-brand-ink">
                {citado.esPropio
                  ? ACCIONES_COPY.responder.aVosMismo
                  : ACCIONES_COPY.responder.respondiendoA(citado.autorNombre)}
              </p>
              <p className="truncate text-xs text-foreground-secondary">{citado.resumen}</p>
            </div>
            <button
              type="button"
              onClick={() => responder?.cancelar()}
              aria-label={ACCIONES_COPY.responder.cancelar}
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-muted",
                "transition-[transform,background-color,color] duration-(--duration-fast) ease-(--ease-spring)",
                "hover:bg-surface-hover hover:text-foreground active:scale-[0.9]",
                "motion-reduce:transition-none motion-reduce:active:scale-100",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
