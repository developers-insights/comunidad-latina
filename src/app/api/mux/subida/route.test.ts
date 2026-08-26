import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `POST /api/mux/subida`.
 *
 * Lo que se afirma acá, en orden de importancia:
 *
 *  1. SIN CLAVES DE MUX → 503 y CERO efectos. Ni una fila, ni un cupo de rate
 *     limit consumido, ni una llamada a Mux. Es la garantía de que el camino de
 *     video "se enciende" y no rompe nada mientras está apagado.
 *  2. El `tenant_id` y el `author_id` de la fila salen del GUARD, nunca del
 *     request. Ni siquiera se parsea el body.
 *  3. Sin sesión → 401 antes de tocar la base.
 *  4. Si Mux falla, el borrador no queda huérfano.
 *
 * Se mockean sólo los bordes (config, SDK de Mux, admin client, guard, limiter);
 * el handler corre de verdad. Mismo patrón de stub que el webhook de Stripe.
 */

const mocks = vi.hoisted(() => ({
  muxConfigurado: true,
  requireTenantMatch: vi.fn(),
  createAdminClient: vi.fn(),
  getMux: vi.fn(),
  limit: vi.fn(),
}));

// `isMuxConfigured` es un `const` derivado de env en el import. Se expone como
// getter para poder apagarlo por test sin recargar el módulo.
vi.mock("@/lib/config/services", () => ({
  get isMuxConfigured() {
    return mocks.muxConfigurado;
  },
}));

// No se carga el módulo real para no arrastrar el SDK de Mux ni sus credenciales.
vi.mock("@/lib/mux/client", () => ({
  getMux: mocks.getMux,
  MUX_NEW_ASSET_SETTINGS: {
    playback_policies: ["public"],
    video_quality: "basic",
    max_resolution_tier: "1080p",
  },
  MUX_UPLOAD_TIMEOUT_SECONDS: 3600,
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));

import { POST } from "./route";

/* --------------------------- Stub del admin client ------------------------- */

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"insert" | "update" | "delete" | "select", OpResult>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createAdminStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = () => tableConfig[op ?? "select"] ?? { data: null, error: null };

    const registrar = (method: keyof TableOps) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        // Un `.select()` DESPUÉS de un write es su RETURNING, no una consulta
        // nueva: no puede pisar la operación en curso.
        if (method !== "select" || op === null) op = method;
        return builder;
      });

    const filtro = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: registrar("insert"),
      update: registrar("update"),
      delete: registrar("delete"),
      select: registrar("select"),
      eq: filtro("eq"),
      single: vi.fn(async () => result()),
      maybeSingle: vi.fn(async () => result()),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

function useAdmin(config: Record<string, TableOps> = {}) {
  const stub = createAdminStub(config);
  mocks.createAdminClient.mockReturnValue(stub.client);
  return stub;
}

/* -------------------------------- Fixtures --------------------------------- */

const TENANT = { id: "tenant-1", slug: "dominicanos", isFallback: false };
const USER = { id: "user-1" };
const BORRADOR = { data: { id: "post-borrador-1" }, error: null };

function pedido(headers: Record<string, string> = {}) {
  return new Request("https://dominicanos.com/api/mux/subida", {
    method: "POST",
    headers: { host: "dominicanos.com", ...headers },
  });
}

function guardOk() {
  mocks.requireTenantMatch.mockResolvedValue({ ok: true, tenant: TENANT, user: USER });
}

function muxOk(upload = { id: "upload-1", url: "https://storage.mux.com/upload-1" }) {
  const create = vi.fn().mockResolvedValue(upload);
  const cancel = vi.fn().mockResolvedValue({});
  mocks.getMux.mockReturnValue({ video: { uploads: { create, cancel } } });
  return { create, cancel };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.muxConfigurado = true;
  mocks.limit.mockReturnValue({ ok: true, remaining: 9, retryAfterMs: 0 });
});

