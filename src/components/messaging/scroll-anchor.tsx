"use client";

import { useEffect, useRef } from "react";

/**
 * Mantiene el hilo scrolleado al último mensaje. `signature` = id del último
 * mensaje: cuando cambia (llegó uno nuevo por polling o envío), baja de nuevo.
 */
export function ScrollAnchor({ signature }: { signature: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    ref.current?.scrollIntoView({
      block: "end",
      behavior: isFirstRender.current ? "instant" : "smooth",
    });
    isFirstRender.current = false;
  }, [signature]);

  return <div ref={ref} aria-hidden="true" />;
}
