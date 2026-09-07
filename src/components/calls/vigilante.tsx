"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLlamadaEntrante } from "@/lib/calls/vigilancia";
import { Timbre } from "./timbre";

export interface VigilanteDeLlamadasProps {
  /** Id de perfil de quien está mirando. Sale del servidor, nunca del cliente. */
  miId: string;
  /**
   * Las server actions, tal cual las exporta `llamadas/actions.ts`.
   *
   * La forma del parámetro es `{ callId }` y no `callId` a secas por una razón
   * de React y no de gusto: un Server Component no puede envolver una action en
   * una arrow para adaptarle la firma —eso sería pasar una función común a un
   * componente de cliente, que no es serializable—. O el tipo calza con la
   * action, o hace falta un endpoint de más.
   */
  acciones: {
    atender: (input: { callId: string }) => Promise<{ ok: boolean }>;
    rechazar: (input: { callId: string }) => Promise<{ ok: boolean }>;
  };
}

/**
 * El que escucha si te están llamando.
 *
 * No pinta nada mientras no haya nada: es una isla de cliente sin layout propio,
 * pensada para colgarse una sola vez lo más arriba posible del árbol.
 *
 * ⚠️ HOY VIVE EN `/llamadas`, Y ESO ALCANZA PARA MENOS DE LO QUE PARECE.
 * Un timbre sólo suena donde está montado. Colgado acá, suena mientras se mira
 * el historial de llamadas y mientras se está en una llamada — no mientras se
 * lee el feed, que es donde la gente pasa el rato. Para que suene en toda la
 * app hay que montarlo una vez en el layout de `(app)`, que pertenece a otro
 * frente: es UNA línea, y está anotada en el reporte de esta tanda.
 */
export function VigilanteDeLlamadas({ miId, acciones }: VigilanteDeLlamadasProps) {
  const router = useRouter();
  const { entrante, descartar } = useLlamadaEntrante(miId);
  const [atendiendo, iniciar] = useTransition();

  if (!entrante) return null;

  return (
    <Timbre
      entrante={entrante}
      atendiendo={atendiendo}
      onAtender={() =>
        iniciar(async () => {
          const resultado = await acciones.atender({ callId: entrante.id });
          descartar(entrante.id);
          if (resultado.ok) {
            // `?entrar=1` es la marca del gesto: sin ella la pantalla de llamada
            // no pide micrófono sola. Ver pantalla-de-llamada.tsx.
            router.push(`/llamadas/${entrante.id}?entrar=1`);
          }
        })
      }
      onRechazar={() =>
        iniciar(async () => {
          descartar(entrante.id);
          await acciones.rechazar({ callId: entrante.id });
          router.refresh();
        })
      }
    />
  );
}
