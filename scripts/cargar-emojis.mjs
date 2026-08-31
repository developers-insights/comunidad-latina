#!/usr/bin/env node
/**
 * cargar-emojis.mjs — carga el catálogo de EMOJIS DE LA COMUNIDAD (migración 0125).
 *
 * QUÉ HACE, EN ORDEN Y POR EMOJI:
 *   1. normaliza el archivo a PNG cuadrado de 512×512 con fondo transparente;
 *   2. lo sube a `community-emojis/<carpeta>/<slug>.png`;
 *   3. recién si la subida salió bien, upsertea la ficha en `community_emojis`.
 *
 * ESE ORDEN NO ES CASUAL. Una ficha cuyo `storage_path` apunta a un archivo que
 * no existe es un emoji que el picker LISTA y que se ve como un cuadrito roto:
 * el peor de los dos fracasos posibles, porque parece que funciona. Si la
 * subida falla, la ficha no se escribe y el emoji simplemente no está.
 *
 * ─── LA NORMALIZACIÓN, Y POR QUÉ NO SE PUEDE SALTEAR ────────────────────────
 * El cliente va a mandar lo que tenga: PNG de 2000 px, SVG, o los dos mezclados.
 * `sharp` los deja a todos en el MISMO PNG de 512×512 (`fit: contain`, fondo
 * transparente), y eso resuelve tres cosas de un saque:
 *
 *   · TAMAÑO PAREJO. Sin esto, un dibujo de 2000 px y otro de 300 px se ven del
 *     mismo tamaño en el picker pero pesan 40 veces distinto, y el de 300 px
 *     sale borroso al pegarlo grande sobre una foto.
 *   · SVG AFUERA DEL BUCKET. Un SVG servido desde un bucket público se abre
 *     como documento y ejecuta el script que traiga adentro (XSS almacenado en
 *     el dominio de Supabase). El bucket de la 0125 sólo acepta PNG y WebP; acá
 *     el SVG se rasteriza y lo que viaja es un PNG.
 *   · PESO. El tope del bucket es 256 KB y el script avisa ANTES de subir si
 *     algún archivo lo pasa igual, en vez de que lo rebote el storage con un
 *     error que no dice cuál era.
 *
 * ─── `is_active` NACE APAGADO, Y HAY QUE PEDIR ENCENDERLO ───────────────────
 * A diferencia de `cargar-musica.mjs`, que activa lo que sube, acá hay que
 * pasar `--activar`. El motivo es concreto y no es celo: en COMENTARIOS el
 * emoji viaja como código corto (`:klk:`) y quien pinta el comentario tiene que
 * saber cambiarlo por la imagen. Mientras ese cambio no esté en producción, un
 * emoji encendido se lee como ":klk:" en el feed. El interruptor es lo que
 * permite cargar los 60 hoy y encenderlos el día correcto.
 *
 * Idempotente: `storage_path` es UNIQUE y la subida va con `upsert: true`, así
 * que volver a correrlo ACTUALIZA en vez de duplicar.
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * El service role es obligatorio: las policies de la 0125 sólo dejan escribir el
 * catálogo (tabla y bucket) a `global_admin`, y este script no tiene sesión.
 *
 * Uso:
 *   node scripts/cargar-emojis.mjs --desde "C:/ruta/al/pack" --revisar
 *   node scripts/cargar-emojis.mjs --desde "C:/ruta/al/pack"
 *   node scripts/cargar-emojis.mjs --desde "C:/ruta/al/pack" --activar
 *   node scripts/cargar-emojis.mjs --desde ... --manifiesto scripts/otro.json
 *
 *   --revisar   No toca nada: valida el manifiesto y los archivos y avisa qué
 *               falta. Es el paso 1 cuando llega un pack nuevo.
 *   --activar   Deja las fichas con `is_active = true`. Ver arriba.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

function flag(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(name) {
  return process.argv.includes(name);
}

const desde = flag('--desde');
const soloRevisar = has('--revisar');
const activar = has('--activar');
const manifiestoPath = path.resolve(
  __dirname,
  '..',
  flag('--manifiesto', 'scripts/catalogo-emojis.json'),
);

if (!desde) {
  console.error('✘ Falta --desde <carpeta con los archivos de los emojis>');
  console.error('  Uso: node scripts/cargar-emojis.mjs --desde "C:/ruta/al/pack" --revisar');
  process.exit(1);
}

/** Espeja el CHECK de `category` en la 0125. Un valor de más lo rebota la base. */
const CATEGORIAS = ['saludos', 'expresiones', 'animo', 'fiesta', 'comida', 'general'];
/** Espeja el CHECK de `slug`. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Espeja `file_size_limit` del bucket. */
const TOPE_BYTES = 262144;
/** Espeja `EMOJI_ASSET_SIDE_PX` (src/lib/emojis/catalog.ts). */
const LADO = 512;

/**
 * Valida UNA ficha contra los mismos checks que la base. Se hace acá para que
 * el error diga QUÉ ficha y POR QUÉ, en vez de un 23514 de Postgres con el
 * nombre de la constraint.
 */
function problemasDe(emoji) {
  const problemas = [];
  if (!emoji.archivo) problemas.push('falta `archivo`');
  if (!SLUG_RE.test(emoji.slug ?? '')) {
    problemas.push(`slug inválido (${emoji.slug ?? '—'}): sólo minúsculas, números y guiones`);
  }
  const label = (emoji.label ?? '').trim();
  const alt = (emoji.alt ?? '').trim();
  if (!label) problemas.push('falta `label`');
  if (alt.length < 4) {
    problemas.push('falta `alt`: escribí qué SE VE en el dibujo (mínimo 4 caracteres)');
  } else if (alt.toLowerCase() === label.toLowerCase()) {
    // El mismo check que la base (`community_emojis_alt_no_repite_el_nombre`).
    problemas.push(
      `el \`alt\` repite el \`label\` ("${label}"): quien no ve el dibujo escucha el nombre y sigue sin saber qué es`,
    );
  }
  if (emoji.category && !CATEGORIAS.includes(emoji.category)) {
    problemas.push(`categoría desconocida (${emoji.category}); las válidas son ${CATEGORIAS.join(', ')}`);
  }
  return problemas;
}

