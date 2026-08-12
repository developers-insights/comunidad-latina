/**
 * Copy del HORARIO DE ATENCIÓN.
 *
 * La vara de tono es `lib/integrity/declarations.ts`: se dice lo que hay, no se
 * promete lo que no hay, y no se disfraza de certeza algo que es una carga
 * manual del negocio.
 *
 * LO QUE ESTE COPY NO PUEDE SUAVIZAR: el horario lo escribe el negocio, no
 * nosotros. "Abierto ahora" es una cuenta sobre lo que ese negocio declaró, y
 * si la persona llega y está cerrado, la app le mintió. Por eso el estado va
 * siempre acompañado de la nota de que lo publicó el negocio, y por eso el vacío
 * no dice "próximamente" ni inventa un "Lunes a viernes de 9 a 18".
 */
export const HORARIO_COPY = {
  titulo: "Horarios de atención",

  /** Se mantiene el vacío honesto que ya existía en la ficha. */
  vacio: "Este negocio todavía no publicó sus horarios. Escribile y te dice cuándo atiende.",

  abierto: "Abierto ahora",
  cerrado: "Cerrado ahora",
  cerradoHoy: "Hoy no atiende",
  veinticuatroHoras: "Abierto las 24 horas",
  cerradoDia: "Cerrado",

  cierraA: (hora: string) => `Cierra a las ${hora}`,
  abreA: (dia: string, hora: string) => `Abre el ${dia.toLowerCase()} a las ${hora}`,
  abreHoyA: (hora: string) => `Abre hoy a las ${hora}`,

  /** Aparece siempre debajo del estado. Es la parte que no se negocia. */
  fuente: "Horario publicado por el negocio.",
  zonaNota: (zona: string) => `Las horas son de ${zona}, la zona del negocio.`,

  /* ----------------------------- Editor ---------------------------------- */
  editarTitulo: "Horarios de atención",
  editarIntro:
    "Cargá los días y las horas en que atendés. Lo van a ver todos los que abran tu negocio.",
  zonaLabel: "¿En qué zona horaria atendés?",
  zonaHelp: "Las horas se muestran así a todo el mundo, sin importar desde dónde te miren.",
  diaCerrado: "Cerrado",
  diaAbierto: "Abierto",
  diaVeinticuatro: "Las 24 horas",
  desde: "Desde",
  hasta: "Hasta",
  agregarTramo: "Agregar otro horario ese día",
  quitarTramo: "Quitar este horario",
  guardar: "Guardar horarios",
  guardando: "Guardando…",
  guardado: "Listo, tus horarios ya están publicados.",

  errores: {
    zona: "Elegí la zona horaria en la que atendés.",
    tramoInvalido:
      "Revisá las horas: la de cierre no puede ser igual a la de apertura. Si atendés todo el día, marcá «Las 24 horas».",
    solapado: "Hay dos horarios del mismo día que se pisan. Revisalos y dejalos separados.",
    demasiados: "Podés cargar hasta tres horarios por día.",
    sinPermiso: "Solo el dueño del negocio o su equipo pueden editar los horarios.",
    generico: "No pudimos guardar los horarios ahora — no es culpa tuya. Probá de nuevo en un rato.",
  },
} as const;
