import { describe, expect, it } from "vitest";
import { analyzeProvenanceBytes } from "./provenance";

/**
 * Los buffers de este archivo son 100% SINTÉTICOS, armados byte a byte acá
 * mismo — nada de fixtures binarios externos ni archivos descargados. Eso es
 * lo que permite probar casos exactos (el box de 64 bits, el truncamiento) sin
 * depender de que un archivo real tenga justo esa estructura.
 */

/* -------------------------------------------------------------------------- */
/* Helpers de construcción de átomos ISO-BMFF (MP4/MOV)                       */
/* -------------------------------------------------------------------------- */

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** Convierte un string a bytes 1:1 (Latin-1) — alcanza para ASCII y para el © de los tags iTunes-style. */
function asciiBytes(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}

/** Un átomo normal: size(4) + type(4) + payload. */
function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [...u32be(size), ...asciiBytes(type), ...payload];
}

/** Un átomo con largesize (64 bits): size32=1 + type(4) + largesize(8) + payload. */
function box64(type: string, payload: number[]): number[] {
  const total = 16 + payload.length;
  const hi = Math.floor(total / 0x100000000);
  const lo = total >>> 0;
  return [
    0, 0, 0, 1,
    ...asciiBytes(type),
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff,
    ...payload,
  ];
}

function ftypBox(major: string, compatibles: string[]): number[] {
  return box("ftyp", [...asciiBytes(major), 0, 0, 0, 0, ...compatibles.flatMap(asciiBytes)]);
}

/** `mvhd` mínimo — el contenido no importa, nunca se escanea, sólo tiene que tener una forma válida. */
function mvhdBox(): number[] {
  return box("mvhd", new Array(100).fill(0));
}

function moovBox(children: number[][]): number[] {
  return box("moov", children.flat());
}

/** `udta` con UN tag hijo directo (convención QuickTime clásica: sin `meta`/`ilst` de por medio). */
function udtaWithDirectTag(tag: string, text: string): number[] {
  return box("udta", box(tag, asciiBytes(text)));
}

/** `udta > meta > ilst > tag > data` — la convención iTunes-style completa. */
function udtaWithIlstTag(tag: string, text: string): number[] {
  const dataBox = box("data", [0, 0, 0, 1, 0, 0, 0, 0, ...asciiBytes(text)]);
  const ilst = box("ilst", box(tag, dataBox));
  const meta = box("meta", [0, 0, 0, 0, ...ilst]); // 4 bytes de version+flags (ISO full box)
  return box("udta", meta);
}

function buildMp4(parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

/* -------------------------------------------------------------------------- */
/* Helpers de construcción de JPEG con EXIF                                   */
/* -------------------------------------------------------------------------- */

/** Un bloque TIFF little-endian con UN solo tag ASCII (ej. Software = 0x0131). */
function buildTiffAsciiTag(tag: number, text: string): number[] {
  const textBytes = [...asciiBytes(text), 0]; // null-terminated
  const ifdOffset = 8;
  const entryOffset = ifdOffset + 2;
  const nextIfdOffset = entryOffset + 12;
  const valueOffset = nextIfdOffset + 4;

  const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  return [
    0x49, 0x49, 0x2a, 0x00, // "II" + magic 42 (LE)
    ...le32(ifdOffset),
    ...le16(1), // entryCount = 1
    ...le16(tag),
    ...le16(2), // type = ASCII
    ...le32(textBytes.length),
    ...le32(valueOffset),
    ...le32(0), // next IFD offset = 0
    ...textBytes,
  ];
}

function buildJpegWithExif(tag: number, text: string): Uint8Array {
  const tiff = buildTiffAsciiTag(tag, text);
  const app1Payload = [...asciiBytes("Exif"), 0, 0, ...tiff];
  const app1Len = app1Payload.length + 2;
  const app1 = [0xff, 0xe1, (app1Len >>> 8) & 0xff, app1Len & 0xff, ...app1Payload];
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]);
}

function buildLargeJpegWithoutExif(totalSize: number): Uint8Array {
  const payload = new Array(totalSize - 4 - 4).fill(0x30); // relleno ASCII '0', no dispara ninguna regla
  const segLen = payload.length + 2;
  const app0 = [0xff, 0xe0, (segLen >>> 8) & 0xff, segLen & 0xff, ...payload];
  return new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xd9]);
}

