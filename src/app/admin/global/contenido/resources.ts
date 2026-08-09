/**
 * Catálogo de lo que se puede LISTAR por comunidad.
 *
 * El pliego enumera nueve cosas ("usuarios, publicaciones, negocios,
 * profesionales, empleos, propiedades, eventos, marketplace e influencers") y
 * esta constante es esa lista, en ese orden, sin abreviar. Es un módulo puro a
 * propósito: la página lo usa para las pestañas, la capa de datos para elegir
 * la consulta, y el test para verificar que no falte ninguno.
 *
 * Los siete que salen de `listings` no son un atajo: en el esquema, un negocio
 * y un evento SON un listing con otro `kind` (migraciones 0004 y 0024). Se
 * listan por separado porque así los pide el pliego y así los piensa quien
 * administra, no porque sean tablas distintas.
 */

export const RESOURCE_KEYS = [
  "usuarios",
  "publicaciones",
  "negocios",
  "profesionales",
  "empleos",
  "propiedades",
  "eventos",
  "marketplace",
  "influencers",
] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export function isResourceKey(value: unknown): value is ResourceKey {
  return RESOURCE_KEYS.includes(value as ResourceKey);
}

export const DEFAULT_RESOURCE: ResourceKey = "usuarios";

/** De qué tabla sale cada listado, y con qué filtro. */
export type ResourceSource =
  | { table: "profiles" }
  | { table: "posts" }
  | { table: "creator_profiles" }
  | { table: "listings"; kind: "business" | "professional" | "job" | "property" | "event" | "product" };

export interface ResourceDefinition {
  key: ResourceKey;
  /** Etiqueta de la pestaña. */
  label: string;
  /** Título de la pantalla cuando esta pestaña está activa. */
  title: string;
  /** Qué se está mirando, en una línea. */
  intro: string;
  emptyTitle: string;
  emptyMessage: string;
  source: ResourceSource;
}

export const RESOURCES: Record<ResourceKey, ResourceDefinition> = {
  usuarios: {
    key: "usuarios",
    label: "Usuarios",
    title: "Usuarios",
    intro: "Todas las cuentas de esta comunidad, de la más nueva a la más vieja.",
    emptyTitle: "Sin cuentas todavía",
    emptyMessage: "Cuando alguien se registre en esta comunidad, va a aparecer acá.",
    source: { table: "profiles" },
  },
  publicaciones: {
    key: "publicaciones",
    label: "Publicaciones",
    title: "Publicaciones",
    intro: "Lo que la comunidad publicó en el feed: textos, fotos, videos y encuestas.",
    emptyTitle: "Feed en silencio",
    emptyMessage: "Todavía no hay publicaciones en esta comunidad.",
    source: { table: "posts" },
  },
  negocios: {
    key: "negocios",
    label: "Negocios",
    title: "Negocios",
    intro: "Los negocios cargados en el directorio de esta comunidad.",
    emptyTitle: "Sin negocios",
    emptyMessage: "Todavía nadie cargó un negocio en esta comunidad.",
    source: { table: "listings", kind: "business" },
  },
  profesionales: {
    key: "profesionales",
    label: "Profesionales",
    title: "Profesionales",
    intro: "Quiénes ofrecen sus servicios en esta comunidad.",
    emptyTitle: "Sin profesionales",
    emptyMessage: "Todavía nadie se ofreció como profesional en esta comunidad.",
    source: { table: "listings", kind: "professional" },
  },
  empleos: {
    key: "empleos",
    label: "Empleos",
    title: "Empleos",
    intro: "Los avisos de trabajo publicados en esta comunidad.",
    emptyTitle: "Sin avisos de trabajo",
    emptyMessage: "Todavía no hay empleos publicados en esta comunidad.",
    source: { table: "listings", kind: "job" },
  },
  propiedades: {
    key: "propiedades",
    label: "Propiedades",
    title: "Propiedades",
    intro: "Vivienda en alquiler o venta publicada en esta comunidad.",
    emptyTitle: "Sin propiedades",
    emptyMessage: "Todavía no hay vivienda publicada en esta comunidad.",
    source: { table: "listings", kind: "property" },
  },
  eventos: {
    key: "eventos",
    label: "Eventos",
    title: "Eventos",
    intro: "Lo que se organiza en esta comunidad, del anuncio más nuevo al más viejo.",
    emptyTitle: "Sin eventos",
    emptyMessage: "Todavía no hay eventos anunciados en esta comunidad.",
    source: { table: "listings", kind: "event" },
  },
  marketplace: {
    key: "marketplace",
    label: "Marketplace",
    title: "Marketplace",
    intro: "Los productos que se venden en esta comunidad.",
    emptyTitle: "Sin productos",
    emptyMessage: "Todavía nadie puso un producto a la venta en esta comunidad.",
    source: { table: "listings", kind: "product" },
  },
  influencers: {
    key: "influencers",
    label: "Influencers",
    title: "Influencers",
    intro: "Las cuentas de creadores de contenido de esta comunidad y en qué estado están.",
    emptyTitle: "Sin creadores",
    emptyMessage: "Todavía nadie activó su perfil de creador en esta comunidad.",
    source: { table: "creator_profiles" },
  },
};

/**
 * Etiquetas de `status` que comparten listings, posts y perfiles. Se usan tal
 * cual en la pastilla de cada fila: quien administra no tiene por qué saber que
 * abajo dice `pending_review`.
 */
export const STATUS_LABEL: Record<string, string> = {
  published: "Publicado",
  pending_review: "En revisión",
  draft: "Borrador",
  removed: "Dado de baja",
  active: "Activa",
  suspended: "Suspendida",
  banned: "Dada de baja",
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
  paused: "En pausa",
};

export function statusVariant(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "published" || status === "active" || status === "approved") return "success";
  if (status === "pending_review" || status === "pending" || status === "suspended") {
    return "warning";
  }
  if (status === "removed" || status === "banned" || status === "rejected") return "danger";
  return "neutral";
}
