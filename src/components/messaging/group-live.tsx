"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * MANTENER VIVO EL CHAT DE GRUPO.
 *
 * Es `thread-refresh.tsx` con dos diferencias, y las dos tienen motivo:
 *
 *  · INTERVALO: 15 s, el mismo que el directo (nació a 6 s; ver nota del 2026-09-04 abajo). En un directo escribe una sola
 *    persona y quince segundos de demora pasan desapercibidos; en un grupo de
 *    veinte, quince segundos son tres mensajes que llegan todos juntos y una
 *    conversación que se lee al revés.
 *
 *  · SE REFRESCA AL VOLVER A LA PESTAÑA, sin esperar el próximo tic. Volver a
 *    la app y ver la conversación de hace un rato es la forma más barata de
 *    que un chat parezca roto.
 *
 * POR QUÉ NO ES REALTIME (todavía): en este proyecto no hay NADA de Realtime
 * —ni publicación, ni un `.channel()` en todo `src/`— y montarlo es una
 * decisión de infraestructura, no un detalle de esta pantalla. La 0133 (§8)
 * deja escrito el razonamiento completo. Cuando entre, entra para los dos
 * chats a la vez y este archivo se borra.
 */
/**
 * 2026-09-04 (revisión de código): el tic hace un router.refresh() COMPLETO del
 * Server Component —auth, grupo, 100 mensajes, autores, ~5 viajes a Supabase—
 * por pestaña abierta. A 6 s, veinte personas con el chat abierto eran mil
 * consultas por minuto con el chat quieto. A 15 s (como thread-refresh.tsx) la
 * inmediatez la dan el refresco al enviar y al volver a la pestaña, que ya
 * existen. Lo correcto de fondo sigue siendo Realtime (0133 §8).
 */
export function GroupLive({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tic = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);

    function alVolver() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      window.clearInterval(tic);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [router, intervalMs]);

  return null;
}
