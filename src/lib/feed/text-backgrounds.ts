/**
 * CATÁLOGO DE FONDOS DE LAS PUBLICACIONES DE TEXTO (`kind='text'`).
 *
 * Origen (call del 3/9, 1:07:33–1:08:57, punto 15 del feedback): el cliente
 * pidió fondos «de colores más llamativos, más bonitos, o que la gente los
 * pueda cambiar». Hasta acá el fondo salía de un hash del id del post —tres
 * variantes fijas, nadie lo elegía— y el composer no ofrecía nada.
 *
 * ── POR QUÉ UN MÓDULO APARTE, Y ACÁ ────────────────────────────────────────
 *
 * El mismo catálogo lo consumen CUATRO bordes que no se conocen entre sí: el
 * selector del composer (cliente), la vista previa (cliente), la tarjeta del
 * feed y del detalle (cliente), y la validación de `createPostAction` (server).
 * Si viviera dentro de `text-banner.tsx` —donde nacieron las tres variantes
 * originales—, el server importaría un componente de React para validar un
 * string. Vive en `src/lib/feed/` por eso: es dato, no presentación, y no
 * importa nada de React ni de `server-only`.
 *
 * ⚠️ ES UN CATÁLOGO CERRADO Y LA BASE LO REPITE. `posts.text_background` tiene
 * un CHECK con exactamente estos ids (0128). Agregar un fondo son DOS cambios,
 * siempre: la entrada acá y el CHECK allá. Si se agrega sólo acá, el INSERT
 * rebota; si se agrega sólo allá, el fondo guardado no lo pinta nadie y el post
 * cae al respaldo. El string que viaja del navegador al servidor es el ID y
 * nunca el CSS: mandar el CSS sería dejar que el cliente escriba en el `style`
 * de todo el que abra la publicación.
 *
 * ── CÓMO SE CONSTRUYE UN FONDO ─────────────────────────────────────────────
 *
 * Cada fondo es un recorrido de tres tramos sobre la MISMA sombra
 * (`--color-media-shade`): `color-mix(in oklab, <acento> N%, sombra)`. El N no
 * es decorativo, es la palanca de contraste — cuanto más alto, más se acerca el
 * tramo al acento puro y menos contrasta contra la tinta clara
 * (`--color-on-media`) que va encima. Arriba se suma un brillo radial suave.
 *
 * CONTRASTE VERIFICADO, NO SUPUESTO: `text-backgrounds.test.ts` resuelve los
 * acentos desde `globals.css`, rehace las mezclas en oklab con culori (el mismo
 * espacio que usa `color-mix`), le suma el brillo como un overlay PLANO al 100%
 * de su opacidad —más severo que el degradado radial real, que sólo pega así de
 * fuerte en un punto— y exige ≥ 4.5:1 contra la tinta en CADA tramo de CADA
 * fondo. Medido hoy: el peor caso es 5.33:1 (Caribe) y el mejor 10.67:1.
 *
 * Los tres primeros (Amanecer, Noche, Plaza) son los que ya existían: siguen
 * siendo el sorteo del modo Automático, así que una publicación vieja —o una
 * nueva que no elige fondo— se sigue viendo como se veía. Sus amarillos bajaron
 * unos puntos (60→50 y 66→54) porque en el peor caso quedaban en 4.46:1 y
 * 4.06:1, o sea por DEBAJO de AA: el catálogo entero pasa por la misma vara y
 * no se les podía dar de baja a los que ya estaban.
 */

/**
 * Los ids, en el orden en que se ofrecen. Es lo que repite el CHECK de la 0128
 * y lo que `createPostAction` le pasa a `z.enum` — por eso es una tupla escrita
 * a mano y no un `.map()` del catálogo: zod necesita los literales para tipar,
 * y un `readonly string[]` derivado dejaría el borde del servidor sin tipo. Que
 * la tupla y el catálogo no se separen lo ancla el test.
 */
export const TEXT_BACKGROUND_IDS = [
  "amanecer",
  "noche",
  "plaza",
  "caribe",
  "tierra",
  "selva",
  "fiesta",
  "cafe",
] as const;

/** Un fondo, tal como lo nombra la base y lo elige quien publica. */
export type TextBackgroundId = (typeof TEXT_BACKGROUND_IDS)[number];

