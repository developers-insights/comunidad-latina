"use client";

import { useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { hasInternalHistory } from "./internal-history";
import { SHELL_COPY } from "./copy";

/**
 * Cómo salir de esta pantalla, sin depender del navegador.
 *
 * En la app instalada (PWA) no hay barra de direcciones ni gesto de volver
 * confiable: si la pantalla no ofrece la salida, no hay salida. El cliente lo
 * dijo dos veces (call del 2026-09-03, 57:28: "siempre que se quiera salir de
 * cualquier cosa, como una vivienda o eventos, no puedo volver para atrás,
 * tengo que ir al buscador").
 *
 * `href` NO alcanza como contrato. Una portada de sección se abre desde el
 * feed, desde /buscar, desde un link compartido y desde una notificación: un
 * link fijo la devuelve siempre al mismo lugar y le miente a la persona que
 * venía de otro. Por eso el orden es: retroceder de verdad cuando hay historial
 * NUESTRO detrás (`internal-history.ts`), y recién si no lo hay caer al
 * `fallbackHref` que declara cada pantalla.
 */
export interface SectionTopBarProps {
  /**
   * A dónde ir cuando NO hay historial de la app detrás: link externo, PWA
   * recién abierta, recarga de una entrada directa.
   *
   * Es OBLIGATORIO y explícito por pantalla —nada de deducirlo del pathname—
   * porque el padre de una URL no siempre es el padre de la experiencia: el
   * wizard vuelve a SU sección, la subpantalla de perfil a /perfil, y una
   * portada de sección a /buscar, que es el mapa de la app.
   */
  fallbackHref: string;
  /**
   * Título de la pantalla, opcional. Se usa sólo donde la pantalla NO tiene su
   * propio encabezado visible: repetirlo al lado del que ya está abajo es ruido.
   * Se dibuja como texto y no como `<h1>` para no competir con el encabezado
   * real de la página en el árbol de accesibilidad.
   */
  title?: string;
  /** Acciones de la pantalla, alineadas a la derecha (guardar, compartir, ⋯). */
  actions?: ReactNode;
  /**
   * Intercepta el "Volver". Devolver `true` significa "yo me encargo" (un
   * wizard que retrocede un paso, una confirmación que hay que mostrar antes) y
   * la barra no navega. Cualquier otro valor deja seguir la navegación normal.
   */
  onBack?: () => boolean | void;
  className?: string;
}

/**
 * La acción de volver, sin la barra.
 *
 * Se exporta para los flujos que tienen que salir por su cuenta —el wizard que
 * primero pregunta "¿salís sin publicar?" y recién después se va— y así la
 * regla de "retroceder o caer al fallback" vive en UN solo lugar.
 */
export function useSectionBack(fallbackHref: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (hasInternalHistory()) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [router, fallbackHref]);
}

/**
 * Pegajosa bajo el header global (59px = 56 del header + 3 de la firma
 * tricolor), a lo ancho completo del contenido (`-mx-4`) y comiéndose el
 * `pt-4` del `<main>` (`-mt-4`) para que no quede una franja de contenido
 * pasando por atrás entre el header y la barra.
 *
 * Es la MISMA gramática que ya usa el detalle de un aviso (`DetailTopBar`, que
 * se construye sobre esta barra): la persona que sale de una vivienda y la que
 * sale del formulario de un empleo tocan el mismo control en el mismo lugar.
 */
export function SectionTopBar({
  fallbackHref,
  title,
  actions,
  onBack,
  className,
}: SectionTopBarProps) {
  const goBack = useSectionBack(fallbackHref);

  function handleBack() {
    if (onBack?.() === true) return;
    goBack();
  }

  return (
    <div
      className={cn(
        "sticky top-[59px] z-30 -mx-4 -mt-4 mb-3 flex min-h-12 items-center gap-2",
        "border-b border-border-subtle bg-canvas/90 px-2 backdrop-blur-md",
        className,
      )}
    >
      <button
        type="button"
        onClick={handleBack}
        className={cn(
          "flex min-h-11 shrink-0 items-center gap-1 rounded-full pl-1.5 pr-3",
          "text-sm font-semibold text-foreground-secondary",
          "transition-[color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-subtle hover:text-foreground active:scale-[0.96]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <CaretLeft size={18} weight="bold" aria-hidden="true" />
        {SHELL_COPY.back}
      </button>

      {title && (
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {title}
        </span>
      )}

      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </div>
  );
}
