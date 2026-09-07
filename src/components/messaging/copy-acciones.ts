/**
 * COPY de las acciones sobre UN mensaje: reaccionar, responder, copiar,
 * reenviar, editar, eliminar y reportar.
 *
 * Vive aparte de `copy.ts` sólo mientras esta tanda esté abierta —hay varias
 * manos sobre el módulo de mensajería a la vez y un archivo compartido son
 * conflictos garantizados—. Al integrar se funde adentro de `COPY` como
 * `COPY.acciones`, sin cambiar ni una cadena.
 *
 * Tono: el mismo del resto del módulo. Se dice qué pasó y qué se puede hacer,
 * en la voz de una persona. Nada de "operación exitosa" ni de nombrar la base.
 */
export const ACCIONES_COPY = {
  menu: {
    /** El botón de tres puntos y el gesto de mantener presionado. */
    trigger: "Opciones del mensaje",
    title: "Este mensaje",
    cancel: "Cancelar",

    responder: "Responder",
    copiar: "Copiar",
    reenviar: "Reenviar",
    editar: "Editar",
    eliminar: "Eliminar",
    reportar: "Reportar",

    /**
     * Las razones por las que una acción no está. Se dicen en la fila, en
     * chico: un botón apagado sin explicación se lee como una falla de la app.
     */
    editarVencido: "Se puede editar hasta 15 minutos después de enviarlo",
    copiarSinTexto: "Este mensaje no tiene texto",
  },

  copiar: {
    listo: "Texto copiado",
    error: "No pudimos copiar el texto. Probá seleccionarlo y copiarlo a mano.",
  },

  reacciones: {
    /** Nombre accesible de la fila de emojis. */
    barLabel: "Reaccionar",
    poner: (emoji: string) => `Reaccionar con ${emoji}`,
    quitar: (emoji: string) => `Sacar tu reacción ${emoji}`,
    verTodos: "Más emojis",
    /** Debajo de la burbuja, para un lector de pantalla. */
    resumen: (total: number) =>
      total === 1 ? "1 reacción" : `${total} reacciones`,
    quienes: (nombres: string[], total: number) => {
      if (nombres.length === 0) {
        return total === 1 ? "1 persona reaccionó" : `${total} personas reaccionaron`;
      }
      if (total <= nombres.length) return nombres.join(", ");
      return `${nombres.join(", ")} y ${total - nombres.length} más`;
    },
    vos: "Vos",
    error: "No pudimos guardar tu reacción. Probá de nuevo.",
    /**
     * Reaccionar tiene su propio techo. "Probá de nuevo" sería un mal consejo:
     * hasta que baje el contador va a fallar igual.
     */
    rateLimitedTitle: "Esperá un momento",
    rateLimitedBody: "Pusiste muchas reacciones seguidas. Seguí en un rato.",
  },

  responder: {
    /** Encabezado de la cita, arriba del composer. */
    respondiendoA: (nombre: string) => `Respondiendo a ${nombre}`,
    aVosMismo: "Respondiendo a tu mensaje",
    cancelar: "Cancelar la respuesta",
    /** Cuando el mensaje citado no es texto. */
    resumenFoto: "Foto",
    resumenVideo: "Video",
    resumenAudio: "Nota de voz",
    resumenArchivo: "Archivo",
    resumenUbicacion: "Ubicación",
    resumenPerfil: "Perfil",
    resumenContenido: "Publicación",
    resumenBajado: "Mensaje eliminado",
    /** La cita adentro de la burbuja enviada, para teclado y lector. */
    irAlOriginal: (nombre: string) => `Ir al mensaje de ${nombre}`,
    noEncontrado: "Ese mensaje ya no está en la conversación",
  },

  editar: {
    title: "Editar el mensaje",
    intro: "Tu corrección se ve al instante y queda marcada como editada.",
    label: "Tu mensaje",
    guardar: "Guardar",
    guardado: "Mensaje corregido",
    /** La marca discreta al lado de la hora. */
    marca: "editado",
    marcaAria: "Este mensaje fue editado",
    vacio: "Escribí algo para poder guardar.",
    vencidoTitle: "Ya pasaron los 15 minutos",
    vencidoBody:
      "Los mensajes se pueden corregir hasta 15 minutos después de enviarlos. Este ya no.",
    noAutorTitle: "Este mensaje no es tuyo",
    noAutorBody: "Sólo quien lo escribió puede corregirlo.",
    flaggedTitle: "Esa corrección no se guardó",
    flaggedBody:
      "Detectamos algo que puede lastimar a otra persona. Probá decirlo de otra forma.",
    errorTitle: "No se pudo guardar",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
  },

  eliminar: {
    title: "¿Eliminar este mensaje?",
    body: "Va a desaparecer para todos y no se puede recuperar. En su lugar queda un aviso de que lo eliminaste.",
    confirmar: "Sí, eliminar",
    listo: "Mensaje eliminado",
    errorTitle: "No se pudo eliminar",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    /** La lápida que queda en el hilo. */
    lapida: "Se eliminó este mensaje",
    lapidaPropia: "Eliminaste este mensaje",
  },

  reenviar: {
    /** Título del panel de destinos, cuando se abre desde un mensaje. */
    title: "Reenviar el mensaje",
    listo: "Mensaje reenviado",
    error: "No pudimos reenviar el mensaje. Probá de nuevo.",
    /**
     * Reenviar un mensaje que no es una tarjeta compartible todavía no está
     * enchufado (ver el informe): se dice, no se esconde el botón sin motivo.
     */
    soloContenido: "Por ahora se pueden reenviar las publicaciones compartidas",
  },

  errores: {
    generic: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    forbidden: "Esta acción ya no está disponible para este mensaje.",
    /** El mensaje se bajó mientras el menú estaba abierto. */
    yaNoEsta: "Ese mensaje ya no está en la conversación.",
  },
} as const;
