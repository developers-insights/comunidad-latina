"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAvisosEnVivo } from "@/lib/notifications/en-vivo";

/** Una ráfaga de eventos (agrupar, marcar leídas) se vuelve un solo refresh. */
const PAUSA_MS = 400;

/**
 * Pantallas que son una lista de avisos (la bandeja, las solicitudes): cuando
 * llega uno, la lista se vuelve a pedir al servidor sin que nadie tenga que
 * recargar.
 */
export function RefrescoEnVivo({ userId, canal }: { userId: string; canal: string }) {
  const router = useRouter();
  const reloj = useRef<number | null>(null);

  const refrescar = useCallback(() => {
    if (reloj.current !== null) window.clearTimeout(reloj.current);
    reloj.current = window.setTimeout(() => {
      reloj.current = null;
      router.refresh();
    }, PAUSA_MS);
  }, [router]);

  useEffect(
    () => () => {
      if (reloj.current !== null) window.clearTimeout(reloj.current);
    },
    [],
  );

  useAvisosEnVivo(userId, refrescar, canal);
  return null;
}