/** Un tramo del recorrido: qué acento, cuánto pesa sobre la sombra y dónde cae. */
export interface TextBackgroundStop {
  /** Variable CSS del acento (globals.css). NUNCA un color literal. */
  acento: string;
  /** % del acento en la mezcla contra `--color-media-shade`. Palanca de contraste. */
  tinta: number;
  /** Parada del degradado, en %. */
  parada: number;
}

export interface TextBackground {
  id: TextBackgroundId;
  /**
   * El nombre que lee quien publica, en el chip y para el lector de pantalla.
   * Son lugares y momentos, no colores: «Caribe» dice algo; «Turquesa», no.
   */
  label: string;
  /** Ángulo del degradado lineal, en grados. */
  angulo: number;
  recorrido: readonly TextBackgroundStop[];
  /** Brillo radial de arriba: opacidad en % de la tinta clara, y su origen. */
  brillo: { pct: number; origen: string };
  /** `background-image` del campo (degradado lineal ya armado). */
  field: string;
  /** `background-image` del brillo (radial), que va en una capa aparte. */
  glow: string;
}

const SHADE = "var(--color-media-shade)";

/** `color-mix` contra la sombra: la misma fórmula de las tres variantes originales. */
function tinte(acento: string, pct: number): string {
  return `color-mix(in oklab, ${acento} ${pct}%, ${SHADE})`;
}

function luz(pct: number): string {
  return `color-mix(in oklab, var(--color-on-media) ${pct}%, transparent)`;
}

type Spec = Omit<TextBackground, "field" | "glow">;

/**
 * Ocho recorridos, elegidos para que no haya dos que se confundan en la tira de
 * chips: azul frío, azul→rojo, rojo→amarillo, turquesa, naranja de tierra,
 * verde, rosa de fiesta y un tostado. Ninguno es el degradado violeta genérico
 * que delata un diseño hecho por una máquina, y los ocho salen de la paleta que
 * la app ya usa en sus módulos (`--brand-*` y `--accent-*`): la publicación de
 * texto se sigue viendo parte de Comunidad Latina y no de otra aplicación.
 */
const SPECS: readonly Spec[] = [
  {
    id: "amanecer",
    label: "Amanecer",
    angulo: 148,
    recorrido: [
      { acento: "var(--brand-yellow)", tinta: 50, parada: 0 },
      { acento: "var(--brand-blue)", tinta: 62, parada: 46 },
      { acento: "var(--brand-blue)", tinta: 92, parada: 100 },
    ],
    brillo: { pct: 9, origen: "86% 60% at 18% 8%" },
  },
  {
    id: "noche",
    label: "Noche",
    angulo: 160,
    recorrido: [
      { acento: "var(--brand-blue)", tinta: 88, parada: 0 },
      { acento: "var(--brand-blue)", tinta: 52, parada: 40 },
      { acento: "var(--brand-red)", tinta: 70, parada: 100 },
    ],
    brillo: { pct: 8, origen: "80% 58% at 82% 12%" },
  },
  {
    id: "plaza",
    label: "Plaza",
    angulo: 150,
    recorrido: [
      { acento: "var(--brand-red)", tinta: 82, parada: 0 },
      { acento: "var(--brand-red)", tinta: 50, parada: 42 },
      { acento: "var(--brand-yellow)", tinta: 54, parada: 100 },
    ],
    brillo: { pct: 7, origen: "90% 62% at 22% 90%" },
  },
  {
    id: "caribe",
    label: "Caribe",
    angulo: 142,
    recorrido: [
      { acento: "var(--accent-comunidad-voluntarios)", tinta: 84, parada: 0 },
      { acento: "var(--accent-profesionales)", tinta: 70, parada: 48 },
      { acento: "var(--brand-blue)", tinta: 58, parada: 100 },
    ],
    brillo: { pct: 8, origen: "84% 60% at 76% 86%" },
  },
  {
    id: "tierra",
    label: "Tierra",
    angulo: 156,
    recorrido: [
      { acento: "var(--accent-empleos)", tinta: 78, parada: 0 },
      { acento: "var(--accent-comunidad-perdidos)", tinta: 64, parada: 44 },
      { acento: "var(--brand-red)", tinta: 52, parada: 100 },
    ],
    brillo: { pct: 7, origen: "88% 58% at 14% 24%" },
  },
  {
    id: "selva",
    label: "Selva",
    angulo: 138,
    recorrido: [
      { acento: "var(--accent-marketplace)", tinta: 76, parada: 0 },
      { acento: "var(--accent-comunidad-comida)", tinta: 62, parada: 46 },
      { acento: "var(--accent-profesionales)", tinta: 70, parada: 100 },
    ],
    brillo: { pct: 8, origen: "82% 62% at 88% 30%" },
  },
  {
    id: "fiesta",
    label: "Fiesta",
    angulo: 164,
    recorrido: [
      { acento: "var(--accent-comunidad)", tinta: 80, parada: 0 },
      { acento: "var(--brand-red)", tinta: 58, parada: 44 },
      { acento: "var(--accent-empleos)", tinta: 72, parada: 100 },
    ],
    brillo: { pct: 7, origen: "86% 60% at 30% 6%" },
  },
  {
    id: "cafe",
    label: "Café",
    angulo: 145,
    recorrido: [
      { acento: "var(--accent-comunidad-perdidos)", tinta: 52, parada: 0 },
      { acento: "var(--accent-empleos)", tinta: 42, parada: 44 },
      { acento: "var(--brand-yellow)", tinta: 54, parada: 100 },
    ],
    brillo: { pct: 7, origen: "90% 64% at 50% 96%" },
  },
];

