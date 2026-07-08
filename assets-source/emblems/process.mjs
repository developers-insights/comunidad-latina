/**
 * Emblemas 3D — post-proceso.
 *
 *   render alpha de Meshy (512² RGBA)  ->  trim al bbox  ->  encuadre óptico
 *   común  ->  WebP 256² (q82, alfa sin pérdida)  ->  public/brand/emblems/
 *
 * Un solo source por emblema: next/image emite el srcset 1x/2x y sirve la
 * variante del tamaño real de cada superficie. 256 cubre @2x del uso mayor
 * (el hero de 88px) y casi @3x, así que nada se ve blando.
 *
 * Uso:  node assets-source/emblems/process.mjs <dir-con-los-alpha-png>
 * Generación de los alpha: ver ./generate.mjs (requiere MESHY_API_KEY).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = process.argv[2];
if (!SRC) throw new Error("uso: node assets-source/emblems/process.mjs <dir-alpha>");
const DEST = path.join(process.cwd(), "public/brand/emblems");
const CANVAS = 256;

/**
 * nombre-de-archivo <- clave-de-generación.
 * `escudo-check` sirve dos superficies (hero del Escudo Anti-Estafa y nivel
 * "Confiable"): un objeto, un significado en todo el producto.
 */
const MAP = {
  "escudo-guard": "escudo-check",
  "escudo-alerta": "escudo-alerta",
  "sello-verificado": "sello-check",
  "sello-alerta": "sello-x",
  "trust-1-nuevo": "nivel-nuevo",
  "trust-2-verificado": "nivel-verificado",
  "trust-4-premium": "nivel-premium",
  "trust-5-diamante": "nivel-diamante",
};

/**
 * Peso óptico: el bounding box no equivale a "cuánto pesa" un objeto a la vista.
 * Una estrella llena poco su bbox (los brazos dejan aire); un sello lo llena
 * entero. Sin esto la estrella se ve chica al lado del sello.
 */
const OPTICAL = {
  "nivel-premium": 1.06,
  "nivel-diamante": 1.02,
  "nivel-nuevo": 1.05,
  "escudo-check": 0.98,
  "escudo-alerta": 0.98,
};

/**
 * Grading puntual. El render 3D de Meshy desatura respecto del concepto: el
 * diamante sale casi blanco y se pierde contra el lienzo `--neutral-25`
 * (#FCFCFB). Se le devuelve el azul hielo. Es corrección de color, no reinvento.
 */
const TONE = {
  "nivel-diamante": { saturation: 1.55, brightness: 0.98 },
};

fs.mkdirSync(DEST, { recursive: true });
const report = [];

for (const [src, name] of Object.entries(MAP)) {
  const file = path.join(SRC, `${src}.png`);
  if (!fs.existsSync(file)) {
    console.warn(`FALTA ${src}.png — saltado`);
    continue;
  }
  const box = Math.round(CANVAS * (OPTICAL[name] ?? 1) * 0.94); // 6% de aire

  let pipe = sharp(file).trim({ threshold: 1 });
  if (TONE[name]) pipe = pipe.modulate(TONE[name]);
  const trimmed = await pipe
    .resize(box, box, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const out = path.join(DEST, `${name}.webp`);
  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: trimmed, gravity: "centre" }])
    .webp({ quality: 82, effort: 6, alphaQuality: 100 })
    .toFile(out);

  const { size } = fs.statSync(out);
  report.push({ emblema: name, KB: +(size / 1024).toFixed(1) });
}

console.table(report);
console.log("total:", report.reduce((a, r) => a + r.KB, 0).toFixed(1), "KB");
