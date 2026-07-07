import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database.types";

/**
 * =============================================================================
 * MATCHING "Para vos" (módulo MATCHING+COPILOTO) — determinístico y explicable
 * =============================================================================
 *
 * Cruza las needs del onboarding (profiles_private, SOLO legibles por el
 * dueño vía RLS — este módulo JAMÁS usa el cliente admin) con el contenido
 * publicado del tenant, y devuelve los mejores 4 matches CON la razón visible
 * (transparencia = confianza: la persona siempre sabe POR QUÉ ve algo).
 *
 * Scoring (server, sin LLM — barato, auditable, sin alucinaciones):
 *   - need → kind es el filtro base (sin match de need no hay candidato)
 *   - misma zona que el perfil ........ +2
 *   - verificación activa (found_active) +1
 *   - recencia (≤7 días +1, ≤30 días +0.5)
 *
 * Anti-honeypot: solo campos ya públicos (title, área aproximada, precio).
 * Nunca loguea needs ni zona (son datos sensibles del onboarding).
 * =============================================================================
 */

type Supabase = SupabaseClient<Database>;

/** Needs canónicas del onboarding (mismo enum que (auth)/actions.ts). */
export const NEED_IDS = ["vivienda", "trabajo", "gente", "estafas", "tramites"] as const;
export type NeedId = (typeof NEED_IDS)[number];

/** need → kind de listing que la satisface. */
const NEED_TO_LISTING_KIND: Partial<Record<NeedId, string>> = {
  vivienda: "property",
  trabajo: "job",
  gente: "event",
};

/** needs que se satisfacen con guías (topics del contenido editorial). */
const NEED_TO_GUIDE_TOPICS: Partial<Record<NeedId, string[]>> = {
  tramites: ["tramites", "documentos", "legal"],
  estafas: ["estafas", "seguridad", "fraude"],
};

export interface MatchItem {
  /** Clave estable para el render. */
  key: string;
  /** "listing" o "guide" — cambia el destino y el layout de la card. */
  type: "listing" | "guide";
  kind: string;
  title: string;
  href: string;
  areaLabel: string | null;
  priceAmount: number | null;
  priceCurrency: string;
  pricePeriod: string | null;
  photoPath: string | null;
  /** La razón del match, visible en la card ("Porque buscás vivienda en Corona"). */
  reason: string;
  /** true si el item tiene verification_check found_active vigente. */
  verified: boolean;
  score: number;
  createdAt: string;
}

export type MatchesResult =
  /** El usuario todavía no completó needs en el onboarding. */
  | { status: "no-needs" }
  /** Hay needs pero nada publicado que matchee hoy. */
  | { status: "empty"; needs: NeedId[] }
  /** Falla técnica — la sección no se muestra (nunca invitar por error). */
  | { status: "unavailable" }
  | { status: "ok"; needs: NeedId[]; items: MatchItem[] };

const MAX_MATCHES = 4;
const CANDIDATES_PER_QUERY = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------ helpers --------------------------------- */

function parseNeeds(value: Json): NeedId[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is NeedId =>
      typeof item === "string" && (NEED_IDS as readonly string[]).includes(item),
  );
}

