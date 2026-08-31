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
 *
 * `voluntariado` (migración 0099) y `acopio` (migración 0105) van AL FINAL a
 * propósito, separados de los demás: los otros son "necesito ayuda", estos dos
 * son "quiero darla" —de tiempo uno, de bienes materiales el otro— y ninguno es
 * una urgencia propia. Los dos siguen siendo `community_resources`
 * (organizaciones curadas, con fuente obligatoria) y NO un tablón donde
 * cualquiera publica su convocatoria: ver la portada de Comunidad
 * (`(indice)/page.tsx`) para la decisión completa.
 *
 * OJO: `acopio` (dejar una donación) no es lo mismo que `comida` (recibir
 * comida) — son direcciones opuestas de la misma ayuda. La distinción
 * completa está en el docblock de `0105_centro_de_acopio.sql`.
 *
 * ── LOS CUATRO DE LA 0120, Y POR QUÉ CAEN DONDE CAEN ────────────────────────
 * Los cuatro son "necesito ayuda", así que van ANTES del par que cierra. El
 * orden dentro de ese bloque sigue siendo el de urgencia, no el alfabético:
 *
 *  · `adicciones` y `medicinas` van pegados a `salud` porque son salud: quien
 *    llega a esa altura de la lista está buscando lo mismo y los tres se
 *    escanean juntos. Separarlos obligaría a leer toda la pantalla dos veces.
 *  · `trabajo` va después de `vivienda`: es subsistencia, pero se resuelve en
 *    semanas y no en horas — abajo de tener dónde dormir, arriba de estudiar.
 *  · `fe` cierra el bloque de "necesito", justo antes de los dos de "quiero
 *    dar": una parroquia es las dos cosas a la vez y hace de bisagra natural.
 *
 * `trabajo` NO es el módulo /empleos. Ahí se publican y se postulan vacantes;
 * acá es quién te AYUDA A BUSCAR una (centros de trabajadores, talleres de
 * currículum, bolsas comunitarias). Son dos cosas distintas y confundirlas
 * mandaría a alguien a leer avisos cuando lo que necesita es que alguien lo
 * acompañe.
 */
export const RESOURCE_TOPICS = [
  "emergencias",
  "migracion",
  "salud",
  "adicciones",
  "medicinas",
  "comida",
  "consulados",
  "legal",
  "vivienda",
  "trabajo",
  "educacion",
  "fe",
  "voluntariado",
  "acopio",
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
// Ayuda mutua — `public.community_help_notices` (0120)
// ===========================================================================

/**
 * Las dos caras del tablón, tal cual el CHECK de `direction`.
 *
 *   offer → una persona OFRECE tiempo, manos o cosas.
 *   need  → un lugar PIDE manos.
 *
 * El pedido del cliente las nombró juntas y en la misma frase («tanto de parte
 * de la persona que quiere prestar sus servicios o el lugar donde necesita
 * prestar los servicios»), y por eso comparten tabla, pantalla y búsqueda: ver
 * §2 de `0120_ayuda_mutua.sql`.
 */
export const HELP_DIRECTIONS = ["offer", "need"] as const;
export type HelpDirection = (typeof HELP_DIRECTIONS)[number];

/**
 * Los estados de un aviso, en el orden en que los recorre.
 *
 *   draft → pending → approved | rejected → (archived)
 *
 * `approved` NO lo puede escribir su autor: lo bloquean la policy de UPDATE y
 * el trigger de la 0120. Es la regla que puso el cliente («todo esto se
 * verifica vía geovanny con la cuenta de admin») escrita dos veces en la base,
 * y una tercera acá arriba para que nadie tenga que ir a buscarla.
 */
export const HELP_STATUSES = ["draft", "pending", "approved", "rejected", "archived"] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];

/**
 * Los SEIS temas que aceptan avisos, contra los catorce que tiene el
 * directorio. La regla, transcripta del CHECK de la migración: el tablón
 * acepta lo que se da con el cuerpo —tiempo, manos, cosas— y NUNCA criterio
 * profesional.
 *
 * Quedan afuera `migracion`, `legal`, `salud`, `medicinas`, `adicciones`,
 * `emergencias`, `consulados` y `vivienda`. No es una lista de pendientes: cada
 * exclusión tiene su motivo escrito en §5 de `0120_ayuda_mutua.sql`, y las tres
 * primeras son literalmente la línea del §11 que el módulo entero existe para
 * no cruzar. Si algún día se suma uno, se suma ACÁ y en el CHECK de la base —
 * los dos, o la app deja pasar algo que la base rechaza con un error crudo.
 */
export const HELP_TOPICS = [
  "comida",
  "voluntariado",
  "acopio",
  "educacion",
  "fe",
  "trabajo",
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

/** Espejan los `check` de zod de la action y los CHECK de la 0120. */
export const HELP_TITLE_MIN = 6;
export const HELP_TITLE_MAX = 100;
export const HELP_BODY_MIN = 20;
export const HELP_BODY_MAX = 1000;
export const HELP_AREA_MIN = 3;
export const HELP_AREA_MAX = 80;
export const HELP_AVAILABILITY_MAX = 160;
export const HELP_ORG_MAX = 140;
export const HELP_REVIEW_NOTE_MIN = 10;
export const HELP_REVIEW_NOTE_MAX = 400;
/** Tope de avisos sin resolver por persona. Lo exige el trigger, no la app. */
export const HELP_MAX_OPEN = 5;

/** Fila de `public.community_help_notices`, tal cual la 0120. */
export interface HelpNoticeRow {
  id: string;
  tenant_id: string;
  created_by: string;
  direction: string;
  topic: string;
  resource_id: string | null;
  title: string;
  body: string;
  area_label: string;
  availability: string | null;
  org_name: string | null;
  languages: string[] | null;
  status: string;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/** Columnas que pide la app. Escrito una vez para no over-fetchear por página. */
export const HELP_NOTICE_COLUMNS =
  "id, tenant_id, created_by, direction, topic, resource_id, title, body, area_label, " +
  "availability, org_name, languages, status, reviewed_at, review_note, created_at";

/**
 * Un aviso listo para render.
 *
 * NO HAY NINGÚN CAMPO DE CONTACTO, y no es que se haya olvidado de mapearlo:
 * la tabla no tiene ninguno. El teléfono de una persona de esta población,
 * pegado a su barrio y a un tema, es exactamente el dato que §5.4 existe para
 * que no exista. Se le escribe por mensaje privado, como a cualquiera.
 *
 * `publisherName` viaja porque un aviso sin cara no se puede evaluar, pero es
 * el `display_name` público que ya se muestra en todo el resto de la app —
 * ningún dato nuevo.
 */
export interface HelpNotice {
  id: string;
  direction: HelpDirection;
  topic: HelpTopic;
  status: HelpStatus;
  title: string;
  body: string;
  areaLabel: string;
  availability: string | null;
  orgName: string | null;
  languages: string[];
  /** Ficha del directorio a la que apunta, ya resuelta a su nombre. */
  resource: { id: string; name: string } | null;
  publisherId: string;
  publisherName: string;
  publishedAtLabel: string;
  /** Motivo del rechazo. Sólo llega cuando lo mira su autor. */
  reviewNote: string | null;
  /** true sólo para quien lo escribió: habilita retirar y archivar. */
  isOwner: boolean;
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
