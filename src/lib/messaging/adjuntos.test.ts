import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADJUNTO_FILENAME_PATTERN,
  MAX_BYTES_DEL_BUCKET,
  MAX_BYTES_POR_KIND,
  TIPOS_DE_ADJUNTO,
  clasificarMime,
  esRutaPropiaDeAdjunto,
  extensionDeMime,
  mimeBase,
  rutaDeAdjunto,
  validarAdjunto,
} from "./adjuntos";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRACION_0140 = readFileSync(
  resolve(HERE, "../../../supabase/migrations/0140_bucket_privado_y_buscador_de_mensajeria.sql"),
  "utf8",
);

const TENANT = "11111111-1111-4111-8111-111111111111";
const USUARIO = "99999999-9999-4999-8999-999999999999";
const OTRO = "88888888-8888-4888-8888-888888888888";
const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/**
 * ═══ POR QUÉ ESTOS TESTS LEEN EL SQL ════════════════════════════════════════
 * El catálogo de tipos y el techo de peso viven DOS veces: acá y en el bucket
 * de la 0140. Cuando se separan, el navegador deja elegir un archivo que
 * Storage rechaza con un 400 recién al subir — el modo de falla que la propia
 * migración describe como el más confuso, porque del lado de quien prueba todo
 * parece andar hasta el último segundo. Mismo patrón que `grupos.test.ts` con
 * las categorías de la 0133.
 */
describe("el catálogo no se separa del bucket", () => {
  const permitidos = (() => {
    const bloque = MIGRACION_0140.match(/allowed_mime_types[\s\S]*?array\[([\s\S]*?)\]/);
    if (!bloque) throw new Error("No se encontró allowed_mime_types en la 0140");
    return new Set(
      Array.from(bloque[1].matchAll(/'([^']+)'/g)).map((coincidencia) => coincidencia[1]),
    );
  })();

  it("todo tipo que la app acepta está permitido en el bucket", () => {
    for (const mime of Object.keys(TIPOS_DE_ADJUNTO)) {
      expect(permitidos).toContain(mime);
    }
  });

  it("el techo del bucket es exactamente el `file_size_limit` de la migración", () => {
    const limite = MIGRACION_0140.match(/file_size_limit[\s\S]*?(\d{6,})/);
    expect(limite).not.toBeNull();
    expect(Number(limite?.[1])).toBe(MAX_BYTES_DEL_BUCKET);
  });

  it("ningún techo por tipo se pasa del techo del bucket", () => {
    for (const [kind, bytes] of Object.entries(MAX_BYTES_POR_KIND)) {
      expect(bytes, kind).toBeLessThanOrEqual(MAX_BYTES_DEL_BUCKET);
    }
  });

  it.each(["image/svg+xml", "application/zip", "application/vnd.android.package-archive"])(
    "%s sigue afuera (0140 §1)",
    (mime) => {
      expect(TIPOS_DE_ADJUNTO[mime]).toBeUndefined();
      expect(clasificarMime(mime)).toBeNull();
    },
  );
});

