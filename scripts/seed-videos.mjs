#!/usr/bin/env node
/**
 * seed-videos.mjs — Videos demo para el sistema de reels (sprint 2026-07-21)
 *
 * Genera con ffmpeg 4–6 clips VERTICALES (720x1280, 6–10s) a partir de
 * fuentes sintéticas (testsrc2 / gradients / mandelbrot / life — nada con
 * derechos de autor), los sube al bucket post-media con la service key y crea
 * posts `published` de usuarios demo con body en español natural:
 *  - personales (entity null → visibles para todos en /videos "Para ti")
 *  - de ENTIDAD (panadería = business, festival = event) para demostrar el
 *    scope por módulo (/videos?scope=negocios | eventos) — las cuentas demo ya
 *    siguen esas entidades (seed-demo-content.mjs), así que los ven
 *  - uno MIXTO (foto + video) para demostrar el visor pasando entre medios
 *
 * NO toca usuarios ni passwords (regla del proyecto: el seed de usuarios
 * driftea passwords). Solo lee usuarios/listings existentes; si falta alguno,
 * salta ese post y lo avisa.
 *
 * Idempotente: paths de storage deterministas (upsert) y posts buscados por
 * body exacto antes de insertar. Requiere en .env.local:
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. ffmpeg en el PATH.
 * Uso: node scripts/seed-videos.mjs
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✘ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const summary = [];
const createdPostIds = [];
const uploadedPaths = [];
function log(action, detail) {
  summary.push(`${action}: ${detail}`);
  console.log(`  ${action === 'skip' ? '·' : '+'} [${action}] ${detail}`);
}
function die(context, error) {
  console.error(`✘ ${context}: ${error?.message ?? error}`);
  process.exit(1);
}
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// ffmpeg: clips sintéticos 9:16 con un tono suave (el autoplay con sonido de
// los reels necesita audio para poder demostrarse)
// ---------------------------------------------------------------------------

function checkFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    die('ffmpeg', 'no está en el PATH — genera los clips demo. Instalalo y reintentá.');
  }
}

/**
 * Tono ambiente MUY suave (dos senos con fade in/out): presente para la demo
 * de sonido, inofensivo al oído. Volumen bajísimo a propósito.
 */
function audioSource(duration) {
  return `aevalsrc=0.05*sin(220*2*PI*t)+0.03*sin(330*2*PI*t):s=44100:d=${duration}`;
}

// Paleta de la marca (azul/amarillo/rojo tricolor) en los gradientes.
const CLIPS = [
  {
    key: 'plaza',
    duration: 7,
    source: 'testsrc2=size=720x1280:rate=30',
  },
  {
    key: 'tricolor',
    duration: 8,
    source: 'gradients=size=720x1280:speed=0.035:nb_colors=3:c0=0x1A5EDB:c1=0xF2B705:c2=0xC1121F',
  },
  {
    key: 'atardecer',
    duration: 9,
    source: 'gradients=size=720x1280:speed=0.025:nb_colors=3:c0=0xFF7A59:c1=0x7C3AED:c2=0x0D2E6B',
  },
  {
    key: 'fractal',
    duration: 6,
    source: 'mandelbrot=size=720x1280:rate=30',
  },
  {
    key: 'vida',
    duration: 8,
    source:
      'life=size=720x1280:rate=25:ratio=0.08:mold=10:seed=42:life_color=#F2B705:death_color=#0D2E6B:mold_color=#1A5EDB',
  },
];

