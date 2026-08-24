import { MAX_POST_TAGS, type TaggedSummary } from "@/lib/social/post-tags";

/**
 * Copy de ETIQUETAR PERSONAS (0089). Vive aparte de `feed/copy.ts` a propósito:
 * este frente no es dueño de ese archivo y una feature nueva no tiene por qué
 * pelearse por un merge en el diccionario compartido.
 *
 * Criterios de escritura (español rioplatense, voz de Comunidad Latina):
 *  · Se le habla a la persona de vos y en presente. "Etiquetá", no "Etiquetar
 *    personas en tu publicación".
 *  · Los estados vacíos DICEN QUÉ HACER, no describen la ausencia. "Buscá por
 *    nombre" es una instrucción; "No hay resultados" es un diagnóstico.
 *  · Nada de jerga: no aparecen "usuario", "perfil", "registro" ni "sistema".
 *  · Los errores nombran qué pasó Y qué sigue, sin culpar a nadie.
 */

export const TAGGER_COPY = {
  /** Fila de acción dentro de la hoja del composer. */
  row: {
    label: "Etiquetar personas",
    /** Cuando todavía no hay nadie elegido. */
    hint: "Sumá a quienes aparecen o participaron",
    /** Con gente elegida: el resumen reemplaza a la ayuda. */
    chosen: (count: number) =>
      count === 1 ? "1 persona etiquetada" : `${count} personas etiquetadas`,
    /** Cuando ya no entra nadie más. */
    full: `Llegaste al máximo de ${MAX_POST_TAGS}`,
    openAria: "Abrir el buscador de personas para etiquetar",
  },

  /** La hoja con el buscador. */
  sheet: {
    title: "Etiquetar personas",
    searchLabel: "Buscar personas",
    searchPlaceholder: "Buscá por nombre",
    /** Antes de escribir nada. */
    idle: "Escribí un nombre para empezar",
    searching: "Buscando…",
    /** Búsqueda sin coincidencias. */
    empty: (query: string) => `No encontramos a nadie con “${query}”`,
    emptyHint: "Probá con el nombre tal como aparece en su perfil.",
    /** La consulta es demasiado corta para salir a buscar. */
    tooShort: "Escribí al menos dos letras",
    /** Falla de red o del servidor durante la búsqueda. */
    error: "No pudimos buscar en este momento",
    errorHint: "Fijate tu conexión y volvé a intentar.",
    chosenTitle: "Ya etiquetaste",
    remove: (name: string) => `Quitar a ${name}`,
    add: (name: string) => `Etiquetar a ${name}`,
    /** Al tocar a alguien cuando la lista ya está llena. */
    limitReached: `Podés etiquetar hasta ${MAX_POST_TAGS} personas en una publicación`,
    done: "Listo",
    /** Aclaración de privacidad, visible sin tener que buscarla. */
    privacyNote: "Cada persona recibe un aviso y puede quitarse cuando quiera.",
  },

  /** La línea "con Ana y 2 más" bajo la cabecera de la card. */
  card: {
    /** Prefijo corto: se lee "con Ana y Julián". */
    label: (summary: TaggedSummary): string => {
      const { names, extraCount } = summary;
      if (names.length === 0) return "";
      const list =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
      if (extraCount === 0) return `con ${list}`;
      return extraCount === 1 ? `con ${list} y 1 más` : `con ${list} y ${extraCount} más`;
    },
    openAria: "Ver a las personas etiquetadas",
    sheetTitle: "Personas etiquetadas",
    viewProfile: "Ver perfil",
    /** Botón de la persona etiquetada sobre su propia etiqueta. */
    removeSelf: "Quitarme de esta publicación",
    removeSelfPending: "Quitando…",
    removeSelfError: "No pudimos quitarte. Probá de nuevo en un momento.",
  },

  /** Resultados de guardar, para que el composer no invente sus propias frases. */
  save: {
    /** La publicación salió pero las etiquetas no se guardaron. */
    partial: "Publicamos tu contenido, pero no pudimos guardar las etiquetas.",
    /** Se reintentó y volvió a fallar. */
    partialGiveUp:
      "Tu publicación ya está en el feed. Podés etiquetar a las personas desde ahí cuando quieras.",
    rateLimited: "Estás etiquetando muy seguido. Esperá un momento y probá de nuevo.",
    /**
     * Alguien de la lista ya no acepta etiquetas (cambió su preferencia o hubo
     * un bloqueo entre la búsqueda y el guardado). Se dice sin señalar a nadie:
     * el motivo es de la otra persona y no es asunto de quien publica.
     */
    someRejected: (count: number) =>
      count === 1
        ? "Una de las personas no se pudo etiquetar. El resto quedó en la publicación."
        : `${count} personas no se pudieron etiquetar. El resto quedó en la publicación.`,
  },
} as const;
