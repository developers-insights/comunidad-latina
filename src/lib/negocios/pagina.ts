/**
 * =============================================================================
 * LA PÁGINA DE UN NEGOCIO — reglas puras, compartidas por el formulario y el
 * servidor (migración 0127)
 * =============================================================================
 *
 * Call del 3/9 (punto 14 del feedback): «falta poder editar la información de
 * la otra cuenta y agregar los servicios que da cada perfil», y el botón
 * «Subir la foto» del perfil-como-negocio llevaba a una página sin ningún
 * campo para subir nada.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE ─────────────────────────────────────────────
 * Los mismos límites tienen que regir en tres lugares: el formulario (para
 * avisar ANTES de mandar), la server action (que es la que decide) y el CHECK
 * de la base (que es el que no se puede saltear). Tres copias del número 12
 * derivan; una sola constante, no.
 *
 * Es un módulo PURO a propósito: sin `server-only`, sin imports de Supabase.
 * Así lo puede importar el componente cliente del formulario sin arrastrar el
 * cliente de servidor al bundle. Lo que necesita servidor (leer la ficha, subir
 * la foto) vive en `pagina-query.ts` y en la server action.
 *
 * ⚠️ Los topes de largo son el ESPEJO de `guardar_pagina_de_negocio` y del
 * CHECK `listings_services_shape` (0127). Si cambia uno, cambian los dos: la
 * base es la que manda, esto es lo que permite explicar el rechazo en español
 * en vez de mostrar un 23514.
 */

/** Cuántos servicios entran en la lista. Espejo del CHECK de la 0127. */
export const MAX_SERVICIOS = 12;
/** Largo de cada servicio, ya recortado. Espejo del CHECK de la 0127. */
export const MAX_LARGO_SERVICIO = 60;

export const MIN_LARGO_TITULO = 2;
export const MAX_LARGO_TITULO = 80;
export const MAX_LARGO_DESCRIPCION = 2000;
export const MAX_LARGO_ZONA = 80;
/** Los cuatro botones del comercio (0048). Laxo a propósito: varios países. */
export const MAX_LARGO_CONTACTO = 120;

/**
 * Deja la lista como la va a guardar la base: recorta, tira los vacíos, saca
 * repetidos y corta en el tope CONSERVANDO EL ORDEN en que la persona los
 * escribió (es su menú, no un set).
 *
 * Los repetidos se comparan sin distinguir mayúsculas ni espacios de más
 * («Plomería» y «plomería  » son el mismo servicio): dos filas idénticas en la
 * página pública se leen como un error del negocio, no como una decisión.
 */
export function normalizarServicios(entrada: readonly string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const crudo of entrada) {
    const servicio = crudo.trim().replace(/\s+/g, " ");
    if (servicio.length === 0) continue;
    const clave = servicio.toLocaleLowerCase("es");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(servicio);
    if (salida.length === MAX_SERVICIOS) break;
  }
  return salida;
}

export type ProblemaDeServicios = "demasiados" | "muy_largo";

/**
 * Qué le pasa a una lista YA normalizada, o `null` si está bien.
 *
 * `normalizarServicios` corta en el tope, así que "demasiados" sólo aparece
 * cuando alguien manda el array a mano sin pasar por el formulario — y ahí es
 * exactamente donde hace falta el chequeo.
 */
export function problemaDeServicios(
  servicios: readonly string[],
): ProblemaDeServicios | null {
  if (servicios.length > MAX_SERVICIOS) return "demasiados";
  if (servicios.some((servicio) => servicio.trim().length > MAX_LARGO_SERVICIO)) {
    return "muy_largo";
  }
  return null;
}

// ---------------------------------------------------------------------------
// LAS DOS FOTOS DE LA IDENTIDAD DEL NEGOCIO
//
// El logo es circular en todos lados (avatar del header, cambiador de perfil,
// tarjeta del directorio) y la portada es un banner apaisado — las mismas dos
// formas que ya tienen el avatar y la portada de una persona (0062, 0100), y
// por eso los mismos criterios.
// ---------------------------------------------------------------------------

