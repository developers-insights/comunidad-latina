import "server-only";

/**
 * Guardrail de ENTRADA del Asistente Comunitario (encuadre legal duro).
 *
 * Este asistente es el "Asistente Comunitario" legal-safe — NO el "Asistente
 * de Trámites" (ese requiere revisión de abogado y NO existe). La línea roja:
 * NUNCA evaluar el caso puntual de una persona (elegibilidad, plazos de SU
 * trámite, consejo legal/migratorio/médico/financiero personal).
 *
 * Capa 1 (esta): clasificador barato por heurística de keywords — si la
 * pregunta pide consejo de caso puntual, se responde con derivación FIJA sin
 * tocar el LLM. Capa 2: el system prompt prohíbe lo mismo. Capa 3: solo se
 * responde desde chunks recuperados del tenant (retrieval-bounded).
 *
 * Sesgo deliberado: preferimos un falso negativo (pregunta personal que se
 * escapa y el prompt la frena) antes que bloquear preguntas generales
 * legítimas ("¿cómo saco mi ITIN?" o "¿qué hago si me para ICE?" son
 * EDUCATIVAS y se responden desde las guías, con derivación al cierre).
 *
 * BILINGÜE (fiscal R3): el asistente responde en inglés si le escriben en
 * inglés (system prompt), así que TODOS los detectores tienen patterns en
 * español E inglés. Y como ninguna heurística de keywords es completa, la
 * derivación obligatoria §3/§11 NO depende solo de esto: el route handler
 * también fuerza `sensitive=true` cuando alguna fuente citada es de tema
 * legal/migratorio/salud/finanzas (ver hasSensitiveChunk).
 */

/** minúsculas + sin tildes + espacios colapsados → regex simples y robustas. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Caso puntual / consejo personal → derivación fija, sin LLM.
 * Todas las patterns asumen texto normalizado (sin tildes).
 */
const PERSONAL_CASE_PATTERNS: readonly RegExp[] = [
  // Elegibilidad personal ("¿califico?", "¿soy elegible?", "¿me corresponde?")
  /\b(califico|calificamos|calificaria|soy elegible|somos elegibles|me corresponde|tengo derecho a|me lo van a (dar|aprobar|negar))\b/,
  /\b(puedo|podria|podre) (aplicar|pedir|solicitar|reclamar|renovar)\b.*\b(yo|mi|para mi)\b/,
  // Su caso/trámite/expediente concreto
  /\bmi (caso|audiencia|cita con|corte|juicio|apelacion|asilo|peticion|solicitud|aplicacion|proceso|tramite pendiente|deportacion|orden|expediente|sentencia|condena|abogado|abogada)\b/,
  // Plazos y resultados de SU trámite
  /\bcuanto (tarda|demora|falta|tiempo queda)\b.*\b(mi|mis|lo mio)\b/,
  /\b(mi|mis)\b.*\bcuanto (tarda|demora|falta)\b/,
  /\bcuando (me llega|me aprueban|me dan|me depositan|sale mi|me toca|me contestan)\b/,
  // Miedo a consecuencias legales personales
  /\bme (van a|pueden|podrian|iran a) (deportar|detener|arrestar|demandar|desalojar|embargar|quitar (la|el|mi))\b/,
  // Decisiones personales legales/contractuales
  /\b(que me conviene|conviene que (firme|acepte|pague|declare)|deberia (aceptar|firmar|pagar|declarar|apelar|divorciarme|casarme)|me recomendas (firmar|pagar|aceptar|declarar))\b/,
  // Salud personal (consejo médico)
  /\b(me duele|estoy embarazada|tengo (fiebre|sintomas|un dolor|una infeccion)|que (medicamento|pastilla|dosis|antibiotico) (tomo|me tomo|debo tomar|le doy))\b/,
  // Finanzas personales (consejo de inversión/deuda propia)
  /\b(en que invierto|me conviene (invertir|un prestamo|sacar un prestamo|refinanciar|declararme)|cuanto me (prestan|toca pagar|van a cobrar|devuelven de taxes))\b/,

  // ---- ENGLISH (fiscal R3: mismas líneas rojas para quien escribe en inglés) ----
  // Elegibilidad personal ("am I eligible…?", "do I qualify…?")
  /\bam i (eligible|entitled|qualified|allowed)\b/,
  /\b(do|would|will|might) (i|we) qualify\b/,
  // Su caso/trámite/expediente concreto
  /\bmy (case|hearing|trial|appeal|petition|application|paperwork|court date|asylum (case|application|claim)|deportation|removal( order)?|record|sentence|conviction|lawyer|attorney|landlord|lease|visa status|green card application)\b/,
  // Plazos y resultados de SU trámite
  /\bhow long (will|does|until|before) my\b/,
  /\bwhen (will|do) (i|we) (get|receive|hear)\b/,
  // Miedo a consecuencias legales personales
  /\b(will|can|could) (they|ice|immigration|the police|my landlord) (deport|arrest|detain|remove|evict|sue) (me|us)\b/,
  // Decisiones personales legales/contractuales/financieras
  /\bshould (i|we) (sign|accept|take|pay|plead|settle|appeal|declare|file|divorce|marry|invest|refinance|cosign)\b/,
  /\b(can|could) (i|we) (sue|appeal|refile|reopen)\b/,
  /\bhow much (will i get|do i owe|can i borrow|is my refund)\b/,
  // Salud personal (consejo médico)
  /\bi\W?m pregnant\b/,
  /\bwhat (medicine|medication|dose|antibiotic|pill) should i (take|give)\b/,
  /\bmy (pain|symptoms|infection|diagnosis|prescription)\b/,
];

