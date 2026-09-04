import { describe, expect, it } from "vitest";
import {
  BUCKET_ALLOWED_VIDEO_MIME_TYPES,
  BUCKET_FILE_SIZE_LIMIT_BYTES,
  MAX_MUX_VIDEO_BYTES,
  MAX_VIDEO_BYTES,
  MUX_VIDEO_ACCEPT_ATTR,
  MUX_WRONG_TYPE_MESSAGE,
  VIDEO_ACCEPT_ATTR,
  VIDEO_FILE_EXTENSIONS,
  VIDEO_FILENAME_PATTERN,
  VIDEO_MIME_TYPES,
  VIDEO_WRONG_TYPE_MESSAGE,
  checkVideoFile,
  formatVideoTooBigMessage,
  isAcceptedVideoType,
  maxVideoBytesFor,
  videoAcceptFor,
  videoWrongTypeMessageFor,
} from "./video-upload-limits";

/**
 * FUENTE ÚNICA DE FORMATO Y PESO DE VIDEO. Nace del feedback del cliente
 * (video, textual): "si es muy pesado no se puede subir, no sé qué onda" +
 * "antes nada más se podían subir si no era de un tipo específico de
 * formato... no te deja subir cualquier tipo de video" — el .mov de iPhone
 * aparecía EN GRIS en el selector de macOS porque el input sólo declaraba
 * `accept="video/mp4,video/webm"`.
 *
 * EL CATÁLOGO FINAL ES SÓLO MP4, WEBM Y MOV. La primera versión de este
 * módulo aceptaba también MKV, AVI, MPEG, 3GP y 3G2 — más amplio de lo que el
 * pedido pedía "como mínimo". Se recortó a los tres porque dos techos
 * independientes lo exigen: (1) el bucket `post-media` de Supabase Storage
 * tiene `allowed_mime_types` configurado y NO incluye los otros cinco —
 * subirlos los rechazaría YA SUBIDOS, el mismo bug que este módulo existe
 * para cerrar, corrido un paso más adelante; (2) MKV/AVI/MPEG no reproducen
 * nativamente en un `<video>` de HTML en ningún navegador mayor. Aceptarlos
 * hubiera sido peor que rechazarlos: la persona gasta la subida entera y la
 * publicación queda rota para todo el mundo.
 */

describe("checkVideoFile — el catálogo final: mp4, mov, webm", () => {
  const ACCEPTED_SAMPLES: Array<{
    mimeType: string;
    fileName: string;
    extension: string;
  }> = [
    { mimeType: "video/mp4", fileName: "clip.mp4", extension: "mp4" },
    // El caso que reportó el cliente: un .mov de iPhone, con el nombre real
    // que usa la Cámara de iOS (mayúsculas incluidas).
    { mimeType: "video/quicktime", fileName: "IMG_1234.MOV", extension: "mov" },
    { mimeType: "video/webm", fileName: "clip.webm", extension: "webm" },
  ];

  for (const sample of ACCEPTED_SAMPLES) {
    it(`acepta ${sample.mimeType} (${sample.fileName})`, () => {
      expect(
        checkVideoFile({ type: sample.mimeType, name: sample.fileName, size: 1024 }),
      ).toMatchObject({ ok: true, extension: sample.extension });
    });
  }
});

