import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * HILO DE COMENTARIOS — la paginación, escrita UNA sola vez.
 *
 * Este módulo nace de una duplicación real: la misma paginación keyset vivía
 * copiada en `app/(app)/feed/[id]/page.tsx` (servidor, hilo del detalle) y en
 * `components/feed/comments-sheet.tsx` (cliente, hoja del feed). Dos copias del
 * mismo `.or(created_at.lt…)`, del mismo `+1` para saber si hay tanda anterior,
 * del mismo `.reverse()` final — y ninguna sabía de la otra. Una revisión de
 * código ya había marcado ese patrón en este repo con otro par de archivos: dos
 * implementaciones de lo mismo no se mantienen sincronizadas, se turnan para
 * quedar viejas.
 *
 * ⚠️ LA MIGRACIÓN ESTÁ A MEDIAS (auditoría 2026-08-20). Hoy lo usan el detalle
 * (`app/(app)/feed/[id]/`) y su paginador; `comments-sheet.tsx` TODAVÍA tiene su
 * propia copia — quedó fuera porque estaba siendo editada por otro frente en la
 * misma tanda. O sea que la duplicación que este módulo vino a matar sigue
 * viva, y con ella el riesgo de divergencia. Verificado a mano el 2026-08-20:
 * hoy las dos implementaciones coinciden carácter por carácter en el keyset,
 * el `+1`, el `.reverse()`, el cursor tomado de la última fila LEÍDA (no la
 * visible) y el filtro de bloqueados. Cerrar esto es cambiar en la hoja su
 * `fetchPostComments` por `fetchCommentThreadPage(...)` con
 * `pageSize: COMMENT_THREAD_PAGE_SIZE.sheet`, sus dos filtros inline por
 * `filterBlockedComments` y su restauración de scroll por
 * `captureReadingPosition`.
 *
 * Acá no hay "use client" ni "server-only" a propósito: la MISMA función corre
 * con el cliente de servidor (RSC del detalle, server actions) y con el del
 * browser (la hoja). Lo único que cambia es quién le pasa el cliente.
 *
 * Qué NO vive acá: resolver autores y Trust (el servidor tiene
 * `feed/queries.ts`, que es server-only, y la hoja tiene su espejo cliente), y
 * el filtro de bloqueados en sí — sólo su aplicación, porque el SET de
 * bloqueados se lee distinto en cada lado.
 */

// ---------------------------------------------------------------------------
// Tanda del hilo (keyset)
// ---------------------------------------------------------------------------

/** Posición del hilo para pedir la tanda ANTERIOR (keyset, nunca OFFSET). */
export interface CommentThreadCursor {
  createdAt: string;
  id: string;
}

/** Un comentario tal como sale de la tabla, sin autor resuelto todavía. */
export interface CommentThreadRow {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  /**
   * Ficha con la que se firmó (0116), o null = lo dijo la persona. Se lee
   * SIEMPRE, también en las tandas de "ver anteriores": si sólo la primera
   * tanda supiera de firmas, un comentario del negocio cambiaría de nombre al
   * scrollear hacia atrás.
   */
  entityListingId: string | null;
}

/** Una tanda del hilo, ya en orden de LECTURA (la más vieja primero). */
export interface CommentThreadPage {
  rows: CommentThreadRow[];
  /** Hay comentarios MÁS VIEJOS que los de esta tanda. */
  hasOlder: boolean;
  /**
   * Desde dónde seguir hacia atrás: la fila más vieja LEÍDA, no la más vieja
   * VISIBLE. El filtro de bloqueados corre después de esto, y si se comiera
   * justo esa fila, un cursor tomado de lo visible saltearía comentarios.
   */
  olderCursor: CommentThreadCursor | null;
}

export type CommentThreadPageResult =
  | { ok: true; page: CommentThreadPage }
  | { ok: false };

