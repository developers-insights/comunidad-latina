import "server-only";

import { createHmac } from "node:crypto";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOpenAIConfigured } from "@/lib/config/services";
import type { Database, Json } from "@/lib/types/database.types";

/**
 * =============================================================================
 * RAG (módulo DB-RAG) — capa de datos del Asistente (R3, migración 0017)
 * =============================================================================
 *
 * Tres piezas, en el orden en que el módulo ASISTENTE las usa:
 *
 * ```ts
 * import { createAdminClient } from "@/lib/supabase/admin";
 * import { searchChunks, logQuery } from "@/lib/rag";
 *
 * // 1. Buscar contexto (admin client interno; la RPC es definer y desde 0018
 * //    solo-service_role — llamar SOLO después de moderación + rate limit):
 * const { chunks, skipped } = await searchChunks(tenant.id, pregunta);
 *
 * if (skipped) {
 *   // OpenAI sin configurar o caído → degradación elegante (§5.6):
 *   // <ProximamentePremium feature="asistente" /> — jamás un error crudo.
 * }
 * if (chunks.length === 0) {
 *   // Guardrail §3: SIN fuentes fuertes el asistente dice "no sé" con calidez
 *   // y linkea /guias — NUNCA inventa. No llamar al LLM sin contexto.
 * }
 *
 * // 2. Responder citando chunks[i].metadata (title/slug/section/kind)…
 *
 * // 3. Telemetría mínima (admin client: la tabla es solo-service por RLS):
 * const logged = await logQuery(createAdminClient(), {
 *   tenantId: tenant.id,
 *   profileId: user?.id ?? null,          // anon permitido
 *   question: pregunta,                    // ⚠ acá adentro se hashea; el texto NO se persiste
 *   sourcesUsed: chunks,
 * });
 * // logged.ok && logged.id → guardarlo para el feedback "¿Te sirvió?":
 * // await setQueryFeedback(createAdminClient(), logged.id, true);
 * ```
 *
 * ANTI-HONEYPOT §5.4 (regla de este módulo):
 *  - La pregunta del usuario JAMÁS se persiste ni se loguea en claro — ni acá
 *    ni en consola (puede revelar estatus migratorio). Solo viaja a OpenAI
 *    para embeddearse y a assistant_queries como HMAC-SHA256 con secreto
 *    FUERA de la base (ver hashQuestion).
 *  - El índice solo contiene contenido ya público (lo garantiza el pipeline
 *    scripts/embed-content.mjs + el re-chequeo de published de match_chunks).
 *
 * Acceso a la RPC: desde 0018 match_chunks es EXECUTE solo-service_role (nadie
 * la invoca por PostgREST salteando moderación/rate limit), por eso
 * searchChunks usa el ADMIN client — está bien porque esta capa SOLO se llama
 * desde el route handler del ASISTENTE, que aplica moderación + rate limit
 * por IP/sesión ANTES de buscar.
 *
 * server-only: lee OPENAI_API_KEY y usa node:crypto — jamás importar desde un
 * client component.
 * =============================================================================
 */

/* ------------------------------- Constantes ------------------------------ */

const EMBEDDING_MODEL = "text-embedding-3-small";
/** Dimensión del índice — DEBE coincidir con vector(1536) de rag_chunks (0017). */
export const EMBEDDING_DIMENSIONS = 1536;
/** Defaults alineados con la firma SQL de match_chunks (0017). */
export const DEFAULT_MATCH_COUNT = 6;
/**
 * Umbral de similitud coseno CALIBRADO empíricamente (scripts/diagnose-rag.mjs)
 * contra el índice real con text-embedding-3-small. Medición sobre las 4
 * preguntas sugeridas del asistente:
 *   - "¿Cómo saco mi ITIN?"           → guía ITIN exacta a 0.748
 *   - "¿Qué hago si me para ICE?"     → guía de derechos ante ICE a 0.589
 *   - "vivienda sin crédito"          → listings de vivienda a 0.454 (relevante)
 *   - "estafas de alquiler"           → listings a 0.387 (NO relevante: no hay
 *                                        guía anti-estafa embebida → debe caer
 *                                        en el fallback honesto + derivación)
 * 0.42 captura los tres matches genuinos y rechaza el ruido de 0.387. El 0.75
 * original (default de una métrica distinta) rechazaba TODO, incluida la guía
 * que respondía la pregunta — el moat citaba "no sé" sobre su propio contenido.
 * text-embedding-3-small: los buenos matches temáticos viven en ~0.45-0.75, no
 * cerca de 1.0.
 */
export const DEFAULT_MIN_SIMILARITY = 0.42;

// Una pregunta real nunca necesita más; acota costo/latencia del peor caso.
const MAX_QUERY_CHARS = 2_000;

/* --------------------------------- Types --------------------------------- */

export type RagSourceKind = "guide" | "listing" | "faq";