describe("checkVideoFile — rechaza formatos reales que el bucket o el navegador no soportan", () => {
  // Estos cinco NO son basura: son contenedores de video de verdad, y esta
  // misma función los aceptaba en la primera versión del módulo. Quedan
  // afuera a propósito (ver docblock del archivo) — este describe existe para
  // que ese recorte no se deshaga por accidente en un refactor futuro.
  const REJECTED_REAL_VIDEO_FORMATS: Array<{ mimeType: string; fileName: string }> = [
    { mimeType: "video/x-matroska", fileName: "clip.mkv" },
    { mimeType: "video/x-msvideo", fileName: "clip.avi" },
    { mimeType: "video/mpeg", fileName: "clip.mpeg" },
    { mimeType: "video/3gpp", fileName: "clip.3gp" },
    { mimeType: "video/3gpp2", fileName: "clip.3g2" },
  ];

  for (const sample of REJECTED_REAL_VIDEO_FORMATS) {
    it(`rechaza ${sample.mimeType} (${sample.fileName})`, () => {
      expect(
        checkVideoFile({ type: sample.mimeType, name: sample.fileName, size: 1024 }),
      ).toEqual({ ok: false, reason: "type" });
    });
  }

  it("un video real pero fuera del catálogo (Ogg Theora)", () => {
    expect(
      checkVideoFile({ type: "video/ogg", name: "clip.ogv", size: 1024 }),
    ).toEqual({ ok: false, reason: "type" });
  });

  it("un archivo que no es video", () => {
    expect(
      checkVideoFile({ type: "application/pdf", name: "documento.pdf", size: 1024 }),
    ).toEqual({ ok: false, reason: "type" });
  });

  it("sin MIME reconocible y con una extensión que tampoco lo es", () => {
    expect(
      checkVideoFile({ type: "", name: "instalador.exe", size: 1024 }),
    ).toEqual({ ok: false, reason: "type" });
  });
});

describe("checkVideoFile — Safari/macOS a veces no reporta el MIME (spec del pedido)", () => {
  it("MIME vacío + extensión reconocida cae a la extensión del archivo", () => {
    expect(
      checkVideoFile({ type: "", name: "IMG_5678.mov", size: 1024 }),
    ).toMatchObject({ ok: true, extension: "mov", mimeType: "video/quicktime" });
  });

  it("MIME genérico (application/octet-stream) también cae a la extensión", () => {
    expect(
      checkVideoFile({ type: "application/octet-stream", name: "clip.webm", size: 1024 }),
    ).toMatchObject({ ok: true, extension: "webm" });
  });

  it("el MIME reconocido manda por encima de una extensión rara/ausente", () => {
    expect(
      checkVideoFile({ type: "video/mp4", name: "blob", size: 1024 }),
    ).toMatchObject({ ok: true, extension: "mp4" });
  });

  it("normaliza mayúsculas tanto en el MIME como en la extensión", () => {
    expect(
      checkVideoFile({ type: "VIDEO/MP4", name: "CLIP.MP4", size: 1024 }),
    ).toMatchObject({ ok: true, extension: "mp4", mimeType: "video/mp4" });
  });
});

describe("checkVideoFile — el peso", () => {
  it("acepta un video justo en el techo (el límite incluye su propio valor)", () => {
    expect(
      checkVideoFile({ type: "video/mp4", name: "clip.mp4", size: MAX_VIDEO_BYTES }),
    ).toMatchObject({ ok: true });
  });

  it("rechaza un video 1 byte por encima del techo", () => {
    expect(
      checkVideoFile({ type: "video/mp4", name: "clip.mp4", size: MAX_VIDEO_BYTES + 1 }),
    ).toEqual({ ok: false, reason: "size" });
  });

  it("el tipo se revisa ANTES que el peso: un formato no soportado y pesadísimo sigue siendo 'type'", () => {
    // Mismo orden que `checkPhotoPayload` (cupo antes que peso): el motivo que
    // se devuelve tiene que ser siempre el más específico y accionable.
    expect(
      checkVideoFile({ type: "video/ogg", name: "clip.ogv", size: MAX_VIDEO_BYTES * 10 }),
    ).toEqual({ ok: false, reason: "type" });
  });
});

