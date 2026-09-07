import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * DERECHOS Y FUENTE DE LA FOTO (migración 0146) — contrato compartido
 * =============================================================================
 *
 * Lo que el cliente marcó como *Opcional* debajo de la descripción, en la
 * pantalla "Contá de qué se trata": quién es dueño de la foto y de dónde salió.
 *
 * Este archivo lo conocen a la vez el servidor (`feed/actions.ts`, las queries
 * del feed) y el cliente (el composer). Por eso NO lleva `server-only` y NO
 * importa nada de `@/lib/supabase/*`: recibe el cliente por parámetro. Mismo
 * criterio —y mismo motivo— que `@/lib/social/post-tags`.
 *
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ NO HAY UN SEGUNDO FORMULARIO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El composer YA le pregunta esto a quien publica: el bloque "Sobre esta foto"
 * (`OriginalityFields`, 0061) tiene el selector de origen, la aclaración libre
 * y el link a la fuente. Lo que faltaba no era la pregunta — era que la
 * respuesta se viera en algún lado que no fuera el panel de moderación.
 *
 * Agregar un segundo campo pidiendo lo mismo con otras palabras habría dejado
 * dos declaraciones sobre la misma foto que pueden contradecirse, y la pregunta
 * "¿cuál gana?" no tiene respuesta buena. Así que acá se DERIVA: una sola
 * respuesta, dos destinos —`content_assets` para moderación,  `posts` para la
 * tarjeta— y ninguna forma de que digan cosas distintas.
 *
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ EL VOCABULARIO PÚBLICO ES MÁS CHICO QUE `license_kind`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `content_assets.license_kind` (0061) tiene seis valores porque los necesita
 * un moderador resolviendo un reclamo: no es lo mismo una licencia comprada que
 * una Creative Commons. Debajo de una foto en el feed esa diferencia no le sirve
 * a nadie y sólo agrega ruido legal a una tarjeta.
 *
 * Por eso las tres formas de "no es mía pero puedo usarla" colapsan en `libre`.
 * La traducción va en un solo sentido y a propósito: del vocabulario grande al
 * chico se puede siempre, al revés se estaría inventando un detalle que la
 * persona nunca dio.
 *
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA REGLA QUE NO SE PUEDE SUAVIZAR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Esto es lo que AFIRMA quien publica, no algo que la plataforma comprobó — el
 * mismo criterio legal que rige `verification_checks` y el panel de integridad.
 * Quien pinte esta línea tiene que decirlo (`CREDITO_COPY.disclaimer`). Una
 * declaración del usuario mostrada como un sello de la plataforma es peor que
 * no mostrar nada.
 */

/**
 * Espeja el CHECK `posts_photo_rights_catalog` de la 0146. Duplicación
 * DELIBERADA: un valor nuevo sólo acá se guarda y no lo pinta nadie; un valor
 * nuevo sólo en la base rebota con un 23514 al publicar.
 */
export const PHOTO_RIGHTS = ["propia", "con_permiso", "libre", "de_otra_fuente"] as const;

export type PhotoRights = (typeof PHOTO_RIGHTS)[number];

/**
 * Tope del crédito. Es el MISMO número que `licenseStatement` en
 * `@/lib/integrity/declarations`, y no un tope nuevo más chico, para que nada
 * de lo que la persona escribió se pierda en el camino al post. Que la línea
 * sea corta en pantalla lo resuelve el `line-clamp` de quien la pinta, que es
 * donde ese problema realmente vive.
 */
export const MAX_PHOTO_CREDIT = 500;

/** La declaración tal como viaja del composer al post y del post a la tarjeta. */
export interface CreditoDeFoto {
  rights: PhotoRights;
  /** Autor, medio o URL, en las palabras de quien publicó. null = no aclaró. */
  credit: string | null;
}

/**
 * Copy de la línea que se lee debajo de la foto. Español neutro-latino, escrito
 * como un crédito de foto de toda la vida y no como una cláusula.
 */
export const CREDITO_COPY = {
  rights: {
    propia: "Foto propia",
    con_permiso: "Foto usada con permiso",
    libre: "Foto de uso libre",
    de_otra_fuente: "Foto tomada de otra fuente",
  } satisfies Record<PhotoRights, string>,
  /**
   * NO ES OPCIONAL NI SUAVIZABLE. Sin esta línea, "Foto propia" debajo de una
   * publicación se lee como algo que Comunidad Latina comprobó, y no lo es.
   */
  disclaimer: "Lo dice quien publicó. Comunidad Latina no lo verificó.",
} as const;

/** La línea completa: "Foto de uso libre · Unsplash". */
export function lineaDeCredito(credito: CreditoDeFoto): string {
  const encabezado = CREDITO_COPY.rights[credito.rights];
  return credito.credit ? `${encabezado} · ${credito.credit}` : encabezado;
}

