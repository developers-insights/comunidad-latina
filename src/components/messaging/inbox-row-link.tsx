"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * El enlace de una fila de la bandeja.
 *
 * PRECARGA EL HILO ENTERO, no el esqueleto. `/mensajes/[id]` no puede tener
 * `loading.tsx` (llama `notFound()`, ver `app/loading-boundaries.test.ts`), así
 * que el prefetch automático de una ruta dinámica no trae nada útil. Con
 * `prefetch={true}` el hilo completo queda en el cache del router y abrirlo es
 * pintar lo que ya está.
 *
 * Cuándo: en cuanto hay intención (hover, foco, el primer toque en el
 * teléfono — llega unos 100 ms antes que el click) y, para las pocas filas con
 * mensajes sin leer arriba de todo, apenas se ven. Precargar toda la bandeja al
 * entrar serían decenas de hilos renderizados en el servidor para abrir uno.
 *
 * Marcar como leído NO pasa acá: lo hace el hilo al abrirse (`HiloEnVivo`), que
 * es el único lugar por donde pasan también la notificación y el enlace
 * directo. Acá sólo se avisa a la bandeja para que baje el globito ya.
 */
export function InboxRowLink({
  href,
  precargar = false,
  onAbrir,
  className,
  children,
}: {
  href: string;
  /** Precarga apenas entra en pantalla, sin esperar intención. */
  precargar?: boolean;
  onAbrir?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [conIntencion, setConIntencion] = useState(precargar);
  const mostrarIntencion = () => setConIntencion(true);

  return (
    <Link
      href={href}
      prefetch={conIntencion ? true : null}
      onMouseEnter={mostrarIntencion}
      onFocus={mostrarIntencion}
      onTouchStart={mostrarIntencion}
      onClick={onAbrir}
      className={className}
    >
      {children}
    </Link>
  );
}
