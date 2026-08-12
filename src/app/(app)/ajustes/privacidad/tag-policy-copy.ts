import type { TagPolicy } from "./tag-policy";

/**
 * Copy de "Quién puede etiquetarte" (Ajustes › Privacidad, columna
 * `tag_policy` de la migración 0089).
 *
 * Mismos criterios que `people-tagger-copy.ts` (la otra mitad de esta
 * feature): se habla de vos, frases cortas, nada de "política de etiquetado"
 * ni de los nombres técnicos de las tres opciones (`everyone` / `following` /
 * `nobody` no aparecen en ningún lado de la pantalla). El público de esta
 * pantalla en particular busca laburo o vende algo — que alguien te pueda
 * nombrar en una foto es, la mayoría de las veces, lo que quiere.
 */
export const TAG_POLICY_COPY = {
  title: "Quién puede etiquetarte",
  /**
   * La aclaración que el spec pidió por escrito: cambiar esto NO toca lo que
   * ya existe. Se dice antes de las opciones, no escondida abajo, porque es
   * la pregunta que cualquiera se hace al ver un cambio de privacidad.
   */
  intro:
    "Esto decide quién puede sumarte a una publicación DE ACÁ EN ADELANTE. Las etiquetas que ya tenés puestas no se borran solas: para sacarte de una en particular, entrá a esa publicación y elegí “Quitarme de esta publicación”.",

  options: {
    everyone: {
      label: "Cualquiera de tu comunidad",
      hint: "Cualquier persona te puede sumar a una foto o a una publicación.",
    },
    following: {
      label: "Sólo a quienes seguís",
      hint: "Únicamente puede etiquetarte la gente que vos elegiste seguir.",
    },
    nobody: {
      label: "Nadie",
      hint: "Nadie puede etiquetarte. Si alguien lo intenta, no vas a aparecer en su publicación.",
    },
  } satisfies Record<TagPolicy, { label: string; hint: string }>,

  saved: "Guardado",
  error: "No pudimos guardar tu elección. Probá de nuevo en un momento.",
} as const;
