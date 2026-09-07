import type { Metadata } from "next";
import { hrefDeCompartido, type CompartidoKind } from "./enlace-interno";

/**
 * =============================================================================
 * LA TARJETA QUE SE VE CUANDO EL LINK SALE DE LA APP
 * =============================================================================
 *
 * El problema que resuelve, medido antes de escribir una línea: NINGÚN detalle
 * de `(app)` emitía `openGraph`. `/feed/[id]` tenía un `metadata` estático con
 * el título "Publicación" — el mismo para las cuarenta mil publicaciones—, y los
 * siete detalles de aviso emitían `title` y nada más. Resultado: cada enlace
 * pegado en WhatsApp llegaba pelado, sin foto y sin descripción, con el nombre
 * del sitio como único dato. Justo el momento en que compartir tiene que
 * convencer a alguien de abrirlo.
 *
 * `metadataBase` ya está puesto en el layout raíz, así que las rutas relativas
 * de acá resuelven solas contra el origin canónico.
 *
 * ── LO QUE ESTE MÓDULO NO HACE: FILTRAR ─────────────────────────────────────
 * `generateMetadata` corre con el cliente del usuario, así que la RLS decide qué
 * fila vuelve. Pero hay un caso que la RLS NO cubre y que acá sí se cubre: el
 * AUTOR de un aviso en revisión SÍ puede leer su propia fila, y si emitiéramos
 * su título y su foto sin mirar el estado, esa metadata se serviría igual para
 * cualquiera que abra la URL — porque el HTML de una página lo cachean proxies y
 * lo leen crawlers que no son ese autor. Por eso `esPublico()` es una condición
 * aparte de la RLS y no un reemplazo de ella.
 */

/**
 * Los estados de `listings` que cualquiera puede ver: `published` por la policy
 * `listings_select` (0004) y `closed` por su extensión en la 0117. Todo lo demás
 * —draft, pending_review, paused, removed— es visible SÓLO para su dueño o para
 * el equipo, y por lo tanto no se cuenta en ninguna metadata.
 */
const ESTADOS_PUBLICOS = new Set(["published", "closed"]);

export function esPublico(status: string | null | undefined): boolean {
  return typeof status === "string" && ESTADOS_PUBLICOS.has(status);
}

/** Una descripción de tarjeta: sin saltos de línea y sin cortar una palabra. */
export function recortar(texto: string | null | undefined, max = 160): string | null {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  if (limpio.length <= max) return limpio;
  const cortado = limpio.slice(0, max);
  const ultimoEspacio = cortado.lastIndexOf(" ");
  return `${(ultimoEspacio > max * 0.6 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
}

export interface MetadataCompartibleInput {
  kind: CompartidoKind;
  id: string;
  /** Vertical de `listings`, para elegir la ruta canónica cuando kind es listing. */
  vertical?: string | null;
  titulo: string | null | undefined;
  descripcion?: string | null;
  /** URL absoluta de la imagen. `null` cae a la OG por defecto del layout raíz. */
  imagenUrl?: string | null;
  /** Estado de la fila. Si no es público, la metadata sale sin contenido. */
  status?: string | null;
  /** Título cuando no hay uno propio, o cuando la fila no es pública. */
  fallbackTitle: string;
}

/**
 * La metadata de un contenido compartible.
 *
 * Cuando la fila no existe o no es pública devuelve SÓLO el título de respaldo
 * genérico ("Aviso", "Publicación"): sin descripción, sin imagen y sin `og:url`.
 * Una tarjeta vacía es la respuesta correcta a "esto no es para vos" — la
 * alternativa es un `og:title` que le cuenta a WhatsApp lo que la página misma
 * le va a negar al visitante.
 */
export function metadataDeCompartible(input: MetadataCompartibleInput): Metadata {
  const publico = input.status === undefined || esPublico(input.status);
  const titulo = publico ? (input.titulo?.trim() || null) : null;

  if (!publico || !titulo) return { title: input.fallbackTitle };

  const descripcion = recortar(input.descripcion);
  const url = hrefDeCompartido(input.kind, input.id, input.vertical);

  return {
    title: titulo,
    ...(descripcion ? { description: descripcion } : {}),
    openGraph: {
      // `article` y no `website`: es una pieza de contenido con autor y fecha,
      // no la portada de un sitio. Los previsualizadores que distinguen los dos
      // le dan más espacio a la descripción en el primero.
      type: "article",
      title: titulo,
      ...(descripcion ? { description: descripcion } : {}),
      url,
      ...(input.imagenUrl
        ? { images: [{ url: input.imagenUrl, width: 1200, height: 630, alt: titulo }] }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: titulo,
      ...(descripcion ? { description: descripcion } : {}),
      ...(input.imagenUrl ? { images: [input.imagenUrl] } : {}),
    },
    alternates: { canonical: url },
  };
}
