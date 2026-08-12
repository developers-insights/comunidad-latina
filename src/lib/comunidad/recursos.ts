import {
  RESOURCE_TOPICS,
  type CommunityResource,
  type ResourceGroup,
  type ResourceRow,
  type ResourceTopic,
} from "./types";

/**
 * Lógica PURA del directorio de recursos: validar la procedencia, armar los
 * canales de contacto y agrupar por tema.
 *
 * ── LA REGLA QUE ESTE ARCHIVO HACE CUMPLIR ──────────────────────────────────
 * Una ficha SIN fuente verificable no se muestra. Nunca. `toCommunityResource`
 * devuelve `null` y la fila desaparece del listado.
 *
 * La migración ya lo exige (`source_name`/`source_url`/`source_checked_at` son
 * NOT NULL y la url tiene un CHECK de http(s)), así que en teoría esto no puede
 * pasar. Se valida igual, y no por desconfianza del SQL: si algún día alguien
 * relaja el CHECK, el modo de falla no puede ser que la app empiece a mostrar
 * consejos de salud y de migración sin decir de dónde salieron — se lee como si
 * los diera la plataforma. El precio de la duplicación es una función de diez
 * líneas; el precio de no tenerla lo paga alguien que va a una dirección que ya
 * no existe.
 */

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/**
 * http(s) y nada más. Corta `javascript:`, `data:` y cualquier esquema que un
 * día llegue por una carga de datos mal hecha. Espeja el CHECK de la 0096.
 */
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Teléfono humano → `tel:`. Deja los dígitos y un `+` inicial: los paréntesis,
 * guiones y espacios que hacen legible un número rompen el marcador de algunos
 * Android. Devuelve null si no quedan al menos 5 dígitos (no era un teléfono).
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 5) return null;
  return `tel:${plus}${digits}`;
}

/**
 * Dirección → búsqueda en un mapa. Va a la dirección PÚBLICA de una
 * organización (una clínica, un consulado), nunca a la de una persona: no hay
 * dato personal viajando en el querystring.
 */
export function mapsHref(address: string | null | undefined): string | null {
  const value = (address ?? "").trim();
  if (value.length < 5) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
}

// ---------------------------------------------------------------------------
// Fila → modelo
// ---------------------------------------------------------------------------

function isResourceTopic(value: string): value is ResourceTopic {
  return (RESOURCE_TOPICS as readonly string[]).includes(value);
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fila cruda → recurso listo para render, o `null` si la fila no se puede
 * mostrar con honestidad. Se descarta cuando:
 *   · el tema no es uno de los conocidos (iría a un grupo sin título);
 *   · falta el nombre;
 *   · la procedencia está incompleta o la url no es http(s)  ← la importante;
 *   · no hay NINGÚN canal de contacto (un recurso al que no se llega no lo es).
 */
export function toCommunityResource(row: ResourceRow): CommunityResource | null {
  if (!isResourceTopic(row.topic)) return null;

  const name = cleanText(row.name);
  if (!name) return null;

  const sourceName = cleanText(row.source_name);
  const sourceUrl = cleanText(row.source_url);
  const checkedAt = cleanText(row.source_checked_at);
  if (!sourceName || !sourceUrl || !checkedAt || !isSafeHttpUrl(sourceUrl)) return null;

  const phone = cleanText(row.phone);
  const website = isSafeHttpUrl(row.website) ? cleanText(row.website) : null;
  const address = cleanText(row.address);
  if (!phone && !website && !address) return null;

  return {
    id: row.id,
    topic: row.topic,
    name,
    description: cleanText(row.description),
    phone,
    website,
    address,
    areaLabel: cleanText(row.area_label),
    hoursNote: cleanText(row.hours_note),
    languages: (row.languages ?? []).map((item) => item.trim()).filter(Boolean),
    costNote: cleanText(row.cost_note),
    requirementsNote: cleanText(row.requirements_note),
    source: { name: sourceName, url: sourceUrl, checkedAt },
  };
}

/**
 * Agrupa por tema en el orden de `RESOURCE_TOPICS` (que NO es alfabético: ver
 * su comentario). Un tema sin recursos no genera grupo — un encabezado
 * "Consulados" seguido de nada le dice a alguien que busca ayuda que la sección
 * está rota.
 *
 * Dentro de cada tema, orden alfabético en español: es el único orden que una
 * persona puede predecir en una lista de nombres propios.
 */
export function groupResourcesByTopic(
  resources: readonly CommunityResource[],
): ResourceGroup[] {
  return RESOURCE_TOPICS.flatMap((topic) => {
    const group = resources
      .filter((resource) => resource.topic === topic)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    return group.length > 0 ? [{ topic, resources: group }] : [];
  });
}

/** Filas crudas → grupos listos, descartando por el camino lo que no se puede mostrar. */
export function toResourceGroups(rows: readonly ResourceRow[]): ResourceGroup[] {
  return groupResourcesByTopic(
    rows.flatMap((row) => {
      const resource = toCommunityResource(row);
      return resource ? [resource] : [];
    }),
  );
}
