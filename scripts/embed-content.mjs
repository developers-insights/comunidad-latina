#!/usr/bin/env node
/**
 * embed-content.mjs — Pipeline de embeddings del moat de IA (R3, tabla 0017)
 *
 * Qué hace (idempotente — correr las veces que haga falta):
 *  1. Lee guides PUBLISHED (globales + por tenant) y listings PUBLISHED.
 *  2. Chunkea:
 *      - guías: por secciones `## ` del markdown, ventanas de ~800 chars con
 *        solapado de ~150 (cada chunk lleva "Título · Sección" de contexto);
 *      - listings: título + descripción + zona + precio + attrs en UN chunk.
 *  3. content_hash = sha256(content): lo que no cambió NO se re-embeddea
 *     (no se re-paga OpenAI) — se compara contra rag_chunks existente.
 *  4. Embeddings con text-embedding-3-small (1536 dims) en batches.
 *  5. Upsert a rag_chunks (onConflict source_kind,source_id,chunk_index).
 *  6. Borra chunks huérfanos: fuentes despublicadas/borradas y colas de
 *     chunks sobrantes cuando un documento se achicó.
 *     Los chunks 'faq' NO se tocan: los cura otro proceso (service_role).
 *
 * MINIMIZACIÓN §5.4: solo entra contenido YA público (published). Jamás se
 * leen listing_private_details, profiles_private ni columnas de contacto.
 *
 * Requiere en .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENAI_API_KEY
 *
 * Uso:
 *   npm run rag:embed            # sincroniza el índice
 *   node scripts/embed-content.mjs --dry-run   # muestra el plan, no escribe ni paga
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✘ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}
if (!OPENAI_API_KEY && !DRY_RUN) {
  console.error('✘ Falta OPENAI_API_KEY en .env.local (o corré con --dry-run para ver el plan).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_TARGET_CHARS = 800;
const CHUNK_OVERLAP_CHARS = 150;
// Un solo chunk por listing (por contrato): tope duro para no pasarse del
// límite de tokens del modelo con descripciones larguísimas.
const LISTING_MAX_CHARS = 4000;
const EMBEDDING_BATCH_SIZE = 64;
const DB_PAGE_SIZE = 1000;
const DELETE_BATCH_SIZE = 200;

function die(context, error) {
  console.error(`✘ ${context}: ${error?.message ?? error}`);
  process.exit(1);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function chunkKey(kind, id, index) {
  return `${kind}:${id}:${index}`;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Parte un body markdown en secciones por encabezados `## `. */
function splitSections(bodyMd) {
  const sections = [];
  let current = { heading: null, lines: [] };
  for (const line of String(bodyMd ?? '').split('\n')) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current.heading !== null || current.lines.join('').trim() !== '') sections.push(current);
      current = { heading: match[1].replace(/#+$/, '').trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading !== null || current.lines.join('').trim() !== '') sections.push(current);
  return sections;
}

/**
 * Ventanas de ~CHUNK_TARGET_CHARS con solapado de CHUNK_OVERLAP_CHARS,
 * cortando en fin de párrafo/oración cuando se puede. Una sección apenas más
 * larga que el target (hasta +35%) queda entera: mejor un chunk coherente
 * que dos mochos.
 */
function windowText(text) {
  const clean = String(text ?? '').trim();
  if (clean === '') return [];
  if (clean.length <= CHUNK_TARGET_CHARS * 1.35) return [clean];

  const windows = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_TARGET_CHARS, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const cut = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '));
      if (cut > CHUNK_TARGET_CHARS * 0.5) end = start + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece !== '') windows.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
  }
  return windows;
}

/** Chunks de una guía: contexto "Título · Sección" adelante de cada ventana. */
function guideChunks(guide) {
  const chunks = [];
  for (const section of splitSections(guide.body_md)) {
    const header = section.heading ? `${guide.title} · ${section.heading}` : guide.title;
    for (const win of windowText(section.lines.join('\n'))) {
      chunks.push({
        content: `${header}\n\n${win}`,
        metadata: {
          title: guide.title,
          slug: guide.slug,
          section: section.heading,
          topics: guide.topics ?? [],
          city: guide.city ?? null,
        },
      });
    }
  }
  if (chunks.length === 0) {
    // Guía sin cuerpo útil (raro): al menos título + resumen para poder citarla.
    const fallback = [guide.title, guide.summary].filter(Boolean).join(' — ').trim();
    if (fallback !== '') {
      chunks.push({
        content: fallback,
        metadata: { title: guide.title, slug: guide.slug, section: null, topics: guide.topics ?? [], city: guide.city ?? null },
      });
    }
  }
  return chunks.map((chunk, index) => ({
    tenant_id: guide.tenant_id, // null = guía global → chunk global
    source_kind: 'guide',
    source_id: guide.id,
    chunk_index: index,
    content: chunk.content,
    content_hash: sha256(chunk.content),
    metadata: chunk.metadata,
  }));
}

