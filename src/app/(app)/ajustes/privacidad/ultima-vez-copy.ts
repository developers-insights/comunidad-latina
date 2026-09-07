/**
 * Copy de "Mostrar cuándo estuviste en línea" (Ajustes › Privacidad, columna
 * `mostrar_ultima_vez` de la 0145).
 *
 * Mismos criterios que `tag-policy-copy.ts`: se habla de vos, frases cortas,
 * cero nombres técnicos. Y una decisión que NO es de estilo: acá no se promete
 * reciprocidad. Otras apps apagan las dos puntas a la vez —si escondés tu
 * "última vez", dejás de ver la de los demás— y nuestra RPC no hace eso: cada
 * quien decide por sí mismo. Escribir "tampoco vas a ver la de nadie" sería
 * cómodo, familiar y falso, así que se dice lo que de verdad pasa.
 */
export const ULTIMA_VEZ_COPY = {
  title: "Mostrar cuándo estuviste en línea",
  intro:
    "Cuando está activado, las personas con las que hablás pueden ver si estás en línea o hace cuánto fue tu última conexión.",

  toggleLabel: "Mostrar mi actividad",
  on: "Activado",
  off: "Desactivado",

  hintOn: "Ven “En línea” mientras usás la app, y “Última vez hace 20 minutos” cuando la cerrás.",
  hintOff:
    "Nadie ve cuándo te conectás. Vos sí seguís viendo la actividad de quienes la tienen activada.",

  saved: "Guardado",
  error: "No pudimos guardar tu elección. Probá de nuevo en un momento.",
} as const;
