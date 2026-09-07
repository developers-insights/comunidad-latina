/**
 * =============================================================================
 * DE UN ENLACE A UNA TARJETA, Y DE UNA TARJETA A UN ENLACE
 * =============================================================================
 *
 * Este módulo es la traducción en los dos sentidos entre una URL del sitio
 * (`/propiedades/abc…`) y el par `{kind, id}` que viaja en las columnas
 * `compartido_kind` / `compartido_id` de un mensaje.
 *
 * Se usa en dos momentos distintos que son el mismo problema:
 *
 *  1. Alguien toca "Compartir" y elige a quién mandárselo → guardamos el par.
 *  2. Alguien PEGA el link a mano en el chat → lo parseamos al mismo par y la
 *     burbuja pinta la misma tarjeta en vez del link pelado.
 *
 * Es lógica pura a propósito: sin Supabase, sin `server-only`, sin React. Así
 * corre igual en el server (al pintar el hilo) y en el cliente (al previsualizar
 * lo que se está por mandar), y se puede testear sin levantar nada.
 */

/**
 * Los tipos de contenido que se pueden compartir. Espeja el CHECK de
 * `compartido_kind` en la migración: si allá se agrega uno, acá se agrega su
 * ruta o el enlace deja de resolver.
 */
export const COMPARTIDO_KINDS = [
  "post",
  "listing",
  "job",
  "business",
  "video",
  "profile",
  "group",
] as const;

export type CompartidoKind = (typeof COMPARTIDO_KINDS)[number];