/** Un chunk devuelto por match_chunks, listo para citar en el prompt. */
export type MatchedChunk = {
  content: string;
  /** Contexto citable (guide: title/slug/section/topics/city · listing: kind/title/area_label/…). */
  metadata: Record<string, Json | undefined>;
  sourceKind: RagSourceKind;
  sourceId: string;
  /** Similitud coseno 0-1 (1 = idéntico). Siempre ≥ minSimilarity. */
  similarity: number;
};

export type SearchChunksOptions = {
  /** 1-20 (clamp en SQL). Default 6. */
  matchCount?: number;
  /** 0-1. Default 0.42 (calibrado, ver DEFAULT_MIN_SIMILARITY): sin fuentes relevantes, "no sé". */
  minSimilarity?: number;
};

export type SearchChunksResult = {
  chunks: MatchedChunk[];
  /**
   * true = la búsqueda NO corrió (OpenAI sin configurar o error técnico).
   * El caller degrada premium (§5.6); NO es lo mismo que chunks vacío con
   * skipped=false (ahí el asistente responde "no encontré nada sobre eso").
   */
  skipped: boolean;
};

export type LogQueryInput = {
  tenantId: string;
  /** null/undefined = consulta anónima (permitida). */
  profileId?: string | null;
  /** La pregunta EN CLARO — se hashea acá adentro; el texto jamás se persiste. */
  question: string;
  /** Chunks citados en la respuesta (se persisten solo kind/id/similarity). */
  sourcesUsed?: ReadonlyArray<Pick<MatchedChunk, "sourceKind" | "sourceId" | "similarity">>;
};

export type LogQueryResult = { ok: true; id: string } | { ok: false; error: string };

/* -------------------------------------------------------------------------
 * La migración 0017 todavía no está reflejada en database.types.ts (se
 * regenera DESPUÉS de aplicarla). Hasta entonces, la RPC y la tabla nuevas se
 * tipan a mano con casts estructurales vía `unknown`. Al regenerar los tipos,
 * estos casts pueden borrarse y usar el cliente tipado directo.
 * ------------------------------------------------------------------------- */

type MatchChunksArgs = {
  /** PostgREST serializa el array como "[0.1,…]" — el formato de texto de pgvector. */
  p_query_embedding: number[];
  p_tenant_id: string;
  p_match_count?: number;
  p_min_similarity?: number;
};

type MatchChunkRpcRow = {
  content: string;
  metadata: Json;
  source_kind: string;
  source_id: string;
  similarity: number;
};

type MatchChunksRpc = (
  fn: "match_chunks",
  args: MatchChunksArgs,
) => PromiseLike<{ data: MatchChunkRpcRow[] | null; error: { message: string } | null }>;

type AssistantQueryInsertRow = {
  tenant_id: string;
  profile_id: string | null;
  question_hash: string;
  sources_used: Json;
};

type AssistantQueriesTable = {
  insert(row: AssistantQueryInsertRow): {
    select(columns: "id"): {
      single(): PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>;
    };
  };
  update(patch: { helpful: boolean }): {
    eq(column: "id", value: string): PromiseLike<{ error: { message: string } | null }>;
  };
};

type AssistantQueriesClient = {
  from(table: "assistant_queries"): AssistantQueriesTable;
};

/* ------------------------------- embedQuery ------------------------------ */

/**
 * Embeddea una pregunta con text-embedding-3-small (1536 dims — la dimensión
 * del índice de 0017).
 *
 * Degradación elegante (§5.6): sin OPENAI_API_KEY, texto vacío o error de API
 * devuelve `null` — NUNCA lanza. No loguea el texto (anti-PII), solo el error
 * técnico.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const input = text.trim().slice(0, MAX_QUERY_CHARS);
  if (!isOpenAIConfigured || input.length === 0) return null;

  try {
    const openai = new OpenAI();
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const embedding = response.data[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      console.error("[rag] embedQuery: respuesta con dimensión inesperada, se degrada a null");
      return null;
    }
    return embedding;
  } catch (error) {
    // Solo el error técnico — jamás la pregunta del usuario (anti-PII §5.4).
    console.error(
      "[rag] embedQuery falló, se degrada a null:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return null;
  }
}

/* ------------------------------ searchChunks ----------------------------- */

/**
 * Busca contexto para el asistente: embeddea la pregunta y llama a la RPC
 * `match_chunks` con el cliente ADMIN (la RPC es security definer y desde
 * 0018 su EXECUTE es solo-service_role: por PostgREST nadie puede hacer
 * búsquedas vectoriales cross-tenant salteando el rate limit del asistente).
 * La RPC re-chequea que cada fuente siga publicada. Devuelve chunks del
 * tenant + globales (tenant_id null), orden por similitud.
 *
 * Nunca lanza: cualquier falla → `{ chunks: [], skipped: true }`.
 */