describe("el accept del input y la validación no se pueden separar", () => {
  it("cada MIME que ofrece el accept es aceptado por la validación", () => {
    const mimeEntries = VIDEO_ACCEPT_ATTR.split(",").filter((entry) => entry.includes("/"));
    expect(mimeEntries.length).toBeGreaterThan(0);
    for (const mime of mimeEntries) {
      expect(isAcceptedVideoType(mime, "sin-nombre")).toBe(true);
    }
  });

  it("cada extensión que ofrece el accept es aceptada por la validación Y por el patrón del servidor", () => {
    const extEntries = VIDEO_ACCEPT_ATTR.split(",").filter((entry) => entry.startsWith("."));
    expect(extEntries.length).toBeGreaterThan(0);
    for (const ext of extEntries) {
      expect(isAcceptedVideoType("", `archivo${ext}`)).toBe(true);
      expect(VIDEO_FILENAME_PATTERN.test(`archivo${ext}`)).toBe(true);
    }
  });

  it("VIDEO_FILE_EXTENSIONS es exactamente el juego de extensiones que ofrece el accept", () => {
    const extEntries = VIDEO_ACCEPT_ATTR.split(",")
      .filter((entry) => entry.startsWith("."))
      .map((entry) => entry.slice(1));
    expect(extEntries).toEqual([...VIDEO_FILE_EXTENSIONS]);
  });

  it("el catálogo final es EXACTAMENTE mp4, mov y webm — ni uno más", () => {
    // A diferencia de otros catálogos de este repo, acá MÁS no es más seguro:
    // cada formato de más es un formato que el bucket puede rechazar ya
    // subido, o que ningún navegador reproduce. Igualdad exacta, no
    // "al menos estos" — que este test se rompa es la señal de alarma si
    // alguien reamplía el catálogo sin revisar el bucket primero.
    expect([...VIDEO_FILE_EXTENSIONS].sort()).toEqual(["mov", "mp4", "webm"]);
  });
});

describe("VIDEO_FILENAME_PATTERN — el mismo patrón que usa la server action", () => {
  it("rechaza una extensión fuera del catálogo", () => {
    expect(VIDEO_FILENAME_PATTERN.test("clip.exe")).toBe(false);
    expect(VIDEO_FILENAME_PATTERN.test("clip.mov.exe")).toBe(false);
  });

  it("rechaza los formatos que se sacaron a propósito del catálogo", () => {
    for (const ext of ["mkv", "avi", "mpeg", "3gp", "3g2"]) {
      expect(VIDEO_FILENAME_PATTERN.test(`clip.${ext}`)).toBe(false);
    }
  });

  it("es insensible a mayúsculas, como los nombres reales de iOS", () => {
    expect(VIDEO_FILENAME_PATTERN.test("IMG_1234.MOV")).toBe(true);
  });
});

describe("MAX_VIDEO_BYTES", () => {
  it("son 200 MB — el número que promete el copy del composer", () => {
    expect(MAX_VIDEO_BYTES).toBe(200 * 1024 * 1024);
  });

  /**
   * EL ANCLA DEL BUG QUE ESTO VINO A CERRAR (cliente 2026-09-03, 21:20).
   *
   * El tope de peso y el de DURACIÓN son dos reglas sobre el mismo archivo, y
   * mientras el primero fueron 60 MB se contradecían: `video-policy.ts` deja
   * publicar 90 s en el feed, y 90 s de un iPhone en 1080p pesan 90–110 MB. O
   * sea que la app ofrecía una duración que su propio tope de peso no dejaba
   * usar — el cliente eligió un video de 1:29 y le salió "pesa 101 MB y el
   * máximo son 60".
   *
   * El número exacto de referencia (101 MB) es el del video real que rebotó.
   * Que ESE archivo entre es la definición de "arreglado" para este punto.
   */
  it("acepta el video de 1:29 y 101 MB que el cliente no pudo publicar", () => {
    const video = { type: "video/quicktime", name: "IMG_4821.MOV", size: 101 * 1024 * 1024 };
    expect(checkVideoFile(video)).toEqual({
      ok: true,
      extension: "mov",
      mimeType: "video/quicktime",
    });
  });

});

