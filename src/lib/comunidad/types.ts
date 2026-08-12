import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * CONTRATOS DEL MÓDULO COMUNIDAD (migración 0096)
 * =============================================================================
 *
 * Todo lo de este archivo es transcripción literal de la migración. Cuando el
 * SQL y esto se contradigan, manda el SQL — pero que no se contradigan es
 * responsabilidad de quien toque cualquiera de los dos.
 *
 * `src/lib/types/database.types.ts` está generado a la altura de la migración
 * 0076, así que `community_resources` y `marcar_caso_resuelto` todavía no
 * existen para TypeScript. Se usa el MISMO escape acotado que ya usan reseñas
 * (`src/lib/resenas/types.ts`) y disputas: un cast en una función con nombre
 * feo, más interfaces de fila escritas a mano al lado de cada uso. Tiene la
 * misma fecha de vencimiento: cuando se regeneren los tipos, esto se borra y
 * las interfaces se reemplazan por `Tables<"community_resources">`.
 *
 * `listings` SÍ está tipado (es de 0004) — Perdido y encontrado no necesita el
 * escape para leer ni para escribir avisos, sólo para llamar a la RPC nueva.
 */

// ===========================================================================
// Perdido y encontrado — `listings` con kind = 'lost_found'
// ===========================================================================

/** `listings.kind` del módulo. Se fija en el servidor, jamás llega del cliente. */
export const LOST_FOUND_KIND = "lost_found";

/** Las dos caras de la sección. Viven en `attrs.lf_type`. */
export const LOST_FOUND_TYPES = ["lost", "found"] as const;
export type LostFoundType = (typeof LOST_FOUND_TYPES)[number];

/**
 * Categorías de objeto. Cerradas a propósito: con texto libre, "documentos",
 * "papeles" y "mi pasaporte" son tres categorías distintas y el filtro deja de
 * servir. El orden es el de frecuencia real esperada, no alfabético.
 */
export const LOST_FOUND_CATEGORIES = [
  "documentos",
  "llaves",
  "telefono",
  "billetera",
  "mochila",
  "mascota",
  "otro",
] as const;
export type LostFoundCategory = (typeof LOST_FOUND_CATEGORIES)[number];

/** Tope de fotos por caso — mismo que el resto de los flujos de publicar. */
export const LOST_FOUND_MAX_PHOTOS = 4;

/** Espejan los `check` de zod en las actions; también los usa el formulario. */
export const LOST_FOUND_TITLE_MIN = 6;
export const LOST_FOUND_TITLE_MAX = 100;
export const LOST_FOUND_DESCRIPTION_MIN = 20;
export const LOST_FOUND_DESCRIPTION_MAX = 1200;
export const LOST_FOUND_AREA_MIN = 3;
export const LOST_FOUND_AREA_MAX = 80;

/**
 * `listings.attrs` de un caso, ya parseado. Todos los campos pueden faltar:
 * `attrs` es jsonb y nadie garantiza su forma desde el lado de la base.
 */
export interface LostFoundAttrs {
  type: LostFoundType | null;
  category: LostFoundCategory | null;
  /** Fecha aproximada del hecho, `YYYY-MM-DD`. Nunca una hora. */
  happenedOn: string | null;
  /** ISO de cuando el dueño lo marcó resuelto (`app.marcar_caso_resuelto`). */
  resolvedAt: string | null;
}

/**
 * Contenido de un caso, sin quién lo publicó.
 *
 * El publicador NO vive acá a propósito: su forma (`PublisherView` con Trust
 * Score y señales) la define `@/components/listings`, y este paquete es puro —
 * no importa componentes. La vista con publicador se arma en
 * `src/app/(app)/comunidad/queries.ts`, que es donde ya se está leyendo la base.
 */
export interface LostFoundCase {
  id: string;
  title: string;
  description: string | null;
  areaLabel: string | null;
  photos: string[];
  type: LostFoundType | null;
  category: LostFoundCategory | null;
  happenedOn: string | null;
  resolvedAt: string | null;
  publishedAtLabel: string;
  /** true sólo para quien lo publicó: habilita el botón de "ya apareció". */
  isOwner: boolean;
}

// ===========================================================================
// Recursos — `public.community_resources` (0096)
// ===========================================================================

/**
 * Temas del directorio. El ORDEN de este arreglo es el orden en que se muestran
 * los grupos en pantalla, y no es alfabético: arriba lo que la gente busca
 * cuando algo se puso urgente.
 */
export const RESOURCE_TOPICS = [
  "emergencias",
  "migracion",
  "salud",
  "comida",
  "consulados",
  "legal",
  "vivienda",
  "educacion",
] as const;
export type ResourceTopic = (typeof RESOURCE_TOPICS)[number];

/** Fila de `public.community_resources`, tal cual la 0096. */
export interface ResourceRow {
  id: string;
  tenant_id: string | null;
  topic: string;
  name: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  area_label: string | null;
  hours_note: string | null;
  languages: string[] | null;
  cost_note: string | null;
  requirements_note: string | null;
  source_name: string;
  source_url: string;
  source_checked_at: string;
  status: string;
}

/** Columnas que pide la app. Escrito una vez para no over-fetchear por página. */
export const RESOURCE_COLUMNS =
  "id, tenant_id, topic, name, description, phone, website, address, area_label, " +
  "hours_note, languages, cost_note, requirements_note, source_name, source_url, " +
  "source_checked_at, status";

/**
 * Procedencia de UNA ficha. Es un tipo propio y no tres campos sueltos porque
 * las tres cosas se muestran SIEMPRE juntas: quién lo dice, dónde lo dice y
 * cuándo lo confirmamos. Separarlas invita a mostrar dos de las tres.
 */
export interface ResourceSource {
  name: string;
  url: string;
  /** `YYYY-MM-DD`. */
  checkedAt: string;
}

/** Un recurso listo para render. */
export interface CommunityResource {
  id: string;
  topic: ResourceTopic;
  name: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  areaLabel: string | null;
  hoursNote: string | null;
  languages: string[];
  costNote: string | null;
  requirementsNote: string | null;
  source: ResourceSource;
}

/** Un tema con sus recursos. Sólo se arma si tiene al menos uno. */
export interface ResourceGroup {
  topic: ResourceTopic;
  resources: CommunityResource[];
}

// ===========================================================================
// El escape de tipado
// ===========================================================================

/**
 * Cast acotado para las cosas de la 0096 que el archivo de tipos generado
 * todavía no conoce (`community_resources`, `marcar_caso_resuelto`).
 *
 * Nombre feo a propósito, misma convención que `supabaseSinTipar` en reseñas:
 * tiene que ser imposible usarlo sin darse cuenta de que ahí se pierde el
 * tipado. Cada uso va pegado a la interfaz de fila que corresponde, así el
 * tipado se pierde en el borde y se recupera en la línea siguiente.
 */
export function supabaseSinTiparComunidad(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}
