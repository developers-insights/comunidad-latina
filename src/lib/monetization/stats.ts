import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  EXTERNAL_CTA_KINDS,
  externalCtasFor,
  parseListingTier,
  type CtaKind,
  type ListingTier,
} from "./tier";

/**
 * ESTADÍSTICAS DEL AVISO, en dos niveles (§3 del contrato).
 *
 * Todo se lee con el cliente del USUARIO: la RLS de `cta_clicks` ya limita las
 * filas al dueño del aviso (y a staff), así que no hace falta —ni corresponde—
 * el cliente admin. Cuánto convierte un comercio es dato suyo, no del
 * competidor de al lado, y ese límite lo pone la base, no esta función.
 *
 * DE DÓNDE SALE CADA NÚMERO. Este módulo no calcula ninguna métrica: las lee.
 * Cuando se escribió, "vistas" y "compartidos" de un AVISO no tenían fuente
 * (`post_views` cuenta personas-día de un POST, no de un listing, y compartir
 * era un copiar-link que no persistía nada) y el panel prefirió el hueco
 * declarado antes que un cero que parece un dato. La 0050 les dio fuente real,
 * calcada de las que ya existían:
 *
 *   vistas      → `listings.view_count`, personas-día, counter por trigger
 *                 sobre `listing_views` (espejo de posts.view_count).
 *   compartidos → suma de `listing_shares`, agregado por día y sin identidad
 *                 (misma forma que cta_clicks).
 *   alcance     → RPC `listing_reach`: cuánta gente DISTINTA. Es una RPC y no
 *                 una query porque contar personas distintas necesita
 *                 `viewer_id`, y esa columna no sale de la base ni para el
 *                 dueño del aviso — "quién miró tu publicación" no se entrega.
 *
 * VENTANAS. Todo lo del bloque básico es HISTÓRICO (los me gusta, los chats y
 * los guardados también lo eran), y lo único acotado a `STATS_WINDOW_DAYS` son
 * los clics por botón, que es lo que la pantalla declara. El alcance es
 * histórico a propósito: el copy dice "cuánta gente distinta vio tu aviso", sin
 * plazo, y una métrica que no coincide con su propia etiqueta miente aunque el
 * número esté bien.
 */

type Supabase = SupabaseClient<Database>;

/** Ventana de las estadísticas. 30 días es el período que la gente compara. */
export const STATS_WINDOW_DAYS = 30;

export interface BasicStats {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  chats: number;
}

export interface CtaClickStat {
  kind: CtaKind;
  clicks: number;
}

export interface PromotionStat {
  type: "boost" | "campaign";
  label: string;
  status: string;
  /** Días contratados (boost) o de duración configurada (campaña). */
  days: number | null;
  endsAt: string | null;
  amountCents: number | null;
}

export interface ListingStats {
  tier: ListingTier;
  basic: BasicStats;
  /** Sólo premium. En gratis viene vacío y la UI muestra qué se desbloquea. */
  ctaClicks: CtaClickStat[];
  /** Sólo premium. */
  promotions: PromotionStat[];
  /** Total de clics del período (suma de `ctaClicks`). */
  totalCtaClicks: number;
  /**
   * Gente DISTINTA que vio el aviso (sólo premium).
   *
   * `null` = no se pudo leer, y la UI no muestra la tarjeta. Es la única
   * métrica del panel que se oculta en vez de caer a 0: un alcance en cero
   * junto a un contador de vistas en 300 no es un dato pobre, es un dato
   * imposible, y quien lo lea va a sacar la conclusión equivocada sobre su
   * publicación paga.
   */
  reach: number | null;
}

function countOf(result: { count: number | null }): number {
  return result.count ?? 0;
}

/**
 * Estadísticas de UN aviso propio. Nunca lanza: una métrica que no se pudo
 * leer vale 0 y el resto del panel sigue en pie — el dueño vino a ver cómo le
 * va, no a que le expliquemos por qué una query se cayó.
 */