/**
 * Cuántos comentarios trae CADA tanda. Es un tamaño de PÁGINA, no un techo.
 *
 * Los dos números son distintos a propósito y por eso viven juntos, donde la
 * diferencia se ve: el DETALLE es una página entera de lectura —se llega por
 * link compartido y se lee de arriba abajo—, mientras que la HOJA es un panel
 * de media pantalla sobre el feed, donde traer 200 comentarios para mostrar
 * cuatro es pagar red que nadie va a leer.
 */
export const COMMENT_THREAD_PAGE_SIZE = {
  detail: 200,
  sheet: 50,
} as const;

export interface FetchCommentThreadPageOptions {
  postId: string;
  /**
   * Comunidad del post. Va en el WHERE aunque `post_id` ya acote el hilo: es la
   * columna LÍDER de `comments_post_thread_idx (tenant_id, post_id, created_at,
   * id)`, y la policy no lo aporta como qual (lo tiene dentro de un OR, y un OR
   * no se convierte en condición de índice). Sin él el plan cae a
   * `comments_post_fk_idx` + Sort en memoria: leer y ordenar los 5.000
   * comentarios de un hilo para devolver 200, en cada tanda. Verificado con
   * EXPLAIN: con `tenant_id` es "Index Scan Backward using
   * comments_post_thread_idx", sin Sort.
   *
   * Acepta `null` porque en el browser el tenant no siempre se conoce de
   * antemano: es una optimización de plan, no una frontera de seguridad — esa
   * la ponen la RLS y el `post_id`.
   */
  tenantId: string | null;
  /**
   * Traer lo ANTERIOR a esta posición. Tiene que venir de `decodeCursor()`: se
   * interpola dentro de un filtro `.or()` de PostgREST, así que el charset
   * cerrado que valida ese helper es lo único que separa esto de un filtro
   * armado con texto libre de la URL.
   */
  olderThan: CommentThreadCursor | null;
  pageSize: number;
}

/**
 * UNA tanda de comentarios de un post, de la más nueva hacia atrás.
 *
 * Se LEE descendente y se ENTREGA ascendente: la lectura del hilo sigue siendo
 * la de siempre (el más viejo arriba), pero la tanda garantizada pasa a ser la
 * de la conversación viva en vez de la de los primeros comentarios de la
 * historia. Antes eran 200 sin cursor y el comentario 201 no existía para
 * nadie — ni para quien lo había escrito.
 */