describe("mimeBase", () => {
  it("le saca el codec al tipo que devuelve MediaRecorder", () => {
    expect(mimeBase("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(mimeBase("audio/mp4;codecs=mp4a.40.2")).toBe("audio/mp4");
    expect(mimeBase("video/webm; codecs=vp9")).toBe("video/webm");
  });

  it("normaliza mayúsculas y espacios", () => {
    expect(mimeBase("  IMAGE/JPEG ")).toBe("image/jpeg");
  });
});

describe("clasificarMime", () => {
  it.each([
    ["image/jpeg", "imagen"],
    ["image/gif", "imagen"],
    ["video/quicktime", "video"],
    ["audio/mp4", "audio"],
    ["audio/webm;codecs=opus", "audio"],
    ["application/pdf", "archivo"],
  ])("%s → %s", (mime, kind) => {
    expect(clasificarMime(mime)).toBe(kind);
  });

  it("un audio y un video en webm NO se confunden aunque compartan contenedor", () => {
    expect(clasificarMime("audio/webm")).toBe("audio");
    expect(clasificarMime("video/webm")).toBe("video");
  });
});

describe("validarAdjunto", () => {
  it("acepta una foto normal y devuelve el mime pelado", () => {
    expect(validarAdjunto({ mime: "image/jpeg", bytes: 400_000 })).toEqual({
      ok: true,
      kind: "imagen",
      mime: "image/jpeg",
    });
  });

  it("rechaza por tipo antes que por peso: un .zip de 1 byte sigue siendo un .zip", () => {
    expect(validarAdjunto({ mime: "application/zip", bytes: 1 })).toEqual({
      ok: false,
      motivo: "tipo",
      kind: null,
    });
  });

  it("rechaza por peso con el techo de SU tipo, no con el del bucket", () => {
    const nueveMegas = 9 * 1024 * 1024;
    expect(validarAdjunto({ mime: "image/jpeg", bytes: nueveMegas }).ok).toBe(false);
    // El mismo peso como video entra: el video tiene el techo del bucket.
    expect(validarAdjunto({ mime: "video/mp4", bytes: nueveMegas }).ok).toBe(true);
  });

  it("un archivo de 0 bytes se rechaza como vacío y no como peso", () => {
    expect(validarAdjunto({ mime: "image/png", bytes: 0 })).toMatchObject({
      ok: false,
      motivo: "vacio",
    });
  });

  it("acepta el tipo con codec y guarda el pelado", () => {
    expect(validarAdjunto({ mime: "audio/webm;codecs=opus", bytes: 20_000 })).toEqual({
      ok: true,
      kind: "audio",
      mime: "audio/webm",
    });
  });
});

describe("rutaDeAdjunto", () => {
  it("arma {tenant}/{user}/chat-{uuid}.{ext} y nada más", () => {
    expect(rutaDeAdjunto(TENANT, USUARIO, "image/jpeg", UUID)).toBe(
      `${TENANT}/${USUARIO}/chat-${UUID}.jpg`,
    );
  });

  it("un tipo desconocido no produce ruta", () => {
    expect(rutaDeAdjunto(TENANT, USUARIO, "application/zip", UUID)).toBeNull();
  });

  it("la ruta que arma pasa su propia revalidación", () => {
    for (const mime of Object.keys(TIPOS_DE_ADJUNTO)) {
      const path = rutaDeAdjunto(TENANT, USUARIO, mime, UUID);
      expect(path, mime).not.toBeNull();
      expect(esRutaPropiaDeAdjunto(path as string, TENANT, USUARIO), mime).toBe(true);
    }
  });

  it("cada tipo tiene extensión", () => {
    for (const mime of Object.keys(TIPOS_DE_ADJUNTO)) {
      expect(extensionDeMime(mime), mime).toBeTruthy();
    }
  });
});

/**
 * El chequeo que impide que un mensaje apunte al archivo de otra persona. Sin
 * él, la policy de lectura de la 0140 —que habilita todo objeto referenciado
 * por un mensaje VISIBLE— convierte un mensaje falso en la llave del archivo.
 */
describe("esRutaPropiaDeAdjunto", () => {
  const propia = `${TENANT}/${USUARIO}/chat-${UUID}.jpg`;

  it("acepta la propia", () => {
    expect(esRutaPropiaDeAdjunto(propia, TENANT, USUARIO)).toBe(true);
  });

  it.each([
    ["el prefijo de OTRA persona", `${TENANT}/${OTRO}/chat-${UUID}.jpg`],
    ["otro tenant", `${OTRO}/${USUARIO}/chat-${UUID}.jpg`],
    ["una carpeta de más", `${TENANT}/${USUARIO}/sub/chat-${UUID}.jpg`],
    ["una carpeta de menos", `${USUARIO}/chat-${UUID}.jpg`],
    ["barra inicial", `/${TENANT}/${USUARIO}/chat-${UUID}.jpg`],
    ["el bucket adelante", `chat-media/${TENANT}/${USUARIO}/chat-${UUID}.jpg`],
    ["traversal", `${TENANT}/${USUARIO}/chat-${UUID}..jpg`],
    ["un nombre elegido a mano", `${TENANT}/${USUARIO}/mi-archivo.jpg`],
    ["sin extensión", `${TENANT}/${USUARIO}/chat-${UUID}`],
    ["un uuid que no lo es", `${TENANT}/${USUARIO}/chat-no-es-un-uuid.jpg`],
    ["cadena vacía", ""],
  ])("rechaza %s", (_caso, path) => {
    expect(esRutaPropiaDeAdjunto(path, TENANT, USUARIO)).toBe(false);
  });

  it("el patrón del nombre no acepta un salto de línea colado al final", () => {
    expect(ADJUNTO_FILENAME_PATTERN.test(`chat-${UUID}.jpg\nchat-${UUID}.jpg`)).toBe(false);
  });
});
