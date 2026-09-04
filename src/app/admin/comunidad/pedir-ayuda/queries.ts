import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HELP_NOTICE_COLUMNS,
  HELP_REPLY_COLUMNS,
  isHelpReplyStatus,
  isHelpStatus,
  isHelpTopic,
  supabaseSinTiparComunidad,
  type HelpNoticeRow,
  type HelpReplyRow,
  type HelpReplyStatus,
  type HelpStatus,
  type HelpTopic,
} from "@/lib/comunidad";

/**
 * =============================================================================
 * LA COLA DE MODERACIÓN DE "PEDIR AYUDA"
 * =============================================================================
 *
 * ── ES OTRA COLA QUE LA DE LA 0120 ──────────────────────────────────────────
 * Aquélla era de ADMISIÓN: nada se veía hasta que una persona lo aprobaba. La
 * 0130 dio vuelta el modelo (§4 de la migración) y ahora un pedido nace
 * publicado. Así que esta pantalla dejó de preguntar "¿esto entra?" y pregunta
 * "¿esto sigue?".
 *
 * El cambio no es cosmético y se nota en el orden: la cola vieja mostraba lo
 * más VIEJO primero (quien más esperó, primero). Ésta muestra lo más NUEVO
 * primero, porque lo que hay que mirar es lo que se acaba de publicar — lo
 * viejo ya lo vio la comunidad entera y, si estaba mal, ya lo reportaron.
 *
 * ── SIN PRIVILEGIOS Y SIN N+1 ───────────────────────────────────────────────
 * Todo se lee con el cliente del propio staff: la RLS gobierna (ARQUITECTURA §6
 * — el admin client no se usa para LEER en un request de usuario). Las policies
 * de las dos tablas tienen rama de staff acotada al tenant, así que el
 * `eq("tenant_id")` de acá es para no traer de más, no para proteger.
 *
 * Y se lee POR LOTE: una consulta para las filas y una para los nombres de
 * quienes las escribieron.
 *
 * ── LO QUE ESTA COLA NO PUEDE VER ───────────────────────────────────────────
 * Nada del autor más allá de su nombre público: ni teléfono, ni email, ni
 * documento. No es una limitación del panel, es que esos datos no existen en
 * estas tablas y `profiles_private` tiene RLS solo-dueño. Quien modera decide
 * sobre el TEXTO, que es exactamente lo que tiene que decidir.
 * =============================================================================
 */

/** Tope de filas por consulta. Misma escala que el resto de las colas. */
export const QUEUE_LIMIT = 50;

export const QUEUE_FILTERS = [
  { id: "publicados", label: "Publicados" },
  { id: "respuestas", label: "Respuestas" },
  { id: "ocultos", label: "Ocultos" },
  // Legado: lo que quedó en la cola de admisión de la 0120 y nunca se resolvió.
  { id: "cola", label: "Quedaron en cola" },
] as const;

export type QueueFilterId = (typeof QUEUE_FILTERS)[number]["id"];
export const DEFAULT_FILTER: QueueFilterId = "publicados";

export function resolveQueueFilter(value: string | string[] | undefined): QueueFilterId {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = QUEUE_FILTERS.find((item) => item.id === raw);
  return match ? match.id : DEFAULT_FILTER;
}

/** Un pedido tal como lo necesita quien modera. */
export interface PedidoReviewItem {
  id: string;
  topic: HelpTopic;
  status: HelpStatus;
  title: string;
  body: string;
  areaLabel: string;
  replyCount: number;
  authorId: string;
  authorName: string;
  createdAt: string;
  /**
   * Días desde que se publicó, calculados EN EL SERVIDOR. Si se calcularan en
   * la tarjeta contra `Date.now()`, el HTML del servidor y el del cliente
   * podrían no coincidir y React tiraría un mismatch de hidratación.
   */
  agedDays: number;
  reviewNote: string | null;
  reviewedAt: string | null;
}

/** Una respuesta tal como la necesita quien modera. */
export interface RespuestaReviewItem {
  id: string;
  noticeId: string;
  noticeTitle: string;
  body: string;
  status: HelpReplyStatus;
  authorId: string;
  authorName: string;
  createdAt: string;
  agedDays: number;
}

export interface PedirAyudaQueue {
  pedidos: PedidoReviewItem[];
  respuestas: RespuestaReviewItem[];
  counts: Record<QueueFilterId, number>;
  truncated: boolean;
  /** true cuando la consulta falló: la pantalla distingue "no hay" de "no pudimos". */
  failed: boolean;
}

function diasDesde(iso: string, ahora: Date): number {
  const desde = new Date(iso).getTime();
  if (Number.isNaN(desde)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - desde) / 86_400_000));
}

async function nombresPorAutor(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", [...ids]);
  return new Map(
    ((data ?? []) as { id: string; display_name: string | null }[]).map((row) => [
      row.id,
      row.display_name,
    ]),
  );
}

