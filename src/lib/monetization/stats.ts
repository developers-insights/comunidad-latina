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
  /**
   * QUÉ MÉTRICAS DE ACÁ ARRIBA SON UN CERO INVENTADO.
   *
   * El resto del objeto sigue trayendo 0 para que el panel no se rompa, pero un
   * 0 que salió de una query fallida no significa lo mismo que un 0 real, y la
   * diferencia le cuesta plata a quien la lee: el dueño de un negocio que pagó
   * un impulso abre estadísticas, ve "0 me gusta, 0 guardados, 0 chats",
   * concluye que el impulso no sirvió y no vuelve a comprar. La query
   * simplemente se cayó.
   *
   * Es el criterio que el repo ya tomó y dejó escrito en
   * `supabase/migrations/0074_ingresos_por_comunidad.sql`: los ilegibles «se
   * informan aparte para que el tablero muestre un hueco en vez de un cero
   * inventado».
   *
   * ⚠️ PENDIENTE: la pantalla que consume esto
   * (`app/(app)/impulsar/[listingId]/estadisticas/page.tsx`) todavía no lo mira
   * y pinta el 0 igual. El campo se agrega primero —sin romperle el tipo a
   * nadie— para que la pantalla pueda mostrar el hueco cuando se actualice.
   */
  unreadable: StatKey[];
}

/** Las métricas que se leen con su propia query y por lo tanto pueden faltar. */
export type StatKey = "likes" | "saves" | "chats" | "shares" | "ctaClicks" | "promotions";

/**
 * Una lectura que puede haber salido mal.
 *
 * ⚠️ EL `onRejected` DE UN `.then()` CASI NUNCA CORRE ACÁ: el cliente de
 * Supabase NO rechaza la promesa, devuelve `{ data, count, error }`. Por eso el
 * `.then(handler, () => 0)` que había antes era decorativo — el camino real era
 * `count: null` → 0 y `data ?? []` → vacío, o sea que un fallo de lectura y un
 * "no hay nada" llegaban al panel exactamente iguales. Se mira el `error`.
 */
type Lectura<T> = { value: T; failed: StatKey | null };

function leido<T>(value: T): Lectura<T> {
  return { value, failed: null };
}

/** Registra el fallo y devuelve el neutro, marcando la métrica como ilegible. */
function ilegible<T>(key: StatKey, neutro: T, detalle: unknown): Lectura<T> {
  const code =
    detalle && typeof detalle === "object" && "code" in detalle
      ? (detalle as { code?: string }).code
      : detalle instanceof Error
        ? detalle.message
        : String(detalle);
  console.warn(`[stats] no se pudo leer "${key}" del aviso — se informa como hueco`, { code });
  return { value: neutro, failed: key };
}

/** `{ count, error }` → número, distinguiendo 0 de "no se pudo contar". */
function contar(
  key: StatKey,
  result: { count: number | null; error: unknown },
): Lectura<number> {
  if (result.error) return ilegible(key, 0, result.error);
  return leido(result.count ?? 0);
}