export async function fetchCommentThreadPage(
  supabase: SupabaseClient<Database>,
  { postId, tenantId, olderThan, pageSize }: FetchCommentThreadPageOptions,
): Promise<CommentThreadPageResult> {
  let query = supabase
    .from("comments")
    .select("id, body, created_at, author_id, entity_listing_id, status")
    .eq("post_id", postId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // +1 para saber si HAY tanda anterior sin pagar una segunda consulta.
    .limit(pageSize + 1);

  if (tenantId) query = query.eq("tenant_id", tenantId);
  if (olderThan) {
    query = query.or(
      `created_at.lt."${olderThan.createdAt}",and(created_at.eq."${olderThan.createdAt}",id.lt."${olderThan.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[feed] tanda del hilo no disponible", { code: error.code });
    return { ok: false };
  }

  const fetched = data ?? [];
  const pageRows = fetched.slice(0, pageSize);
  const oldest = pageRows[pageRows.length - 1];
  return {
    ok: true,
    page: {
      hasOlder: fetched.length > pageSize,
      olderCursor: oldest
        ? { createdAt: oldest.created_at, id: oldest.id }
        : null,
      rows: pageRows
        .map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          authorId: row.author_id,
          entityListingId: row.entity_listing_id ?? null,
        }))
        // De vuelta a ascendente: el más viejo arriba, como se lee un hilo.
        .reverse(),
    },
  };
}

/**
 * Saca de la tanda a quien el viewer bloqueó (§ contrato bloqueo). Vale para
 * TODAS las tandas, no sólo la primera: sin esto, "ver anteriores" era la
 * puerta de atrás por la que reaparecía la persona bloqueada.
 */
export function filterBlockedComments<T extends { authorId: string | null }>(
  rows: readonly T[],
  blocked: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !row.authorId || !blocked.has(row.authorId));
}

// ---------------------------------------------------------------------------
// Conservar el punto de lectura al insertar contenido ARRIBA
// ---------------------------------------------------------------------------

/**
 * Dónde scrollea el hilo: un contenedor propio (la hoja del feed) o el
 * documento entero (el detalle, que scrollea con la página). `null` = documento.
 */
export type ReadingPositionScroller = HTMLElement | null;

/**
 * Mide el punto de lectura ANTES de insertar y devuelve cómo restaurarlo
 * DESPUÉS.
 *
 * Es la pieza sin la cual "ver comentarios anteriores" no sirve de nada: meter
 * 200 comentarios encima de lo que alguien está leyendo lo teletransporta, y
 * eso es exactamente lo que el cliente pidió sacar (2026-08-20: "ahí nomás
 * dentro de pantalla se tiene que fluir; si no es como que te corta el mambo").
 * Una recarga te devolvía arriba de todo; una inserción sin ancla te manda
 * abajo de todo. Las dos pierden el hilo de la conversación.
 *
 * El truco es anclar por la distancia al FONDO, no por el scroll absoluto: lo
 * que se inserta va arriba, así que todo lo que ya estaba en pantalla conserva
 * su distancia al final del hilo y no se mueve un píxel.
 *
 * Se llama en dos tiempos —medir, insertar, restaurar— y el restaurar tiene que
 * correr con el DOM ya actualizado y ANTES del paint (useLayoutEffect), o el
 * salto se ve un frame.
 */
export function captureReadingPosition(
  scroller: ReadingPositionScroller,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const heightOf = () =>
    scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;
  const offsetOf = () => (scroller ? scroller.scrollTop : window.scrollY);

  const distanceToBottom = heightOf() - offsetOf();

  return () => {
    const target = heightOf() - distanceToBottom;
    if (scroller) {
      scroller.scrollTop = target;
      return;
    }
    // jsdom no implementa scrollTo: se guarda para no romper en tests.
    if (typeof window.scrollTo === "function") window.scrollTo(0, target);
  };
}

// ---------------------------------------------------------------------------
// Copy de la paginación del hilo
// ---------------------------------------------------------------------------

/**
 * Textos que nacen con la paginación en el lugar.
 *
 * Viven acá y no en `copy.ts` ni en `helpers.ts` por un motivo de coordinación,
 * no de arquitectura: esos dos archivos los está tocando otro agente en esta
 * misma rama, y agregarles claves era garantizarse un conflicto. `COPY.comments`
 * y `COMMENT_THREAD_COPY` siguen siendo la fuente del resto del hilo — de acá
 * sale sólo lo que antes no existía porque antes esto era una recarga.
 */
export const COMMENT_THREAD_PAGING_COPY = {
  /** El botón mientras la tanda viaja. Reemplaza al label, no lo acompaña. */
  loadingOlder: "Buscando los anteriores…",
  /** La tanda no llegó. El hilo que ya está en pantalla NO se toca. */
  errorTitle: "No pudimos traer los comentarios anteriores",
  errorBody: "Puede ser la conexión. Probá de nuevo en un momento.",
  /** Se acabó el hacia atrás: no es un error ni un vacío, es el final. */
  threadStart: "Llegaste al principio de la conversación",
  /**
   * Sólo para lectores de pantalla: la tanda entra ARRIBA y fuera de la vista,
   * así que sin esto la única señal de que algo pasó es que el botón cambió.
   */
  addedAnnouncement: (count: number) =>
    count === 1
      ? "Se sumó 1 comentario más arriba."
      : `Se sumaron ${count} comentarios más arriba.`,
  /**
   * La tanda llegó entera pero quedó en nada: son todos de gente que el viewer
   * bloqueó. Sin este aviso, tocar el botón no produce NINGÚN cambio visible y
   * se lee como que la app se colgó.
   */
  noneAdded: "No apareció ningún comentario más.",
} as const;