/* -------------------------------------------------------------------------- */

describe("analyzeProvenanceBytes — MP4/MOV", () => {
  it("MP4 con TikTok en udta (free box) → señal alta y veredicto probable_descarga_de_plataforma", () => {
    const bytes = buildMp4([
      ftypBox("isom", ["isom", "mp42"]),
      moovBox([mvhdBox(), box("udta", box("free", asciiBytes("Exportado desde TikTok v30")))]),
    ]);

    const result = analyzeProvenanceBytes(bytes, "video/mp4");

    expect(result.analyzed).toBe(true);
    expect(result.verdict).toBe("probable_descarga_de_plataforma");
    expect(result.containerBrand).toBe("isom");
    const tiktok = result.signals.find((s) => s.platform === "TikTok");
    expect(tiktok).toBeDefined();
    expect(tiktok?.confidence).toBe("alta");
  });

  it("MP4 con CapCut en el tag de encoder (©too) → detectado y expuesto como encoder", () => {
    const bytes = buildMp4([
      ftypBox("isom", ["isom", "mp42"]),
      moovBox([mvhdBox(), udtaWithDirectTag("©too", "CapCut 3.2.1")]),
    ]);

    const result = analyzeProvenanceBytes(bytes, "video/mp4");

    expect(result.analyzed).toBe(true);
    const capcut = result.signals.find((s) => s.platform === "CapCut");
    expect(capcut).toBeDefined();
    expect(capcut?.confidence).toBe("alta");
    expect(result.encoder).toBe("CapCut 3.2.1");
    expect(result.verdict).toBe("probable_descarga_de_plataforma");
  });

  it("MP4 con el patrón completo udta>meta>ilst>data también se detecta", () => {
    const bytes = buildMp4([
      ftypBox("isom", ["isom", "mp42"]),
      moovBox([mvhdBox(), udtaWithIlstTag("©too", "InShot Inc.")]),
    ]);

    const result = analyzeProvenanceBytes(bytes, "video/mp4");

    expect(result.analyzed).toBe(true);
    const inshot = result.signals.find((s) => s.platform === "InShot");
    expect(inshot).toBeDefined();
    expect(inshot?.confidence).toBe("alta");
    expect(inshot?.field).toContain("©too");
  });

  it("MP4 limpio, sin ninguna firma conocida → sin_indicios", () => {
    const bytes = buildMp4([
      ftypBox("isom", ["isom", "mp42"]),
      moovBox([mvhdBox(), udtaWithDirectTag("©nam", "Vacaciones 2024")]),
    ]);

    const result = analyzeProvenanceBytes(bytes, "video/mp4");

    expect(result.analyzed).toBe(true);
    expect(result.verdict).toBe("sin_indicios");
    expect(result.signals).toHaveLength(0);
    expect(result.containerBrand).toBe("isom");
  });

  it("box de 64 bits (largesize) se parsea bien: no rompe el offset del hermano siguiente", () => {
    const sixtyFourBitBox = box64("free", asciiBytes("marca de 64 bits: CapCut"));
    const followingBox = box("free", asciiBytes("SEGUNDO-BOX-TikTok-OK"));

    const bytes = buildMp4([
      ftypBox("isom", ["isom", "mp42"]),
      sixtyFourBitBox,
      followingBox,
      moovBox([mvhdBox()]),
    ]);

    const result = analyzeProvenanceBytes(bytes, "video/mp4");

    expect(result.analyzed).toBe(true);
    // Si el largesize se hubiera interpretado mal, el offset del segundo box
    // quedaría corrido y esta señal (o la del primero) no aparecería.
    expect(result.signals.some((s) => s.platform === "CapCut")).toBe(true);
    expect(result.signals.some((s) => s.platform === "TikTok")).toBe(true);
  });

  it("archivo truncado (ftyp declarado pero cortado a mitad) → analyzed: false, sin lanzar", () => {
    const full = buildMp4([ftypBox("isom", ["isom", "mp42", "isom", "isom"])]);
    const truncated = full.slice(0, 10); // el ftyp declara más tamaño del que hay bytes

    expect(() => analyzeProvenanceBytes(truncated, "video/mp4")).not.toThrow();
    const result = analyzeProvenanceBytes(truncated, "video/mp4");
    expect(result.analyzed).toBe(false);
    expect(result.verdict).toBe("sin_indicios");
    expect(result.signals).toHaveLength(0);
  });

  it("basura (bytes sin ninguna estructura reconocible) → analyzed: false, sin lanzar", () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255, 254, 0, 0, 0, 0]);

    expect(() => analyzeProvenanceBytes(garbage, "video/mp4")).not.toThrow();
    const result = analyzeProvenanceBytes(garbage, "video/mp4");
    expect(result.analyzed).toBe(false);
  });

  it("archivo vacío → analyzed: false, sin lanzar", () => {
    const result = analyzeProvenanceBytes(new Uint8Array(0), "video/mp4");
    expect(result.analyzed).toBe(false);
    expect(result.verdict).toBe("sin_indicios");
  });
});