export type GuardrailVerdict =
  | { blocked: false }
  | { blocked: true; reason: "personal_case" };

/** ¿La pregunta pide consejo sobre SU caso puntual? → responder derivando. */
export function checkQuestionGuardrail(question: string): GuardrailVerdict {
  const q = normalize(question);
  for (const pattern of PERSONAL_CASE_PATTERNS) {
    if (pattern.test(q)) return { blocked: true, reason: "personal_case" };
  }
  return { blocked: false };
}

/**
 * Temas sensibles: se responden desde las fuentes, pero el cierre SIEMPRE
 * deriva ("para tu caso puntual, hablá con un profesional verificado").
 * Español + inglés (fiscal R3). Igual NO es la única red: ver hasSensitiveChunk.
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(ice|migra|migracion|inmigracion|deportacion|deportan|asilo|refugio|visa|green card|residencia|ciudadania|permiso de trabajo|daca|tps|corte|juez|abogado|abogada|notario|notaria|demanda|contrato|lease|desalojo|deuda|colecciones|impuestos|taxes|itin|ssn|seguro (medico|social)|medicaid|medicare|hospital|clinica|salud|embarazo|prestamo|credito|banco|estafa|fraude|policia|arresto|detencion)\b/,
  /\b(asylum|deportation|deported|immigration|immigrant|uscis|refugee|citizenship|work permit|lawyer|attorney|legal aid|court|judge|lawsuit|sue|sued|contract|eviction|evicted|landlord|debt|collections|loan|mortgage|credit|irs|social security|insurance|health|hospital|clinic|pregnant|pregnancy|police|arrest|arrested|detained|detention|fraud|scam)\b/,
];

export function isSensitiveTopic(question: string): boolean {
  const q = normalize(question);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(q));
}

/** ¿Huele a estafa/fraude? → derivar además al Escudo Anti-Estafa. */
export function isScamTopic(question: string): boolean {
  return /\b(estafa|estafaron|estafador|fraude|scam|scammed|scammer|fraud|fraudulent|me robaron|me enganaron|rip ?off|ripped (me |us )?off|stole my (money|deposit|rent)|con artist)\b/.test(
    normalize(question),
  );
}

/* ----------------------- Sensibilidad por FUENTES ------------------------ */

/**
 * Topics curados (metadata.topics de las guías embebidas, p. ej. 'ice',
 * 'derechos', 'impuestos', 'itin') que marcan una fuente como tema
 * legal/migratorio/salud/finanzas. Se matchea sobre el topic normalizado.
 */
const SENSITIVE_CHUNK_TOPIC_RE =
  /(ice|migra|inmigra|immigra|deporta|asilo|asylum|refug|visa|residencia|ciudadania|citizenship|daca|tps|derechos|rights|legal|abogado|lawyer|attorney|corte|court|impuesto|tax|itin|ssn|banco|bank|prestamo|loan|credito|credit|deuda|debt|desalojo|eviction|vivienda|salud|health|medic|hospital|seguro|insurance|embarazo|emergencia|emergency|licencia|dmv|policia|police)/;

/**
 * ¿Alguna fuente recuperada es de tema sensible? (fiscal R3)
 *
 * La derivación obligatoria del PLAN §3/§11 ("SIEMPRE deriva en temas
 * sensibles") no puede depender solo de la heurística de keywords sobre la
 * pregunta — un fraseo indirecto o un idioma no cubierto la saltearían. Acá
 * la sensibilidad se deriva del CONTENIDO que se va a citar: si el RAG trajo
 * una guía de inmigración/legal/salud/finanzas (sus topics los cura el
 * pipeline), el route handler fuerza `sensitive=true` y el botón a
 * profesionales, sin importar cómo se haya formulado la pregunta.
 */
export function hasSensitiveChunk(
  chunks: ReadonlyArray<{ metadata: Record<string, unknown> }>,
): boolean {
  for (const chunk of chunks) {
    const topics = chunk.metadata.topics;
    if (!Array.isArray(topics)) continue;
    for (const topic of topics) {
      if (typeof topic === "string" && SENSITIVE_CHUNK_TOPIC_RE.test(normalize(topic))) {
        return true;
      }
    }
  }
  return false;
}
