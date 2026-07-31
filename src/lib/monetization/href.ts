import { safeExternalHref } from "@/lib/url/safe-href";
import { CTA_VALUE_KIND, parseListingKind, type ExternalCtaKind } from "./tier";

// ---------------------------------------------------------------------------
// Dónde vive cada aviso
// ---------------------------------------------------------------------------

/**
 * Ruta del DETALLE de un aviso, o `null` si ese vertical todavía no tiene
 * pantalla propia.
 *
 * `null` es un dato, no un olvido: hoy Negocios se resuelve en su listado y las
 * colaboraciones de creadores viven dentro de su propio flujo. Devolver una
 * ruta inventada haría que "Ver mi publicación" llevara a un 404 justo después
 * de publicar, que es el peor momento posible para que algo no funcione.
 */
export function listingDetailHref(kind: unknown, id: string): string | null {
  switch (parseListingKind(kind)) {
    case "property":
      return `/propiedades/${id}`;
    case "business":
      return `/negocios/${id}`;
    case "professional":
      return `/profesionales/${id}`;
    case "event":
      return `/eventos/${id}`;
    case "job":
      return `/empleos/${id}`;
    case "product":
      return `/marketplace/${id}`;
    default:
      return null;
  }
}

/** Listado del módulo. Siempre existe: es el fallback de `listingDetailHref`. */
export function listingModuleHref(kind: unknown): string {
  switch (parseListingKind(kind)) {
    case "property":
      return "/propiedades";
    case "business":
      return "/negocios";
    case "professional":
      return "/profesionales";
    case "event":
      return "/eventos";
    case "job":
      return "/empleos";
    case "product":
      return "/marketplace";
    case "creator_gig":
      return "/creadores";
    default:
      return "/feed";
  }
}

/** Adónde mandar a alguien que quiere VER lo que acaba de publicar. */
export function listingViewHref(kind: unknown, id: string): string {
  return listingDetailHref(kind, id) ?? listingModuleHref(kind);
}

/**
 * DE UN VALOR GUARDADO A UN `href` QUE SE PUEDE PONER EN EL DOM.
 *
 * Los cuatro botones de link pasan por `safeExternalHref` y no por una
 * comparación de strings: ese módulo clasifica por ORIGEN RESUELTO justamente
 * porque `zod.url()` acepta `javascript:` y porque `//evil.com` y `/\evil.com`
 * ya se colaron una vez como "navegación interna". Acá no se lo esquiva ni se
 * lo "mejora": se lo usa.
 *
 * Devolver `null` significa NO MOSTRAR EL BOTÓN. Nunca significa mostrarlo
 * roto: un botón que no lleva a ningún lado en la pantalla de un comercio es
 * peor que no tenerlo, porque parece que el comercio no funciona.
 */

export interface CtaHref {
  href: string;
  /** true ⇒ abrir en pestaña nueva con `rel="noopener noreferrer"`. */
  external: boolean;
  /** El valor legible que se le puede leer a alguien (número, dirección). */
  display: string;
}

/**
 * Teléfono → sólo `+` inicial y dígitos. El valor guardado es LAXO a propósito
 * (la 0048 acepta espacios, paréntesis y guiones porque la comunidad escribe
 * números de varios países); el esquema `tel:` no los quiere, así que la
 * normalización vive acá y no en la base.
 */
export function telDigits(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * WhatsApp usa `wa.me/<solo dígitos>` — sin `+`, sin espacios. Un número sin
 * código de país igual abre WhatsApp; abrirlo con el número mal formado sería
 * mandar a la persona a un chat vacío, así que se exige un mínimo de 8 dígitos
 * (mismo piso que la campaña de posts ya usa).
 */
export function whatsappDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

/**
 * "Cómo llegar" → búsqueda en el mapa por TEXTO.
 *
 * Se manda la dirección que el comercio ELIGIÓ publicar, que es dato público
 * de su aviso, y NO coordenadas: `listings.geo_zone` es un geohash truncado a
 * ~5 km precisamente porque el plan prohíbe el punto exacto, y un botón no es
 * motivo para reabrir esa decisión (la 0048 lo dice con todas las letras).
 */
export function mapsSearchHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

export function ctaHref(kind: ExternalCtaKind, raw: string | null | undefined): CtaHref | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  switch (CTA_VALUE_KIND[kind]) {
    case "phone": {
      if (kind === "whatsapp") {
        const digits = whatsappDigits(value);
        if (!digits) return null;
        return { href: `https://wa.me/${digits}`, external: true, display: value };
      }
      const digits = telDigits(value);
      if (!digits) return null;
      return { href: `tel:${digits}`, external: false, display: value };
    }

    case "url": {
      const safe = safeExternalHref(value);
      // Un "Sitio web" que resuelve al propio sitio no es un sitio web: la base
      // exige `^https?://` y acá se exige que además sea de otro origen.
      if (!safe || !safe.external) return null;
      return { href: safe.href, external: true, display: safe.href };
    }

    case "text": {
      if (value.length < 5) return null;
      return { href: mapsSearchHref(value), external: true, display: value };
    }
  }
}
