/**
 * DETECCIÓN LOCAL DEL TIPO DE PUBLICACIÓN — heurística léxica, sin IA y sin red.
 *
 * Pedido del cliente: "el sistema debe identificar automáticamente el tipo de
 * publicación y enviarla al módulo correspondiente". El "+" ya resuelve esto
 * con tiles explícitos (`@/components/shell/create-menu`); lo que falta es
 * el composer GENÉRICO del feed — cuando alguien escribe ahí un texto que en
 * realidad es una oferta, una propiedad, un empleo, un evento o un artículo en
 * venta, el sistema lo nota y lo SUGIERE. Nunca decide por la persona: el
 * consumidor de este módulo (el chip en `post-composer.tsx`) es una propuesta
 * descartable, jamás un redireccionamiento automático.
 *
 * ============================================================================
 * REGLA MADRE: "MEJOR NO SUGERIR QUE SUGERIR MAL"
 * ============================================================================
 * Un falso positivo acá es peor que un falso negativo: interrumpir a alguien
 * que está charlando en el feed con un chip que no tiene nada que ver cuesta
 * confianza en la función entera (la próxima vez la ignora, aunque acierte).
 * Un falso negativo cuesta una oportunidad — bastante más barato. Por eso el
 * umbral es conservador a propósito, en dos niveles:
 *
 *  · SEÑAL FUERTE — una frase tan específica de un tipo de publicación que
 *    alcanza SOLA ("se alquila", "se busca personal", "2x1"). Nadie dice
 *    "se alquila" hablando de otra cosa.
 *  · SEÑAL DÉBIL — una palabra suelta que aparece en más contextos ("cuarto",
 *    "empleo", "precio"). Sola no alcanza; hacen falta DOS señales débiles del
 *    MISMO tipo para asumir que no es casualidad.
 *
 * ============================================================================
 * QUÉ SE TOLERA A PROPÓSITO (documentado, no es un olvido)
 * ============================================================================
 *
 * FALSOS NEGATIVOS aceptados (preferimos el silencio):
 *  · Un solo indicio débil ("tengo un cuarto libre") no alcanza sin una
 *    segunda señal — se calla, aunque en los hechos sea una oferta real.
 *  · Sinónimos regionales fuera de la lista ("chamba", "laburo", "depa") o
 *    spanglish más allá de "aplicar" (ya asentado como término de uso común
 *    para postularse a un empleo en la comunidad latina en EE. UU.) no están
 *    cubiertos en esta primera versión.
 *  · Texto en inglés puro: el público de este feed escribe mayormente en
 *    español o spanglish leve; cubrir inglés integral queda para una v2 si el
 *    volumen lo justifica.
 *
 * FALSOS POSITIVOS aceptados (el resto del umbral no los evita del todo):
 *  · Alguien que combina por escrito dos señales débiles de tipos distintos en
 *    una charla normal ("che, con este calor no doy más, necesito una
 *    changa de lo que sea, aunque sea medio tiempo") — coincidencia posible
 *    pero rara; no se persigue con reglas cada vez más específicas porque cada
 *    regla nueva agrega su propio riesgo de falso positivo en otro lado.
 *
 * ============================================================================
 * "BUSCO TRABAJO" NO ES UNA VACANTE — y su análogo en vivienda
 * ============================================================================
 * Quien ESCRIBE buscando algo (trabajo, cuarto) no está OFRECIENDO ese mismo
 * algo. Sugerirle "publicá un empleo" a alguien que busca trabajo es el peor
 * tipo de error de este módulo: le dice, sin querer, que confundimos su
 * necesidad con su oferta. Por eso `empleo` y `propiedad` tienen listas de
 * EXCLUSIÓN ("busco/buscando/necesito trabajo|empleo", su equivalente en
 * cuarto/apartamento/habitación, y negaciones como "no se alquila"): si
 * aparece una de esas frases, ese tipo NO se sugiere aunque el resto del
 * texto reúna señales suficientes.
 *
 * ============================================================================
 * NORMALIZACIÓN
 * ============================================================================
 * Todo el texto (entrada y listas de señales) se compara en minúscula y sin
 * tildes (`NFD` + descarte de marcas combinantes). Efecto colateral conocido
 * e inofensivo: la "ñ" se descompone en "n" + tilde combinante y también
 * pierde su tilde ("año" → "ano"). Ninguna señal de este archivo depende de
 * "ñ" ni de la distinción "n"/"ñ", así que no genera falsos positivos —
 * se documenta acá para que quien lea esto no lo redescubra debuggeando.
 */