export type TipoDeFotoDeNegocio = "logo" | "portada";

/** Lo que el navegador puede mandar. El tipo REAL lo verifica el servidor. */
export const FOTO_MIME_ACEPTADOS = ["image/jpeg", "image/png", "image/webp"] as const;

/** Formatos que `sharp` tiene que reconocer en los bytes de verdad. */
export const FOTO_FORMATOS_ACEPTADOS = ["jpeg", "png", "webp"] as const;

/**
 * 5 MB, el mismo tope que el avatar y la portada de una persona (0100, donde
 * además lo aplica el bucket). Cómodo para una foto de celular y muy por
 * debajo del `bodySizeLimit` de 11 MB de las server actions (next.config.ts):
 * el archivo viaja POR la action para que el servidor pueda mirarlo antes de
 * escribir nada en el bucket.
 */
export const MAX_FOTO_BYTES = 5 * 1024 * 1024;

/**
 * Mínimos y máximos de la imagen ORIGINAL, en píxeles.
 *
 * El mínimo no es capricho: un logo de 80 px se ve roto apenas alguien lo mira
 * en un teléfono con pantalla densa, y es mejor decirlo al subir que dejar que
 * el negocio descubra su propia foto pixelada en el directorio. El máximo ataja
 * la bomba de descompresión: una imagen de 30.000 px de lado pesa poco
 * comprimida y revienta la memoria al decodificarla.
 */
export const FOTO_LADO_MAXIMO = 8000;
export const LOGO_LADO_MINIMO = 200;
export const PORTADA_ANCHO_MINIMO = 640;
export const PORTADA_ALTO_MINIMO = 240;

/** A qué tamaño se guarda cada una, ya normalizada por el servidor. */
export const LOGO_SALIDA = { ancho: 512, alto: 512 } as const;
export const PORTADA_SALIDA = { ancho: 1600, alto: 600 } as const;

export type ProblemaDeFoto =
  | "tipo"
  | "peso"
  | "vacia"
  | "ilegible"
  | "chica"
  | "enorme";

/**
 * ¿Las dimensiones alcanzan para esta foto? Pura y testeada aparte porque es
 * la regla que más fácil se escribe al revés (ancho por alto, mínimo por
 * máximo) y la que el servidor aplica sobre los bytes reales.
 */
export function problemaDeDimensiones(
  tipo: TipoDeFotoDeNegocio,
  ancho: number,
  alto: number,
): ProblemaDeFoto | null {
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho < 1 || alto < 1) {
    return "ilegible";
  }
  if (ancho > FOTO_LADO_MAXIMO || alto > FOTO_LADO_MAXIMO) return "enorme";
  if (tipo === "logo") {
    return ancho < LOGO_LADO_MINIMO || alto < LOGO_LADO_MINIMO ? "chica" : null;
  }
  return ancho < PORTADA_ANCHO_MINIMO || alto < PORTADA_ALTO_MINIMO ? "chica" : null;
}

/**
 * El path del archivo dentro del bucket `listing-photos`. El prefijo es el
 * canónico de la 0012 —`{tenant_id}/{listing_id}/`—, que es lo que la policy de
 * Storage y la RPC `guardar_fotos_de_negocio` vuelven a exigir cada una por su
 * lado.
 *
 * El prefijo `logo-` / `portada-` no es decorativo: hace legible el bucket
 * cuando hay que mirar qué ocupa lugar, y distingue de un vistazo estas dos
 * fotos de las de la galería del aviso.
 */
export function pathDeFotoDeNegocio(
  tipo: TipoDeFotoDeNegocio,
  tenantId: string,
  listingId: string,
  id: string,
): string {
  return `${tenantId}/${listingId}/${tipo === "logo" ? "logo" : "portada"}-${id}.webp`;
}

/** ¿Este path cae DENTRO de la carpeta de este aviso? (nunca la de otro). */
export function esPathDeEsteNegocio(
  path: string,
  tenantId: string,
  listingId: string,
): boolean {
  return path.startsWith(`${tenantId}/${listingId}/`) && !path.includes("..");
}