export async function searchChunks(
  tenantId: string,
  query: string,
  options: SearchChunksOptions = {},
): Promise<SearchChunksResult> {
  const embedding = await embedQuery(query);
  if (embedding === null) return { chunks: [], skipped: true };

  try {
    const supabase = createAdminClient();
    // Cast estructural: match_chunks aún no existe en database.types.ts (ver arriba).
    const rpc = supabase.rpc.bind(supabase) as unknown as MatchChunksRpc;
    const { data, error } = await rpc("match_chunks", {
      p_query_embedding: embedding,
      p_tenant_id: tenantId,
      p_match_count: options.matchCount ?? DEFAULT_MATCH_COUNT,
      p_min_similarity: options.minSimilarity ?? DEFAULT_MIN_SIMILARITY,
    });

    if (error) {
      console.error("[rag] match_chunks falló, se degrada a skipped:", error.message);
      return { chunks: [], skipped: true };
    }

    const chunks: MatchedChunk[] = (data ?? []).map((row) => ({
      content: row.content,
      metadata: (row.metadata ?? {}) as MatchedChunk["metadata"],
      sourceKind: row.source_kind as RagSourceKind,
      sourceId: row.source_id,
      similarity: row.similarity,
    }));

    return { chunks, skipped: false };
  } catch (error) {
    console.error(
      "[rag] searchChunks falló, se degrada a skipped:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return { chunks: [], skipped: true };
  }
}

/* ------------------------------ hashQuestion ----------------------------- */

/**
 * Secreto del HMAC de preguntas — vive FUERA de la base a propósito.
 * ASSISTANT_QUERY_SECRET dedicado si existe; fallback CRON_SECRET (mismo
 * patrón que la cookie anónima del asistente). Dev sin .env completo: secreto
 * fijo con warning — jamás romper por telemetría (§5.6).
 */
function hashSecret(): string {
  const value = process.env.ASSISTANT_QUERY_SECRET || process.env.CRON_SECRET;
  if (value && value.length > 0) return value;
  console.warn(
    "[rag] ASSISTANT_QUERY_SECRET/CRON_SECRET ausentes — hashQuestion usa un secreto de dev.",
  );
  return "cl-rag-dev-only";
}

/**
 * HMAC-SHA256 (keyed) de la pregunta NORMALIZADA (trim + lowercase + espacios
 * colapsados): la misma pregunta colisiona al mismo hash — sirve para medir
 * repetición/frecuencia sin poder leerla (§5.4).
 *
 * ¿Por qué HMAC y no sha256 pelado? (fiscal R3) El espacio de preguntas
 * reales es chico y la normalización es código público: un sha256 sin clave
 * se revierte por diccionario offline con solo un dump de la DB ("¿qué hago
 * si me para ICE?" tiene un hash determinístico y conocido). Con la clave
 * FUERA de la base, un dump/subpoena de la DB sola no permite recuperar
 * preguntas; quien además tenga el secreto del server solo puede confirmar
 * una pregunta CONOCIDA, no leer arbitrarias.
 */
export function hashQuestion(question: string): string {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, " ");
  return createHmac("sha256", hashSecret()).update(normalized, "utf8").digest("hex");
}

/* -------------------------------- logQuery ------------------------------- */

/**
 * Registra la consulta en `assistant_queries` (telemetría mínima, TTL 30d).
 *
 * ⚠ La tabla es solo-service por RLS: pasá el admin client
 * (`createAdminClient()`) — por eso solo puede llamarse desde server actions /
 * route handlers (server-only). La pregunta se hashea ACÁ ADENTRO: el texto
 * en claro jamás toca la base ni los logs.
 *
 * Nunca lanza: devuelve `{ ok: false, error }` para que el caller decida
 * (una falla de telemetría JAMÁS rompe la respuesta al usuario).
 */
export async function logQuery(
  admin: SupabaseClient<Database>,
  input: LogQueryInput,
): Promise<LogQueryResult> {
  try {
    // Cast estructural: assistant_queries aún no existe en database.types.ts (ver arriba).
    const table = (admin as unknown as AssistantQueriesClient).from("assistant_queries");
    const { data, error } = await table
      .insert({
        tenant_id: input.tenantId,
        profile_id: input.profileId ?? null,
        question_hash: hashQuestion(input.question),
        sources_used: (input.sourcesUsed ?? []).map((source) => ({
          source_kind: source.sourceKind,
          source_id: source.sourceId,
          similarity: source.similarity,
        })),
      })
      .select("id")
      .single();

    if (error || !data) {
      const message = error?.message ?? "insert sin fila devuelta";
      console.error("[rag] logQuery falló:", message);
      return { ok: false, error: message };
    }
    return { ok: true, id: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error("[rag] logQuery falló:", message);
    return { ok: false, error: message };
  }
}

/* ---------------------------- setQueryFeedback --------------------------- */

/**
 * Feedback "¿Te sirvió?" sobre una consulta ya registrada (id de logQuery).
 * Solo-service por RLS → admin client. Nunca lanza.
 */
export async function setQueryFeedback(
  admin: SupabaseClient<Database>,
  queryId: string,
  helpful: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const table = (admin as unknown as AssistantQueriesClient).from("assistant_queries");
    const { error } = await table.update({ helpful }).eq("id", queryId);
    if (error) {
      console.error("[rag] setQueryFeedback falló:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error("[rag] setQueryFeedback falló:", message);
    return { ok: false, error: message };
  }
}