describe("formatVideoTooBigMessage — el texto exacto que ve la persona", () => {
  it("un archivo bien por encima del techo", () => {
    expect(formatVideoTooBigMessage(320 * 1024 * 1024)).toBe(
      "Este video pesa 320 MB y el máximo son 200 MB. Probá con uno más corto.",
    );
  });

  it("redondea el peso HACIA ARRIBA: nunca declara el archivo más liviano de lo que es", () => {
    // 200 MB + 1 byte no puede leerse como "200 MB" al lado de un máximo de
    // "200 MB" — sería decirle a la persona que su archivo pesa lo mismo que el
    // máximo permitido, cuando en realidad se pasó. Mismo criterio que
    // `normalizeDeclaredDuration` en video-policy.ts.
    expect(formatVideoTooBigMessage(MAX_VIDEO_BYTES + 1)).toBe(
      "Este video pesa 201 MB y el máximo son 200 MB. Probá con uno más corto.",
    );
  });
});

describe("VIDEO_WRONG_TYPE_MESSAGE", () => {
  it("es exactamente el texto que explica por qué y qué hacer (nombra MP4 como salida concreta)", () => {
    expect(VIDEO_WRONG_TYPE_MESSAGE).toBe(
      "Ese formato de video no se reproduce en la app — convertilo a MP4 y volvé a intentar.",
    );
  });
});

/**
 * EL ANCLA QUE PIDIÓ EL COORDINADOR. Hoy nada verificaba que el catálogo de
 * este módulo fuera compatible con lo que Supabase Storage realmente deja
 * subir — así fue como el módulo terminó aceptando MKV/AVI/MPEG/3GP/3G2, que
 * el bucket rechaza. Esta relación (código ⊆ bucket) es justo lo que hay que
 * anclar para que no se vuelva a separar en silencio.
 *
 * `BUCKET_ALLOWED_VIDEO_MIME_TYPES` sigue siendo un dato escrito a mano (no hay
 * forma de leer Supabase Storage desde un test sin red) — ver el ⚠️ de
 * provenencia en `video-upload-limits.ts` sobre CUÁL proyecto se consultó.
 *
 * `BUCKET_FILE_SIZE_LIMIT_BYTES` ya NO: desde la 0132 el `file_size_limit` de
 * `post-media` lo escribe una migración de este repo, así que el número del
 * código y el del bucket tienen por fin una sola fuente verificable en el
 * árbol. Si alguien cambia uno de los dos sin el otro, este test lo frena.
 */
describe("el catálogo del código es subconjunto de lo que el bucket post-media acepta", () => {
  it("todo MIME que VIDEO_MIME_TYPES aprueba está en BUCKET_ALLOWED_VIDEO_MIME_TYPES", () => {
    for (const mime of VIDEO_MIME_TYPES) {
      expect(BUCKET_ALLOWED_VIDEO_MIME_TYPES).toContain(mime);
    }
  });

  it("MAX_VIDEO_BYTES entra debajo del techo real del bucket, con margen", () => {
    // El mismo número que escribe `0132_posters_de_video.sql`.
    expect(BUCKET_FILE_SIZE_LIMIT_BYTES).toBe(250 * 1024 * 1024);
    expect(MAX_VIDEO_BYTES).toBeLessThan(BUCKET_FILE_SIZE_LIMIT_BYTES);
  });
});

// ===========================================================================
// LA RUTA DE MUX
// ===========================================================================

/**
 * TODO LO DE ARRIBA SIGUE SIENDO VERDAD, Y SE PRUEBA IGUAL — pero sólo de la
 * ruta "bucket", que es la que corre cuando Mux no está configurado. Los dos
 * techos que recortan el catálogo a mp4/mov/webm (el `allowed_mime_types` del
 * bucket y lo que un `<video>` sabe reproducir) NO son ciertos cuando el archivo
 * viaja a Mux: ahí el bucket no lo toca y el navegador no reproduce el original,
 * sino el HLS que Mux devuelve. Por eso la ruta es un parámetro y no una
 * bandera: las dos verdades conviven, cada una en su camino.
 *
 * Lo que este bloque ancla es que ampliar una ruta NO amplió la otra.
 */

