/**
 * =============================================================================
 * EDITAR UN AVISO YA PUBLICADO — reglas puras y textos
 * =============================================================================
 *
 * Pedido del dueño del producto (call, mirando un aviso de servicio): «si quiero
 * editar esta publicidad de servicio, tampoco la puedo editar como se puede
 * editar acá [un post del feed]… falta ese botón para todas estas publicaciones,
 * y el botón de edición, los tres dots ahí arriba».
 *
 * Todo lo de este archivo es PURO —sin I/O, sin `server-only`— para que la
 * misma regla decida qué ofrece el menú (cliente) y qué acepta la server action
 * (servidor). Cuando esas dos definiciones se separan, aparece el botón que
 * siempre falla.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EDITAR DEVUELVE EL AVISO A REVISIÓN
 * -----------------------------------------------------------------------------
 * No es una decisión de producto: es el contrato de la base. El WITH CHECK de
 * `listings_update` (0004, última versión 0075) sólo deja al DUEÑO dejar la fila
 * en draft / pending_review / paused / removed / closed. `published` está
 * excluido a propósito —anti bait-and-switch: un aviso no se reescribe después
 * de pasar moderación— y por lo tanto NINGÚN update del dueño puede conservar un
 * aviso publicado. Un UPDATE que intente `status = 'published'` con el JWT de la
 * persona rebota con 42501, no "a veces": siempre.
 *
 * O sea que el camino honesto es uno solo, y de paso es el seguro: lo editado
 * vuelve a `pending_review` y se publica de nuevo cuando lo aprueban. Eso es
 * también lo que cierra el agujero de las fotos —una foto nueva nunca llega a
 * verse antes de que la mire el mismo pipeline que la mira en el alta.
 *
 * Lo que SÍ se puede hacer sin volver a revisión está separado en su propio
 * gesto: PAUSAR (published → paused). No cambia una letra del contenido, así que
 * no hay nada que volver a moderar.
 */

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 * Estados desde los que se puede abrir la hoja de edición.
 *
 * `expired` NO está: un aviso vencido se renueva (0098), y ofrecer "editar"
 * ahí mandaría a alguien a corregir el texto de algo que igual no se ve.
 * `removed` y `closed` tampoco: el primero lo bajó moderación y no se resuelve
 * editando, el segundo ya cumplió su objetivo ("ya se alquiló").
 */
const EDITABLES = new Set(["published", "paused", "pending_review"]);

/** Qué status queda después de guardar, según el que tenía. */
export function statusDespuesDeEditar(status: string): "pending_review" | "paused" {
  // Un aviso pausado por su dueño sigue pausado: no se ve, así que devolverlo a
  // la cola sería hacerle perder el turno a alguien cuyo aviso sí está esperando.
  // Vuelve a revisión cuando la persona lo reactiva.
  return status === "paused" ? "paused" : "pending_review";
}

/**
 * ¿Se le ofrece "Editar" a esta publicación?
 *
 * `pausadaPorReportes` es la excepción que ya existe en el resto del módulo
 * (ver `puedeCerrarPublicacion`): un aviso pausado por denuncias no lo
 * desbloquea su dueño reescribiéndolo.
 */
export function puedeEditarse(status: string, pausadaPorReportes = false): boolean {
  return EDITABLES.has(status) && !pausadaPorReportes;
}

/** Pausar es sólo para lo que está a la vista. */
export function puedePausarse(status: string): boolean {
  return status === "published";
}

/** Reactivar: sale de la pausa del dueño, nunca de una pausa por denuncias. */
export function puedeReactivarse(status: string, pausadaPorReportes = false): boolean {
  return status === "paused" && !pausadaPorReportes;
}

/**
 * El motivo por el que un aviso está pausado, leído de `attrs`.
 *
 * `attrs` es jsonb libre (doctrina 0107): entra como `unknown` y se angosta acá,
 * en un solo lugar, para que nadie vuelva a escribir el `as Record<...>` suelto.
 */
export function pausadoPorReportes(status: string, attrs: unknown): boolean {
  if (status !== "paused") return false;
  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};
  return record.paused_reason === "reports";
}

/** Marca de pausa propia. Lo que la distingue de `'reports'` (0118). */
export const PAUSA_DEL_DUENO = "owner" as const;

// ---------------------------------------------------------------------------
// Campos: qué se edita en cada vertical
// ---------------------------------------------------------------------------

/**
 * Topes de forma. Son los del alta del Marketplace (`productDraftSchema`) con
 * una sola diferencia deliberada: el título admite desde 5 caracteres en vez de
 * 8, porque hay verticales donde el título es un nombre propio ("Ana Paz") y un
 * piso de 8 le prohibiría a esa persona corregirle una tilde a su propia ficha.
 */
export const EDICION_LIMITES = {
  tituloMin: 5,
  tituloMax: 120,
  descripcionMax: 4000,
  precioMax: 1_000_000,
  fotosMax: 10,
} as const;

