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
// Pedir ayuda — `public.community_help_notices` (0120) + `..._replies` (0130)
// ===========================================================================

/**
 * Las dos caras que tuvo el tablón. Hoy sólo se usa una.
 *
 *   need  → alguien PIDE (información, orientación, una ayuda puntual).
 *   offer → LEGADO. Alguien se ofrecía a dar una mano.
 *
 * El cliente sacó los ofrecimientos el 2026-09-03: «necesito manos» para una
 * mudanza es responsabilidad legal de Comunidad Latina si alguien se lastima.
 * La 0130 archivó los `offer` vivos y sacó el camino para crear nuevos; el
 * valor sobrevive porque es lo que explica por qué esas filas están archivadas
 * y porque el CHECK de los temas nuevos se apoya en él.
 */
export const HELP_DIRECTIONS = ["offer", "need"] as const;
export type HelpDirection = (typeof HELP_DIRECTIONS)[number];

/** La única dirección que se puede publicar hoy. Se escribe una sola vez. */
export const HELP_DIRECTION_DEFAULT: HelpDirection = "need";

/**
 * Los estados de un pedido.
 *
 *   approved → donde NACE. El tablón es vivo: se publica al toque (§4 de la
 *              0130). Lo que reemplaza a la revisión previa es el detector de
 *              datos de contacto, la moderación automática del texto, el cupo
 *              de 5 abiertos y la moderación POSTERIOR del equipo.
 *   archived → resuelto o dado de baja por su autor. No sale de acá.
 *   rejected → oculto por el equipo, con motivo que su autor lee. El equipo lo
 *              puede restaurar.
 *   draft / pending → LEGADO de la cola previa (0120). Ya no se crean.
 */
export const HELP_STATUSES = ["draft", "pending", "approved", "rejected", "archived"] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];

/**
 * Los DIEZ temas de un pedido, transcriptos del CHECK de la 0130.
 *
 * Los seis primeros venían de la 0120, cuando el tablón era de ofrecimientos y
 * la regla era «lo que se da con el cuerpo, nunca criterio profesional». Los
 * cuatro últimos son los que la 0130 habilita al pasar a pedidos: el argumento
 * de aquella exclusión era sobre OFRECER («te presto un cuarto» es el escenario
 * de trata, textual), y preguntar dónde consiguen sillas de ruedas no es eso.
 *
 * `migracion` y `legal` siguen afuera incluso como pedido, y no es una lista de
 * pendientes: un tema con ese nombre invita a que un desconocido conteste qué
 * hacer con un caso, y eso es la línea del §11 que el módulo existe para no
 * cruzar. El caso que contó el cliente —el turno en el consulado— entra por
 * `tramites`, que es papeles y turnos; el abogado barato, por `otro`.
 *
 * El ORDEN es el de pantalla, no alfabético: primero lo que más se pide.
 * Si algún día se suma uno, se suma ACÁ y en el CHECK de la base — los dos, o
 * la app deja pasar algo que la base rechaza con un error crudo.
 */
export const HELP_TOPICS = [
  "tramites",
  "salud",
  "trabajo",
  "educacion",
  "vivienda",
  "comida",
  "fe",
  "voluntariado",
  "acopio",
  "otro",
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
/** Tope de pedidos abiertos por persona. Lo exige el trigger, no la app. */
export const HELP_MAX_OPEN = 5;

/**
 * Largo de una respuesta. El piso es 2 y no 20 como el cuerpo de un pedido, y
 * es la decisión que hace útil a esta sección: la respuesta más valiosa que
 * describió el cliente es un número de teléfono o el nombre de una oficina.
 * Un piso alto obliga a rellenar con palabras que nadie necesita leer.
 */
export const HELP_REPLY_MIN = 2;
export const HELP_REPLY_MAX = 1000;

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
  reply_count: number | null;
  created_at: string;
}

/** Columnas que pide la app. Escrito una vez para no over-fetchear por página. */
export const HELP_NOTICE_COLUMNS =
  "id, tenant_id, created_by, direction, topic, resource_id, title, body, area_label, " +
  "availability, org_name, languages, status, reviewed_at, review_note, reply_count, created_at";

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
  /** Motivo por el que el equipo lo ocultó. Sólo llega cuando lo mira su autor. */
  reviewNote: string | null;
  /** Respuestas visibles. Sale del contador de la 0130, no de un count por fila. */
  replyCount: number;
  /** true sólo para quien lo escribió: habilita marcarlo resuelto. */
  isOwner: boolean;
}

// ---------------------------------------------------------------------------
// Respuestas — `public.community_help_replies` (0130)
// ---------------------------------------------------------------------------

/**
 * Los tres estados de una respuesta. Las tres conservan la fila: una respuesta
 * que desaparece de la base es una respuesta que no se puede auditar después de
 * un reporte.
 *
 *   visible → la ve la comunidad.
 *   hidden  → la ocultó el equipo (con firma y motivo interno).
 *   deleted → la borró su autor.
 */
export const HELP_REPLY_STATUSES = ["visible", "hidden", "deleted"] as const;
export type HelpReplyStatus = (typeof HELP_REPLY_STATUSES)[number];

/** Fila de `public.community_help_replies`, tal cual la 0130. */
export interface HelpReplyRow {
  id: string;
  tenant_id: string;
  notice_id: string;
  created_by: string;
  body: string;
  status: string;
  created_at: string;
}

export const HELP_REPLY_COLUMNS =
  "id, tenant_id, notice_id, created_by, body, status, created_at";

/**
 * Una respuesta lista para render.
 *
 * `authorName` es el `display_name` público que ya se muestra en toda la app —
 * ningún dato nuevo. No viaja avatar ni Trust Score: quien contesta con el
 * teléfono de una oficina no está compitiendo por reputación, y un puntaje al
 * lado de una respuesta útil convertiría la ayuda en un ranking.
 */
export interface HelpReply {
  id: string;
  noticeId: string;
  body: string;
  status: HelpReplyStatus;
  authorId: string;
  authorName: string;
  createdAtLabel: string;
  /** true sólo para quien la escribió: habilita borrarla. */
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
