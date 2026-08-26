#!/usr/bin/env node
/**
 * cargar-musica.mjs — carga el catálogo REAL de música (migración 0090).
 *
 * QUÉ HACE, EN ORDEN Y POR PISTA:
 *   1. sube el archivo de audio a `music-tracks/<carpeta>/<archivo>`;
 *   2. recién si la subida salió bien, upsertea la ficha en `music_tracks`
 *      con `is_active = true`.
 *
 * ESE ORDEN NO ES CASUAL. Una ficha activa cuyo `storage_path` apunta a un
 * archivo que no existe es una pista que el picker LISTA y que no suena: el
 * peor de los dos fracasos posibles, porque se ve como si funcionara. Si la
 * subida falla, la ficha no se escribe y la pista simplemente no está.
 *
 * A DIFERENCIA de `seed-music.mjs` (fichas de PRUEBA, sin archivo y sin
 * licencia), este script sí está pensado para correr contra producción: las
 * pistas del manifiesto son música propia de la comunidad, con la licencia
 * resuelta. Por eso no tiene freno de entorno — tiene, en cambio, la exigencia
 * de que cada ficha traiga `license_kind` distinto de 'pending' (lo mismo que
 * pide el check `music_tracks_licencia_verificada` de la base).
 *
 * Idempotente: `storage_path` es UNIQUE, así que volver a correrlo ACTUALIZA la
 * ficha en vez de duplicarla, y la subida va con `upsert: true`.
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * El service role es obligatorio: las policies de 0090 sólo dejan escribir el
 * catálogo (tabla y bucket) a `global_admin`, y este script no tiene sesión.
 *
 * Uso:
 *   node scripts/cargar-musica.mjs --desde "C:/ruta/a/los/mp3"
 *   node scripts/cargar-musica.mjs --desde ... --manifiesto scripts/catalogo-musica.json
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

function flag(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const desde = flag('--desde');
const manifiestoPath = path.resolve(
  __dirname,
  '..',
  flag('--manifiesto', 'scripts/catalogo-musica.json'),
);

if (!desde) {
  console.error('✘ Falta --desde <carpeta con los archivos de audio>');
  console.error('  Uso: node scripts/cargar-musica.mjs --desde "C:/ruta/a/los/mp3"');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✘ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

/** Espeja `allowed_mime_types` del bucket (0090). Un tipo que no esté acá lo rebota el storage. */
const MIME_POR_EXTENSION = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const manifiesto = JSON.parse(await fs.readFile(manifiestoPath, 'utf8'));
  const bucket = manifiesto.bucket ?? 'music-tracks';
  const carpeta = manifiesto.carpeta ?? 'global';
  const pistas = manifiesto.pistas ?? [];

  console.log(`▸ ${pistas.length} pista(s) → ${SUPABASE_URL}`);
  console.log(`  bucket ${bucket}/${carpeta}  ·  archivos desde ${desde}`);
  console.log('');

  let fallaron = 0;

  for (const pista of pistas) {
    const etiqueta = `${pista.title} — ${pista.artist}`;

    if (!pista.license_kind || pista.license_kind === 'pending') {
      console.error(`  ✘ ${etiqueta}: license_kind sin resolver. No se carga.`);
      fallaron += 1;
      continue;
    }

    const extension = path.extname(pista.archivo).toLowerCase();
    const contentType = MIME_POR_EXTENSION[extension];
    if (!contentType) {
      console.error(`  ✘ ${etiqueta}: extensión ${extension} fuera de las que acepta el bucket.`);
      fallaron += 1;
      continue;
    }

    let cuerpo;
    try {
      cuerpo = await fs.readFile(path.resolve(desde, pista.archivo));
    } catch {
      console.error(`  ✘ ${etiqueta}: no se encontró ${pista.archivo} en la carpeta.`);
      fallaron += 1;
      continue;
    }

    const storagePath = `${carpeta}/${pista.archivo}`;

    const { error: subida } = await supabase.storage
      .from(bucket)
      .upload(storagePath, cuerpo, { contentType, upsert: true });

    if (subida) {
      console.error(`  ✘ ${etiqueta}: falló la subida (${subida.message}).`);
      fallaron += 1;
      continue;
    }

    const { error: ficha } = await supabase.from('music_tracks').upsert(
      {
        tenant_id: pista.tenant_id ?? null,
        title: pista.title,
        artist: pista.artist,
        duration_seconds: pista.duration_seconds,
        storage_path: storagePath,
        license_kind: pista.license_kind,
        source_url: pista.source_url ?? null,
        license_url: pista.license_url ?? null,
        attribution_required: pista.attribution_required ?? false,
        attribution_text: pista.attribution_text ?? null,
        category: pista.category ?? 'general',
        sort_order: pista.sort_order ?? 100,
        is_active: true,
      },
      { onConflict: 'storage_path' },
    );

    if (ficha) {
      console.error(`  ✘ ${etiqueta}: subió el audio pero falló la ficha (${ficha.message}).`);
      fallaron += 1;
      continue;
    }

    console.log(`  ✓ ${etiqueta}  (${(cuerpo.length / 1048576).toFixed(1)} MB)`);
  }

  console.log('');
  if (fallaron > 0) {
    console.error(`▸ ${fallaron} pista(s) no quedaron cargadas.`);
    process.exitCode = 1;
    return;
  }
  console.log('▸ Catálogo cargado y activo. Para apagar una pista:');
  console.log("  update public.music_tracks set is_active = false where title = '…';");
}

main().catch((error) => {
  console.error('✘ Falló la carga:', error);
  process.exit(1);
});
