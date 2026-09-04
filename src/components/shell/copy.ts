/**
 * Copy del shell — lo que se lee en el chrome de la app, no adentro de una
 * pantalla. Español rioplatense, como todo el producto.
 */
export const SHELL_COPY = {
  /**
   * "Volver", y no "Atrás" ni sólo una flecha: es la palabra que usó el cliente
   * ("no puedo volver para atrás") y la que se entiende sin depender de que el
   * ícono se lea. El texto va SIEMPRE visible —no como `aria-label` de un ícono
   * pelado— porque en la app instalada esta es la única salida de la pantalla.
   */
  back: "Volver",
  /**
   * Volver desde un formulario a medio llenar. Se pregunta SÓLO cuando hay algo
   * escrito: confirmar un formulario vacío es un obstáculo, no un cuidado.
   */
  leaveFormTitle: "¿Descartás lo que escribiste?",
  leaveFormBody: "Si volvés ahora, lo que empezaste no se guarda.",
  leaveFormConfirm: "Sí, volver",
  leaveFormCancel: "Seguir acá",
} as const;
