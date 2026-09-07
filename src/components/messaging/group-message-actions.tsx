"use client";

import { MessageActions } from "./message-menu";

/**
 * QUÉ SE PUEDE HACER CON UN MENSAJE DE GRUPO.
 *
 * ─── POR QUÉ ESTE ARCHIVO YA CASI NO TIENE CÓDIGO ───────────────────────────
 * Antes era un botón con dos acciones adentro (borrar y reportar) escritas acá.
 * Ahora las acciones sobre un mensaje son SEIS y son las mismas en el chat de
 * dos y en el de grupo, así que viven en `MessageActions` — una sola vez. Este
 * archivo queda como la puerta que la página de grupos ya monta, para que la
 * pantalla se actualice sin tener que reescribirse en el mismo movimiento.
 *
 * ─── LA DECISIÓN QUE ESTABA ESCRITA ACÁ SIGUE EN PIE ────────────────────────
 * Lo que decía la versión anterior: el menú va detrás de un botón VISIBLE y no
 * sólo detrás de un toque largo, porque «un gesto que no se ve es un gesto que
 * no existe», en este teléfono los gestos venían fallando, y un lector de
 * pantalla no puede anunciar un gesto. Todo eso sigue siendo cierto y el botón
 * sigue estando.
 *
 * Lo que cambia es que ya no es lo ÚNICO: el cliente pidió el toque largo y
 * ahora también funciona, más el clic derecho en escritorio. Las tres puertas
 * abren el mismo panel. Se le suma una entrada al gesto que ya era accesible en
 * vez de reemplazarla por una que no lo es.
 *
 * ─── DÓNDE SE ENCIENDE EL TOQUE LARGO ───────────────────────────────────────
 * Acá NO: este componente se monta al COSTADO de la burbuja (prop `acciones` de
 * `GroupMessageBubble`), así que sólo puede ser el botón. El toque largo
 * necesita envolver el mensaje, y eso lo hace la burbuja cuando recibe su prop
 * `mensaje`. Es el paso siguiente de la integración, no una limitación de este
 * archivo.
 */
export function GroupMessageActions({
  groupId,
  messageId,
  puedoBorrar,
  className,
  createdAt,
  body = "",
  kind = "texto",
  esAutor = false,
  autorNombre = "",
}: {
  groupId: string;
  messageId: string;
  /** Soy el autor, o administro el grupo. */
  puedoBorrar: boolean;
  className?: string;
  /**
   * Lo que sigue es OPCIONAL para no romper la página de grupos, que hoy pasa
   * sólo los tres de arriba. Sin `createdAt` y sin `esAutor`, editar no se
   * ofrece —el valor seguro— y el resto del menú funciona igual.
   */
  createdAt?: string;
  body?: string;
  kind?: string;
  esAutor?: boolean;
  autorNombre?: string;
}) {
  return (
    <MessageActions
      ambito="grupo"
      mensajeId={messageId}
      hiloId={groupId}
      isOwn={esAutor}
      // `puedoBorrar` ya venía resuelto por la página con la misma regla de la
      // policy (autor o administrador). Se respeta tal cual: si no soy el autor
      // pero puedo borrar, es porque administro.
      administro={puedoBorrar && !esAutor}
      kind={kind}
      // Sin fecha no hay ventana de edición que calcular, y una fecha inventada
      // ofrecería "Editar" en un mensaje de hace un año. `Date(0)` deja la
      // ventana cerrada, que es el estado correcto cuando no se sabe.
      createdAt={createdAt ?? new Date(0).toISOString()}
      body={body}
      autorNombre={autorNombre}
      className={className}
    />
  );
}
