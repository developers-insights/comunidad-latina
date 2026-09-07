import { TIPOS_DE_ADJUNTO } from "./adjuntos";

/**
 * =============================================================================
 * LO QUE SE COMPARTIÓ EN UN GRUPO — contrato compartido (0136 + 0140)
 * =============================================================================
 *
 * Lógica pura: sin Supabase, sin `server-only`, sin React. La consulta la
 * importa desde el servidor y la lista desde el navegador, y las dos tienen que
 * estar de acuerdo en qué entra en cada solapa y cómo se lee un cursor — si eso
 * se escribe dos veces, "Ver más" empieza a saltear filas y nadie se entera.
 *
 * ─── POR QUÉ EL CURSOR ES `(created_at, id)` Y NO UN NÚMERO DE PÁGINA ───────
 * `range()`/`OFFSET` obliga a Postgres a contar y descartar las filas que ya
 * pasaron: la página 20 de un grupo con diez mil mensajes es un scan de todo lo
 * anterior. Con keyset la consulta siempre arranca donde quedó la anterior.
 *
 * `created_at` solo NO alcanza como clave: dos mensajes del mismo milisegundo
 * —una tanda de fotos entra así— empatan, y un `lt` sobre el empate saltea o
 * repite. Por eso el desempate por `id`, que es el mismo orden que usa
 * `listarMensajesDelGrupo`.
 */

export const SOLAPAS_DE_GALERIA = ["multimedia", "archivos", "enlaces"] as const;
export type SolapaDeGaleria = (typeof SOLAPAS_DE_GALERIA)[number];

/**
 * Cuántos ítems trae cada tanda. Multimedia va en grilla de tres y el resto en
 * filas, así que el número es múltiplo de 3 y de 2: cualquiera de las dos
 * formas cierra sin una fila coja al final.
 */
export const ITEMS_POR_TANDA = 24;

export function parsearSolapa(value: unknown): SolapaDeGaleria {
  return (SOLAPAS_DE_GALERIA as readonly string[]).includes(value as string)
    ? (value as SolapaDeGaleria)
    : "multimedia";
}

export interface CursorDeGaleria {
  createdAt: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `~` como separador: no aparece en un timestamp ISO ni en un uuid, y viaja por
 * una query string sin escaparse.
 */
export function armarCursor(cursor: CursorDeGaleria): string {
  return `${cursor.createdAt}~${cursor.id}`;
}

/**
 * El cursor llega de la URL o del cliente, así que se valida como cualquier
 * entrada: sin esto, un `created_at` inventado se interpola en el `.or()` de
 * PostgREST, que es un lenguaje de filtros con su propia sintaxis.
 */
export function parsearCursor(value: unknown): CursorDeGaleria | null {
  if (typeof value !== "string") return null;
  const corte = value.lastIndexOf("~");
  if (corte <= 0) return null;

  const createdAt = value.slice(0, corte);
  const id = value.slice(corte + 1);
  if (!UUID_RE.test(id)) return null;
  if (Number.isNaN(Date.parse(createdAt))) return null;
  // Un timestamp legítimo de PostgREST no trae ni comillas ni comas ni
  // paréntesis; cualquiera de esas rompería el filtro en vez de filtrar.
  if (/["',()]/.test(createdAt)) return null;

  return { createdAt, id };
}

/**
 * EL PRIMER ENLACE DE UN MENSAJE DE TEXTO.
 *
 * La consulta prefiltra con un `ilike '%http%'` —que también atrapa palabras
 * como "httpd"— y esta función es la que decide de verdad. Devolver `null` acá
 * significa que la fila no era un enlace y no se muestra.
 *
 * La puntuación final se recorta porque escribir «mirá esto https://x.com/a.»
 * es lo normal, y el punto no es parte de la dirección.
 */
export function primerEnlaceDelCuerpo(body: string | null | undefined): string | null {
  const texto = (body ?? "").trim();
  if (!texto) return null;

  const encontrado = texto.match(/https?:\/\/[^\s<>"']+/i);
  if (!encontrado) return null;

  const limpio = encontrado[0].replace(/[.,;:!?)\]}]+$/, "");
  try {
    const url = new URL(limpio);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return limpio;
  } catch {
    return null;
  }
}

/**
 * Cómo se nombra un enlace en la lista: el dominio y, si aporta, el principio
 * de la ruta. La URL entera no entra en 375 px y termina cortada justo donde
 * dejaba de decir algo.
 */
export function etiquetaDeEnlace(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    const ruta = parsed.pathname.replace(/\/+$/, "");
    if (!ruta || ruta === "/") return host;
    return `${host}${ruta.length > 28 ? `${ruta.slice(0, 28)}…` : ruta}`;
  } catch {
    return url;
  }
}

/**
 * `312 KB`, `2,5 MB`. Coma decimal y salto a KB debajo del mega: un PDF de
 * 300 KB mostrado como "0,3 MB" se lee como si no pesara nada.
 */
export function pesoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * `application/pdf` → `PDF`. Sale del mismo mapa que valida la subida, así que
 * un tipo que la app no acepta nunca llega acá con nombre propio.
 */
export function tipoLegible(mime: string | null | undefined): string {
  const extension = mime ? TIPOS_DE_ADJUNTO[mime] : undefined;
  return extension ? extension.toUpperCase() : "Archivo";
}

/**
 * UN ÍTEM DE LA GALERÍA, YA LISTO PARA PINTAR.
 *
 * ⚠️ VIVE ACÁ Y NO AL LADO DE LA FUNCIÓN QUE LO ARMA, por el mismo motivo que
 * `FilaDeBandeja` vive en `bandeja.ts`: quien lo construye
 * (`multimedia/armar.ts`) abre con `import "server-only"`, y quien lo pinta
 * (`galeria-lista.tsx`) es un client component. Con el tipo declarado allá, un
 * `import type` que debería evaporarse alcanza para arrastrar el módulo entero
 * y romper el build con "'server-only' cannot be imported from a Client
 * Component". Ya pasó una vez en este repo.
 *
 * Y TIENE QUE SER SERIALIZABLE: cruza la frontera al cliente en los dos
 * caminos —el primer render y el "Ver más"—, así que nada de `Date`, `Map` ni
 * funciones. La fecha viaja ya escrita en la zona horaria de quien lee,
 * resuelta en el servidor; formatearla en el navegador haría que el primer
 * render y la hidratación pudieran escribir días distintos.
 */
export type ItemDeGaleria = {
  mensajeId: string;
  /** Quién lo mandó y cuándo, ya listos para leer. */
  quien: string;
  cuando: string;
} & (
  | {
      clase: "media";
      tipo: "imagen" | "video";
      /** URL firmada (1 h). `null` cuando la firma no se pudo emitir. */
      src: string | null;
      ancho: number | null;
      alto: number | null;
    }
  | { clase: "archivo"; nombre: string; tipo: string; peso: string }
  | { clase: "enlace"; titulo: string; detalle: string | null }
);