/* ---------------------------------- Tests ---------------------------------- */

describe("POST /api/mux/subida — sin claves de Mux", () => {
  it("devuelve 503 y no toca NADA: ni base, ni Mux, ni cupo", async () => {
    mocks.muxConfigurado = false;
    const admin = useAdmin();
    muxOk();

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(503);
    await expect(respuesta.json()).resolves.toMatchObject({ error: "mux_no_configurado" });
    // Lo importante no es el 503: es que no hay efectos que limpiar después.
    expect(admin.calls).toEqual([]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.getMux).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
    // Ni siquiera se pregunta quién es: el camino está apagado para todos.
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/mux/subida — sesión y comunidad", () => {
  it("sin sesión devuelve 401 antes de escribir nada", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "Entrá a tu cuenta para seguir.",
    });
    const admin = useAdmin();
    muxOk();

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(401);
    await expect(respuesta.json()).resolves.toMatchObject({ error: "sin_sesion" });
    expect(admin.calls).toEqual([]);
    expect(mocks.getMux).not.toHaveBeenCalled();
  });

  it("con el JWT de otra comunidad devuelve 409 y no crea el borrador", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "tenant-mismatch",
      message: "Esta cuenta es de otra comunidad.",
    });
    const admin = useAdmin();
    muxOk();

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(409);
    expect(admin.calls).toEqual([]);
    expect(mocks.getMux).not.toHaveBeenCalled();
  });
});

describe("POST /api/mux/subida — techo por hora", () => {
  it("devuelve 429 sin crear el borrador ni llamar a Mux", async () => {
    guardOk();
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 60_000 });
    const admin = useAdmin();
    muxOk();

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(429);
    expect(admin.calls).toEqual([]);
    expect(mocks.getMux).not.toHaveBeenCalled();
  });

  it("la key del limiter es por persona y por acción, no compartida con el feed", async () => {
    guardOk();
    useAdmin({ posts: { insert: BORRADOR } });
    muxOk();

    await POST(pedido());

    expect(mocks.limit).toHaveBeenCalledWith("mux-subida:user-1", 10, 3_600_000);
  });
});

