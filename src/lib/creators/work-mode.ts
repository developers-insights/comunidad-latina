/**
 * =============================================================================
 * MODALIDAD DEL TRABAJO — a distancia / presencial / mixto
 * =============================================================================
 *
 * El cliente lo pidió como "Digital Jobs" vs "On-site Jobs". Hasta la 0087 lo
 * único que existía era `listings.area_label`, texto libre donde cada quien
 * escribía lo que le parecía: "Washington Heights", "Remoto", "a convenir". Eso
 * no se puede filtrar ni mostrar consistente — dos avisos con modalidades
 * opuestas se veían idénticos en la lista.
 *
 * ESTE MÓDULO ES SOLO EL VOCABULARIO. Los valores que viajan a la base son los
 * del CHECK de `listings.work_mode` (`remoto` | `presencial` | `hibrido`), en
 * español y sin acentos como el resto de los dominios del repo. Las etiquetas
 * son otra cosa: son lo que lee una persona, y por eso NO son la traducción
 * literal del valor técnico —
 *
 *   - "A distancia" en vez de "Remoto": se entiende sin haber trabajado nunca en
 *     tecnología, que es el público de esta comunidad.
 *   - "Mixto" en vez de "Híbrido": "híbrido" es jerga de oficina corporativa y
 *     acá describe algo mucho más simple (una parte se hace de casa, otra no).
 *
 * NADA DE LO QUE EXPORTA ESTE MÓDULO LANZA. La modalidad llega de la base (donde
 * puede ser NULL para todo aviso anterior a 0087), de un `searchParams` que
 * escribe cualquiera en la URL, o de un form. Un valor raro tiene que
 * degradar a "no se declaró" y no tirar una pantalla entera.
 */

/** Los tres valores que acepta el CHECK de `listings.work_mode` (0087). */
export const WORK_MODES = ["remoto", "presencial", "hibrido"] as const;

export type WorkMode = (typeof WORK_MODES)[number];

/**
 * Qué lee una persona. Ver el docblock: la etiqueta no traduce el valor
 * técnico, lo explica.
 */
export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  remoto: "A distancia",
  presencial: "Presencial",
  hibrido: "Mixto",
};

/** Una línea que aclara qué significa cada opción al momento de elegirla. */
export const WORK_MODE_HELP: Record<WorkMode, string> = {
  remoto: "Se hace desde donde estés",
  presencial: "Hay que estar en el lugar",
  hibrido: "Una parte en el lugar, otra a distancia",
};

/**
 * ¿Este trabajo necesita que la persona esté en algún lado?
 *
 * Es la única pregunta que hace la app sobre la modalidad, y por eso vive acá y
 * no repetida en cada pantalla: si mañana se suma una cuarta modalidad, el
 * lugar donde decidir si exige zona es este.
 */
export function requiresArea(mode: WorkMode | null): boolean {
  return mode !== "remoto";
}

/**
 * Normalizador defensivo. Devuelve `null` —"no se declaró"— ante cualquier cosa
 * que no sea exactamente una de las tres modalidades.
 *
 * Tolera lo que una persona o una URL realmente mandan: espacios sobrantes,
 * mayúsculas, y el acento de "híbrido" que el CHECK de la base no acepta pero
 * que cualquiera escribe. Lo que NO hace es adivinar a partir de texto libre
 * (`area_label = "remoto"` no convierte un aviso en remoto): ese dato lo declara
 * quien publica, no un heurístico.
 */
export function normalizeWorkMode(raw: unknown): WorkMode | null {
  if (typeof raw !== "string") return null;

  // NFD separa la tilde en un carácter combinante propio, y el rango
  // ̀-ͯ es el bloque entero de esos combinantes: así "Híbrido",
  // "HÍBRIDO" e "híbrido " caen todos en el valor "hibrido" que exige el CHECK.
  const value = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  return (WORK_MODES as readonly string[]).includes(value) ? (value as WorkMode) : null;
}

/**
 * Etiqueta lista para pintar. `null` (aviso anterior a 0087, o de un kind donde
 * la modalidad no aplica) devuelve `null` y quien llama NO muestra el chip — es
 * distinto de mostrar "Presencial" por defecto, que sería afirmar un dato que
 * nadie eligió.
 */
export function workModeLabel(raw: unknown): string | null {
  const mode = normalizeWorkMode(raw);
  return mode ? WORK_MODE_LABEL[mode] : null;
}
