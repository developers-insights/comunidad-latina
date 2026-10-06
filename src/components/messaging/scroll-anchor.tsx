"use client";

import { useEffect, useRef } from "react";

/**
 * Mantiene el hilo scrolleado al último mensaje. `signature` = id del último
 * mensaje: cuando cambia (llegó uno nuevo por polling o envío), baja de nuevo.
 *
 * `soloContenedor`: en el panel de chat de la llamada NO se usa
 * `scrollIntoView`, que también desplaza a los ancestros con overflow oculto y
 * corría la pantalla de video entera. Ahí se baja sólo el `[data-chat-scroller]`.
 */
export function ScrollAnchor({
  signature,
  soloContenedor = false,
}: {
  signature: string;
  soloContenedor?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const primera = isFirstRender.current;
    isFirstRender.current = false;
    if (soloContenedor) {
      const scroller = ref.current?.closest<HTMLElement>("[data-chat-scroller]");
      if (!scroller) return;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: primera ? "instant" : "smooth" });
      return;
    }
    ref.current?.scrollIntoView({
      block: "end",
      behavior: primera ? "instant" : "smooth",
    });
  }, [signature, soloContenedor]);

  return <div ref={ref} aria-hidden="true" />;
}
