// Diagnóstico one-off: mide la similitud real de las preguntas sugeridas del
// Asistente contra el índice RAG, para calibrar DEFAULT_MIN_SIMILARITY.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, ".env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const openai = new OpenAI();

const { data: tenant } = await supabase.from("tenants").select("id").eq("slug", "dominicanos").single();

const questions = [
  "¿Cómo saco mi ITIN?",
  "¿Dónde encuentro vivienda sin crédito?",
  "¿Cómo me protejo de estafas de alquiler?",
  "¿Qué hago si me para ICE?",
];

for (const q of questions) {
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: q,
    dimensions: 1536,
  });
  const vector = emb.data[0].embedding;
  const { data, error } = await supabase.rpc("match_chunks", {
    p_query_embedding: vector,
    p_tenant_id: tenant.id,
    p_match_count: 3,
    p_min_similarity: 0.0, // sin filtro: quiero ver las similitudes crudas
  });
  if (error) {
    console.log(`\n"${q}"\n  ERROR: ${error.message}`);
    continue;
  }
  console.log(`\n"${q}"`);
  if (!data || data.length === 0) {
    console.log("  (sin resultados ni con umbral 0)");
  } else {
    for (const r of data) {
      const m = r.metadata || {};
      console.log(`  ${r.similarity.toFixed(3)}  [${r.source_kind}] ${m.title || m.slug || r.source_id}`);
    }
  }
}
console.log("\n---\nDEFAULT_MIN_SIMILARITY actual = 0.75");