function renderClip(outDir, clip) {
  const outFile = path.join(outDir, `${clip.key}.mp4`);
  if (existsSync(outFile)) return outFile;
  const args = [
    '-y',
    '-f', 'lavfi', '-i', clip.source,
    '-f', 'lavfi', '-i', audioSource(clip.duration),
    '-t', String(clip.duration),
    '-af', `afade=t=in:d=0.8,afade=t=out:st=${clip.duration - 1}:d=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    '-shortest',
    outFile,
  ];
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    die(`ffmpeg clip ${clip.key}`, result.stderr?.slice(-600) ?? result.error);
  }
  return outFile;
}

// ---------------------------------------------------------------------------
// Lecturas (nunca se crean usuarios ni listings acá)
// ---------------------------------------------------------------------------

async function tenantBySlug(slug) {
  const { data, error } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle();
  if (error) die(`tenant ${slug}`, error);
  if (!data) die(`tenant ${slug}`, 'no existe — corré primero scripts/seed.mjs');
  return data.id;
}

async function findUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) die('listUsers', error);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function findListingBySeedKey(tenantId, seedKey) {
  const { data, error } = await supabase
    .from('listings')
    .select('id, title, kind, created_by')
    .eq('tenant_id', tenantId)
    .eq('attrs->>seed_key', seedKey)
    .maybeSingle();
  if (error) die(`listing ${seedKey}`, error);
  return data;
}

// ---------------------------------------------------------------------------
// Escrituras idempotentes
// ---------------------------------------------------------------------------

async function uploadClip(tenantId, userId, clipKey, localFile) {
  const storagePath = `${tenantId}/${userId}/seed-reel-${clipKey}.mp4`;
  const bytes = readFileSync(localFile);
  const { error } = await supabase.storage
    .from('post-media')
    .upload(storagePath, bytes, { contentType: 'video/mp4', upsert: true });
  if (error) die(`subiendo ${storagePath}`, error);
  uploadedPaths.push(storagePath);
  log('upload', storagePath);
  return storagePath;
}

async function upsertPost(tenantId, { authorId, body, media, entityListingId = null, createdAt }) {
  const { data: existing, error: selErr } = await supabase
    .from('posts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('body', body)
    .maybeSingle();
  if (selErr) die(`buscando post "${body.slice(0, 30)}…"`, selErr);
  if (existing) {
    log('skip', `post "${body.slice(0, 40)}…" ya existe (${existing.id})`);
    createdPostIds.push(`${existing.id} (ya existía)`);
    return existing.id;
  }
  const { data, error } = await supabase
    .from('posts')
    .insert({
      tenant_id: tenantId,
      author_id: authorId,
      body,
      media,
      kind: 'post',
      status: 'published',
      entity_listing_id: entityListingId,
      created_at: createdAt ?? new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) die(`creando post "${body.slice(0, 30)}…"`, error);
  createdPostIds.push(data.id);
  log('create', `post ${entityListingId ? '[entidad] ' : ''}"${body.slice(0, 44)}…" → ${data.id}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\nSeed de VIDEOS demo (reels) — idempotente\n');
  checkFfmpeg();

  const tenantId = await tenantBySlug('dominicanos');

  // Usuarios demo existentes (no se crean ni se tocan passwords).
  const [maria, carlos, luis, altagraciaListing, festivalListing] = await Promise.all([
    findUserByEmail('maria@demo.comunidadlatina.com'),
    findUserByEmail('carlos@demo.comunidadlatina.com'),
    findUserByEmail('luis@demo.comunidadlatina.com'),
    findListingBySeedKey(tenantId, 'negocio-panaderia-altagracia'),
    findListingBySeedKey(tenantId, 'evento-festival-sabor'),
  ]);
  if (!maria) die('usuarios demo', 'maria@demo.comunidadlatina.com no existe — corré scripts/seed-demo-content.mjs primero');
  const luisOrMaria = luis ?? maria;
  const carlosOrMaria = carlos ?? maria;

  // Clips sintéticos en un tmp propio (se limpia al final).
  const outDir = path.join(os.tmpdir(), 'cl-seed-videos');
  mkdirSync(outDir, { recursive: true });
  const clipFiles = {};
  for (const clip of CLIPS) {
    clipFiles[clip.key] = renderClip(outDir, clip);
    log('render', `${clip.key}.mp4 (${clip.duration}s, 720x1280)`);
  }

  // Foto para el post MIXTO (visor foto→video): URL verificada del seed visual.
  let mixedPhotoUrl = null;
  try {
    const img = JSON.parse(readFileSync(path.resolve(__dirname, 'seed-images.json'), 'utf8'));
    mixedPhotoUrl = img.gente_feed?.[3] ?? img.gente_feed?.[0] ?? null;
  } catch {
    log('skip', 'sin seed-images.json — el post mixto va solo con video');
  }

  // ---- Personales (visibles para todos en /videos "Para ti") --------------
  const mariaTricolor = await uploadClip(tenantId, maria.id, 'tricolor', clipFiles.tricolor);
  await upsertPost(tenantId, {
    authorId: maria.id,
    body: '¡Estrenando los videos de la comunidad! 🎥 Cuéntenme qué está pasando en su barrio, quiero verlo todo.',
    media: [mariaTricolor],
    createdAt: daysAgo(0.1),
  });

  const luisFractal = await uploadClip(tenantId, luisOrMaria.id, 'fractal', clipFiles.fractal);
  await upsertPost(tenantId, {
    authorId: luisOrMaria.id,
    body: 'Editando visuales para el aftermovie del festival. Un adelanto del mood de este año 🎬',
    media: [luisFractal],
    createdAt: daysAgo(0.45),
  });

  const carlosPlaza = await uploadClip(tenantId, carlosOrMaria.id, 'plaza', clipFiles.plaza);
  await upsertPost(tenantId, {
    authorId: carlosOrMaria.id,
    body: 'Domingo de plaza con la familia. Queens tiene su encanto, no me lo discutan 😄',
    media: [carlosPlaza],
    createdAt: daysAgo(0.9),
  });

  // ---- Mixto foto + video (el visor pasa de la foto al video) -------------
  const mariaPlaza = await uploadClip(tenantId, maria.id, 'plaza', clipFiles.plaza);
  await upsertPost(tenantId, {
    authorId: maria.id,
    body: 'El ensayo del grupo de baile quedó grabado — deslicen para ver el video con la energía completa 💃',
    media: [mixedPhotoUrl, mariaPlaza].filter(Boolean),
    createdAt: daysAgo(0.3),
  });

  // ---- De ENTIDAD (demuestran el scope por módulo en /videos) -------------
  if (altagraciaListing?.created_by) {
    const panClip = await uploadClip(tenantId, altagraciaListing.created_by, 'atardecer', clipFiles.atardecer);
    await upsertPost(tenantId, {
      authorId: altagraciaListing.created_by,
      entityListingId: altagraciaListing.id,
      body: 'Así se ve la primera tanda de pan de agua saliendo del horno. Mañana doble horneada desde las 6 🥖',
      media: [panClip],
      createdAt: daysAgo(0.2),
    });
  } else {
    log('skip', 'panadería (negocio-panaderia-altagracia) no encontrada — sin video de negocio');
  }

  if (festivalListing?.created_by) {
    const festClip = await uploadClip(tenantId, festivalListing.created_by, 'vida', clipFiles.vida);
    await upsertPost(tenantId, {
      authorId: festivalListing.created_by,
      entityListingId: festivalListing.id,
      body: 'Se viene el festival: música en vivo, comida típica y feria de emprendedores. Entrada libre, trae a la familia 🎉',
      media: [festClip],
      createdAt: daysAgo(0.6),
    });
  } else {
    log('skip', 'festival (evento-festival-sabor) no encontrado — sin video de evento');
  }

  // Limpieza del tmp local (los clips ya viven en el bucket).
  try {
    rmSync(outDir, { recursive: true, force: true });
  } catch {
    // tmp que no se pudo borrar: sin drama
  }

  console.log('\n— IDs de posts (para limpiar la demo si hace falta):');
  for (const id of createdPostIds) console.log(`   · ${id}`);
  console.log('— Archivos en storage (bucket post-media):');
  for (const p of uploadedPaths) console.log(`   · ${p}`);
  console.log(
    `\n✔ Videos demo listos (${summary.filter((s) => !s.startsWith('skip')).length} cambios, ${summary.filter((s) => s.startsWith('skip')).length} ya existían/saltados)\n`,
  );
}

main().catch((e) => die('seed-videos', e));
