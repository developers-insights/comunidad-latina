"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export type AvisoEnVivo =
  | { tipo: "nuevo"; kind: string | null; title: string | null }
  | { tipo: "cambio" }
  | { tipo: "volvio" };

/**
 * La campana se entera de un aviso cuando llega (Realtime sobre
 * `notifications`, publicada en la 0176), no en la próxima navegación.
 *
 * Volver a la pestaña también avisa: si la publicación todavía no está aplicada
 * o el socket se cayó con el teléfono en el bolsillo, el globito se corrige al
 * volver en vez de mentir hasta el próximo click. No es un sondeo: no corre
 * nada mientras nadie mira.
 */
export function useAvisosEnVivo(
  userId: string | null,
  alAvisar: (aviso: AvisoEnVivo) => void,
  canal = "campana",
): void {
  const alAvisarRef = useRef(alAvisar);
  useEffect(() => {
    alAvisarRef.current = alAvisar;
  }, [alAvisar]);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let vivo = true;

    const suscripcion = supabase
      .channel(`avisos:${canal}:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `profile_id=eq.${userId}` },
        (payload) => {
          if (!vivo) return;
          if (payload.eventType === "INSERT") {
            const fila = payload.new as { kind?: unknown; title?: unknown };
            alAvisarRef.current({
              tipo: "nuevo",
              kind: typeof fila.kind === "string" ? fila.kind : null,
              title: typeof fila.title === "string" ? fila.title : null,
            });
            return;
          }
          alAvisarRef.current({ tipo: "cambio" });
        },
      );

    void (async () => {
      // Realtime evalúa la RLS con el token de la sesión: sin esto el canal
      // conecta y no recibe una sola fila de una tabla protegida.
      try {
        await supabase.realtime.setAuth();
      } catch (error) {
        console.warn("[notificaciones] setAuth de Realtime falló", {
          message: error instanceof Error ? error.message : "error desconocido",
        });
      }
      if (vivo) suscripcion.subscribe();
    })();

    const alVolver = () => {
      if (document.visibilityState === "visible") alAvisarRef.current({ tipo: "volvio" });
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", alVolver);
      void supabase.removeChannel(suscripcion);
    };
  }, [userId, canal]);
}