/** Cualquier entrada (PNG grande, SVG, WebP) → PNG cuadrado de 512 transparente. */
async function normalizar(origen) {
  return sharp(origen, { density: 384 }) // density: para que un SVG rasterice nítido
    .resize(LADO, LADO, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}

async function main() {
  const manifiesto = JSON.parse(await fs.readFile(manifiestoPath, 'utf8'));
  const bucket = manifiesto.bucket ?? 'community-emojis';
  const carpeta = manifiesto.carpeta ?? 'global';
  const emojis = manifiesto.emojis ?? [];

  console.log(`▸ ${emojis.length} emoji(s) · manifiesto ${path.relative(process.cwd(), manifiestoPath)}`);
  console.log(`  archivos desde ${desde}`);
  console.log(`  destino ${bucket}/${carpeta}  ·  is_active = ${activar}`);
  if (soloRevisar) console.log('  MODO REVISIÓN: no se sube ni se escribe nada.');
  console.log('');

  // Un slug repetido en el manifiesto no lo agarra la base (el segundo pisa al
  // primero por el upsert) y el resultado sería un emoji "que no se cargó" sin
  // ningún error. Se detecta acá.
  const vistos = new Set();
  let fallaron = 0;

  const supabase = soloRevisar ? null : conectar();

  for (const emoji of emojis) {
    const etiqueta = emoji.label ?? emoji.slug ?? emoji.archivo ?? '(sin nombre)';

    const problemas = problemasDe(emoji);
    if (vistos.has(emoji.slug)) problemas.push(`el slug "${emoji.slug}" está repetido en el manifiesto`);
    vistos.add(emoji.slug);

    if (problemas.length > 0) {
      console.error(`  ✘ ${etiqueta}: ${problemas.join(' · ')}`);
      fallaron += 1;
      continue;
    }

    let png;
    try {
      png = await normalizar(path.resolve(desde, emoji.archivo));
    } catch (error) {
      console.error(`  ✘ ${etiqueta}: no se pudo leer/convertir ${emoji.archivo} (${error.message}).`);
      fallaron += 1;
      continue;
    }

    if (png.length > TOPE_BYTES) {
      console.error(
        `  ✘ ${etiqueta}: el PNG quedó en ${(png.length / 1024).toFixed(0)} KB y el bucket acepta hasta ${TOPE_BYTES / 1024} KB.`,
      );
      fallaron += 1;
      continue;
    }

    const storagePath = `${carpeta}/${emoji.slug}.png`;

    if (soloRevisar) {
      console.log(`  ✓ ${etiqueta}  →  ${storagePath}  (${(png.length / 1024).toFixed(0)} KB)`);
      continue;
    }

    const { error: subida } = await supabase.storage
      .from(bucket)
      .upload(storagePath, png, { contentType: 'image/png', upsert: true });

    if (subida) {
      console.error(`  ✘ ${etiqueta}: falló la subida (${subida.message}).`);
      fallaron += 1;
      continue;
    }

    const { error: ficha } = await supabase.from('community_emojis').upsert(
      {
        // `tenant_id` null = catálogo GLOBAL, que ven todas las comunidades. Un
        // emoji propio de UNA comunidad lleva su uuid acá y su carpeta aparte.
        tenant_id: emoji.tenant_id ?? null,
        slug: emoji.slug,
        label: emoji.label.trim(),
        alt_text: emoji.alt.trim(),
        storage_path: storagePath,
        category: emoji.category ?? 'general',
        sort_order: emoji.sort_order ?? 100,
        is_active: activar,
      },
      { onConflict: 'storage_path' },
    );

    if (ficha) {
      console.error(`  ✘ ${etiqueta}: subió la imagen pero falló la ficha (${ficha.message}).`);
      fallaron += 1;
      continue;
    }

    console.log(`  ✓ ${etiqueta}  →  ${storagePath}  (${(png.length / 1024).toFixed(0)} KB)`);
  }

  console.log('');
  if (fallaron > 0) {
    console.error(`▸ ${fallaron} emoji(s) no quedaron cargados.`);
    process.exitCode = 1;
    return;
  }

  if (soloRevisar) {
    console.log('▸ Todo listo para cargar. Sacá --revisar y volvé a correrlo.');
    return;
  }
  if (activar) {
    console.log('▸ Catálogo cargado y ENCENDIDO.');
    console.log('  ⚠️  En comentarios el emoji viaja como `:slug:`. Si el renderer todavía');
    console.log('     no lo cambia por la imagen, apagalos con:');
    console.log("     update public.community_emojis set is_active = false;");
    return;
  }
  console.log('▸ Catálogo cargado y APAGADO (nadie lo ve todavía). Para encenderlo:');
  console.log('  node scripts/cargar-emojis.mjs --desde <carpeta> --activar');
  console.log('  …o, uno por uno:');
  console.log("  update public.community_emojis set is_active = true where slug = 'klk';");
}

function conectar() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('✘ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
    console.error('  (Con --revisar no hacen falta: ese modo no toca la base.)');
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

main().catch((error) => {
  console.error('✘ Falló la carga:', error);
  process.exit(1);
});
