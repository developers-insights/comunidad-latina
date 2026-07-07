#!/usr/bin/env node
/**
 * generate-icons.mjs — Íconos PWA de Comunidad Latina (módulo PWA).
 *
 * Rasteriza un SVG premium (monograma geométrico "CL" sobre azul #1A5EDB,
 * puro vector — sin <text>, así no depende de fuentes del sistema) a:
 *
 *   public/icons/icon-192.png          (any, esquinas redondeadas)
 *   public/icons/icon-512.png          (any, esquinas redondeadas)
 *   public/icons/maskable-512.png      (maskable, full-bleed, safe zone 40%)
 *   public/icons/apple-touch-icon.png  (180×180, full-bleed opaco — iOS aplica su máscara)
 *   src/app/apple-icon.png             (copia: Next la linkea automáticamente)
 *
 * Uso: node scripts/generate-icons.mjs   (requiere devDependency `sharp`)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "public", "icons");
mkdirSync(iconsDir, { recursive: true });

/**
 * Monograma "CL" construido con paths puros (arco + trazo en L), centrado en
 * la safe zone maskable (círculo de radio 40% = 205px sobre canvas 512).
 * Extremos verificados: todos a <193px del centro.
 */
const MONOGRAM = `
  <g fill="none" stroke="#FFFFFF" stroke-width="46" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 256.9 190.6 A 88 88 0 1 0 256.9 321.4" />
    <path d="M 318 168 L 318 344 L 390 344" />
  </g>`;

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2F6FE9" />
      <stop offset="0.55" stop-color="#1A5EDB" />
      <stop offset="1" stop-color="#1449A8" />
    </linearGradient>
    <radialGradient id="sheen" cx="0.3" cy="0.12" r="0.9">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.14" />
      <stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
  </defs>`;

/** rx=0 → full-bleed (maskable/apple); rx>0 → esquinas redondeadas (any). */
function iconSvg(rx = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${DEFS}
  <rect width="512" height="512" rx="${rx}" fill="url(#bg)" />
  <rect width="512" height="512" rx="${rx}" fill="url(#sheen)" />
  ${MONOGRAM}
</svg>`;
}

const ROUNDED = Buffer.from(iconSvg(116)); // ~22.6% — squircle sobrio
const FULLBLEED = Buffer.from(iconSvg(0));

async function rasterize(svg, size, outFile) {
  const png = await sharp(svg, { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(outFile, png);
  console.log(`✓ ${path.relative(root, outFile)} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

await rasterize(ROUNDED, 192, path.join(iconsDir, "icon-192.png"));
await rasterize(ROUNDED, 512, path.join(iconsDir, "icon-512.png"));
await rasterize(FULLBLEED, 512, path.join(iconsDir, "maskable-512.png"));
await rasterize(FULLBLEED, 180, path.join(iconsDir, "apple-touch-icon.png"));
// Convención de Next: src/app/apple-icon.png genera el <link rel="apple-touch-icon"> solo.
await rasterize(FULLBLEED, 180, path.join(root, "src", "app", "apple-icon.png"));

console.log("Íconos PWA generados.");