describe("POST /api/mux/subida — camino feliz", () => {
  it("devuelve el contrato completo y deja el borrador enlazado a la subida", async () => {
    guardOk();
    const admin = useAdmin({ posts: { insert: BORRADOR } });
    muxOk();

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toEqual({
      uploadId: "upload-1",
      uploadUrl: "https://storage.mux.com/upload-1",
      postDraftId: "post-borrador-1",
    });

    // El UPDATE que hace posible el webhook: sin `mux_upload_id` grabado, el
    // evento que llegue después no tiene con qué encontrar la publicación.
    const enlace = admin.calls.find((c) => c.table === "posts" && c.method === "update");
    expect(enlace?.args[0]).toEqual({ mux_upload_id: "upload-1" });
  });

  it("el tenant_id y el author_id salen del guard — el request no aporta un solo dato", async () => {
    guardOk();
    const admin = useAdmin({ posts: { insert: BORRADOR } });
    muxOk();

    // Un cliente hostil intentando dictar la comunidad por header y por body.
    await POST(
      new Request("https://dominicanos.com/api/mux/subida", {
        method: "POST",
        headers: { host: "dominicanos.com", "x-tenant-slug": "otra-comunidad" },
        body: JSON.stringify({ tenant_id: "tenant-INTRUSO", author_id: "user-INTRUSO" }),
      }),
    );

    const insert = admin.calls.find((c) => c.table === "posts" && c.method === "insert");
    expect(insert?.args[0]).toEqual({
      tenant_id: "tenant-1",
      author_id: "user-1",
      body: "",
      kind: "post",
      status: "draft",
      mux_status: "uploading",
    });
  });

  it("el asset nace público y SIN rendición mp4 (que se paga para siempre)", async () => {
    guardOk();
    useAdmin({ posts: { insert: BORRADOR } });
    const mux = muxOk();

    await POST(pedido());

    const params = mux.create.mock.calls[0][0];
    expect(params.new_asset_settings.playback_policies).toEqual(["public"]);
    expect(params.new_asset_settings).not.toHaveProperty("mp4_support");
    // `passthrough` es el id del borrador: vuelve en el webhook como comodidad,
    // nunca como autorización.
    expect(params.new_asset_settings.passthrough).toBe("post-borrador-1");
  });

  it("el cors_origin sale del host del request, no de una constante de build", async () => {
    guardOk();
    useAdmin({ posts: { insert: BORRADOR } });
    const mux = muxOk();

    // Multi-tenant: cada comunidad vive en su dominio.
    await POST(pedido({ "x-forwarded-host": "comunidadlatina.com", "x-forwarded-proto": "https" }));

    expect(mux.create.mock.calls[0][0].cors_origin).toBe("https://comunidadlatina.com");
  });

  it("en local usa http, o el navegador descartaría la respuesta CORS de Mux", async () => {
    guardOk();
    useAdmin({ posts: { insert: BORRADOR } });
    const mux = muxOk();

    await POST(
      new Request("http://localhost:3000/api/mux/subida", {
        method: "POST",
        headers: { host: "localhost:3000" },
      }),
    );

    expect(mux.create.mock.calls[0][0].cors_origin).toBe("http://localhost:3000");
  });

  it("con varios proxies en la cadena toma el primer valor, no la lista entera", async () => {
    guardOk();
    useAdmin({ posts: { insert: BORRADOR } });
    const mux = muxOk();

    await POST(
      pedido({
        "x-forwarded-host": "dominicanos.com, interno.vercel.app",
        "x-forwarded-proto": "https, http",
      }),
    );

    expect(mux.create.mock.calls[0][0].cors_origin).toBe("https://dominicanos.com");
  });
});

describe("POST /api/mux/subida — cuando algo falla", () => {
  it("si Mux rechaza la subida, borra el borrador y devuelve 502", async () => {
    guardOk();
    const admin = useAdmin({ posts: { insert: BORRADOR } });
    const create = vi.fn().mockRejectedValue(new Error("Mux caído"));
    mocks.getMux.mockReturnValue({ video: { uploads: { create, cancel: vi.fn() } } });

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(502);
    await expect(respuesta.json()).resolves.toMatchObject({ error: "mux_falló" });
    const borrado = admin.calls.find((c) => c.table === "posts" && c.method === "delete");
    expect(borrado).toBeDefined();
  });

  it("si Mux devuelve una subida sin url, tampoco deja el borrador colgado", async () => {
    guardOk();
    const admin = useAdmin({ posts: { insert: BORRADOR } });
    muxOk({ id: "upload-1" } as { id: string; url: string });

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(502);
    expect(admin.calls.some((c) => c.table === "posts" && c.method === "delete")).toBe(true);
  });

  it("si no se puede enlazar la subida, la cancela en Mux y borra el borrador", async () => {
    guardOk();
    const admin = useAdmin({
      posts: { insert: BORRADOR, update: { data: null, error: { code: "XX000" } } },
    });
    const mux = muxOk();

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(502);
    // Sin cancelar quedaría una URL de subida viva capaz de producir un asset
    // que ninguna publicación va a poder reclamar.
    expect(mux.cancel).toHaveBeenCalledWith("upload-1");
    expect(admin.calls.some((c) => c.table === "posts" && c.method === "delete")).toBe(true);
  });

  it("si no se puede crear el borrador devuelve 500 y no llama a Mux", async () => {
    guardOk();
    useAdmin({ posts: { insert: { data: null, error: { code: "23503" } } } });
    const mux = muxOk();

    const respuesta = await POST(pedido());

    expect(respuesta.status).toBe(500);
    expect(mux.create).not.toHaveBeenCalled();
  });
});
