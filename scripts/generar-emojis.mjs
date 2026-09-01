#!/usr/bin/env node
/**
 * generar-emojis.mjs — DIBUJA el pack de emojis de la comunidad (migración 0125).
 *
 * Paso 1 de 3. Después van `quitar-fondo-emojis.mjs` y `cargar-emojis.mjs`.
 *
 * ─── POR QUÉ EXISTE ESTE SCRIPT ─────────────────────────────────────────────
 * El cliente mandó dos LÁMINAS de 30 emojis cada una: capturas de pantalla, con
 * fondo, los 30 dibujos pegados en una sola imagen. Eso no se puede usar: el
 * bucket quiere un archivo por emoji, cuadrado y con transparencia. Pedirle los
 * sueltos era el camino corto y no iba a llegar, así que el pack se dibuja acá.
 *
 * ─── EL FONDO VERDE ─────────────────────────────────────────────────────────
 * Los modelos de imagen NO generan canal alpha: devuelven un PNG opaco. Por eso
 * cada emoji se dibuja sobre un verde chroma plano y el recorte lo hace después
 * `quitar-fondo-emojis.mjs` por flood fill desde el borde. El prompt insiste en
 * "flat", "no shadow" y "no gradient" justamente porque una sombra proyectada
 * sobre el fondo deja un cerco gris que el recorte no puede distinguir del
 * dibujo.
 *
 * ─── EL ESTILO VIVE EN EL MANIFIESTO, NO ACÁ ────────────────────────────────
 * `scripts/catalogo-emojis.json` trae `estilo.prefijo` + `estilo.sufijo` y, por
 * emoji, sólo el `motivo`. El prompt final es la concatenación de los tres. Es
 * lo que hace que los 60 se vean como UN pack: el estilo está escrito una sola
 * vez. Si estuviera repetido en 60 prompts, alcanzaría con que alguien edite
 * uno para que ese dibujo desentone y nadie sepa por qué.
 *
 * ─── REINTENTOS, Y POR QUÉ NO SON OPCIONALES ────────────────────────────────
 * La API devuelve 503 ("high demand") de forma rutinaria y en tandas de varios
 * minutos. Sin reintentos, una corrida de 60 termina con la mitad de los
 * archivos y ningún patrón claro de cuáles. Se reintenta con espera creciente
 * ante 429/500/503 y se avisa cuál quedó afuera.
 *
 * Idempotente: por defecto SALTEA los que ya existen en la carpeta destino, así
 * volver a correrlo completa los que faltaron en vez de repagar los 60.
 *
 * Requiere GOOGLE_AI_API_KEY en .env.local (la misma key del MCP nanobanana).
 * La key nunca se imprime ni se commitea: .env.local está en .gitignore.
 *
 * Uso:
 *   node scripts/generar-emojis.mjs --hacia "C:/ruta/crudos"
 *   node scripts/generar-emojis.mjs --hacia ... --solo klk,wepa,cafecito
 *   node scripts/generar-emojis.mjs --hacia ... --rehacer
 *   node scripts/generar-emojis.mjs --hacia ... --modelo pro
 *
 *   --solo      Lista de slugs separados por coma. Para rehacer los que salieron mal.
 *   --rehacer   No saltea los que ya existen: los pisa.
 *   --modelo    `flash` (default) o `pro`. Pro dibuja mejor pero se satura más.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

function flag(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(name);

const hacia = flag('--hacia');
const solo = flag('--solo');
const rehacer = has('--rehacer');
const manifiestoPath = path.resolve(__dirname, '..', flag('--manifiesto', 'scripts/catalogo-emojis.json'));

const MODELOS = {
  flash: 'gemini-3.1-flash-image-preview',
  pro: 'gemini-3-pro-image-preview',
};
const modelo = MODELOS[flag('--modelo', 'flash')] ?? MODELOS.flash;

if (!hacia) {
  console.error('✘ Falta --hacia <carpeta donde dejar los PNG crudos>');
  process.exit(1);
}

const API_KEY = process.env.GOOGLE_AI_API_KEY;
if (!API_KEY) {
  console.error('✘ Falta GOOGLE_AI_API_KEY en .env.local (la misma key del MCP nanobanana).');
  process.exit(1);
}

/**
 * Cuántos dibujos en vuelo a la vez. Seis y no veinte: el cuello de botella es la
 * cuota del modelo, y pedir de a veinte adelanta el 429 en vez de terminar antes.
 */
const EN_PARALELO = 6;
/** Reintentos por emoji ante un error temporal. */
const REINTENTOS = 6;
/** Espera base; crece al doble en cada intento (2s, 4s, 8s…). */
const ESPERA_BASE_MS = 2000;

const TEMPORALES = new Set([429, 500, 502, 503, 504]);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Un dibujo. Devuelve el buffer del PNG o tira con un mensaje que dice QUÉ pasó
 * — nunca un error genérico: con 60 emojis, "falló" sin motivo obliga a correr
 * todo de nuevo para saber cuál era el problema.
 */