/** Qué muestra la hoja para este vertical. */
export interface CamposEditables {
  /** ¿Lleva precio? Un profesional o una ficha de negocio, no. */
  precio: boolean;
  /** Cómo se llama el precio acá — "Precio" no sirve para un alquiler. */
  precioEtiqueta: string;
  /** Cómo se llama la descripción acá. */
  descripcionEtiqueta: string;
  /** ¿La hoja ofrece tocar las fotos? */
  fotos: boolean;
  /** Cómo se nombra el aviso en los textos ("tu aviso", "tu producto"). */
  sustantivo: string;
}

const CAMPOS_POR_KIND: Record<string, CamposEditables> = {
  property: {
    precio: true,
    precioEtiqueta: "Precio del alquiler",
    descripcionEtiqueta: "Descripción",
    fotos: true,
    sustantivo: "tu aviso",
  },
  product: {
    precio: true,
    precioEtiqueta: "Precio",
    descripcionEtiqueta: "Descripción",
    fotos: true,
    sustantivo: "tu producto",
  },
  job: {
    precio: true,
    precioEtiqueta: "Sueldo o pago",
    descripcionEtiqueta: "Descripción del trabajo",
    fotos: true,
    sustantivo: "tu aviso de trabajo",
  },
  service: {
    precio: true,
    precioEtiqueta: "Precio del servicio",
    descripcionEtiqueta: "Qué incluye",
    fotos: true,
    sustantivo: "tu servicio",
  },
  event: {
    precio: true,
    precioEtiqueta: "Precio de la entrada",
    descripcionEtiqueta: "Descripción",
    fotos: true,
    sustantivo: "tu evento",
  },
  creator_gig: {
    precio: true,
    precioEtiqueta: "Lo que ofrecés pagar",
    descripcionEtiqueta: "Descripción",
    fotos: true,
    sustantivo: "tu colaboración",
  },
  professional: {
    // Una ficha de profesional no publica una tarifa: cobra por consulta y eso
    // se conversa. El alta tampoco la pide.
    precio: false,
    precioEtiqueta: "",
    descripcionEtiqueta: "Sobre vos y tu trabajo",
    fotos: true,
    sustantivo: "tu ficha",
  },
  lost_found: {
    precio: false,
    precioEtiqueta: "",
    descripcionEtiqueta: "Qué pasó",
    fotos: true,
    sustantivo: "tu aviso",
  },
};

const CAMPOS_POR_DEFECTO: CamposEditables = {
  precio: false,
  precioEtiqueta: "",
  descripcionEtiqueta: "Descripción",
  fotos: true,
  sustantivo: "tu aviso",
};

export function camposEditables(kind: string): CamposEditables {
  return CAMPOS_POR_KIND[kind] ?? CAMPOS_POR_DEFECTO;
}

/**
 * `business` no se edita con esta hoja: ya tiene su propia página de edición
 * (`/negocios/[id]/editar`) con rubro, servicios, horarios, logo y portada.
 * Duplicarla en una hoja acotada sería ofrecer dos verdades sobre lo mismo.
 */
export function editaEnPaginaPropia(kind: string): string | null {
  return kind === "business" ? "editar-negocio" : null;
}

// ---------------------------------------------------------------------------
// ¿Cambió algo?
// ---------------------------------------------------------------------------

export interface ValoresDeAviso {
  title: string;
  description: string;
  /** null = el aviso no tiene precio (o el vertical no lo usa). */
  priceAmount: number | null;
  /** Paths de storage tal cual están guardados, NO urls. */
  photos: readonly string[];
}

/**
 * ¿Hay algo distinto entre lo que había y lo que la persona escribió?
 *
 * Una sola definición, usada por el botón "Guardar" (para apagarse) y por la
 * action (para no mandar a revisión un aviso que nadie tocó — que sería sacarlo
 * del muro a cambio de nada).
 */
export function hayCambios(actual: ValoresDeAviso, nuevo: ValoresDeAviso): boolean {
  if (actual.title.trim() !== nuevo.title.trim()) return true;
  if (actual.description.trim() !== nuevo.description.trim()) return true;
  if ((actual.priceAmount ?? null) !== (nuevo.priceAmount ?? null)) return true;
  if (actual.photos.length !== nuevo.photos.length) return true;
  return actual.photos.some((path, index) => path !== nuevo.photos[index]);
}

/** Las fotos que NO estaban antes: son las únicas que necesitan moderarse. */
export function fotosNuevas(
  antes: readonly string[],
  ahora: readonly string[],
): string[] {
  const previas = new Set(antes);
  return ahora.filter((path) => !previas.has(path));
}

/** Las que se sacaron: se les anota la fecha en el libro de procedencia. */
export function fotosQuitadas(
  antes: readonly string[],
  ahora: readonly string[],
): string[] {
  const actuales = new Set(ahora);
  return antes.filter((path) => !actuales.has(path));
}

/**
 * El precio, tal como lo escribe una persona, convertido a número.
 *
 * Acepta "1.200,50" y "1,200.50" porque las dos formas conviven en la
 * comunidad. Devuelve `null` para el campo vacío (que es un dato: "sin precio")
 * y `undefined` cuando lo escrito no es un precio, para que la hoja pueda
 * decirlo en vez de guardar un cero silencioso.
 */