/** Los cinco tipos que este módulo sabe reconocer. */
export type TipoSugerenciaComposer =
  | "oferta"
  | "propiedad"
  | "empleo"
  | "evento"
  | "articulo";

export interface SugerenciaComposer {
  tipo: TipoSugerenciaComposer;
  /** Copy del chip — cálido, formulado como pregunta (ver `post-composer.tsx`). */
  etiqueta: string;
  /** Ruta EXACTA del formulario destino, verificada contra `shell/create-menu.tsx`. */
  href: string;
}

/** Debajo de este largo (ya recortado) no hay contexto suficiente para nada. */
const LARGO_MINIMO = 15;

/** Hacen falta al menos DOS señales débiles del mismo tipo para sugerir. */
const UMBRAL_SEÑALES_DEBILES = 2;

interface DefinicionTipo {
  tipo: TipoSugerenciaComposer;
  etiqueta: string;
  href: string;
  /** Una sola alcanza. */
  fuertes: string[];
  /** Hacen falta {@link UMBRAL_SEÑALES_DEBILES} para que cuenten. */
  debiles: string[];
  /**
   * Presente cualquiera de éstas, el tipo NO se sugiere — pisa a `fuertes` y
   * `debiles` por igual. Cubre "está buscando" en vez de "está ofreciendo" y
   * negaciones explícitas.
   */
  exclusiones: string[];
  /**
   * Chequeo adicional, más allá de listas de frases — hoy sólo lo usan
   * `evento` (combinación día+hora) y `oferta` (porcentaje de descuento),
   * donde una frase suelta no alcanza a expresar el patrón.
   */
  patronFuerteExtra?: RegExp;
  /**
   * Exclusión con forma de patrón, para cuando la lista de frases literales
   * no alcanza: "busco trabajo" se escribe también "se busca empleo de
   * cocinero", "ando buscando un cuarto", "estoy en busca de un empleo" — la
   * persona OFRECIÉNDOSE o PIDIENDO, con artículos y palabras en el medio que
   * ninguna lista finita de strings pegados va a cubrir. El gap tolerado es
   * de UNA palabra ({0,1}): con dos ya entra "se busca personal para trabajo
   * de limpieza", que ES una vacante real y no debe excluirse.
   */
  patronExclusionExtra?: RegExp;
}

/**
 * Quita tildes/diéresis (`NFD` + descarte de marcas combinantes), pasa a
 * minúscula y colapsa espacios. Ver el docblock de arriba sobre el efecto
 * colateral en "ñ" — deliberadamente no se repara acá.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Aparece `señal` como PALABRA/FRASE completa en `normalizado`? Con límites
 * de palabra en los dos extremos — así "renta" no matchea dentro de otra
 * palabra más larga, y una frase de varias palabras ("se alquila") exige esas
 * palabras exactas y seguidas (los espacios del medio son literales).
 *
 * `señal` ya tiene que venir normalizada (minúscula, sin tildes) — todas las
 * listas de este archivo lo están.
 */