/**
 * Lo que el composer le manda al servidor, derivado de la declaración que la
 * persona ya completó en "Sobre esta foto".
 *
 * DEVUELVE `null` CUANDO NO HAY NADA QUE DECLARAR, y eso incluye el caso en que
 * eligió "Prefiero no aclararlo ahora" sin escribir una fuente. No declarar es
 * una opción legítima y tiene que verse como lo que es —una publicación sin
 * línea de crédito— y no como una afirmación en boca de alguien que no la hizo.
 *
 * EL CASO `de_otra_fuente` ES EL ÚNICO QUE SE INFIERE, y es la inferencia más
 * conservadora posible: la persona citó una fuente y NO reclamó ningún derecho
 * sobre la foto. "La compartí de otra fuente" dice exactamente eso y no más.
 */
export function creditoDesdeDeclaracion(declaracion: {
  licenseKind: string;
  licenseStatement?: string | null;
  licenseUrl?: string | null;
}): CreditoDeFoto | null {
  /**
   * Se prefiere la aclaración escrita sobre el link: es la atribución en
   * palabras de la persona ("me las pasó el fotógrafo del local"), que es lo
   * que un lector entiende. El link queda igual en `content_assets` para quien
   * modera. Nunca se pintan los dos: una línea con una frase Y una URL cruda
   * deja de ser un crédito y pasa a ser un pie de página.
   */
  const credit =
    declaracion.licenseStatement?.trim() || declaracion.licenseUrl?.trim() || null;

  switch (declaracion.licenseKind) {
    case "propio":
      return { rights: "propia", credit };
    case "con_permiso":
      return { rights: "con_permiso", credit };
    case "licencia_comercial":
    case "creative_commons":
    case "dominio_publico":
      return { rights: "libre", credit };
    default:
      return credit ? { rights: "de_otra_fuente", credit } : null;
  }
}

/**
 * Normaliza lo que llegó del formulario. NUNCA lanza: un crédito malformado
 * degrada a "no declaró nada" en vez de a una afirmación inventada — el mismo
 * criterio que `normalizeDeclaration`.
 */
export function normalizarCredito(
  rights: unknown,
  credit: unknown,
): CreditoDeFoto | null {
  if (typeof rights !== "string") return null;
  if (!(PHOTO_RIGHTS as readonly string[]).includes(rights)) return null;

  const texto = typeof credit === "string" ? credit.trim() : "";
  return {
    rights: rights as PhotoRights,
    credit: texto ? texto.slice(0, MAX_PHOTO_CREDIT) : null,
  };
}

type OpenClient = SupabaseClient<Record<string, unknown>, "public", never>;

interface CreditoRow {
  id: string;
  photo_rights: string | null;
  photo_credit: string | null;
}

/**
 * Los créditos de una tanda de posts, en UNA query.
 *
 * QUERY APARTE Y NO DOS COLUMNAS EN `POST_COLUMNS`, por el mismo motivo que
 * `fetchPostPolls` y `fetchPostMusic`: ese select lo comparten el feed, el
 * detalle y /videos, y una columna que todavía no existe en el entorno haría
 * fallar la consulta ENTERA. Acá, sin la 0146 aplicada, se devuelve un mapa
 * vacío: ninguna publicación muestra su crédito y todo lo demás sigue igual.
 *
 * Tampoco pasa por el RPC del feed (`feed_posts_page`): su `returns table` es
 * fijo, así que sumarle columnas obliga a un `drop function` — y el feed entero
 * depende de esa función. Un `select` aparte sobre `posts` no toca nada de eso.
 *
 * La RLS de `posts` ya decide qué filas se ven: acá no se filtra por seguridad.
 */
export async function fetchPhotoCredits(
  supabase: SupabaseClient,
  postIds: readonly string[],
): Promise<Map<string, CreditoDeFoto>> {
  const byPostId = new Map<string, CreditoDeFoto>();
  const ids = [...new Set(postIds.filter(Boolean))];
  if (ids.length === 0) return byPostId;

  const open = supabase as unknown as OpenClient;
  const { data, error } = await open
    .from("posts")
    .select("id, photo_rights, photo_credit")
    .in("id", ids)
    .not("photo_rights", "is", null);

  if (error) {
    console.warn("[feed] query de créditos de foto falló", { code: error.code });
    return byPostId;
  }

  for (const row of (data ?? []) as unknown as CreditoRow[]) {
    const credito = normalizarCredito(row.photo_rights, row.photo_credit);
    if (credito) byPostId.set(row.id, credito);
  }
  return byPostId;
}