export async function fetchPedirAyudaQueue(
  supabase: SupabaseClient,
  tenantId: string,
  filter: QueueFilterId,
): Promise<PedirAyudaQueue> {
  const sinTipar = supabaseSinTiparComunidad(supabase);
  const vacio: Record<QueueFilterId, number> = {
    publicados: 0,
    respuestas: 0,
    ocultos: 0,
    cola: 0,
  };
  const ahora = new Date();

  /**
   * Los pedidos se traen SIEMPRE (hasta 400) porque de esa misma lectura salen
   * los contadores de las tres pestañas de pedidos: pedirlos con tres
   * `head: true` extra serían tres round-trips para números que ya están en
   * memoria. `draft` no cuenta en ninguna: es privado de su autor y el panel no
   * tiene nada que decidir sobre algo que no le mandaron.
   */
  const { data: dataPedidos, error: errorPedidos } = await sinTipar
    .from("community_help_notices")
    .select(HELP_NOTICE_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(400);

  if (errorPedidos) {
    console.warn("[admin/pedir-ayuda] query de pedidos falló", { code: errorPedidos.code });
    return { pedidos: [], respuestas: [], counts: vacio, truncated: false, failed: true };
  }

  const filas = (dataPedidos ?? []) as unknown as HelpNoticeRow[];
  const counts = { ...vacio };
  for (const fila of filas) {
    if (fila.status === "approved") counts.publicados += 1;
    else if (fila.status === "rejected") counts.ocultos += 1;
    else if (fila.status === "pending") counts.cola += 1;
  }

  const ESTADO_POR_FILTRO: Partial<Record<QueueFilterId, HelpStatus>> = {
    publicados: "approved",
    ocultos: "rejected",
    cola: "pending",
  };

  const estado = ESTADO_POR_FILTRO[filter];
  const delFiltro = estado ? filas.filter((fila) => fila.status === estado) : [];
  const paginaPedidos = delFiltro.slice(0, QUEUE_LIMIT);

  // ---- Respuestas -----------------------------------------------------------
  // El CONTADOR de la pestaña sale siempre de un `head: true` (cuenta sin traer
  // filas) y no del largo de la página: la página está capada en QUEUE_LIMIT, y
  // un contador que dice "50" cuando hay 300 es peor que no tenerlo.
  const { count: totalRespuestas } = await sinTipar
    .from("community_help_replies")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "visible");
  counts.respuestas = totalRespuestas ?? 0;

  // Las FILAS sólo se traen cuando se están mirando.
  let respuestas: RespuestaReviewItem[] = [];
  if (filter === "respuestas") {
    const { data, error } = await sinTipar
      .from("community_help_replies")
      .select(HELP_REPLY_COLUMNS)
      .eq("tenant_id", tenantId)
      .in("status", ["visible", "hidden"])
      .order("created_at", { ascending: false })
      .limit(QUEUE_LIMIT);

    if (error) {
      console.warn("[admin/pedir-ayuda] query de respuestas falló", { code: error.code });
      return { pedidos: [], respuestas: [], counts, truncated: false, failed: true };
    }

    const filasRespuesta = (data ?? []) as unknown as HelpReplyRow[];

    // El título del pedido, por lote. Sin él, quien modera lee una respuesta
    // suelta y no puede decidir: "probá en la 82" no significa nada sin la
    // pregunta.
    const pedidoPorId = new Map(filas.map((fila) => [fila.id, fila.title]));
    const faltantes = [
      ...new Set(
        filasRespuesta
          .map((fila) => fila.notice_id)
          .filter((id) => !pedidoPorId.has(id)),
      ),
    ];
    if (faltantes.length > 0) {
      const { data: extra } = await sinTipar
        .from("community_help_notices")
        .select("id, title")
        .in("id", faltantes);
      for (const fila of (extra ?? []) as { id: string; title: string }[]) {
        pedidoPorId.set(fila.id, fila.title);
      }
    }

    const nombres = await nombresPorAutor(
      supabase,
      [...new Set(filasRespuesta.map((fila) => fila.created_by))],
    );

    respuestas = filasRespuesta.flatMap((fila): RespuestaReviewItem[] => {
      if (!isHelpReplyStatus(fila.status) || fila.status === "deleted") return [];
      return [
        {
          id: fila.id,
          noticeId: fila.notice_id,
          noticeTitle: pedidoPorId.get(fila.notice_id) ?? "Pedido que ya no está",
          body: fila.body,
          status: fila.status,
          authorId: fila.created_by,
          authorName: nombres.get(fila.created_by) ?? "Cuenta sin perfil legible",
          createdAt: fila.created_at,
          agedDays: diasDesde(fila.created_at, ahora),
        },
      ];
    });
  }

  // ---- Pedidos de la página -------------------------------------------------
  const nombres = await nombresPorAutor(
    supabase,
    [...new Set(paginaPedidos.map((fila) => fila.created_by))],
  );

  const pedidos = paginaPedidos.flatMap((fila): PedidoReviewItem[] => {
    // Mismas guardas que el lado público: una fila con un tema o un estado que
    // la app no conoce no se puede dibujar (ni decidir) con honestidad.
    if (!isHelpTopic(fila.topic) || !isHelpStatus(fila.status)) return [];
    return [
      {
        id: fila.id,
        topic: fila.topic,
        status: fila.status,
        title: fila.title,
        body: fila.body,
        areaLabel: fila.area_label,
        replyCount: typeof fila.reply_count === "number" ? fila.reply_count : 0,
        authorId: fila.created_by,
        authorName: nombres.get(fila.created_by) ?? "Cuenta sin perfil legible",
        createdAt: fila.created_at,
        agedDays: diasDesde(fila.created_at, ahora),
        reviewNote: fila.review_note,
        reviewedAt: fila.reviewed_at,
      },
    ];
  });

  return {
    pedidos,
    respuestas,
    counts,
    truncated: delFiltro.length > QUEUE_LIMIT,
    failed: false,
  };
}