/** Normaliza etiquetas de zona para comparar ("Corona, Queens" ~ "corona"). */
function normalizeArea(label: string | null | undefined): string {
  return (label ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function sameZone(userArea: string, itemArea: string | null): boolean {
  if (!userArea || !itemArea) return false;
  const item = normalizeArea(itemArea);
  if (!item) return false;
  // Match laxo por token: "corona" ∈ "Corona, Queens" y viceversa.
  return item.includes(userArea) || userArea.includes(item);
}

function recencyBonus(createdAt: string, now: number): number {
  const age = now - new Date(createdAt).getTime();
  if (!Number.isFinite(age) || age < 0) return 0;
  if (age <= 7 * DAY_MS) return 1;
  if (age <= 30 * DAY_MS) return 0.5;
  return 0;
}

/** Razón del match, en el idioma cálido del producto — SIEMPRE visible. */
function reasonFor(need: NeedId, userAreaLabel: string | null, inZone: boolean): string {
  const zone = inZone && userAreaLabel ? ` en ${userAreaLabel}` : "";
  switch (need) {
    case "vivienda":
      return `Porque buscás vivienda${zone}`;
    case "trabajo":
      return `Porque buscás trabajo${zone}`;
    case "gente":
      return `Porque querés conocer gente de tu comunidad`;
    case "tramites":
      return `Porque estás resolviendo trámites`;
    case "estafas":
      return `Porque querés cuidarte de estafas`;
  }
}

function listingHref(kind: string, id: string): string {
  switch (kind) {
    case "property":
      return `/propiedades/${id}`;
    case "event":
      return "/eventos";
    case "business":
      return "/negocios";
    case "professional":
      return "/profesionales";
    default:
      return "/feed";
  }
}

/* ------------------------------ getMatches ------------------------------ */

export interface MatchingTenant {
  id: string;
  currency: string;
}

/**
 * Top 4 matches para el usuario logueado.
 *
 * `supabase` DEBE ser el cliente server del propio usuario (anon + cookies):
 * la lectura de `profiles_private` depende de la RLS owner-only. Nunca pasar
 * el cliente admin acá. Nunca lanza: ante cualquier falla devuelve "no-needs"
 * (la sección simplemente no aparece — degradación silenciosa).
 */
export async function getMatches(
  supabase: Supabase,
  userId: string,
  tenant: MatchingTenant,
): Promise<MatchesResult> {
  try {
    const [privateResult, profileResult] = await Promise.all([
      supabase
        .from("profiles_private")
        .select("needs")
        .eq("profile_id", userId)
        .maybeSingle(),
      supabase.from("profiles").select("area_label").eq("id", userId).maybeSingle(),
    ]);

    const needs = parseNeeds(privateResult.data?.needs ?? null);
    if (needs.length === 0) return { status: "no-needs" };

    const userAreaLabel = profileResult.data?.area_label ?? null;
    const userArea = normalizeArea(userAreaLabel);

    // Candidatos: listings por kind + guías por topic, en paralelo.
    const listingKinds = needs
      .map((need) => NEED_TO_LISTING_KIND[need])
      .filter((kind): kind is string => Boolean(kind));
    const guideTopics = needs.flatMap((need) => NEED_TO_GUIDE_TOPICS[need] ?? []);

    const [listingsResult, guidesResult] = await Promise.all([
      listingKinds.length > 0
        ? supabase
            .from("listings")
            .select(
              "id, kind, title, area_label, price_amount, price_currency, price_period, photos, created_at",
            )
            .eq("tenant_id", tenant.id)
            .eq("status", "published")
            .in("kind", listingKinds)
            .order("created_at", { ascending: false })
            .limit(CANDIDATES_PER_QUERY)
        : Promise.resolve({ data: [], error: null }),
      guideTopics.length > 0
        ? supabase
            .from("guides")
            .select("id, slug, title, topics, created_at")
            .eq("status", "published")
            .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
            .overlaps("topics", guideTopics)
            .order("published_at", { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (listingsResult.error) {
      console.warn("[matching] query de listings falló", { code: listingsResult.error.code });
    }
    if (guidesResult.error) {
      console.warn("[matching] query de guías falló", { code: guidesResult.error.code });
    }

    const listingRows = listingsResult.data ?? [];
    const guideRows = guidesResult.data ?? [];

    // Verificación activa de los candidatos (misma regla estricta de siempre:
    // sin check found_active NO se dice "verificado").
    const verifiedIds = new Set<string>();
    if (listingRows.length > 0) {
      const { data: checks } = await supabase
        .from("verification_checks")
        .select("subject_id")
        .eq("tenant_id", tenant.id)
        .eq("subject_kind", "listing")
        .eq("result", "found_active")
        .in(
          "subject_id",
          listingRows.map((row) => row.id),
        );
      for (const check of checks ?? []) {
        if (check.subject_id) verifiedIds.add(check.subject_id);
      }
    }

    const now = Date.now();
    const kindToNeed = new Map<string, NeedId>();
    for (const need of needs) {
      const kind = NEED_TO_LISTING_KIND[need];
      if (kind) kindToNeed.set(kind, need);
    }

    const items: MatchItem[] = [];

    for (const row of listingRows) {
      const need = kindToNeed.get(row.kind);
      if (!need) continue;
      const inZone = sameZone(userArea, row.area_label);
      const verified = verifiedIds.has(row.id);
      const score =
        (inZone ? 2 : 0) + (verified ? 1 : 0) + recencyBonus(row.created_at, now);
      items.push({
        key: `listing-${row.id}`,
        type: "listing",
        kind: row.kind,
        title: row.title,
        href: listingHref(row.kind, row.id),
        areaLabel: row.area_label,
        priceAmount: row.price_amount,
        priceCurrency: row.price_currency,
        pricePeriod: row.price_period,
        photoPath: row.photos.find((path) => path && path.trim().length > 0) ?? null,
        reason: reasonFor(need, userAreaLabel, inZone),
        verified,
        score,
        createdAt: row.created_at,
      });
    }

    // Guías: qué need las trajo (primer topic que overlapea).
    const guideNeeds = needs.filter((need) => NEED_TO_GUIDE_TOPICS[need]);
    for (const row of guideRows) {
      const need =
        guideNeeds.find((candidate) =>
          (NEED_TO_GUIDE_TOPICS[candidate] ?? []).some((topic) =>
            (row.topics ?? []).includes(topic),
          ),
        ) ?? guideNeeds[0];
      if (!need) continue;
      items.push({
        key: `guide-${row.id}`,
        type: "guide",
        kind: "guide",
        title: row.title,
        href: `/guias/${row.slug}`,
        areaLabel: null,
        priceAmount: null,
        priceCurrency: tenant.currency,
        pricePeriod: null,
        photoPath: null,
        reason: reasonFor(need, null, false),
        verified: false,
        score: 1 + recencyBonus(row.created_at, now), // fuente editorial curada
        createdAt: row.created_at,
      });
    }

    if (items.length === 0) return { status: "empty", needs };

    // Orden: score desc, luego recencia desc — determinístico y estable.
    items.sort((a, b) =>
      a.score === b.score
        ? b.createdAt.localeCompare(a.createdAt)
        : b.score - a.score,
    );

    // Diversidad mínima: no más de 2 items del mismo kind en el top 4.
    const perKind = new Map<string, number>();
    const top: MatchItem[] = [];
    for (const item of items) {
      const used = perKind.get(item.kind) ?? 0;
      if (used >= 2) continue;
      perKind.set(item.kind, used + 1);
      top.push(item);
      if (top.length === MAX_MATCHES) break;
    }

    return { status: "ok", needs, items: top };
  } catch (error) {
    // Nunca romper el feed por el matching — degradación silenciosa.
    console.warn(
      "[matching] getMatches falló, se omite la sección:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return { status: "unavailable" };
  }
}
