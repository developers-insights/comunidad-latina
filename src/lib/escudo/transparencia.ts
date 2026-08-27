/**
 * =============================================================================
 * LOS NÚMEROS DEL ESCUDO — lectura, derivación y formato
 * =============================================================================
 *
 * Todo lo que se muestra en /escudo/transparencia pasa por acá. El módulo es
 * PURO a propósito: no importa Supabase, no toca `headers()` y no sabe qué es un
 * tenant. Recibe el jsonb que devolvió `public.escudo_transparencia()` (0122) y
 * devuelve lo que la pantalla dibuja. Así la regla difícil —cuándo un número se
 * puede mostrar y cuándo no— se puede fijar en un test en vez de quedar suelta
 * dentro de un componente.
 *
 * ── LA REGLA QUE ORDENA TODO EL ARCHIVO ─────────────────────────────────────
 * Una cifra falsa en una pantalla de seguridad destruye exactamente lo que la
 * pantalla intenta construir. De ahí salen las tres decisiones de abajo, y las
 * tres son la misma decisión mirada desde ángulos distintos:
 *
 *   1. UN CERO ES UN DATO; UNA LECTURA FALLIDA NO ES UN CERO.
 *      `parseMetricas` devuelve `null` ante CUALQUIER campo ausente o con forma
 *      inesperada, y no completa con ceros. "No pudimos leer los números" es una
 *      pantalla honesta; "0 denuncias recibidas" cuando en realidad la consulta
 *      falló es una mentira, y de las que tranquilizan.
 *
 *   2. LA VENTANA LA DICE LA BASE, NO EL FRONT.
 *      `ventanaDias` viene en la respuesta y el copy se deriva de ahí
 *      (`describirVentana`). Si algún día la función SQL cambia a 90 días, la
 *      pantalla dice "los últimos 3 meses" sola. Repetir el 365 como constante
 *      del front es la forma más barata de terminar mostrando un período que no
 *      es el que se contó.
 *
 *   3. CON POCA MUESTRA NO HAY NÚMERO.
 *      Una mediana sobre dos revisiones no es una mediana: es una anécdota con
 *      forma de estadística. Debajo de `MINIMO_PARA_MEDIANA` la pantalla no
 *      muestra un tiempo, muestra por qué todavía no lo hay.
 *
 * Nada de esto es exceso de celo: la app se la deja leer a gente que está por
 * decidir si le manda plata a un desconocido.
 */

/**
 * Muestra mínima para publicar una mediana de tiempo de revisión.
 *
 * Cinco y no tres: con tres casos, uno solo que quedó abierto un fin de semana
 * ya ES la mediana. Cinco tampoco es mucho — no pretende significancia
 * estadística, sólo que el número no lo escriba un caso raro.
 */
export const MINIMO_PARA_MEDIANA = 5;

/**
 * Debajo de este total de señales, la pantalla antepone el cartel de "todavía
 * tenemos poca historia".
 *
 * NO oculta los números: los enmarca. La diferencia importa — esconder un cero
 * es lo que hace una plataforma que tiene algo que tapar, y mostrar un cero
 * pelado sin contexto se lee como un error de la app. El cartel dice la tercera
 * cosa, que es la verdadera: la comunidad es nueva y todavía pasó poco.
 */
export const MINIMO_PARA_HISTORIA = 12;

/** Espejo tipado del jsonb de `public.escudo_transparencia()` (0122). */
export interface MetricasEscudo {
  /** Días que abarca el conteo. Lo dice la base; ver la regla 2 de la cabecera. */
  ventanaDias: number;
  denunciasRecibidas: number;
  /** Denuncias que moderación confirmó (`status = 'upheld'`). */
  denunciasConfirmadas: number;
  /** Denuncias todavía abiertas o en curso (`open` + `reviewing`). */
  denunciasEnRevision: number;
  /** Avisos que la 0118 sacó de circulación sola, por acumulación de denuncias. */
  avisosPausados: number;
  /** Avisos que volvieron después de la revisión. El sistema también se equivoca. */
  avisosRestituidos: number;
  /** Consultas a registros oficiales cuyo resultado fue "matrícula activa". */
  verificacionesActivas: number;
  revisionesResueltas: number;
  /** Mediana en horas, o `null` cuando no hubo ninguna revisión resuelta. */
  revisionHorasMediana: number | null;
}