export interface EnlaceInterno {
  kind: CompartidoKind;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RUTA CANÓNICA POR TIPO, EN UN SOLO LUGAR.
 *
 * `listing` es el caso raro y por eso no está acá: cuatro rutas distintas
 * (propiedades, marketplace, profesionales, eventos) comparten ese `kind`
 * porque las cuatro son filas de `listings`. Cuál de las cuatro depende de
 * `listings.kind`, que es un dato de la BASE y no del enlace — así que el href
 * de un listing lo arma `hrefDeCompartido` con el vertical ya resuelto.
 */
const RUTA_POR_KIND: Record<Exclude<CompartidoKind, "listing">, string> = {
  post: "/feed",
  job: "/empleos",
  business: "/negocios",
  video: "/videos/largos",
  profile: "/perfil",
  group: "/mensajes/grupos",
};

/**
 * El camino de vuelta: qué `compartido_kind` le corresponde a cada primer
 * segmento de ruta. Las cuatro rutas de `listings` caen todas en `listing`,
 * que es justo lo que queremos guardar — el vertical se vuelve a leer de la
 * base cuando haya que pintar la tarjeta, y así un aviso que cambia de sección
 * no deja mensajes viejos apuntando a una URL que ya no existe.
 */
const KIND_POR_SEGMENTO: Record<string, CompartidoKind> = {
  feed: "post",
  propiedades: "listing",
  marketplace: "listing",
  profesionales: "listing",
  eventos: "listing",
  empleos: "job",
  negocios: "business",
  perfil: "profile",
};

/** Vertical de `listings` → su ruta de detalle. */
const RUTA_POR_VERTICAL: Record<string, string> = {
  property: "/propiedades",
  product: "/marketplace",
  professional: "/profesionales",
  event: "/eventos",
  job: "/empleos",
  business: "/negocios",
};

export function esCompartidoKind(value: unknown): value is CompartidoKind {
  return (
    typeof value === "string" &&
    (COMPARTIDO_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A dónde lleva el botón de una tarjeta compartida.
 *
 * `vertical` sólo importa cuando el kind es `listing`; sin él —o con uno que no
 * reconocemos— se cae al listado de marketplace, que es una pantalla que existe
 * siempre. Nunca se devuelve una ruta inventada: un botón que promete un aviso
 * y entrega un 404 es peor que no tener botón (mismo criterio que
 * `listingDetailHref` en lib/monetization/href.ts).
 */
export function hrefDeCompartido(
  kind: CompartidoKind,
  id: string,
  vertical?: string | null,
): string {
  if (kind !== "listing") return `${RUTA_POR_KIND[kind]}/${id}`;
  const base = vertical ? RUTA_POR_VERTICAL[vertical] : undefined;
  return `${base ?? "/marketplace"}/${id}`;
}

/**
 * Normaliza un origin para compararlo: sin barra final, en minúsculas.
 * `URL.origin` ya viene así, pero `NEXT_PUBLIC_SITE_URL` la escribe una persona
 * en un dashboard y llega de las dos formas.
 */
function normalizarOrigin(value: string): string | null {
  try {
    return new URL(value.trim()).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * ¿ESTA URL ES UNA PUBLICACIÓN NUESTRA?
 *
 * Devuelve `{kind, id}` sólo si la URL apunta a un origin propio Y a una ruta de
 * detalle que sabemos pintar. Cualquier otra cosa —otro dominio, una ruta de
 * listado, un id que no es uuid— devuelve `null`, y quien llama pinta el link
 * como texto, que es el comportamiento de siempre.
 *
 * ── POR QUÉ EL ORIGIN SE VERIFICA Y NO SE ADIVINA ───────────────────────────
 * Sin este filtro, `https://sitio-que-no-es-nuestro.com/feed/<uuid>` se pintaría
 * como una tarjeta con nuestra marca alrededor: alguien podría mandar un link
 * ajeno vestido de publicación de la comunidad. El id que se saca de la URL
 * después se consulta contra la base con el cliente del usuario, así que la RLS
 * sigue siendo la barrera de QUÉ se ve; esto de acá decide si el enlace es
 * NUESTRO, que es una pregunta distinta y que la RLS no puede contestar.
 *
 * ── ALCANCE: SÓLO ENLACES INTERNOS ──────────────────────────────────────────
 * Un link de YouTube, Facebook o Instagram devuelve `null` y se queda como
 * texto. Previsualizar enlaces de terceros exige bajarse la página del otro
 * dominio para leerle los `og:` — o sea, hacer que NUESTRO servidor haga una
 * petición a una URL que eligió un usuario. Eso es SSRF de manual (alcanza la
 * red interna, los metadata endpoints del cloud, `localhost`) y necesita su
 * propio diseño: allowlist de dominios, resolución de DNS con bloqueo de rangos
 * privados, timeouts, tope de tamaño y caché. No entra por la puerta de atrás
 * de esta tanda.
 */
export function parsearEnlaceInterno(
  url: string,
  opciones?: {
    /**
     * Origins que contamos como propios. Por defecto, `NEXT_PUBLIC_SITE_URL`.
     * Se puede pasar más de uno porque en producción el sitio se sirve también
     * bajo el dominio propio de cada comunidad, y un link copiado de ahí es tan
     * nuestro como el canónico.
     */
    origenesPropios?: readonly string[];
  },
): EnlaceInterno | null {
  const crudo = url.trim();
  if (!crudo) return null;

  let parsed: URL;
  try {
    parsed = new URL(crudo);
  } catch {
    return null;
  }

  // `javascript:` y `data:` parsean bien como URL y su `.origin` es "null":
  // el chequeo de protocolo va antes que el de origin, no después.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const propios = (
    opciones?.origenesPropios ?? [process.env.NEXT_PUBLIC_SITE_URL ?? ""]
  )
    .map(normalizarOrigin)
    .filter((origin): origin is string => origin !== null);

  if (propios.length === 0) return null;
  if (!propios.includes(parsed.origin.toLowerCase())) return null;

  const segmentos = parsed.pathname.split("/").filter(Boolean);

  // El video largo es el único de dos segmentos antes del id (`/videos/largos/…`),
  // igual que el grupo (`/mensajes/grupos/…`). Se resuelven antes que el resto
  // para que `videos` y `mensajes` no se lean como si fueran el segmento final.
  if (segmentos.length === 3) {
    const [uno, dos, id] = segmentos;
    if (!UUID_RE.test(id)) return null;
    if (uno === "videos" && dos === "largos") return { kind: "video", id };
    if (uno === "mensajes" && dos === "grupos") return { kind: "group", id };
    return null;
  }

  if (segmentos.length !== 2) return null;

  const [seccion, id] = segmentos;
  if (!UUID_RE.test(id)) return null;

  const kind = KIND_POR_SEGMENTO[seccion];
  return kind ? { kind, id } : null;
}

/**
 * ¿EL MENSAJE ES *SÓLO* UN ENLACE NUESTRO?
 *
 * Se pide que el cuerpo sea el link y nada más. Un mensaje como «mirá esto
 * https://…/propiedades/abc, ¿te sirve?» conserva su texto: reemplazarlo por una
 * tarjeta borraría lo que la persona escribió, que es justamente la parte que
 * ella eligió decir. En ese caso la tarjeta no aparece y el link queda como
 * texto — no se pierde nada.
 */
export function enlaceInternoDelCuerpo(
  body: string | null | undefined,
  opciones?: { origenesPropios?: readonly string[] },
): EnlaceInterno | null {
  const texto = (body ?? "").trim();
  if (!texto || /\s/.test(texto)) return null;
  return parsearEnlaceInterno(texto, opciones);
}
