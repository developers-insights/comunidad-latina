import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * DEGRADACIÓN ELEGANTE DEL PIPELINE (§7)
 * =============================================================================
 *
 * La regla tiene dos mitades y las dos se prueban acá:
 *
 *   · el pipeline NUNCA lanza —ni sin admin client, ni con storage caído, ni
 *     sin `sharp`, ni con el escaneo roto—; siempre devuelve un resultado;
 *   · y NUNCA se calla lo que no pudo hacer: cada falla enciende
 *     `needsHumanReview` con un motivo. Un archivo sin analizar y uno analizado
 *     y limpio no pueden verse iguales desde afuera, porque quien llama decide
 *     con eso si el contenido se publica solo.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  hashStorageObject: vi.fn(),
  imagePhash: vi.fn(),
  scanContentAsset: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("./storage", () => ({ hashStorageObject: mocks.hashStorageObject }));
vi.mock("./image", () => ({ imagePhash: mocks.imagePhash, imageLuma: vi.fn() }));
vi.mock("./scan", () => ({
  scanContentAsset: mocks.scanContentAsset,
  DEFAULT_MAX_DISTANCE: 10,
}));

import { INTEGRITY_REASONS, registerUploadedMedia, type MediaItem } from "./register";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type OpResult = { data?: unknown; error?: unknown };

function createAdminStub(plan: Record<string, OpResult> = {}) {
  const writes: Record<string, unknown[]> = {};

  const from = vi.fn((table: string) => {
    let op = "select";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      maybeSingle: async () => plan[`${table}.${op}`] ?? { data: null, error: null },
      single: async () => plan[`${table}.${op}`] ?? { data: null, error: null },
      then: (resolve: (value: OpResult) => unknown) =>
        Promise.resolve(plan[`${table}.${op}`] ?? { data: [], error: null }).then(resolve),
    };
    for (const method of ["select", "eq", "in", "limit", "order"]) {
      builder[method] = vi.fn(() => builder);
    }
    for (const method of ["insert", "update", "upsert"]) {
      builder[method] = vi.fn((payload: unknown) => {
        op = method;
        writes[`${table}.${method}`] = [...(writes[`${table}.${method}`] ?? []), payload];
        return builder;
      });
    }
    return builder;
  });

  return { client: { from }, from, writes };
}

const PHOTO_ITEM = {
  mediaKind: "imagen" as const,
  storageBucket: "listing-photos",
  storagePath: `${TENANT}/listing/foto.webp`,
};

function input(items: MediaItem[] = [PHOTO_ITEM]) {
  return {
    tenantId: TENANT,
    uploaderId: USER,
    subjectKind: "listing" as const,
    subjectId: "44444444-4444-4444-8444-444444444444",
    sourceHost: "dominicanos.com",
    items,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.hashStorageObject.mockResolvedValue({
    ok: true,
    sha256: "a".repeat(64),
    byteSize: 1234,
    bytes: new Uint8Array([1, 2, 3]),
  });
  mocks.imagePhash.mockResolvedValue("0".repeat(64));
  mocks.scanContentAsset.mockResolvedValue({ ok: true, openAlerts: 0 });
});