const CLAVES_ENTERAS = [
  ["ventanaDias", "ventana_dias"],
  ["denunciasRecibidas", "denuncias_recibidas"],
  ["denunciasConfirmadas", "denuncias_confirmadas"],
  ["denunciasEnRevision", "denuncias_en_revision"],
  ["avisosPausados", "avisos_pausados"],
  ["avisosRestituidos", "avisos_restituidos"],
  ["verificacionesActivas", "verificaciones_activas"],
  ["revisionesResueltas", "revisiones_resueltas"],
] as const;

/**
 * Postgres devuelve `numeric` como string por PostgREST cuando no entra en un
 * float seguro, y `count(*)` como number. Se aceptan las dos formas y NADA más:
 * un booleano o un objeto no se "convierten", se rechazan.
 */
function aNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function aEnteroNoNegativo(valor: unknown): number | null {
  const n = aNumero(valor);
  if (n === null || !Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * El jsonb de la RPC → métricas tipadas, o `null`.
 *
 * TODO O NADA (regla 1 de la cabecera). Si falta un campo o viene con otra
 * forma, no se completa con ceros: se devuelve `null` y la pantalla dice que no
 * pudo leer los números. Un cero inventado en esta pantalla es peor que un
 * error visible.
 */
export function parseMetricas(raw: unknown): MetricasEscudo | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const fuente = raw as Record<string, unknown>;

  const enteros: Partial<Record<(typeof CLAVES_ENTERAS)[number][0], number>> = {};
  for (const [destino, origen] of CLAVES_ENTERAS) {
    const n = aEnteroNoNegativo(fuente[origen]);
    if (n === null) return null;
    enteros[destino] = n;
  }
  // Una ventana de 0 días no cuenta nada: el resto de los números no
  // significaría lo que dice el rótulo.
  if (enteros.ventanaDias === 0) return null;

  // La mediana es el único campo que PUEDE ser null con sentido: cuando no hubo
  // ninguna revisión resuelta, no hay qué medir. `undefined` o basura, en
  // cambio, siguen siendo una lectura fallida.
  const brutoMediana = fuente["revision_horas_mediana"];
  let mediana: number | null = null;
  if (brutoMediana !== null) {
    const n = aNumero(brutoMediana);
    if (n === null || n < 0) return null;
    mediana = n;
  }

  return {
    ventanaDias: enteros.ventanaDias!,
    denunciasRecibidas: enteros.denunciasRecibidas!,
    denunciasConfirmadas: enteros.denunciasConfirmadas!,
    denunciasEnRevision: enteros.denunciasEnRevision!,
    avisosPausados: enteros.avisosPausados!,
    avisosRestituidos: enteros.avisosRestituidos!,
    verificacionesActivas: enteros.verificacionesActivas!,
    revisionesResueltas: enteros.revisionesResueltas!,
    revisionHorasMediana: mediana,
  };
}

/**
 * Miles con punto, a mano y no con `Intl`.
 *
 * `Intl.NumberFormat("es-AR")` depende del ICU con el que se haya compilado
 * Node: en un build small-icu devuelve "1,234" y la pantalla mostraría el
 * separador equivocado según dónde corra. Acá el resultado es el mismo en toda
 * máquina, que es lo único que se le pide a un formateador de cifras.
 */
export function formatearEntero(n: number): string {
  const entero = Math.max(0, Math.trunc(n));
  const digitos = String(entero);
  let salida = "";
  for (let i = 0; i < digitos.length; i += 1) {
    if (i > 0 && (digitos.length - i) % 3 === 0) salida += ".";
    salida += digitos[i];
  }
  return salida;
}

/**
 * "los últimos 12 meses", "los últimos 3 meses", "el último mes", "los últimos
 * 45 días". Sale de `ventanaDias`, que lo dice la base (regla 2).
 */
export function describirVentana(dias: number): string {
  if (dias >= 360 && dias <= 370) return "los últimos 12 meses";
  if (dias >= 28 && dias <= 31) return "el último mes";
  if (dias % 30 === 0 && dias >= 60) return `los últimos ${dias / 30} meses`;
  return `los últimos ${formatearEntero(dias)} días`;
}

/**
 * Horas → texto humano. Se redondea SIEMPRE hacia arriba en la unidad que se
 * muestra: prometer menos espera de la real es la única forma de equivocarse que
 * acá tiene costo.
 */
export function formatearEspera(horas: number): string {
  if (horas < 1) return "menos de 1 hora";
  if (horas < 48) {
    const enteras = Math.round(horas);
    return enteras === 1 ? "1 hora" : `${formatearEntero(enteras)} horas`;
  }
  const dias = Math.round(horas / 24);
  return dias === 1 ? "1 día" : `${formatearEntero(dias)} días`;
}

export type EsperaTipica =
  | { estado: "sin_muestra"; resueltas: number }
  | { estado: "conocida"; resueltas: number; horas: number; texto: string };

/**
 * El tiempo de revisión, o la razón por la que todavía no hay uno.
 *
 * Ver la regla 3 de la cabecera: debajo de `MINIMO_PARA_MEDIANA` no se publica
 * un número. Y no es lo mismo "no hay muestra" que "cero": cero horas sería una
 * afirmación, y no tenemos ninguna que hacer.
 */
export function esperaTipica(metricas: MetricasEscudo): EsperaTipica {
  const { revisionesResueltas: resueltas, revisionHorasMediana: horas } = metricas;
  if (horas === null || resueltas < MINIMO_PARA_MEDIANA) {
    return { estado: "sin_muestra", resueltas };
  }
  return { estado: "conocida", resueltas, horas, texto: formatearEspera(horas) };
}

/**
 * Cuánta señal acumuló la comunidad. Suma sólo lo que representa ACTIVIDAD del
 * Escudo: denuncias, pausas y verificaciones. Las restituciones no se cuentan
 * aparte —ya están implicadas en las pausas— y sumarlas inflaría el total con lo
 * mismo contado dos veces.
 */
export function totalDeSenales(metricas: MetricasEscudo): number {
  return (
    metricas.denunciasRecibidas +
    metricas.avisosPausados +
    metricas.verificacionesActivas +
    metricas.revisionesResueltas
  );
}

/** ¿Corresponde el cartel de "todavía tenemos poca historia"? */
export function hayPocaHistoria(metricas: MetricasEscudo): boolean {
  return totalDeSenales(metricas) < MINIMO_PARA_HISTORIA;
}

export interface Cifra {
  clave: string;
  etiqueta: string;
  /** Ya formateado. La pantalla no hace cuentas. */
  valor: string;
  nota: string;
  /**
   * `true` cuando el valor es 0. La pantalla lo usa para pintarlo en tono
   * neutro con un "todavía", nunca en rojo: un cero acá no es una falla, es una
   * comunidad joven.
   */
  todavia: boolean;
}

/**
 * Las cifras del panel, en el orden en que se leen y con la nota que las hace
 * interpretables. La nota NO es decoración: un número sin la frase que dice qué
 * cuenta y qué no cuenta es exactamente el tipo de dato que después se
 * malinterpreta a favor nuestro.
 */
export function cifrasDelPanel(metricas: MetricasEscudo): Cifra[] {
  const ventana = describirVentana(metricas.ventanaDias);
  return [
    {
      clave: "denuncias",
      etiqueta: "Denuncias recibidas",
      valor: formatearEntero(metricas.denunciasRecibidas),
      nota:
        metricas.denunciasEnRevision > 0
          ? `En ${ventana}. Hay ${formatearEntero(metricas.denunciasEnRevision)} sin resolver todavía.`
          : `En ${ventana}. Cuenta lo que la comunidad avisó, no todo lo que pasó.`,
      todavia: metricas.denunciasRecibidas === 0,
    },
    {
      clave: "confirmadas",
      etiqueta: "Denuncias confirmadas",
      valor: formatearEntero(metricas.denunciasConfirmadas),
      nota: `En ${ventana}. Alguien del equipo las miró y les dio la razón.`,
      todavia: metricas.denunciasConfirmadas === 0,
    },
    {
      clave: "pausados",
      etiqueta: "Avisos pausados solos",
      valor: formatearEntero(metricas.avisosPausados),
      nota: `En ${ventana}. Salieron de circulación por acumular denuncias, sin esperar a un moderador.`,
      todavia: metricas.avisosPausados === 0,
    },
    {
      clave: "restituidos",
      etiqueta: "Avisos que volvieron",
      valor: formatearEntero(metricas.avisosRestituidos),
      nota: `En ${ventana}. Se revisaron, no había nada, y volvieron a estar visibles.`,
      todavia: metricas.avisosRestituidos === 0,
    },
    {
      clave: "verificaciones",
      etiqueta: "Matrículas activas",
      valor: formatearEntero(metricas.verificacionesActivas),
      nota: `En ${ventana}. Figuraban activas en un registro oficial el día que las consultamos.`,
      todavia: metricas.verificacionesActivas === 0,
    },
  ];
}
