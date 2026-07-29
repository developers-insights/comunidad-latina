/**
 * Recorta el fondo blanco de un render 3D y lo deja como webp con alfa.
 *
 *   node scripts/cutout-icons.mjs <dir-de-png> <dir-salida> [nombre[:semilla_x,semilla_y] ...]
 *
 * Sin nombres, procesa el set fijo del bottom nav (inicio/buscar/videos/ajustes).
 * Con nombres, procesa esos archivos `<nombre>.png` del dir de entrada — así se
 * agregó `crear` (el "+", 2026-07-29) sin tocar la lista de abajo.
 *
 * Así se hizo el set del bottom nav (2026-07-29): íconos generados con
 * nano-banana-pro pidiendo "fondo blanco plano #FFFFFF" y pasados por acá. El
 * fondo transparente es lo que les permite vivir sobre la píldora de marca de
 * la pestaña activa y sobre los dos temas, cosa que un pastel horneado en el
 * PNG (el set del menú, public/icons/menu) no puede hacer.
 *
 * Por qué flood fill y no "todo lo blanco es fondo": el play lleva un triángulo
 * BLANCO adentro y la lupa un brillo blanco en el vidrio. Un umbral global se
 * los come. Acá el relleno entra sólo desde los bordes y sólo atraviesa píxeles
 * claros Y neutros (baja saturación), así que:
 *   - la sombra de contacto (gris neutro, pegada al fondo) se va;
 *   - la casa crema (cálida, saturada) NO se atraviesa;
 *   - el triángulo del play y el brillo de la lupa quedan (no tocan el borde).
 *
 * `seeds` extra para huecos cerrados que sí son fondo (el centro del engranaje).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC_DIR = process.argv[2];
const OUT_DIR = process.argv[3];

/**
 * Claro y neutro = fondo atravesable. 150 (y no 200) para que la sombra de
 * contacto se vaya ENTERA: lo que queda de ella se ve como mancha clara sobre
 * el tema oscuro. Ningún objeto del set corre riesgo — los cuatro son o
 * saturados (casa crema, azules) o oscuros (el gris del engranaje es lum ~133).
 */
const LUM_MIN = 150;
const SAT_MAX = 12;
/** Tamaño final: 3x sobre los ~32px que muestra la barra. */
const OUT_SIZE = 128;

const DEFAULT_ICONS = [
  { name: "inicio", seeds: [] },
  { name: "buscar", seeds: [] },
  { name: "videos", seeds: [] },
  // El engranaje tiene el centro blanco cerrado por el anillo dorado: no lo
  // alcanza el relleno de los bordes, así que se siembra a mano.
  { name: "ajustes", seeds: [[0.5, 0.5]] },
];

/** `crear:0.5,0.5` → { name: "crear", seeds: [[0.5, 0.5]] }; sin `:` → sin semillas. */
function parseArgIcon(arg) {
  const [name, rawSeed] = arg.split(":");
  if (!rawSeed) return { name, seeds: [] };
  const [sx, sy] = rawSeed.split(",").map(Number);
  return { name, seeds: [[sx, sy]] };
}

const ICONS = process.argv.length > 4 ? process.argv.slice(4).map(parseArgIcon) : DEFAULT_ICONS;

function isBackgroundish(r, g, b) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return lum >= LUM_MIN && sat <= SAT_MAX;
}

async function cutout({ name, seeds }) {
  const srcPath = path.join(SRC_DIR, `${name}.png`);
  const image = sharp(await readFile(srcPath)).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const bg = new Uint8Array(width * height);
  const stack = [];

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (bg[idx]) return;
    const o = idx * channels;
    if (!isBackgroundish(data[o], data[o + 1], data[o + 2])) return;
    bg[idx] = 1;
    stack.push(x, y);
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  for (const [fx, fy] of seeds) {
    push(Math.round(fx * (width - 1)), Math.round(fy * (height - 1)));
  }

  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // La sombra de contacto sobrevive al relleno (es gris apenas teñido, y en
  // varios renders queda por debajo del umbral). No hace falta afinar el
  // umbral: la sombra es un BLOB SEPARADO del objeto, así que nos quedamos
  // sólo con el componente conexo más grande y se va sola. Los cuatro íconos
  // son un objeto único, así que no hay nada legítimo que descartar.
  const label = new Int32Array(width * height).fill(-1);
  let best = -1;
  let bestSize = 0;
  for (let start = 0; start < label.length; start += 1) {
    if (bg[start] || label[start] !== -1) continue;
    const id = start;
    let size = 0;
    const queue = [start];
    label[start] = id;
    while (queue.length > 0) {
      const idx = queue.pop();
      size += 1;
      const x = idx % width;
      const y = (idx - x) / width;
      const neighbours = [
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || bg[n] || label[n] !== -1) continue;
        label[n] = id;
        queue.push(n);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }

  // Máscara de opacidad (0 = fondo). Se difumina medio píxel para que el borde
  // no quede escalonado; al bajar a 128px el fleco blanco desaparece solo.
  const mask = Buffer.alloc(width * height);
  let kept = 0;
  for (let i = 0; i < bg.length; i += 1) {
    const solid = !bg[i] && label[i] === best;
    mask[i] = solid ? 255 : 0;
    if (solid) kept += 1;
  }
  // OJO: sharp puede devolver la máscara con 3 canales (la sube a sRGB solo).
  // Hay que leer `info.channels` y no asumir 1 — asumirlo desalinea el alfa y
  // sale un rayado.
  const { data: alpha, info: alphaInfo } = await sharp(mask, {
    raw: { width, height, channels: 1 },
  })
    .blur(0.6)
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < bg.length; i += 1) {
    data[i * channels + 3] = alpha[i * alphaInfo.channels];
  }

  const out = path.join(OUT_DIR, `${name}.webp`);
  // trim + contain a 112 + margen de 8: cada ícono queda ópticamente del mismo
  // tamaño en la barra, sin depender del margen que le dejó el render.
  const buffer = await sharp(data, { raw: { width, height, channels } })
    .trim({ threshold: 1 })
    .resize(OUT_SIZE - 16, OUT_SIZE - 16, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: 8,
      bottom: 8,
      left: 8,
      right: 8,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 92, alphaQuality: 100 })
    .toBuffer();
  await writeFile(out, buffer);

  const pct = ((kept / (width * height)) * 100).toFixed(1);
  console.log(`${name}: ${pct}% del lienzo queda opaco → ${out}`);
}

await mkdir(OUT_DIR, { recursive: true });
for (const icon of ICONS) await cutout(icon);