describe("sin archivos no hay pipeline", () => {
  it("devuelve limpio sin tocar la red", async () => {
    const result = await registerUploadedMedia(input([]));
    expect(result).toEqual({ needsHumanReview: false, reasons: [], assetIds: [] });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("camino feliz", () => {
  it("registra el asset con su huella y no pide ojos humanos", async () => {
    const stub = createAdminStub({ "content_assets.insert": { data: { id: ASSET }, error: null } });
    mocks.createAdminClient.mockReturnValue(stub.client);

    const result = await registerUploadedMedia(input());

    expect(result.needsHumanReview).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.assetIds).toEqual([ASSET]);

    const row = stub.writes["content_assets.insert"]?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenant_id: TENANT,
      uploader_id: USER,
      subject_kind: "listing",
      media_kind: "imagen",
      storage_bucket: "listing-photos",
      // bytea en el formato que habla PostgREST, calculado server-side.
      sha256: `\\x${"a".repeat(64)}`,
      phash: "0".repeat(64),
      source_host: "dominicanos.com",
      // Sin declaración explícita, `desconocido` — que NO significa "es propio".
      license_kind: "desconocido",
      originality_declared: false,
    });
    // Sin umbrales: los pone la comunidad desde la base (0086 + 0088). Que acá
    // viaje un objeto vacío ES la aserción — un número significaría que la app
    // volvió a tener su propia definición de "esto es un duplicado".
    expect(mocks.scanContentAsset).toHaveBeenCalledWith(stub.client, ASSET, {});
  });
});

describe("PIPELINE CAÍDO → el contenido va a revisión, nunca pasa como limpio", () => {
  it("sin admin client configurado", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente");
    });

    const result = await registerUploadedMedia(input());

    expect(result.needsHumanReview).toBe(true);
    expect(result.reasons).toEqual([INTEGRITY_REASONS.failed]);
    expect(result.assetIds).toEqual([]);
  });

  it("si el archivo no se puede leer de storage, no se inventa un asset", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);
    mocks.hashStorageObject.mockResolvedValue({ ok: false, reason: "error" });

    const result = await registerUploadedMedia(input());

    expect(result.needsHumanReview).toBe(true);
    expect(result.reasons).toContain(INTEGRITY_REASONS.failed);
    expect(stub.writes["content_assets.insert"]).toBeUndefined();
  });

  it("si el archivo pasa el tope de tamaño, lo dice con su propio motivo", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);
    mocks.hashStorageObject.mockResolvedValue({ ok: false, reason: "demasiado-grande" });

    const result = await registerUploadedMedia(input());

    expect(result.needsHumanReview).toBe(true);
    expect(result.reasons).toEqual([INTEGRITY_REASONS.tooLarge]);
  });

  it("sin `sharp` el asset se registra igual, pero marcado como sin huella", async () => {
    const stub = createAdminStub({ "content_assets.insert": { data: { id: ASSET }, error: null } });
    mocks.createAdminClient.mockReturnValue(stub.client);
    mocks.imagePhash.mockResolvedValue(null);

    const result = await registerUploadedMedia(input());

    // El SHA-256 sí se calculó: el duplicado exacto sigue detectándose. Lo que
    // falta es el "se parece", y por eso pide un humano.
    expect(result.assetIds).toEqual([ASSET]);
    expect(result.needsHumanReview).toBe(true);
    expect(result.reasons).toContain(INTEGRITY_REASONS.notFingerprinted);
    const row = stub.writes["content_assets.insert"]?.[0] as Record<string, unknown>;
    expect(row.phash).toBeNull();
  });

  it("si el escaneo falla, el archivo queda marcado para revisión", async () => {
    const stub = createAdminStub({ "content_assets.insert": { data: { id: ASSET }, error: null } });
    mocks.createAdminClient.mockReturnValue(stub.client);
    mocks.scanContentAsset.mockResolvedValue({ ok: false, error: "timeout" });

    const result = await registerUploadedMedia(input());

    expect(result.needsHumanReview).toBe(true);
    expect(result.reasons).toContain(INTEGRITY_REASONS.failed);
  });

  it("si el INSERT del asset falla, no se lanza y se pide revisión", async () => {
    const stub = createAdminStub({
      "content_assets.insert": { data: null, error: { code: "23503", message: "fk" } },
    });
    mocks.createAdminClient.mockReturnValue(stub.client);

    const result = await registerUploadedMedia(input());

    expect(result.needsHumanReview).toBe(true);
    expect(result.assetIds).toEqual([]);
    expect(mocks.scanContentAsset).not.toHaveBeenCalled();
  });
});

describe("alertas del escaneo → motivos para la cola", () => {
  it("un duplicado exacto viaja como motivo a moderation_queue", async () => {
    const stub = createAdminStub({
      "content_assets.insert": { data: { id: ASSET }, error: null },
      "content_integrity_alerts.select": {
        data: [{ kind: "duplicado_exacto" }, { kind: "licencia_faltante" }],
        error: null,
      },
    });
    mocks.createAdminClient.mockReturnValue(stub.client);
    mocks.scanContentAsset.mockResolvedValue({ ok: true, openAlerts: 2 });

    const result = await registerUploadedMedia(input());

    expect(result.needsHumanReview).toBe(true);
    expect(result.reasons).toContain(INTEGRITY_REASONS.duplicate);
    expect(result.reasons).toContain(INTEGRITY_REASONS.missingLicense);
  });
});