export function parsearPrecio(crudo: string): number | null | undefined {
  const limpio = crudo.trim();
  if (limpio === "") return null;
  // Se queda con dígitos y separadores; el último separador manda como decimal.
  const soloNumeros = limpio.replace(/[^\d.,]/g, "");
  if (soloNumeros === "") return undefined;
  const ultimoPunto = soloNumeros.lastIndexOf(".");
  const ultimaComa = soloNumeros.lastIndexOf(",");
  const corte = Math.max(ultimoPunto, ultimaComa);
  const entero = (corte >= 0 ? soloNumeros.slice(0, corte) : soloNumeros).replace(
    /[.,]/g,
    "",
  );
  const decimales = corte >= 0 ? soloNumeros.slice(corte + 1).replace(/[.,]/g, "") : "";
  // Tres dígitos después del separador es un separador de miles, no decimales:
  // "1.200" son mil doscientos, no uno con doscientos milésimos.
  const valor =
    decimales.length === 3 && corte >= 0
      ? Number(`${entero}${decimales}`)
      : Number(decimales ? `${entero || "0"}.${decimales}` : entero);
  if (!Number.isFinite(valor) || valor < 0) return undefined;
  return valor;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/**
 * REGLA DE TONO (la misma de `VENCIMIENTO_COPY`): la persona no hizo nada mal.
 * Está corrigiendo algo suyo, que es exactamente lo que queremos que pueda
 * hacer. Y la consecuencia importante —que el aviso vuelve a revisión— se dice
 * ANTES de guardar, no después: enterarse después es enterarse tarde.
 */
export const EDICION_COPY = {
  menu: {
    abrir: "Opciones de esta publicación",
    editar: "Editar",
    editarNegocio: "Editar la página del negocio",
    pausar: "Pausar",
    reactivar: "Volver a publicar",
    verMisPublicaciones: "Mis publicaciones",
  },

  hoja: {
    titulo: "Editar publicación",
    tituloCampo: "Título",
    tituloPlaceholder: "Decí en pocas palabras de qué se trata",
    precioPlaceholder: "0",
    sinPrecio: "Dejalo vacío si no querés mostrar un precio.",
    contador: (usados: number, tope: number) => `${usados} de ${tope}`,
    fotosLabel: "Fotos",
    fotosAgregar: "Agregar fotos",
    fotosQuitar: (n: number, total: number) => `Quitar la foto ${n} de ${total}`,
    fotosTope: (tope: number) => `Podés tener hasta ${tope} fotos.`,
    guardar: "Guardar cambios",
    guardando: "Guardando…",
    cancelar: "Cancelar",
    sinCambios: "Todavía no cambiaste nada.",
    cargando: "Buscando tu publicación…",
  },

  /** El aviso que se lee ANTES de tocar Guardar. */
  revision: {
    publicada:
      "Cuando guardes, tu publicación vuelve a revisión un ratito y se muestra de nuevo apenas la aprobemos. No se borra nada.",
    pausada: "Tu publicación está pausada, así que los cambios quedan guardados sin volver a revisión.",
    enRevision: "Tu publicación ya está en revisión. Los cambios entran en la misma revisión.",
  },

  ok: {
    guardadoTitulo: "Listo, lo guardamos",
    guardadoRevision:
      "Tu publicación vuelve a mostrarse apenas la aprobemos. Te avisamos.",
    guardadoDirecto: "Los cambios ya están.",
    pausadaTitulo: "Tu publicación está pausada",
    pausadaCuerpo:
      "Dejó de mostrarse, pero no se borró nada. Podés volver a publicarla cuando quieras.",
    reactivadaTitulo: "La mandamos a revisión",
    reactivadaCuerpo:
      "Vuelve a mostrarse apenas la aprobemos. Te avisamos cuando esté.",
  },

  errores: {
    generico:
      "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
    necesitaCuenta: "Entrá a tu cuenta para editar tu publicación.",
    noEsTuya: "No encontramos esa publicación entre las tuyas.",
    noSeEdita:
      "Esta publicación no se puede editar ahora. Si el equipo la está revisando, te avisamos cuando termine.",
    tituloCorto: (min: number) => `El título necesita al menos ${min} caracteres.`,
    tituloLargo: (max: number) => `El título entra en ${max} caracteres.`,
    descripcionLarga: (max: number) => `La descripción entra en ${max} caracteres.`,
    precioInvalido: "Escribí el precio con números, por ejemplo 1200.",
    precioAlto: "Ese precio es más alto de lo que aceptamos.",
    fotosMuchas: (tope: number) => `Podés tener hasta ${tope} fotos.`,
    fotoRuta: "Una de las fotos no se subió bien. Probá de nuevo.",
    fotoSubida: "No pudimos subir esa foto. Probá con otra o más tarde.",
    demasiado: "Editaste muchas veces hoy. Probá de nuevo mañana.",
  },
} as const;