describe("la ruta de Mux acepta lo que el pedido pidió: cualquier formato de video", () => {
  // Estos son EXACTAMENTE los cinco que el bloque de más arriba rechaza en la
  // ruta del bucket. Que los mismos archivos den respuestas distintas según la
  // ruta no es una inconsistencia: es la feature.
  const CONTENEDORES_REALES: Array<{ type: string; name: string }> = [
    { type: "video/x-matroska", name: "clip.mkv" },
    { type: "video/x-msvideo", name: "clip.avi" },
    { type: "video/mpeg", name: "clip.mpeg" },
    { type: "video/3gpp", name: "clip.3gp" },
    { type: "video/3gpp2", name: "clip.3g2" },
  ];

  for (const sample of CONTENEDORES_REALES) {
    it(`acepta ${sample.type} (${sample.name}), que el bucket rechaza`, () => {
      expect(checkVideoFile({ ...sample, size: 1024 }, "mux")).toMatchObject({ ok: true });
      // La contracara, en el mismo test: la ruta vieja no se movió.
      expect(checkVideoFile({ ...sample, size: 1024 })).toEqual({ ok: false, reason: "type" });
    });
  }

  it("un .mkv que el navegador reporta como application/x-matroska entra por la EXTENSIÓN", () => {
    // Es el mismo tipo de bug que el .mov de iPhone: mirar sólo el MIME deja
    // afuera un video perfectamente válido porque el navegador no lo nombró bien.
    expect(
      checkVideoFile({ type: "application/x-matroska", name: "pelicula.mkv", size: 1024 }, "mux"),
    ).toMatchObject({ ok: true });
  });

  it("sin MIME ninguno también entra: el que sabe es Mux, no el navegador", () => {
    expect(checkVideoFile({ type: "", name: "GRABACION", size: 1024 }, "mux")).toMatchObject({
      ok: true,
    });
    expect(
      checkVideoFile({ type: "application/octet-stream", name: "video-raro", size: 1024 }, "mux"),
    ).toMatchObject({ ok: true });
  });
});

describe("la ruta de Mux sigue rechazando lo que NO es un video", () => {
  // "Cualquier formato de video" no es "cualquier archivo": mandar 2 GB de PDF
  // a transcodificar para que Mux lo rechace media hora después sería peor que
  // decirlo en el momento.
  const NO_SON_VIDEO: Array<{ type: string; name: string }> = [
    { type: "application/pdf", name: "contrato.pdf" },
    { type: "image/jpeg", name: "foto.jpg" },
    { type: "audio/mpeg", name: "cancion.mp3" },
    { type: "text/plain", name: "notas.txt" },
    { type: "application/zip", name: "backup.zip" },
  ];

  for (const sample of NO_SON_VIDEO) {
    it(`rechaza ${sample.type}`, () => {
      expect(checkVideoFile({ ...sample, size: 1024 }, "mux")).toEqual({
        ok: false,
        reason: "type",
      });
    });
  }
});

describe("el peso en la ruta de Mux", () => {
  it("un video de 600 MB —imposible por el bucket— pasa sin chistar", () => {
    const seiscientosMb = 600 * 1024 * 1024;
    expect(checkVideoFile({ type: "video/mp4", name: "c.mp4", size: seiscientosMb }, "mux")).toMatchObject({
      ok: true,
    });
    expect(checkVideoFile({ type: "video/mp4", name: "c.mp4", size: seiscientosMb })).toEqual({
      ok: false,
      reason: "size",
    });
  });

  it("acepta justo en el techo de 5 GB y rechaza un byte más", () => {
    expect(
      checkVideoFile({ type: "video/mp4", name: "c.mp4", size: MAX_MUX_VIDEO_BYTES }, "mux"),
    ).toMatchObject({ ok: true });
    expect(
      checkVideoFile({ type: "video/mp4", name: "c.mp4", size: MAX_MUX_VIDEO_BYTES + 1 }, "mux"),
    ).toEqual({ ok: false, reason: "size" });
  });

  it("el techo de Mux sigue siendo de otro orden que el del bucket", () => {
    expect(MAX_MUX_VIDEO_BYTES).toBe(5 * 1024 * 1024 * 1024);
    // El factor era 50 cuando el bucket eran 60 MB; con 200 MB (2026-09-03) son
    // 25. Lo que el test protege no es el número exacto sino la RELACIÓN: por
    // Mux el peso deja de ser una limitación de producto, y el tope que muerde
    // pasa a ser el de DURACIÓN. Si algún día esta distancia se achica a menos
    // de un orden de magnitud, es que el parche del bucket dejó de ser un
    // parche y hay que discutirlo, no ajustar el número acá.
    expect(MAX_MUX_VIDEO_BYTES).toBeGreaterThan(MAX_VIDEO_BYTES * 10);
  });
});

