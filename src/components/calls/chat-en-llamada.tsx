"use client";

import { useEffect, useRef, useState } from "react";
import { ChatCircleDots, LockKey, X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui";
import { EnVueloProvider } from "@/components/messaging/en-vuelo";
import { COPY } from "./copy";
import styles from "./llamada.module.css";

type Fase = "cerrado" | "abierto" | "cerrando";

export interface ChatEnLlamadaProps {
  abierto: boolean;
  onCerrar: () => void;
  onNuevosAjenos: (cantidad: number) => void;
  titulo: string;
  subtitulo: string | null;
  /** El hilo ya renderizado en el servidor (`HiloDirecto` / `HiloDeGrupo`). */
  children: React.ReactNode;
}

/**
 * EL CHAT ADENTRO DE LA LLAMADA.
 *
 * Nunca se navega para mostrarlo: salir de `/llamadas/[id]` desmonta
 * `useMotorDeLlamada` y corta Agora. El hilo llega como `children` desde el
 * servidor y queda MONTADO aunque el panel esté cerrado — así el borrador del
 * composer sobrevive, el contador de no leídos sigue andando y abrirlo es
 * instantáneo. Cerrado lleva `hidden` (no `invisible`): con `display: none`
 * ningún `scrollTo` del hilo puede mover la pantalla de video.
 *
 * Desde `lg` es una columna a la derecha que achica el video; abajo de eso, una
 * hoja desde abajo sobre el video, con velo para cerrarla tocando afuera.
 */
export function ChatEnLlamada({
  abierto,
  onCerrar,
  onNuevosAjenos,
  titulo,
  subtitulo,
  children,
}: ChatEnLlamadaProps) {
  // La salida dura lo que su animación: "cerrando" mantiene el panel visible
  // hasta el `animationend`, y recién ahí pasa a `hidden`.
  const [cerrando, setCerrando] = useState(false);
  const [abiertoAntes, setAbiertoAntes] = useState(abierto);
  if (abiertoAntes !== abierto) {
    setAbiertoAntes(abierto);
    setCerrando(!abierto && !sinMovimiento());
  }
  const fase: Fase = abierto ? "abierto" : cerrando ? "cerrando" : "cerrado";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const teclado = useAlturaDelTeclado(fase !== "cerrado");

  useEffect(() => {
    if (fase !== "abierto") return;
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    // En la compu el foco va directo al campo; en el teléfono eso abriría el
    // teclado y taparía la mitad de la hoja antes de leer nada.
    if (window.matchMedia("(min-width: 64rem)").matches) {
      panelRef.current
        ?.querySelector<HTMLTextAreaElement>("textarea:not([disabled])")
        ?.focus();
    }
  }, [fase]);

  // Respaldo del `animationend`: con la pestaña en segundo plano o el ahorro de
  // batería las animaciones se congelan y el evento no llega nunca; sin esto
  // la hoja quedaba tapando los controles.
  useEffect(() => {
    if (fase !== "cerrando") return;
    const id = window.setTimeout(() => setCerrando(false), 320);
    return () => window.clearTimeout(id);
  }, [fase]);

  useEffect(() => {
    if (fase !== "abierto") return;
    function alTeclear(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) onCerrar();
    }
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [fase, onCerrar]);

  const visible = fase !== "cerrado";

  return (
    <EnVueloProvider onNuevosAjenos={onNuevosAjenos}>
      {/* Velo del teléfono: tocar el video que queda arriba cierra la hoja. */}
      <div
        aria-hidden="true"
        hidden={!visible}
        onClick={onCerrar}
        className={cn(
          "absolute inset-0 z-20 bg-media-shade/45 lg:hidden",
          fase === "cerrando" ? styles.veloSale : styles.veloEntra,
        )}
      />

      <section
        ref={panelRef}
        aria-label={COPY.chat.regionLabel}
        hidden={!visible}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && fase === "cerrando")
            setCerrando(false);
        }}
        style={{ "--cl-teclado": `${teclado}px` } as React.CSSProperties}
        className={cn(
          "flex flex-col overflow-hidden bg-canvas text-foreground [caret-color:auto]",
          // Teléfono: hoja sobre el video. El alto descuenta el teclado para que
          // el campo quede siempre a la vista.
          "absolute inset-x-0 bottom-[var(--cl-teclado)] z-30 h-[min(82dvh,calc(100dvh-var(--cl-teclado)-3.5rem))] rounded-t-[1.75rem]",
          "shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.45)]",
          // Compu: columna a la derecha que le saca ancho al video.
          "lg:relative lg:inset-auto lg:bottom-auto lg:z-auto lg:my-3 lg:mr-3 lg:h-auto lg:w-[380px] lg:shrink-0 lg:rounded-[1.75rem]",
          "lg:shadow-[0_18px_48px_-18px_rgba(0,0,0,0.5)] lg:ring-1 lg:ring-on-media/10",
          fase === "cerrando" ? styles.chatSale : styles.chatEntra,
        )}
      >
        <span
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong/60 lg:hidden"
        />

        <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 pb-3 pt-2 lg:pt-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
            <ChatCircleDots size={18} weight="fill" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-base font-semibold text-foreground">
              {titulo}
            </h2>
            <p className="flex items-center gap-1 truncate text-xs text-foreground-muted">
              <LockKey size={12} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{subtitulo ?? COPY.chat.privado}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={COPY.chat.cerrar}
            className={cn(
              "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground-secondary",
              "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-surface-subtle active:scale-[0.92]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div
          ref={scrollerRef}
          data-chat-scroller=""
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {children}
        </div>
      </section>
    </EnVueloProvider>
  );
}

/** Lo que se ve mientras el hilo todavía viene en camino desde el servidor. */
export function EsqueletoDelChat() {
  return (
    <div className="flex flex-col gap-3 px-3 py-4" aria-hidden="true">
      <Skeleton className="h-10 w-3/5 rounded-2xl" />
      <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
      <Skeleton className="h-14 w-2/3 rounded-2xl" />
      <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
    </div>
  );
}

function sinMovimiento() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Cuánto tapa el teclado del teléfono.
 *
 * iOS (y Chrome de Android desde la 108) NO achican el viewport de layout al
 * abrir el teclado: `100dvh` sigue midiendo la pantalla entera y una hoja
 * pegada abajo queda con el campo de texto debajo del teclado. El
 * `visualViewport` sí se achica, y la diferencia es el teclado.
 */
function useAlturaDelTeclado(activo: boolean) {
  const [alto, setAlto] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!activo || !vv) return;
    const viewport = vv;
    function medir() {
      const tapado = window.innerHeight - viewport.height - viewport.offsetTop;
      setAlto(tapado > 80 ? Math.round(tapado) : 0);
    }
    medir();
    viewport.addEventListener("resize", medir);
    viewport.addEventListener("scroll", medir);
    return () => {
      viewport.removeEventListener("resize", medir);
      viewport.removeEventListener("scroll", medir);
    };
  }, [activo]);

  return activo ? alto : 0;
}