async function dibujar(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${API_KEY}`;

  let ultimo = 'sin intentos';
  for (let intento = 0; intento < REINTENTOS; intento += 1) {
    let respuesta;
    try {
      respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
        }),
      });
    } catch (error) {
      // Error de red: es temporal por definición, se reintenta.
      ultimo = `red: ${error.message}`;
      await dormir(ESPERA_BASE_MS * 2 ** intento);
      continue;
    }

    if (!respuesta.ok) {
      const cuerpo = (await respuesta.text()).slice(0, 200).replace(/\s+/g, ' ');
      ultimo = `HTTP ${respuesta.status}: ${cuerpo}`;
      if (!TEMPORALES.has(respuesta.status)) throw new Error(ultimo);
      await dormir(ESPERA_BASE_MS * 2 ** intento);
      continue;
    }

    const json = await respuesta.json();
    const partes = json?.candidates?.[0]?.content?.parts ?? [];
    const imagen = partes.find((p) => p.inlineData?.data);

    if (!imagen) {
      // Sin imagen y sin error HTTP: casi siempre es el filtro de seguridad del
      // modelo. Se dice cuál fue el motivo en vez de reintentar seis veces algo
      // que nunca va a salir.
      const motivo = json?.candidates?.[0]?.finishReason ?? json?.promptFeedback?.blockReason ?? 'sin imagen en la respuesta';
      throw new Error(`el modelo no devolvió imagen (${motivo})`);
    }

    return Buffer.from(imagen.inlineData.data, 'base64');
  }

  throw new Error(`agotados los ${REINTENTOS} intentos · último: ${ultimo}`);
}

async function main() {
  const manifiesto = JSON.parse(await fs.readFile(manifiestoPath, 'utf8'));
  const estilo = manifiesto.estilo ?? {};
  const filtro = solo ? new Set(solo.split(',').map((s) => s.trim())) : null;

  const todos = (manifiesto.emojis ?? []).filter((e) => !filtro || filtro.has(e.slug));
  if (filtro) {
    const faltantes = [...filtro].filter((s) => !todos.some((e) => e.slug === s));
    if (faltantes.length) console.error(`  ⚠️  no están en el manifiesto: ${faltantes.join(', ')}`);
  }

  await fs.mkdir(hacia, { recursive: true });

  // Se resuelve ANTES de empezar qué hay que dibujar, para que el conteo del
  // encabezado sea el real y no "60" cuando en verdad se van a hacer 4.
  const pendientes = [];
  for (const emoji of todos) {
    const destino = path.join(hacia, `${emoji.slug}.png`);
    if (!rehacer) {
      const yaEsta = await fs.stat(destino).then((s) => s.size > 0).catch(() => false);
      if (yaEsta) continue;
    }
    pendientes.push({ emoji, destino });
  }

  console.log(`▸ modelo ${modelo}  ·  destino ${hacia}`);
  console.log(`  ${pendientes.length} a dibujar de ${todos.length} en el manifiesto` +
    (rehacer ? '  (--rehacer: se pisan los existentes)' : '  (los que ya existen se saltean)'));
  console.log('');

  if (pendientes.length === 0) {
    console.log('▸ No hay nada que dibujar. Usá --rehacer para volver a generarlos.');
    return;
  }

  let hechos = 0;
  const fallaron = [];

  // Pool de N trabajadores sobre una cola compartida: mantiene EN_PARALELO
  // dibujos en vuelo todo el tiempo, en vez de esperar a que termine el más
  // lento de cada tanda de tres.
  const cola = [...pendientes];
  async function trabajador() {
    for (;;) {
      const item = cola.shift();
      if (!item) return;
      const { emoji, destino } = item;
      const prompt = [estilo.prefijo, `${emoji.motivo}.`, estilo.sufijo].filter(Boolean).join(' ');
      try {
        const png = await dibujar(prompt);
        await fs.writeFile(destino, png);
        hechos += 1;
        console.log(`  ✓ ${emoji.label.padEnd(22)} ${emoji.slug}.png  (${(png.length / 1024).toFixed(0)} KB)  [${hechos}/${pendientes.length}]`);
      } catch (error) {
        fallaron.push(emoji.slug);
        console.error(`  ✘ ${emoji.label.padEnd(22)} ${emoji.slug}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(EN_PARALELO, cola.length) }, trabajador));

  console.log('');
  if (fallaron.length) {
    console.error(`▸ ${fallaron.length} sin dibujar. Reintentá sólo esos:`);
    console.error(`  node scripts/generar-emojis.mjs --hacia "${hacia}" --solo ${fallaron.join(',')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`▸ ${hechos} dibujo(s) listos en ${hacia}.`);
  console.log('  Siguiente: node scripts/quitar-fondo-emojis.mjs --desde "' + hacia + '" --hacia <carpeta-final>');
}

main().catch((error) => {
  console.error('✘ Falló la generación:', error);
  process.exit(1);
});