/**
 * =============================================================================
 * PROCEDENCIA DEL ARCHIVO Y HUELLA DE AUDIO
 * =============================================================================
 *
 * Dos capas que se sumaron después de la 0061 y que comparten una propiedad con
 * el resto del pipeline: ninguna decide si algo se publica, las dos sólo dicen
 * "esto lo mira una persona".
 *
 * La de procedencia es la que más fácil se malinterpreta, así que se prueba
 * explícitamente lo que NO hace: encontrar la firma de TikTok en los metadatos
 * de un archivo no afirma nada sobre derechos de autor — dice de dónde salió el
 * ARCHIVO, que es un dato técnico. Por eso levanta revisión humana y no un
 * bloqueo automático.
 */
describe("procedencia del archivo → revisión humana, nunca bloqueo automático", () => {
  /** MP4 mínimo con la firma de la plataforma plantada en `udta`. */
  function mp4ConFirma(firma: string): Uint8Array {
    const ftyp = [
      0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, // size + 'ftyp'
      0x69, 0x73, 0x6f, 0x6d, // major_brand 'isom'
      0, 0, 2, 0, // minor_version
      0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32, // compatible brands
    ];
    const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const box = (type: string, payload: number[]) => [
      ...u32be(8 + payload.length),
      ...[...type].map((c) => c.charCodeAt(0)),
      ...payload,
    ];
    // El texto va dentro de un box `free` anidado en `udta`, que es donde las
    // apps de edición dejan su firma de verdad — no suelto en el udta.
    const moov = box("moov", box("udta", box("free", [...Buffer.from(firma, "latin1")])));
    return new Uint8Array([...ftyp, ...moov]);
  }

  const VIDEO_ITEM = {
    mediaKind: "video" as const,
    storageBucket: "post-media",
    storagePath: `${TENANT}/user/video.mp4`,
  };

  it("un video con firma de TikTok en los metadatos va a revisión con su motivo", async () => {
    mocks.hashStorageObject.mockResolvedValue({
      ok: true,
      sha256: "b".repeat(64),
      byteSize: 4242,
      bytes: mp4ConFirma("TikTok"),
    });
    const stub = createAdminStub({ "content_assets.insert": { data: { id: ASSET }, error: null } });
    mocks.createAdminClient.mockReturnValue(stub.client);

    const result = await registerUploadedMedia(input([VIDEO_ITEM]));

    expect(result.reasons).toContain(INTEGRITY_REASONS.platformSource);
    expect(result.needsHumanReview).toBe(true);
    // Lo que NO pasa: el asset se registró igual. Detectar procedencia no
    // cancela la publicación, la manda a que la mire alguien.
    expect(result.assetIds).toEqual([ASSET]);
  });

  it("un video sin firmas no levanta el motivo de procedencia", async () => {
    mocks.hashStorageObject.mockResolvedValue({
      ok: true,
      sha256: "c".repeat(64),
      byteSize: 4242,
      bytes: mp4ConFirma("una nota cualquiera"),
    });
    const stub = createAdminStub({ "content_assets.insert": { data: { id: ASSET }, error: null } });
    mocks.createAdminClient.mockReturnValue(stub.client);

    const result = await registerUploadedMedia(input([VIDEO_ITEM]));

    expect(result.reasons).not.toContain(INTEGRITY_REASONS.platformSource);
  });

  it("los bytes del video se conservan al leer de storage — si no, no hay metadatos que leer", async () => {
    const stub = createAdminStub({ "content_assets.insert": { data: { id: ASSET }, error: null } });
    mocks.createAdminClient.mockReturnValue(stub.client);

    await registerUploadedMedia(input([VIDEO_ITEM]));

    expect(mocks.hashStorageObject).toHaveBeenCalledWith(
      expect.anything(),
      "post-media",
      expect.any(String),
      expect.objectContaining({ keepBytes: true }),
    );
  });

  it("un audio inválido del cliente deja la columna en NULL, que significa «no se analizó»", async () => {
    const stub = createAdminStub({ "content_assets.insert": { data: { id: ASSET }, error: null } });
    mocks.createAdminClient.mockReturnValue(stub.client);

    await registerUploadedMedia(input([{ ...VIDEO_ITEM, audioPcm: "no soy base64 válido" }]));

    const row = stub.writes["content_assets.insert"]?.[0] as Record<string, unknown>;
    expect(row.audio_phash).toBeNull();
  });
});