describe("checkVideoFile sin ruta explícita es el comportamiento de SIEMPRE", () => {
  it("el default es 'bucket': todo llamador que no sepa de Mux no cambió de respuesta", () => {
    // Es la garantía de compatibilidad del módulo: la server action y cualquier
    // código anterior siguen preguntando lo mismo y recibiendo lo mismo.
    const mkv = { type: "video/x-matroska", name: "clip.mkv", size: 1024 };
    expect(checkVideoFile(mkv)).toEqual(checkVideoFile(mkv, "bucket"));
    expect(checkVideoFile(mkv)).toEqual({ ok: false, reason: "type" });
  });
});

describe("el accept y el techo salen de la ruta, no de una copia a mano", () => {
  it("con Mux el input ofrece video/* — el selector deja de pintar en gris nada", () => {
    expect(videoAcceptFor("mux")).toBe("video/*");
    expect(MUX_VIDEO_ACCEPT_ATTR).toBe("video/*");
  });

  it("sin Mux el input sigue ofreciendo exactamente la lista de siempre", () => {
    expect(videoAcceptFor("bucket")).toBe(VIDEO_ACCEPT_ATTR);
  });

  it("maxVideoBytesFor devuelve el techo de cada ruta", () => {
    expect(maxVideoBytesFor("mux")).toBe(MAX_MUX_VIDEO_BYTES);
    expect(maxVideoBytesFor("bucket")).toBe(MAX_VIDEO_BYTES);
  });
});

describe("el mensaje de rechazo dice la verdad de SU ruta", () => {
  it("sin Mux: el formato no se reproduce, convertí a MP4", () => {
    expect(videoWrongTypeMessageFor("bucket")).toBe(VIDEO_WRONG_TYPE_MESSAGE);
  });

  it("con Mux: no hay formato que sobre, así que el problema es otro", () => {
    // Decirle "convertilo a MP4" a alguien que eligió un PDF sería un consejo
    // absurdo, y en la ruta de Mux es el ÚNICO caso en que este mensaje sale.
    expect(videoWrongTypeMessageFor("mux")).toBe(MUX_WRONG_TYPE_MESSAGE);
    expect(MUX_WRONG_TYPE_MESSAGE).toBe(
      "Ese archivo no parece un video. Elegí el video que querés publicar.",
    );
    expect(MUX_WRONG_TYPE_MESSAGE).not.toContain("MP4");
  });

  it("el aviso de peso cambia de unidad, no de frase", () => {
    // 5120 MB es un número que nadie lee; 5 GB sí.
    expect(formatVideoTooBigMessage(6 * 1024 * 1024 * 1024, "mux")).toBe(
      "Este video pesa 6 GB y el máximo son 5 GB. Probá con uno más corto.",
    );
    // Y redondea HACIA ARRIBA igual que la versión en MB: 5 GB + 1 byte no
    // puede leerse "5 GB" al lado de un máximo que también dice "5 GB".
    expect(formatVideoTooBigMessage(MAX_MUX_VIDEO_BYTES + 1, "mux")).toBe(
      "Este video pesa 5.1 GB y el máximo son 5 GB. Probá con uno más corto.",
    );
  });
});