const KIND_LABEL = {
  property: 'Vivienda',
  business: 'Negocio',
  professional: 'Profesional',
  event: 'Evento',
  job: 'Empleo',
};

function formatPrice(listing) {
  if (listing.price_amount == null) return null;
  const period = listing.price_period ? ` por ${listing.price_period}` : '';
  return `Precio: ${listing.price_amount} ${listing.price_currency ?? 'USD'}${period}`;
}

/** attrs jsonb plano → líneas "clave: valor" legibles para el embedding. */
function formatAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null;
  const lines = Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

/** UN chunk por listing: título + descripción + zona + precio + attrs. */
function listingChunks(listing) {
  const content = [
    `${KIND_LABEL[listing.kind] ?? listing.kind}: ${listing.title}`,
    listing.description ?? null,
    listing.area_label ? `Zona: ${listing.area_label}` : null,
    formatPrice(listing),
    formatAttrs(listing.attrs),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, LISTING_MAX_CHARS)
    .trim();

  if (content === '') return [];
  return [
    {
      tenant_id: listing.tenant_id,
      source_kind: 'listing',
      source_id: listing.id,
      chunk_index: 0,
      content,
      content_hash: sha256(content),
      // Solo columnas públicas del aviso — jamás contacto/dirección exacta.
      metadata: {
        kind: listing.kind,
        title: listing.title,
        area_label: listing.area_label ?? null,
        geo_zone: listing.geo_zone ?? null,
        price_amount: listing.price_amount ?? null,
        price_currency: listing.price_currency ?? null,
        price_period: listing.price_period ?? null,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/** Trae todas las filas paginando (builderFactory devuelve un builder NUEVO por página). */
async function fetchAll(context, builderFactory) {
  const rows = [];
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await builderFactory().range(from, from + DB_PAGE_SIZE - 1);
    if (error) {
      if (/rag_chunks/.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
        die(context, new Error(`${error.message} — ¿aplicaste la migración 0017? (npm run db:migrate)`));
      }
      die(context, error);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < DB_PAGE_SIZE) break;
  }
  return rows;
}

async function embedBatch(texts) {
  const attempt = async () => {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    // La API devuelve data con index — ordenar por las dudas.
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  };

  try {
    return await attempt();
  } catch (error) {
    // Un retry para transitorios (429/5xx); si vuelve a fallar, abortamos.
    console.warn(`  ⚠ OpenAI falló (${error?.message ?? error}) — reintento en 2s…`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return attempt();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n▶ embed-content — modelo ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dims)${DRY_RUN ? ' [DRY-RUN]' : ''}\n`);

  // 1. Fuentes publicadas ----------------------------------------------------
  const guides = await fetchAll('leyendo guides', () =>
    supabase
      .from('guides')
      .select('id, tenant_id, slug, title, summary, body_md, topics, city')
      .eq('status', 'published')
      .order('id'),
  );
  const listings = await fetchAll('leyendo listings', () =>
    supabase
      .from('listings')
      .select('id, tenant_id, kind, title, description, attrs, area_label, geo_zone, price_amount, price_currency, price_period')
      .eq('status', 'published')
      .order('id'),
  );
  console.log(`  fuentes publicadas: ${guides.length} guías · ${listings.length} listings`);

  // 2. Chunks deseados -------------------------------------------------------
  const desired = [...guides.flatMap(guideChunks), ...listings.flatMap(listingChunks)];
  const desiredByKey = new Map(desired.map((c) => [chunkKey(c.source_kind, c.source_id, c.chunk_index), c]));
  const guideChunkCount = desired.filter((c) => c.source_kind === 'guide').length;
  console.log(`  chunks deseados: ${desired.length} (${guideChunkCount} de guías, ${desired.length - guideChunkCount} de listings)`);

  // 3. Estado actual del índice (solo guide/listing: 'faq' es de otro proceso)
  const existing = await fetchAll('leyendo rag_chunks', () =>
    supabase
      .from('rag_chunks')
      .select('id, source_kind, source_id, chunk_index, content_hash')
      .in('source_kind', ['guide', 'listing'])
      .order('id'),
  );
  const existingByKey = new Map(
    existing.map((row) => [chunkKey(row.source_kind, row.source_id, row.chunk_index), row]),
  );

  // 4. Diff ------------------------------------------------------------------
  const toEmbed = [];
  let unchanged = 0;
  for (const chunk of desired) {
    const current = existingByKey.get(chunkKey(chunk.source_kind, chunk.source_id, chunk.chunk_index));
    if (current && current.content_hash === chunk.content_hash) {
      unchanged += 1;
    } else {
      toEmbed.push(chunk);
    }
  }
  const orphans = existing.filter(
    (row) => !desiredByKey.has(chunkKey(row.source_kind, row.source_id, row.chunk_index)),
  );

  console.log(`  plan: +${toEmbed.length} a embeddear · =${unchanged} sin cambios · -${orphans.length} huérfanos a borrar\n`);

  if (DRY_RUN) {
    for (const chunk of toEmbed.slice(0, 20)) {
      console.log(`    + ${chunkKey(chunk.source_kind, chunk.source_id, chunk.chunk_index)} (${chunk.content.length} chars)`);
    }
    if (toEmbed.length > 20) console.log(`    … y ${toEmbed.length - 20} más`);
    for (const row of orphans.slice(0, 20)) {
      console.log(`    - ${chunkKey(row.source_kind, row.source_id, row.chunk_index)}`);
    }
    console.log('\n✔ DRY-RUN: no se escribió nada ni se llamó a OpenAI.\n');
    return;
  }

  // 5. Borrar huérfanos ANTES de upsert (fuentes despublicadas dejan de ser
  // citables ya; match_chunks igual las filtra en vivo mientras tanto).
  for (let i = 0; i < orphans.length; i += DELETE_BATCH_SIZE) {
    const ids = orphans.slice(i, i + DELETE_BATCH_SIZE).map((row) => row.id);
    const { error } = await supabase.from('rag_chunks').delete().in('id', ids);
    if (error) die('borrando chunks huérfanos', error);
  }
  if (orphans.length > 0) console.log(`  - borrados ${orphans.length} chunks huérfanos`);

  // 6. Embeddings + upsert en batches -----------------------------------------
  let upserted = 0;
  for (let i = 0; i < toEmbed.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
    let embeddings;
    try {
      embeddings = await embedBatch(batch.map((chunk) => chunk.content));
    } catch (error) {
      die(`embeddings (batch ${i / EMBEDDING_BATCH_SIZE + 1})`, error);
    }

    const rows = batch.map((chunk, index) => {
      const embedding = embeddings[index];
      if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
        die('validando embeddings', new Error(`dimensión inesperada en ${chunkKey(chunk.source_kind, chunk.source_id, chunk.chunk_index)}`));
      }
      return {
        tenant_id: chunk.tenant_id,
        source_kind: chunk.source_kind,
        source_id: chunk.source_id,
        chunk_index: chunk.chunk_index,
        content: chunk.content,
        // Formato de texto de pgvector: "[0.1,0.2,…]".
        embedding: JSON.stringify(embedding),
        metadata: chunk.metadata,
        content_hash: chunk.content_hash,
      };
    });

    const { error } = await supabase
      .from('rag_chunks')
      .upsert(rows, { onConflict: 'source_kind,source_id,chunk_index' });
    if (error) die('upsert a rag_chunks', error);

    upserted += rows.length;
    console.log(`  + batch ${Math.floor(i / EMBEDDING_BATCH_SIZE) + 1}: ${rows.length} chunks embebidos y upserteados`);
  }

  console.log(
    `\n✔ Índice RAG sincronizado: +${upserted} embebidos · =${unchanged} sin cambios · -${orphans.length} huérfanos borrados` +
      ` · total deseado ${desired.length} chunks (${guides.length} guías + ${listings.length} listings).\n`,
  );
}

main().catch((error) => die('error inesperado', error));