function contieneSeñal(normalizado: string, señal: string): boolean {
  const escapada = señal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escapada}\\b`, "u").test(normalizado);
}

/** Cuántas señales de `lista` aparecen en `normalizado` (sin repetir por texto largo). */
function contarSeñales(normalizado: string, lista: string[]): number {
  return lista.reduce((total, señal) => (contieneSeñal(normalizado, señal) ? total + 1 : total), 0);
}

// ---------------------------------------------------------------------------
// EVENTO — combinación día de la semana + hora ("este sábado a las 8pm", "el
// viernes 9:30pm"). Una frase suelta no alcanza a expresar esto; hace falta un
// patrón. Corre sobre el texto YA normalizado (por eso los días van sin tilde).
// ---------------------------------------------------------------------------
const DIAS_SEMANA = "lunes|martes|miercoles|jueves|viernes|sabado|domingo";
const PATRON_DIA_Y_HORA = new RegExp(
  `\\b(${DIAS_SEMANA})\\b[^.!?\\n]{0,25}\\b\\d{1,2}(:\\d{2})?\\s?(am|pm|hs|h)\\b`,
  "u",
);

// ---------------------------------------------------------------------------
// OFERTA — "20% off" / "20% de descuento". El símbolo "%" hace que una lista
// de frases sueltas sea incómoda (el número varía); un patrón lo resuelve.
// ---------------------------------------------------------------------------
const PATRON_PORCENTAJE_DESCUENTO = /\b\d{1,3}\s?%\s?(de\s+)?(descuento|off)\b/u;

/**
 * Las cinco definiciones, en el ORDEN en que se evalúan. El orden es el
 * desempate cuando un texto —caso raro— reúne señales de más de un tipo a la
 * vez: no hay un sistema de puntaje, gana el primero que cumple.
 *
 * `empleo` y `propiedad` van primero porque tienen el vocabulario más
 * específico (menor riesgo de falso positivo) y porque redirigir mal en esos
 * dos formularios es lo más costoso — son los que piden datos sensibles
 * (dirección, condiciones de pago). `articulo` va último porque su vocabulario
 * ("vendo", "precio") es el más genérico y el que más se solapa con `oferta`.
 */
const DEFINICIONES: DefinicionTipo[] = [
  {
    tipo: "empleo",
    etiqueta: "¿Tenés una vacante?",
    href: "/empleos/publicar",
    fuertes: [
      "se busca personal",
      "se solicita personal",
      "solicitamos personal",
      "estamos contratando",
      "vacante disponible",
      "posicion disponible",
    ],
    debiles: [
      "se busca",
      "vacante",
      "empleo",
      "trabajo de",
      "pago por hora",
      "tiempo completo",
      "medio tiempo",
      "aplicar",
      "enviar cv",
      "contratando",
      "entrevista",
    ],
    exclusiones: [
      "busco trabajo",
      "busco empleo",
      "busco un trabajo",
      "busco un empleo",
      "buscando trabajo",
      "buscando empleo",
      "necesito trabajo",
      "necesito empleo",
      "en busca de trabajo",
      "en busca de empleo",
    ],
    // Persona ofreciéndose ("se busca empleo de cocinero", "buscando un
    // trabajo") o preguntando por terceros ("alguien conoce trabajo cerca?").
    // Ver el docblock de patronExclusionExtra por el gap de {0,1}.
    patronExclusionExtra:
      /\b(?:se\s+)?(?:busco|busca|buscando|necesito|necesita|solicito|en\s+busca\s+de)(?:\s+\S+)?\s+(?:trabajo|empleo|chamba|laburo)\b|\b(?:alguien|quien)(?:\s+\S+)?\s+(?:trabajo|empleo)\b/,
  },
  {
    tipo: "propiedad",
    etiqueta: "¿Alquilás un cuarto o apartamento?",
    href: "/publicar?kind=property",
    fuertes: ["se alquila", "se renta", "en alquiler", "en renta"],
    debiles: [
      "alquilo",
      "rento",
      "cuarto",
      "apartamento",
      "habitacion",
      "deposito",
      "amoblado",
      "amueblado",
      "recamara",
      "por mes",
      "renta mensual",
    ],
    exclusiones: [
      "busco cuarto",
      "busco apartamento",
      "busco habitacion",
      "buscando cuarto",
      "buscando apartamento",
      "buscando habitacion",
      "necesito cuarto",
      "necesito apartamento",
      "necesito habitacion",
      "quien alquila",
      "quien renta",
      "alguien alquila",
      "alguien renta",
      "no se alquila",
      "no se renta",
    ],
    // Análogo de empleo: quien PIDE un techo no está alquilando uno.
    // "se busca cuarto", "ando buscando un apartamento", "en busca de una
    // habitacion economica". Gap de {0,1} por la misma razón.
    patronExclusionExtra:
      /\b(?:se\s+)?(?:busco|busca|buscando|necesito|necesita|solicito|en\s+busca\s+de)(?:\s+\S+)?\s+(?:cuarto|apartamento|habitacion|depto|casa|techo)\b/,
  },
  {
    tipo: "evento",
    etiqueta: "¿Estás organizando un evento?",
    href: "/publicar?kind=event",
    fuertes: ["entradas disponibles", "boletos disponibles"],
    debiles: [
      "evento",
      "entradas",
      "boletos",
      "en vivo",
      "no te lo pierdas",
      "abrimos puertas",
      "este sabado",
      "este domingo",
      "este viernes",
    ],
    exclusiones: [],
    patronFuerteExtra: PATRON_DIA_Y_HORA,
  },
  {
    tipo: "oferta",
    etiqueta: "¿Es una promo de tu negocio?",
    href: "/publicar?kind=business",
    fuertes: ["oferta valida", "promocion valida", "2x1", "3x2"],
    debiles: [
      "descuento",
      "promocion",
      "oferta especial",
      "solo por hoy",
      "solo esta semana",
    ],
    exclusiones: ["no hay descuento", "no hay oferta"],
    patronFuerteExtra: PATRON_PORCENTAJE_DESCUENTO,
  },
  {
    tipo: "articulo",
    etiqueta: "¿Estás vendiendo algo?",
    href: "/marketplace/publicar",
    fuertes: ["se vende"],
    debiles: [
      "vendo",
      "precio",
      "usado",
      "nuevo en caja",
      "como nuevo",
      "negociable",
      "envio incluido",
      "poco uso",
    ],
    exclusiones: ["no vendo", "no se vende", "no esta en venta"],
  },
];

/**
 * ¿`definicion` se cumple en `normalizado`? Cualquier exclusión presente
 * pisa todo lo demás (ver docblock "BUSCO TRABAJO NO ES UNA VACANTE").
 */
function cumpleDefinicion(normalizado: string, definicion: DefinicionTipo): boolean {
  if (definicion.exclusiones.some((exclusion) => contieneSeñal(normalizado, exclusion))) {
    return false;
  }
  if (definicion.patronExclusionExtra?.test(normalizado)) {
    return false;
  }
  const tieneSeñalFuerte =
    definicion.fuertes.some((fuerte) => contieneSeñal(normalizado, fuerte)) ||
    (definicion.patronFuerteExtra?.test(normalizado) ?? false);
  if (tieneSeñalFuerte) return true;

  return contarSeñales(normalizado, definicion.debiles) >= UMBRAL_SEÑALES_DEBILES;
}

/**
 * Punto de entrada del módulo. Puro: mismo texto, mismo resultado, sin tocar
 * red ni DOM. `null` = no hay sugerencia (el caso normal — la enorme mayoría
 * de lo que se escribe en el feed es charla, no un listing disfrazado).
 *
 * @param texto El cuerpo TAL COMO se está escribiendo (sin recortar antes de
 *   llamar — el recorte y el mínimo de {@link LARGO_MINIMO} caracteres los
 *   resuelve esta función).
 */
export function detectarTipoDePublicacion(texto: string): SugerenciaComposer | null {
  const limpio = texto.trim();
  if (limpio.length < LARGO_MINIMO) return null;

  const normalizado = normalizar(limpio);

  for (const definicion of DEFINICIONES) {
    if (cumpleDefinicion(normalizado, definicion)) {
      return { tipo: definicion.tipo, etiqueta: definicion.etiqueta, href: definicion.href };
    }
  }
  return null;
}
