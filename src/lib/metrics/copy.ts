import type { MetricKey } from "./types";

/**
 * Copy del tablero — y, sobre todo, LA DEFINICIÓN DE CADA MÉTRICA.
 *
 * Las definiciones viven acá y se pintan en pantalla, no en un comentario del
 * código. Un número sin definición no se puede discutir: en una reunión de
 * aceptación, "entraron 12" abre la pregunta "¿12 qué?" y nadie tiene con qué
 * responder. Con la definición al lado, el número se puede aceptar o pelear,
 * que es lo que un tablero tiene que permitir.
 *
 * Tono: el que lee esto es el equipo de la comunidad, no un ingeniero. Nada de
 * nombres de tablas, nada de "eventos" ni "registros".
 */

export interface MetricCopy {
  /** Rótulo corto de la tarjeta. */
  label: string;
  /** La pregunta del plan que esta métrica responde. */
  question: string;
  /** Qué cuenta, en una frase. */
  counts: string;
  /** Qué NO cuenta. Tan importante como lo anterior. */
  excludes: string;
}

export const METRIC_COPY: Record<MetricKey, MetricCopy> = {
  active: {
    label: "Entran",
    question: "¿Cuánta gente entra?",
    counts:
      "Personas distintas que usaron la comunidad. Cuenta a quien abrió un video o un aviso, reaccionó, comentó, guardó algo, votó una encuesta, publicó, escribió un mensaje o se postuló a un empleo. Cada persona cuenta una sola vez, entre una vez o entre todos los días.",
    excludes:
      "No cuenta a quien mira sin haber creado una cuenta, ni a quien abre la app y solo desliza el inicio sin tocar nada. No guardamos inicios de sesión: esto se mide por lo que la gente hace.",
  },
  publishers: {
    label: "Publican",
    question: "¿Cuánta gente publica?",
    counts:
      "Personas distintas que publicaron algo: una publicación en el inicio, o un aviso de vivienda, negocio, profesional, evento o trabajo.",
    excludes:
      "No cuenta los borradores que quedaron a medias, ni los avisos que cargó el equipo para arrancar la comunidad, ni comentar o reaccionar — eso es participar, no publicar.",
  },
  contacters: {
    label: "Contactan",
    question: "¿Cuánta gente se contacta?",
    counts:
      "Personas distintas que le escribieron a alguien por un aviso. Se cuenta a quien da el primer paso.",
    excludes:
      "No cuenta las postulaciones a empleos, que se miden en la sección Empleos. El contenido de los mensajes no se lee nunca, ni para esto ni para nada.",
  },
};

export const COPY = {
  title: "Cómo viene la comunidad",
  intro:
    "Tres números: cuánta gente entra, cuánta publica y cuánta se contacta. Debajo de cada uno está su definición exacta, para que se pueda discutir.",

  rangeLabel: "Período",
  ranges: {
    7: "7 días",
    30: "30 días",
    90: "90 días",
  } as Record<number, string>,

  communityLabel: "Comunidad",
  allCommunities: "Todas",

  comparedTo: (days: number) => `vs. los ${days} días anteriores`,
  noComparison: "Sin período anterior para comparar",
  sameAsBefore: "Igual que el período anterior",

  definitionCounts: "Qué cuenta",
  definitionExcludes: "Qué no cuenta",

  chartTitle: "Día por día",
  chartIntro:
    "Cada línea es una de las tres métricas. Un día en cero es un día en cero: no falta el dato.",
  chartTableCaption: "Los mismos números del gráfico, en tabla.",
  chartColDay: "Día",

  secondaryTitle: "Para poner en contexto",
  secondary: {
    newMembers: "Cuentas nuevas",
    newMembersHelp:
      "Gente que creó su cuenta en el período. No es lo mismo que “entran”: se puede crear una cuenta y no volver, o entrar todos los días sin ser nuevo.",
    publications: "Publicaciones en total",
    publicationsHelp:
      "El volumen, no las personas. Si una sola persona publica diez avisos, acá se ven diez.",
    contacts: "Contactos abiertos",
    contactsHelp:
      "Cuántas veces alguien pidió hablar por un aviso. Es el volumen detrás de “contactan”.",
    acceptedContacts: "Contactos aceptados",
    acceptedContactsHelp:
      "De los contactos abiertos en el período, cuántos la otra persona ya aceptó. Es el número que dice si el contacto llega a algún lado.",
  },

  finePrintTitle: "Cómo leer estos números",
  finePrint: [
    "El día cierra a la medianoche UTC, que son las 8 de la noche en Nueva York. Hoy va incompleto: son las horas que van del día, no un día entero.",
    "Por privacidad, los mensajes y los contactos sin actividad se borran a los 90 días. Más atrás de ese límite, los números pueden quedar cortos.",
    "Acá solo hay cantidades. Este tablero no muestra nombres, ni teléfonos, ni quién hizo qué.",
  ],

  emptyTitle: "Todavía no hay actividad",
  emptyMessage:
    "Esta comunidad está recién empezando. Los ceros son reales, no un error: en cuanto alguien entre, publique o escriba, va a aparecer acá.",

  errorTitle: "No pudimos traer los números",
  errorMessage:
    "Algo falló al calcular el tablero. Volvé a intentar; si sigue igual, avisanos.",
  errorRetry: "Reintentar",

  loadingLabel: "Calculando los números de la comunidad",

  navLabel: "Métricas",
} as const;
