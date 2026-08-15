import "server-only";

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
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
 * import { searchChunksFts, logQuery } from "@/lib/rag";
 *
 * // 1. Buscar contexto (admin client interno; la RPC es definer y desde 0019
 * //    solo-service_role — llamar SOLO después de moderación + rate limit):
 * const { chunks, skipped } = await searchChunksFts(tenant.id, pregunta);
 *
 * if (skipped) {
 *   // Error técnico de la base → degradación elegante (§5.6):
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
 * POR QUÉ ACÁ NO HAY EMBEDDINGS (auditoría 2026-08-13)
 * ---------------------------------------------------
 * La 0017 trajo el camino vectorial (`match_chunks` + `embedQuery` con
 * text-embedding-3-small) y la 0019 trajo su gemelo textual
 * (`match_chunks_fts`, full-text en español dentro de Postgres). El asistente
 * eligió el textual —una sola credencial, ANTHROPIC_API_KEY— y el vectorial
 * quedó SIN UN SOLO CONSUMIDOR: `embedQuery`, `searchChunks` y sus dos
 * constantes de calibración vivieron meses como código muerto que arrastraba el
 * SDK de OpenAI a este módulo y `https://api.openai.com` a la CSP del navegador.
 * Se borraron. La RPC `match_chunks` y la columna `embedding` de `rag_chunks`
 * siguen en la base: nada de esto es una decisión irreversible, y si algún día
 * vuelve el camino vectorial vuelve con su consumidor.
 *
 * ANTI-HONEYPOT §5.4 (regla de este módulo):
 *  - La pregunta del usuario JAMÁS se persiste ni se loguea en claro — ni acá
 *    ni en consola (puede revelar estatus migratorio). Viaja a la base como
 *    texto de búsqueda y a assistant_queries como HMAC-SHA256 con secreto
 *    FUERA de la base (ver hashQuestion).
 *  - El índice solo contiene contenido ya público (lo garantiza el re-chequeo
 *    de published en vivo que hace `match_chunks_fts`).
 *
 * Acceso a la RPC: desde 0019 `match_chunks_fts` es EXECUTE solo-service_role
 * (nadie la invoca por PostgREST salteando moderación/rate limit), por eso
 * `searchChunksFts` usa el ADMIN client — está bien porque esta capa SOLO se
 * llama desde el route handler del ASISTENTE, que aplica moderación + rate
 * limit por IP/sesión ANTES de buscar.
 *
 * server-only: usa el cliente service_role y node:crypto — jamás importar desde
 * un client component.
 * =============================================================================
 */

/* ------------------------------- Constantes ------------------------------ */

/** Default alineado con la firma SQL de match_chunks_fts (0019). */
export const DEFAULT_MATCH_COUNT = 6;

// Una pregunta real nunca necesita más; acota costo/latencia del peor caso.
const MAX_QUERY_CHARS = 2_000;

/* --------------------------------- Types --------------------------------- */

export type RagSourceKind = "guide" | "listing" | "faq";

/** Un chunk devuelto por match_chunks_fts, listo para citar en el prompt. */
export type MatchedChunk = {
  content: string;
  /** Contexto citable (guide: title/slug/section/topics/city · listing: kind/title/area_label/…). */
  metadata: Record<string, Json | undefined>;
  sourceKind: RagSourceKind;
  sourceId: string;
  /** Puntaje 0-1 (ts_rank normalizado). */
  similarity: number;
};

export type SearchChunksOptions = {
  /** 1-20 (clamp en SQL). Default 6. */
  matchCount?: number;
};

export type SearchChunksResult = {
  chunks: MatchedChunk[];
  /**
   * true = la búsqueda NO corrió (error técnico de la base).
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

type MatchChunkRpcRow = {
  content: string;
  metadata: Json;
  source_kind: string;
  source_id: string;
  similarity: number;
};

type MatchChunksFtsArgs = {
  p_query: string;
  p_tenant_id: string;
  p_match_count?: number;
};

type MatchChunksFtsRpc = (
  fn: "match_chunks_fts",
  args: MatchChunksFtsArgs,
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

/* ----------------------------- searchChunksFts --------------------------- */

/**
 * Recuperación de contexto para el Asistente por FULL-TEXT SEARCH (español),
 * dentro de Postgres — el ÚNICO camino de recuperación que tiene el asistente,
 * y el motivo por el que depende de una sola credencial (ANTHROPIC_API_KEY).
 *
 * La RPC `match_chunks_fts` (0019) es security definer y solo-service_role, con
 * re-chequeo de `published` en vivo, así que se llama con el admin client.
 * Puntúa por `ts_rank`; `similarity` viene normalizada a 0-1.
 *
 * Nunca lanza: cualquier falla → `{ chunks: [], skipped: true }`. `skipped` acá
 * es raro (solo error de DB), así que "no hubo match" se expresa como
 * `{ chunks: [], skipped: false }` → el asistente responde "todavía no tengo
 * información verificada", nunca inventa.
 */
export async function searchChunksFts(
  tenantId: string,
  query: string,
  options: SearchChunksOptions = {},
): Promise<SearchChunksResult> {
  const input = query.trim().slice(0, MAX_QUERY_CHARS);
  if (input.length === 0) return { chunks: [], skipped: false };

  try {
    const supabase = createAdminClient();
    // Cast estructural: match_chunks_fts aún no está en database.types.ts.
    const rpc = supabase.rpc.bind(supabase) as unknown as MatchChunksFtsRpc;
    const { data, error } = await rpc("match_chunks_fts", {
      p_query: input,
      p_tenant_id: tenantId,
      p_match_count: options.matchCount ?? DEFAULT_MATCH_COUNT,
    });

    if (error) {
      console.error("[rag] match_chunks_fts falló, se degrada a skipped:", error.message);
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
      "[rag] searchChunksFts falló, se degrada a skipped:",
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
