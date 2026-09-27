#!/usr/bin/env node
// Fuente única: public/brand/logo-original.svg (vectorización fiel de logo.jpg, el logo que mandó el cliente).
// El wordmark de og-logo.png usa Bookman Old Style Bold instalada en Windows: el PNG se genera local y se commitea,
// así producción no depende de la fuente.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = (...p) => path.join(root, ...p);

const iso = readFileSync(out("public/brand/logo-original.svg"), "utf8");
const [, vw, vh] = iso.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
const isoBody = iso.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const TILE_DEFS = `
  <radialGradient id="tile" cx="0.5" cy="0.4" r="0.75">
    <stop offset="0" stop-color="#535357"/>
    <stop offset="0.55" stop-color="#38383C"/>
    <stop offset="1" stop-color="#1F1F23"/>
  </radialGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.07"/>
    <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
  </linearGradient>
  <filter id="lift" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.28"/>
  </filter>`;

function placedIso(size, heightRatio, cyRatio = 0.5) {
  const h = size * heightRatio;
  const w = (h * vw) / vh;
  const x = (size - w) / 2;
  const y = size * cyRatio - h / 2;
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" overflow="visible">${isoBody}</svg>`;
}

function tileSvg(size, { heightRatio, radius = 0, shadow = true }) {
  const rx = size * radius;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>${TILE_DEFS}</defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="url(#tile)"/>
  <rect width="${size}" height="${size}" rx="${rx}" fill="url(#sheen)"/>
  <g${shadow ? ' filter="url(#lift)"' : ""}>${placedIso(size, heightRatio, 0.51)}</g>
</svg>`;
}

async function png(svg, size, file, { opaque = false } = {}) {
  let img = sharp(Buffer.from(svg), { density: 72 * 4 }).resize(size, size);
  if (opaque) img = img.flatten({ background: "#2B2B2F" }).removeAlpha();
  const buf = await img.png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(file, buf);
  console.log(`${path.relative(root, file)}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
  return buf;
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

const ROUNDED = 0.226;

const logoH = 626;
const logoW = Math.round((logoH * vw) / vh);
const logoBuf = await sharp(Buffer.from(iso), { density: 72 * 4 })
  .resize(logoW, logoH)
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(out("public/brand/logo-mark.png"), logoBuf);
console.log(`public/brand/logo-mark.png  ${logoW}x${logoH}`);

await png(tileSvg(512, { heightRatio: 0.7, radius: ROUNDED }), 192, out("public/icons/icon-192.png"));
await png(tileSvg(512, { heightRatio: 0.7, radius: ROUNDED }), 512, out("public/icons/icon-512.png"));
// maskable: la zona segura es un círculo de radio 40%; con 0.55 la caja entera del isotipo queda adentro.
await png(tileSvg(512, { heightRatio: 0.55 }), 512, out("public/icons/maskable-512.png"));
await png(tileSvg(512, { heightRatio: 0.64 }), 180, out("public/icons/apple-touch-icon.png"), { opaque: true });
await png(tileSvg(512, { heightRatio: 0.64 }), 180, out("src/app/apple-icon.png"), { opaque: true });
await png(tileSvg(1024, { heightRatio: 0.6 }), 1024, out("public/brand/store-icon-1024.png"), { opaque: true });
await png(tileSvg(512, { heightRatio: 0.6 }), 512, out("public/brand/play-icon-512.png"), { opaque: true });

const faviconSvg = tileSvg(64, { heightRatio: 0.82, radius: 0.2, shadow: false });
writeFileSync(out("public/brand/favicon.svg"), faviconSvg + "\n");
writeFileSync(out("src/app/icon.svg"), faviconSvg + "\n");
const icoParts = [];
for (const size of [16, 32, 48]) {
  const buf = await sharp(Buffer.from(faviconSvg), { density: 72 * 8 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  icoParts.push({ size, buf });
}
writeFileSync(out("src/app/favicon.ico"), ico(icoParts));
console.log("src/app/favicon.ico  16/32/48");

const OG_W = 1200;
const OG_H = 630;
const ogIsoH = 360;
const ogIsoW = (ogIsoH * vw) / vh;
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${OG_W} ${OG_H}" width="${OG_W}" height="${OG_H}">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.36" r="0.8">
      <stop offset="0" stop-color="#4E4E52"/>
      <stop offset="0.5" stop-color="#343438"/>
      <stop offset="1" stop-color="#1C1C20"/>
    </radialGradient>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>
  <g filter="url(#lift)">
    <svg x="${(OG_W - ogIsoW) / 2}" y="70" width="${ogIsoW}" height="${ogIsoH}" viewBox="0 0 ${vw} ${vh}">${isoBody}</svg>
  </g>
  <text x="${OG_W / 2}" y="540" text-anchor="middle" font-family="Bookman Old Style" font-weight="bold"
    font-size="60" letter-spacing="4" fill="#E6E4DE" transform="translate(${OG_W / 2} 0) scale(1.12 1) translate(${-OG_W / 2} 0)">Comunidad Latina</text>
</svg>`;
const ogBuf = await sharp(Buffer.from(ogSvg)).flatten({ background: "#2B2B2F" }).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(out("public/brand/og-logo.png"), ogBuf);
console.log(`public/brand/og-logo.png  ${OG_W}x${OG_H}  ${(ogBuf.length / 1024).toFixed(1)} KB`);