export async function fetchListingStats(
  supabase: Supabase,
  input: {
    listingId: string;
    tenantId: string;
    kind: string;
    tier: unknown;
    /**
     * Contadores que el trigger mantiene en la propia fila de `listings`. Si el
     * caller ya los trae en su select —y la pantalla los trae—, no se paga una
     * query por cada uno.
     */
    commentCount?: number | null;
    viewCount?: number | null;
  },
): Promise<ListingStats> {
  const tier = parseListingTier(input.tier);
  const isPremiumTier = tier === "premium";

  const sinceDate = new Date();
  sinceDate.setUTCDate(sinceDate.getUTCDate() - STATS_WINDOW_DAYS);
  const sinceIso = sinceDate.toISOString();
  const sinceDay = sinceIso.slice(0, 10);

  const [likes, saves, chats, shares] = await Promise.all([
    supabase
      .from("reactions")
      .select("subject_id", { count: "exact", head: true })
      .eq("subject_kind", "listing")
      .eq("subject_id", input.listingId)
      .then(countOf, () => 0),
    // `saves` es polimórfica y todavía puede no estar en los tipos generados en
    // algún entorno: cliente de schema abierto, mismo patrón que el feed.
    (supabase as unknown as SupabaseClient)
      .from("saves")
      .select("subject_id", { count: "exact", head: true })
      .eq("subject_kind", "listing")
      .eq("subject_id", input.listingId)
      .then(countOf, () => 0),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", input.listingId)
      .then(countOf, () => 0),
    // `listing_shares` ya viene agregada por día (una fila por aviso y día, 0050):
    // sumarla entera es leer un puñado de enteros, no recorrer un log de eventos.
    supabase
      .from("listing_shares")
      .select("shares")
      .eq("listing_id", input.listingId)
      .then(
        (r) => (r.data ?? []).reduce((sum, row) => sum + (row.shares ?? 0), 0),
        () => 0,
      ),
  ]);

  const basic: BasicStats = {
    likes,
    saves,
    chats,
    shares,
    // `listings.comment_count` (0038) y `listings.view_count` (0050) los
    // mantienen sus triggers; si el caller ya los trae en su select, no se paga
    // otra query.
    comments: typeof input.commentCount === "number" ? input.commentCount : 0,
    views: typeof input.viewCount === "number" ? input.viewCount : 0,
  };

  if (!isPremiumTier) {
    return { tier, basic, ctaClicks: [], promotions: [], totalCtaClicks: 0, reach: null };
  }

  const [clicksResult, boostsResult, campaignsResult, reach] = await Promise.all([
    supabase
      .from("cta_clicks")
      .select("cta_kind, clicks")
      .eq("listing_id", input.listingId)
      .gte("clicked_on", sinceDay)
      .then(
        (r) => (r.data ?? []) as Array<{ cta_kind: string; clicks: number }>,
        () => [] as Array<{ cta_kind: string; clicks: number }>,
      ),
    supabase
      .from("boosts")
      .select("duration_days, status, ends_at, amount_cents")
      .eq("listing_id", input.listingId)
      .neq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(
        (r) => r.data ?? [],
        () => [],
      ),
    supabase
      .from("campaigns")
      .select("duration_days, status, ends_at, budget_cents")
      .eq("listing_id", input.listingId)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(
        (r) => r.data ?? [],
        () => [],
      ),
    // La RPC valida sesión, tenant y propiedad del aviso por su cuenta: acá sólo
    // se traduce cualquier fallo (incluida una 0050 todavía sin aplicar) a
    // `null`, que la UI lee como "no mostrar la tarjeta".
    supabase.rpc("listing_reach", { p_listing_id: input.listingId }).then(
      (r) => (typeof r.data === "number" ? r.data : null),
      () => null,
    ),
  ]);

  // Agregado por botón. La tabla ya viene agrupada por (botón, día): acá sólo
  // se suman los días de la ventana.
  const byKind = new Map<string, number>();
  for (const row of clicksResult) {
    byKind.set(row.cta_kind, (byKind.get(row.cta_kind) ?? 0) + (row.clicks ?? 0));
  }

  // Se listan los botones que ESTE módulo ofrece (en el orden de la spec) más
  // el chat, que existe en todos. Un botón sin clics se muestra en 0: "nadie lo
  // tocó" es información, y esconderlo haría creer que el botón no existe.
  const ordered: CtaKind[] = [...externalCtasFor(input.kind), "chat"];
  const ctaClicks: CtaClickStat[] = ordered.map((kind) => ({
    kind,
    clicks: byKind.get(kind) ?? 0,
  }));
  // Un botón que se cargó antes y ya no corresponde al módulo igual tuvo clics:
  // se suma al final para que el total cierre con lo que la base guardó.
  for (const kind of EXTERNAL_CTA_KINDS) {
    if (!ordered.includes(kind) && (byKind.get(kind) ?? 0) > 0) {
      ctaClicks.push({ kind, clicks: byKind.get(kind) ?? 0 });
    }
  }

  const promotions: PromotionStat[] = [
    ...boostsResult.map((row) => ({
      type: "boost" as const,
      label: `Impulso de ${row.duration_days} días`,
      status: row.status,
      days: row.duration_days,
      endsAt: row.ends_at,
      amountCents: row.amount_cents,
    })),
    ...campaignsResult.map((row) => ({
      type: "campaign" as const,
      label: "Campaña",
      status: row.status,
      days: row.duration_days,
      endsAt: row.ends_at,
      amountCents: row.budget_cents,
    })),
  ];

  return {
    tier,
    basic,
    ctaClicks,
    promotions,
    totalCtaClicks: ctaClicks.reduce((sum, item) => sum + item.clicks, 0),
    reach,
  };
}