function armar(spec: Spec): TextBackground {
  const tramos = spec.recorrido
    .map((s) => `${tinte(s.acento, s.tinta)} ${s.parada}%`)
    .join(", ");
  return {
    ...spec,
    field: `linear-gradient(${spec.angulo}deg, ${tramos})`,
    glow: `radial-gradient(${spec.brillo.origen}, ${luz(spec.brillo.pct)} 0%, transparent 64%)`,
  };
}

export const TEXT_BACKGROUNDS: readonly TextBackground[] = SPECS.map(armar);

/**
 * EL SORTEO DEL MODO AUTOMÁTICO — los tres fondos que existían antes de que se
 * pudiera elegir. Que el pozo sea EXACTAMENTE estos tres, en ESTE orden, es lo
 * que hace que una publicación vieja (`text_background is null`) se siga viendo
 * igual que ayer. Sumar un fondo al catálogo NO lo suma acá: correría el módulo
 * del hash y repintaría de golpe cada texto ya publicado.
 */
export const AUTO_TEXT_BACKGROUNDS: readonly TextBackgroundId[] = [
  "amanecer",
  "noche",
  "plaza",
];

export function isTextBackgroundId(value: unknown): value is TextBackgroundId {
  return (
    typeof value === "string" && (TEXT_BACKGROUND_IDS as readonly string[]).includes(value)
  );
}

/** Hash determinístico sobre el id del post — mismo id, mismo fondo, siempre. */
export function autoTextBackgroundOf(postId: string): TextBackgroundId {
  let hash = 0;
  for (let i = 0; i < postId.length; i++) {
    hash = (hash * 33 + postId.charCodeAt(i)) >>> 0;
  }
  return AUTO_TEXT_BACKGROUNDS[hash % AUTO_TEXT_BACKGROUNDS.length];
}

/**
 * EL fondo de una publicación, resolviendo las tres situaciones en un solo
 * lugar: la persona eligió uno del catálogo, no eligió (Automático → sorteo por
 * id), o la fila trae un valor que este código no conoce —una publicación
 * escrita por una versión más nueva, o a mano— y ahí se cae al sorteo en vez de
 * pintar nada. Nunca devuelve `undefined`: la tarjeta lo consume sin defensas.
 */
export function textBackgroundOf(
  postId: string,
  elegido: string | null | undefined,
): TextBackground {
  const id = isTextBackgroundId(elegido) ? elegido : autoTextBackgroundOf(postId);
  // El `!` es seguro por construcción: `id` sale del catálogo o del pozo del
  // sorteo, y que el pozo sea un subconjunto del catálogo lo ancla el test.
  return TEXT_BACKGROUNDS.find((fondo) => fondo.id === id)!;
}
