#!/usr/bin/env node
/**
 * seed-music.mjs — Catálogo de música de PRUEBA (migración 0061)
 *
 * ⚠️ SOLO PARA DESARROLLO. Estas filas NO son música licenciada: son fichas de
 * ejemplo para poder ver el picker, el recorte y la insignia funcionando. Por
 * eso el script:
 *
 *   · se niega a correr si detecta un entorno de producción;
 *   · exige el flag explícito `--si-entiendo-que-no-hay-licencia`;
 *   · marca cada fila con `[PRUEBA]` en el título, para que si alguna se cuela
 *     a un entorno compartido se vea de una;
 *   · deja `storage_path` apuntando a `global/prueba/…`, una carpeta que no
 *     tiene archivos. El picker las lista y el botón de escuchar va a fallar en
 *     silencio (onError apaga el indicador) — que es lo correcto: no hay audio.
 *     Para escucharlas de verdad hay que subir tres mp3 a esa carpeta.
 *
 * EL CATÁLOGO REAL NO SE SIEMBRA CON UN SCRIPT. Cada pista necesita, una por
 * una: el archivo, la licencia verificada, la URL de origen y —si la licencia lo
 * exige— el texto exacto de atribución. Ver la sección §5 de
 * supabase/migrations/0061_musica_en_publicaciones.sql.
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Uso: node scripts/seed-music.mjs --si-entiendo-que-no-hay-licencia
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const CONFIRM_FLAG = '--si-entiendo-que-no-hay-licencia';

if (!process.argv.includes(CONFIRM_FLAG)) {
  console.error('✘ Este script siembra fichas SIN licencia, sólo para desarrollo.');
  console.error(`  Si es lo que querés: node scripts/seed-music.mjs ${CONFIRM_FLAG}`);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✘ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

// Freno de producción. Se mira el entorno Y la URL: un `.env.local` mal apuntado
// es exactamente el accidente que este bloque existe para evitar.
const isProductionEnv =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
if (isProductionEnv) {
  console.error('✘ Entorno de producción: no se siembra música de prueba. Abortado.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Fichas de ejemplo. `license_kind` es 'cc0' para que el check
 * `music_tracks_licencia_verificada` deje activarlas, PERO el título dice
 * [PRUEBA] y no hay archivo detrás. No confundir con música real.
 *
 * `tenant_id: null` = catálogo global (todas las comunidades lo ven).
 */
const TRACKS = [
  {
    title: '[PRUEBA] Tarde de domingo',
    artist: 'Sin artista (ficha de prueba)',
    duration_seconds: 132,
    storage_path: 'global/prueba/tarde-de-domingo.mp3',
    license_kind: 'cc0',
    source_url: null,
    license_url: null,
    attribution_required: false,
    attribution_text: null,
    category: 'tranquila',
    sort_order: 10,
  },
  {
    title: '[PRUEBA] Merengue de barrio',
    artist: 'Sin artista (ficha de prueba)',
    duration_seconds: 187,
    storage_path: 'global/prueba/merengue-de-barrio.mp3',
    license_kind: 'cc0',
    source_url: null,
    license_url: null,
    attribution_required: false,
    attribution_text: null,
    category: 'tropical',
    sort_order: 20,
  },
  {
    // Con atribución obligatoria: es el caso que hace que MusicBadge pinte su
    // segunda línea. Sin una ficha así, ese camino no se ve nunca en desarrollo.
    title: '[PRUEBA] Ritmo de la esquina',
    artist: 'Sin artista (ficha de prueba)',
    duration_seconds: 96,
    storage_path: 'global/prueba/ritmo-de-la-esquina.mp3',
    license_kind: 'cc_by',
    source_url: null,
    license_url: null,
    attribution_required: true,
    attribution_text: '«Ritmo de la esquina» — ficha de prueba, sin licencia real',
    category: 'urbana',
    sort_order: 30,
  },
];

async function main() {
  console.log(`▸ Sembrando ${TRACKS.length} fichas de música de PRUEBA en ${SUPABASE_URL}`);

  for (const track of TRACKS) {
    // Idempotente por `storage_path`, que es UNIQUE en la tabla: volver a correr
    // el script actualiza la ficha en vez de duplicarla.
    const { error } = await supabase
      .from('music_tracks')
      .upsert({ ...track, tenant_id: null, is_active: true }, { onConflict: 'storage_path' });

    if (error) {
      console.error(`  ✘ ${track.title}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`  ✓ ${track.title}`);
  }

  console.log('');
  console.log('▸ Listo. Recordá que NO hay archivos de audio detrás de estas fichas:');
  console.log('  subí tres mp3 a music-tracks/global/prueba/ si querés escuchar algo.');
  console.log('▸ Para apagarlas: update public.music_tracks set is_active = false');
  console.log("  where title like '[PRUEBA]%';");
}

main().catch((error) => {
  console.error('✘ Falló el sembrado:', error);
  process.exit(1);
});
