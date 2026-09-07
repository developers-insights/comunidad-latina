/**
 * Copy de "Mostrar cuándo estuviste en línea" (Ajustes › Privacidad, columna
 * `mostrar_ultima_vez` de la 0145).
 *
 * Mismos criterios que `tag-policy-copy.ts`: se habla de vos, frases cortas,
 * cero nombres técnicos. Y un dato que NO es de estilo: la preferencia es
 * RECÍPROCA —`presencia_de()` mira también el `mostrar_ultima_vez` de quien
 * pregunta—, así que el copy tiene que decirlo. Si no lo dijera, alguien
 * apagaría el interruptor para esconderse y descubriría de casualidad que
 * también dejó de ver a los demás.
 */
export const ULTIMA_VEZ_COPY = {
  title: "Mostrar cuándo estuviste en línea",
  intro:
    "Cuando está activado, las personas con las que hablás pueden ver si estás en línea o hace cuánto fue tu última conexión. Funciona en las dos direcciones: si lo apagás, vos tampoco ves la de nadie.",

  toggleLabel: "Mostrar mi actividad",
  on: "Activado",
  off: "Desactivado",

  hintOn: "Ven “En línea” mientras usás la app, y “Última vez hace 20 minutos” cuando la cerrás.",
  hintOff: "Nadie ve cuándo te conectás, y vos tampoco ves la actividad de las demás personas.",

  saved: "Guardado",
  error: "No pudimos guardar tu elección. Probá de nuevo en un momento.",
} as const;