/**
 * Estadísticas de UN aviso propio. Nunca lanza: una métrica que no se pudo leer
 * vale 0 y el resto del panel sigue en pie — el dueño vino a ver cómo le va, no
 * a que le expliquemos por qué una query se cayó. Pero el hueco queda declarado
 * en `unreadable` y el fallo, logueado: "no se pudo leer" y "es cero" son cosas
 * distintas y el panel tiene que poder decirlas distinto.
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
      .then(
        (r) => contar("likes", r),
        (e) => ilegible("likes", 0, e),
      ),
    // `saves` es polimórfica y todavía puede no estar en los tipos generados en
    // algún entorno: cliente de schema abierto, mismo patrón que el feed.
    (supabase as unknown as SupabaseClient)
      .from("saves")
      .select("subject_id", { count: "exact", head: true })
      .eq("subject_kind", "listing")
      .eq("subject_id", input.listingId)
      .then(
        (r) => contar("saves", r),
        (e) => ilegible("saves", 0, e),
      ),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", input.listingId)
      .then(
        (r) => contar("chats", r),
        (e) => ilegible("chats", 0, e),
      ),
    // `listing_shares` ya viene agregada por día (una fila por aviso y día, 0050):
    // sumarla entera es leer un puñado de enteros, no recorrer un log de eventos.
    supabase
      .from("listing_shares")
      .select("shares")
      .eq("listing_id", input.listingId)
      .then(
        (r) =>
          r.error
            ? ilegible("shares", 0, r.error)
            : leido((r.data ?? []).reduce((sum, row) => sum + (row.shares ?? 0), 0)),
        (e) => ilegible("shares", 0, e),
      ),
  ]);

  const unreadable: StatKey[] = [likes, saves, chats, shares]
    .map((lectura) => lectura.failed)
    .filter((key): key is StatKey => key !== null);

  const basic: BasicStats = {
    likes: likes.value,
    saves: saves.value,
    chats: chats.value,
    shares: shares.value,
    // `listings.comment_count` (0038) y `listings.view_count` (0050) los
    // mantienen sus triggers; si el caller ya los trae en su select, no se paga
    // otra query.
    comments: typeof input.commentCount === "number" ? input.commentCount : 0,
    views: typeof input.viewCount === "number" ? input.viewCount : 0,
  };

  if (!isPremiumTier) {
    return {
      tier,
      basic,
      ctaClicks: [],
      promotions: [],
      totalCtaClicks: 0,
      reach: null,
      unreadable,
    };
  }

  type ClickRow = { cta_kind: string; clicks: number };
  type BoostRow = {
    duration_days: number;
    status: string;
    ends_at: string | null;
    amount_cents: number | null;
  };
  type CampaignRow = {
    duration_days: number | null;
    status: string;
    ends_at: string | null;
    budget_cents: number | null;
  };

  const [clicks, boosts, campaigns, reach] = await Promise.all([
    supabase
      .from("cta_clicks")
      .select("cta_kind, clicks")
      .eq("listing_id", input.listingId)
      .gte("clicked_on", sinceDay)
      .then(
        (r) =>
          r.error
            ? ilegible("ctaClicks", [] as ClickRow[], r.error)
            : leido((r.data ?? []) as ClickRow[]),
        (e) => ilegible("ctaClicks", [] as ClickRow[], e),
      ),
    supabase
      .from("boosts")
      .select("duration_days, status, ends_at, amount_cents")
      .eq("listing_id", input.listingId)
      .neq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(
        (r) =>
          r.error
            ? ilegible("promotions", [] as BoostRow[], r.error)
            : leido((r.data ?? []) as BoostRow[]),
        (e) => ilegible("promotions", [] as BoostRow[], e),
      ),
    supabase
      .from("campaigns")
      .select("duration_days, status, ends_at, budget_cents")
      .eq("listing_id", input.listingId)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(
        (r) =>
          r.error
            ? ilegible("promotions", [] as CampaignRow[], r.error)
            : leido((r.data ?? []) as CampaignRow[]),
        (e) => ilegible("promotions", [] as CampaignRow[], e),
      ),
    // La RPC valida sesión, tenant y propiedad del aviso por su cuenta: acá sólo
    // se traduce cualquier fallo (incluida una 0050 todavía sin aplicar) a
    // `null`, que la UI lee como "no mostrar la tarjeta" — esta métrica ya
    // distinguía el hueco del cero, y es el modelo que sigue el resto.
    supabase.rpc("listing_reach", { p_listing_id: input.listingId }).then(
      (r) => {
        if (r.error) {
          console.warn("[stats] no se pudo leer el alcance del aviso", { code: r.error.code });
          return null;
        }
        return typeof r.data === "number" ? r.data : null;
      },
      () => null,
    ),
  ]);

  const clicksResult = clicks.value;
  const boostsResult = boosts.value;
  const campaignsResult = campaigns.value;
  for (const lectura of [clicks, boosts, campaigns]) {
    // `promotions` sale de DOS queries (impulsos y campañas): si cualquiera de
    // las dos falla, la lista está incompleta y se declara una sola vez.
    if (lectura.failed && !unreadable.includes(lectura.failed)) {
      unreadable.push(lectura.failed);
    }
  }

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
    unreadable,
  };
}
