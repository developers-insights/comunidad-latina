import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HELP_NOTICE_COLUMNS,
  isHelpDirection,
  isHelpStatus,
  isHelpTopic,
  supabaseSinTiparComunidad,
  type HelpDirection,
  type HelpNoticeRow,
  type HelpStatus,
  type HelpTopic,
} from "@/lib/comunidad";

/**
 * =============================================================================
 * LA COLA DE AVISOS DE AYUDA MUTUA
 * =============================================================================
 *
 * Es la cola que el cliente pidió con todas las letras: «todo esto se verifica
 * vía geovanny con la cuenta de admin». Un aviso queda en `pending` hasta que
 * alguien del equipo lo mira; hasta entonces no lo ve nadie más que su autor.
 *
 * ── SIN PRIVILEGIOS Y SIN N+1 ───────────────────────────────────────────────
 * Todo se lee con el cliente del propio staff: la RLS gobierna (ARQUITECTURA §6
 * — el admin client no se usa para LEER en un request de usuario). La policy de
 * `community_help_notices` tiene rama de staff acotada al tenant, así que el
 * `eq("tenant_id")` de acá es para no traer de más, no para proteger.
 *
 * Y se lee POR LOTE: una consulta para los avisos, una para los nombres de
 * quienes los escribieron y una para los nombres de las fichas. Con cincuenta
 * avisos, resolverlo fila por fila serían cien round-trips.
 *
 * ── LO QUE ESTA COLA NO PUEDE VER ───────────────────────────────────────────
 * Nada del autor más allá de su nombre público: ni teléfono, ni email, ni
 * documento. No es una limitación del panel, es que esos datos no existen en
 * esta tabla (§2 de la 0120) y `profiles_private` tiene RLS solo-dueño. Quien
 * modera decide sobre el TEXTO del aviso, que es exactamente lo que tiene que
 * decidir.
 * =============================================================================
 */

/** Tope de filas por consulta. Misma escala que la cola de solicitudes. */
export const QUEUE_LIMIT = 50;

export const QUEUE_FILTERS = [
  { id: "pendientes", label: "Para revisar", statuses: ["pending"] },
  { id: "publicados", label: "Publicados", statuses: ["approved"] },
  { id: "resueltos", label: "Rechazados y bajados", statuses: ["rejected", "archived"] },
] as const;

export type QueueFilterId = (typeof QUEUE_FILTERS)[number]["id"];
export const DEFAULT_FILTER: QueueFilterId = "pendientes";

export function resolveQueueFilter(value: string | string[] | undefined): QueueFilterId {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = QUEUE_FILTERS.find((item) => item.id === raw);
  return match ? match.id : DEFAULT_FILTER;
}

/** Un aviso tal como lo necesita quien decide. */
export interface HelpNoticeReviewItem {
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
  resourceName: string | null;
  authorId: string;
  authorName: string;
  createdAt: string;
  /**
   * Días esperando, calculados EN EL SERVIDOR. Si se calcularan en la tarjeta
   * contra `Date.now()`, el HTML del servidor y el del cliente podrían no
   * coincidir y React tiraría un mismatch de hidratación.
   */
  waitedDays: number;
  reviewNote: string | null;
  reviewedAt: string | null;
}

export interface HelpNoticeQueue {
  items: HelpNoticeReviewItem[];
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

export async function fetchHelpNoticeQueue(
  supabase: SupabaseClient,
  tenantId: string,
  filter: QueueFilterId,
): Promise<HelpNoticeQueue> {
  const sinTipar = supabaseSinTiparComunidad(supabase);
  const vacio: Record<QueueFilterId, number> = { pendientes: 0, publicados: 0, resueltos: 0 };

  const { data, error } = await sinTipar
    .from("community_help_notices")
    .select(HELP_NOTICE_COLUMNS)
    .eq("tenant_id", tenantId)
    // Lo más viejo primero: quien más esperó, primero. Es lo contrario del
    // tablón público (lo más nuevo arriba) porque son dos preguntas distintas —
    // allá "qué hay", acá "qué debo".
    .order("created_at", { ascending: true })
    .limit(400);

  if (error) {
    console.warn("[admin/ayuda-mutua] query de la cola falló", { code: error.code });
    return { items: [], counts: vacio, truncated: false, failed: true };
  }

  const rows = (data ?? []) as unknown as HelpNoticeRow[];

  // Los contadores de las tres pestañas salen de la MISMA lectura: pedirlos con
  // tres `head: true` extra serían tres round-trips para números que ya están
  // en memoria. `draft` no cuenta en ninguna: es privado de su autor y el panel
  // no tiene nada que decidir sobre algo que todavía no le mandaron.
  const counts = { ...vacio };
  for (const row of rows) {
    if (row.status === "pending") counts.pendientes += 1;
    else if (row.status === "approved") counts.publicados += 1;
    else if (row.status === "rejected" || row.status === "archived") counts.resueltos += 1;
  }

  const estados = QUEUE_FILTERS.find((item) => item.id === filter)?.statuses ?? [];
  const delFiltro = rows.filter((row) => (estados as readonly string[]).includes(row.status));
  const pagina = delFiltro.slice(0, QUEUE_LIMIT);

  const autores = [...new Set(pagina.map((row) => row.created_by))];
  const fichas = [
    ...new Set(pagina.map((row) => row.resource_id).filter((id): id is string => Boolean(id))),
  ];

  const [perfiles, recursos] = await Promise.all([
    autores.length > 0
      ? supabase.from("profiles").select("id, display_name").in("id", autores)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    fichas.length > 0
      ? sinTipar.from("community_resources").select("id, name").in("id", fichas)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const nombrePorAutor = new Map(
    ((perfiles.data ?? []) as { id: string; display_name: string | null }[]).map((row) => [
      row.id,
      row.display_name,
    ]),
  );
  const nombrePorFicha = new Map(
    ((recursos.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]),
  );

  const ahora = new Date();
  const items = pagina.flatMap((row): HelpNoticeReviewItem[] => {
    // Mismas guardas que el lado público: una fila con un tema o una dirección
    // que la app no conoce no se puede dibujar (ni decidir) con honestidad.
    if (!isHelpTopic(row.topic) || !isHelpDirection(row.direction) || !isHelpStatus(row.status)) {
      return [];
    }
    return [
      {
        id: row.id,
        direction: row.direction,
        topic: row.topic,
        status: row.status,
        title: row.title,
        body: row.body,
        areaLabel: row.area_label,
        availability: row.availability,
        orgName: row.direction === "need" ? row.org_name : null,
        languages: (row.languages ?? []).filter(Boolean),
        resourceName: row.resource_id ? (nombrePorFicha.get(row.resource_id) ?? null) : null,
        authorId: row.created_by,
        authorName: nombrePorAutor.get(row.created_by) ?? "Cuenta sin perfil legible",
        createdAt: row.created_at,
        waitedDays: diasDesde(row.created_at, ahora),
        reviewNote: row.review_note,
        reviewedAt: row.reviewed_at,
      },
    ];
  });

  return { items, counts, truncated: delFiltro.length > QUEUE_LIMIT, failed: false };
}
