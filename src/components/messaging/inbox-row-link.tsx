"use client";

import Link from "next/link";
import { useTransition } from "react";
import { marcarConversacionLeidaAction } from "@/app/(app)/mensajes/lecturas";

/**
 * El enlace de una fila de la bandeja, que además deja anotado que la
 * conversación se abrió.
 *
 * Es lo ÚNICO cliente de la fila: el avatar, el nombre, el resumen y el
 * contador siguen siendo Server Components y viajan como `children`. Envolver
 * la fila entera en `"use client"` habría mandado su HTML dos veces (marcado
 * más payload de RSC) por una sola llamada al abrir.
 *
 * La marca sale sin esperar respuesta y la navegación no la espera: abrir un
 * chat no puede quedar detrás de un round-trip. Si el `upsert` falla, el
 * contador sigue ahí en la próxima carga — que es lo correcto, porque en ese
 * caso efectivamente no quedó registrado que lo leíste.
 */
export function InboxRowLink({
  href,
  conversationId,
  marcarLeida,
  className,
  children,
}: {
  href: string;
  conversationId: string;
  /** `false` cuando no hay nada sin leer: no se gasta una escritura de más. */
  marcarLeida: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [, startTransition] = useTransition();

  function alAbrir() {
    if (!marcarLeida) return;
    startTransition(async () => {
      await marcarConversacionLeidaAction({ conversationId }).catch(() => undefined);
    });
  }

  return (
    <Link href={href} onClick={alAbrir} className={className}>
      {children}
    </Link>
  );
}
