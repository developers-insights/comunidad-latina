import type { ReactNode } from "react";
import { getAuthUserId } from "@/lib/supabase/server";
import { VigilanteDeLlamadas } from "@/components/calls/vigilante";
import { atenderLlamadaAction, rechazarLlamadaAction } from "./actions";

/**
 * Layout de llamadas. No dibuja chrome —cada página pone el suyo— y existe
 * sólo para colgar el vigilante una vez por sección en vez de una vez por
 * pantalla.
 *
 * Las server actions bajan como props: es lo que le permite al componente de
 * cliente atender o rechazar sin un endpoint propio y sin que el navegador
 * decida nada más que el gesto.
 */
export default async function LlamadasLayout({ children }: { children: ReactNode }) {
  const miId = await getAuthUserId();

  return (
    <>
      {children}
      {miId && (
        <VigilanteDeLlamadas
          miId={miId}
          acciones={{ atender: atenderLlamadaAction, rechazar: rechazarLlamadaAction }}
        />
      )}
    </>
  );
}
