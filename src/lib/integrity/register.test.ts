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

import { INTEGRITY_REASONS, registerUploadedMedia } from "./register";

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

function input(items = [PHOTO_ITEM]) {
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
    expect(mocks.scanContentAsset).toHaveBeenCalledWith(stub.client, ASSET, 10);
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
