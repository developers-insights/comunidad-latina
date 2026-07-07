import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchedChunk } from "@/lib/rag";
import type { Database, Json } from "@/lib/types/database.types";
import type { AssistantSource } from "@/components/assistant/protocol";

/**
 * Mapea los chunks del RAG (@/lib/rag → searchChunks) a:
 *  1. Tarjetas de fuente citada para la UI (BezelCards con destino interno).
 *  2. Bloque de FUENTES numeradas para el system prompt.
 *
 * Copy legal §11: el descriptor de una guía usa su PRIMERA fuente oficial con
 * fecha de consulta ("Según IRS — ITIN al 1 de julio de 2026") — se enriquece
 * con una query batch a `guides.sources` (RLS del caller: solo publicadas).
 * Si no hay fuente oficial, el descriptor es honesto ("publicado en la
 * comunidad") — NUNCA un "verificado" a secas.
 */

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** "2026-07-01" → "1 de julio de 2026" (es). Fecha inválida → null. */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

type GuideOfficialSource = { name: string; checkedAt: string | null };

/**
 * Primera fuente oficial de cada guía citada, en batch.
 * Formato de guides.sources (migración 0007):
 * [{ "name": "IRS — ITIN", "url": "…", "checked_at": "2026-07-01" }]
 */
async function fetchGuideOfficialSources(
  supabase: SupabaseClient<Database>,
  guideIds: string[],
): Promise<Map<string, GuideOfficialSource>> {
  const map = new Map<string, GuideOfficialSource>();
  if (guideIds.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from("guides")
      .select("id, sources")
      .in("id", guideIds);
    if (error || !data) return map;
    for (const row of data) {
      const sources = Array.isArray(row.sources) ? (row.sources as Json[]) : [];
      const first = asRecord(sources[0]);
      const name = asString(first.name);
      if (name) {
        map.set(row.id, { name, checkedAt: asString(first.checked_at) });
      }
    }
  } catch {
    // Sin enriquecimiento seguimos con el descriptor honesto de fallback.
  }
  return map;
}

/** Ruta interna de destino de un chunk. */
function hrefFor(chunk: MatchedChunk): string {
  const meta = chunk.metadata;
  if (chunk.sourceKind === "guide") {
    const slug = asString(meta.slug);
    return slug ? `/guias/${slug}` : "/guias";
  }
  if (chunk.sourceKind === "listing") {
    switch (asString(meta.kind)) {
      case "property":
        return `/propiedades/${chunk.sourceId}`;
      case "professional":
        return `/profesionales/${chunk.sourceId}`;
      case "event":
        return `/eventos/${chunk.sourceId}`;
      case "business":
        return "/negocios"; // los negocios no tienen detalle propio (aún)
      default:
        return "/feed";
    }
  }
  // faq / futuros kinds → el hub de guías es el destino más útil y seguro
  return "/guias";
}

function titleFor(chunk: MatchedChunk): string {
  const fromMeta = asString(chunk.metadata.title) ?? asString(chunk.metadata.name);
  if (fromMeta) return fromMeta;
  switch (chunk.sourceKind) {
    case "guide":
      return "Guía de la comunidad";
    case "listing":
      return "Aviso de la comunidad";
    default:
      return "Contenido de la comunidad";
  }
}

/** Descriptor legal-safe (§11): descriptor literal + fecha, o honestidad. */
function descriptorFor(
  chunk: MatchedChunk,
  guideSources: Map<string, GuideOfficialSource>,
): string {
  if (chunk.sourceKind === "guide") {
    const official = guideSources.get(chunk.sourceId);
    if (official) {
      const fecha = formatDate(official.checkedAt);
      return fecha ? `Según ${official.name} al ${fecha}` : `Según ${official.name}`;
    }
    return "De las guías de la comunidad, con sus fuentes citadas adentro";
  }
  if (chunk.sourceKind === "listing") {
    const area = asString(chunk.metadata.area_label);
    const base =
      asString(chunk.metadata.kind) === "event"
        ? "Evento publicado en la comunidad"
        : "Publicado en la comunidad";
    return area ? `${base} · ${area}` : base;
  }
  return "De la base de conocimiento de la comunidad";
}

const MAX_SOURCE_CARDS = 3;
const MAX_CHUNK_CHARS = 1_200;

export type SourceInfo = {
  /** Tarjetas de fuente para la UI (dedupe por destino, máx. 3). */
  sources: AssistantSource[];
  /** Bloque FUENTES numerado para el system prompt. */
  promptContext: string;
};

/**
 * Chunks → tarjetas + contexto de prompt, compartiendo el enriquecimiento de
 * fuentes oficiales de guías. `supabase` es el cliente del REQUEST (RLS del
 * caller — jamás admin acá).
 */
export async function buildSourceInfo(
  supabase: SupabaseClient<Database>,
  chunks: MatchedChunk[],
): Promise<SourceInfo> {
  const guideIds = [
    ...new Set(
      chunks.filter((chunk) => chunk.sourceKind === "guide").map((c) => c.sourceId),
    ),
  ];
  const guideSources = await fetchGuideOfficialSources(supabase, guideIds);

  const seen = new Set<string>();
  const sources: AssistantSource[] = [];
  for (const chunk of chunks) {
    const href = hrefFor(chunk);
    if (seen.has(href)) continue;
    seen.add(href);
    if (sources.length < MAX_SOURCE_CARDS) {
      sources.push({
        title: titleFor(chunk),
        href,
        descriptor: descriptorFor(chunk, guideSources),
      });
    }
  }

  const promptContext = chunks
    .map((chunk, index) => {
      const content = chunk.content.trim().slice(0, MAX_CHUNK_CHARS);
      return `[${index + 1}] «${titleFor(chunk)}» (${descriptorFor(chunk, guideSources)})\n${content}`;
    })
    .join("\n\n");

  return { sources, promptContext };
}