describe("analyzeProvenanceBytes — JPEG", () => {
  it("JPEG con EXIF Software=Instagram → detectado como alta confianza", () => {
    const bytes = buildJpegWithExif(0x0131, "Instagram");

    const result = analyzeProvenanceBytes(bytes, "image/jpeg");

    expect(result.analyzed).toBe(true);
    const instagram = result.signals.find((s) => s.platform === "Instagram");
    expect(instagram).toBeDefined();
    expect(instagram?.confidence).toBe("alta");
    expect(instagram?.field).toBe("exif.software");
    expect(result.encoder).toBe("Instagram");
    expect(result.verdict).toBe("probable_descarga_de_plataforma");
  });

  it("JPEG con EXIF Make de cámara real (sin firma de plataforma) → sin_indicios", () => {
    const bytes = buildJpegWithExif(0x010f, "Canon");

    const result = analyzeProvenanceBytes(bytes, "image/jpeg");

    expect(result.analyzed).toBe(true);
    expect(result.verdict).toBe("sin_indicios");
  });

  it("JPEG grande sin EXIF → señal baja de ausencia, nunca alta", () => {
    const bytes = buildLargeJpegWithoutExif(150 * 1024);

    const result = analyzeProvenanceBytes(bytes, "image/jpeg");

    expect(result.analyzed).toBe(true);
    const sinExif = result.signals.find((s) => s.signal === "sin-metadata-exif");
    expect(sinExif).toBeDefined();
    expect(sinExif?.confidence).toBe("baja");
    expect(result.verdict).toBe("sospechoso");
  });

  it("JPEG chico sin EXIF → no dispara la señal de ausencia (el umbral es por tamaño)", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // SOI + EOI, sin nada en el medio

    const result = analyzeProvenanceBytes(bytes, "image/jpeg");

    expect(result.analyzed).toBe(true);
    expect(result.signals).toHaveLength(0);
    expect(result.verdict).toBe("sin_indicios");
  });
});

describe("analyzeProvenanceBytes — PNG", () => {
  function pngChunk(type: string, data: number[]): number[] {
    return [...u32be(data.length), ...asciiBytes(type), ...data, 0, 0, 0, 0]; // CRC no se valida, alcanza con 4 bytes cualquiera
  }

  it("PNG con chunk tEXt conteniendo la firma de una plataforma → detectado", () => {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const textChunk = pngChunk("tEXt", [...asciiBytes("Comment"), 0, ...asciiBytes("Editado con CapCut")]);
    const iend = pngChunk("IEND", []);
    const bytes = new Uint8Array([...signature, ...textChunk, ...iend]);

    const result = analyzeProvenanceBytes(bytes, "image/png");

    expect(result.analyzed).toBe(true);
    expect(result.signals.some((s) => s.platform === "CapCut")).toBe(true);
  });
});

describe("analyzeProvenanceBytes — formato desconocido", () => {
  it("un formato no reconocido devuelve analyzed: false sin lanzar", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF", no soportado
    const result = analyzeProvenanceBytes(bytes, "application/pdf");
    expect(result.analyzed).toBe(false);
    expect(result.verdict).toBe("sin_indicios");
  });
});
