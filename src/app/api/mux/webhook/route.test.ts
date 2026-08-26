import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `POST /api/mux/webhook`.
 *
 * Es la superficie más expuesta del módulo: no tiene sesión ni cookie, escribe
 * con service_role (bypassa RLS) y su payload entero viene de afuera. Lo que se
 * afirma acá:
 *
 *  1. Firma ausente / inválida / vencida → 401 y CERO writes.
 *  2. Sin `MUX_WEBHOOK_SECRET` → 503 y CERO writes.
 *  3. Idempotencia con RECLAMO: dos entregas simultáneas del mismo evento, una
 *     sola procesa. Un reclamo vencido (proceso que murió a mitad) sí se retoma.
 *  4. `passthrough` es dato de afuera: no alcanza para tocar una publicación que
 *     no está en el circuito de Mux, y un valor que no es uuid ni se intenta.
 *  5. Fuera de orden: un evento viejo no le pisa el estado a uno nuevo.
 *
 * El handler corre de verdad; sólo se mockea el admin client. La verificación de
 * firma NO se mockea —es la única autorización que hay— así que las firmas de
 * estos tests son HMAC reales.
 */

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "./route";

const SECRETO = "secreto-de-webhook";

/* --------------------------- Stub del admin client ------------------------- */

type OpResult = { data?: unknown; error?: unknown };
type OpKey = "insert" | "update" | "delete" | "select";
/** Un valor, o una COLA: la segunda llamada a la misma op devuelve el segundo. */
type TableOps = Partial<Record<OpKey, OpResult | OpResult[]>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createAdminStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];
  const consumidos: Record<string, number> = {};

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: OpKey | null = null;

    const result = (): OpResult => {
      const clave = `${table}.${op ?? "select"}`;
      const configurado = tableConfig[op ?? "select"];
      if (Array.isArray(configurado)) {
        const indice = consumidos[clave] ?? 0;
        consumidos[clave] = indice + 1;
        return configurado[Math.min(indice, configurado.length - 1)] ?? { data: null, error: null };
      }
      return configurado ?? { data: null, error: null };
    };

    const registrar = (method: OpKey) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
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
      in: filtro("in"),
      or: filtro("or"),
      not: filtro("not"),
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

function tocó(stub: ReturnType<typeof createAdminStub>, table: string, method?: string) {
  return stub.calls.some((c) => c.table === table && (method ? c.method === method : true));
}

/* -------------------------------- Fixtures --------------------------------- */

/** El post que el UPDATE devuelve cuando SÍ matcheó una fila. */
const POST_TOCADO = { data: [{ id: "post-1", tenant_id: "tenant-1" }], error: null };
/** Cero filas: la correlación no encontró nada, o el gate de estado la frenó. */
const NINGUNA_FILA = { data: [] as Array<unknown>, error: null };
/** El INSERT en la bandeja chocó con el UNIQUE: alguien ya registró este evento. */
const EVENTO_DUPLICADO = { data: null, error: { code: "23505" } };
/** El reclamo se lo llevó otro (o ya está procesado): el UPDATE no devolvió fila. */
const RECLAMO_PERDIDO = { data: null, error: null };
const RECLAMO_GANADO = { data: { id: "evento-1" }, error: null };

function eventoReady(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-ready-1",
    type: "video.asset.ready",
    data: {
      id: "asset-1",
      upload_id: "upload-1",
      passthrough: "post-1",
      duration: 42.123456,
      playback_ids: [{ id: "playback-1", policy: "public" }],
      ...overrides,
    },
  };
}

function pedido(evento: unknown, { secreto = SECRETO, timestampMs = Date.now() } = {}) {
  const body = JSON.stringify(evento);
  const t = Math.floor(timestampMs / 1000);
  const v1 = crypto.createHmac("sha256", secreto).update(`${t}.${body}`).digest("hex");
  return new Request("https://dominicanos.com/api/mux/webhook", {
    method: "POST",
    headers: { "mux-signature": `t=${t},v1=${v1}` },
    body,
  });
}

const SECRETO_PREVIO = process.env.MUX_WEBHOOK_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.MUX_WEBHOOK_SECRET = SECRETO;
});

afterEach(() => {
  if (SECRETO_PREVIO === undefined) delete process.env.MUX_WEBHOOK_SECRET;
  else process.env.MUX_WEBHOOK_SECRET = SECRETO_PREVIO;
});

/* ---------------------------------- Tests ---------------------------------- */

describe("POST /api/mux/webhook — sin configurar", () => {
  it("sin MUX_WEBHOOK_SECRET devuelve 503 y no procesa nada", async () => {
    delete process.env.MUX_WEBHOOK_SECRET;
    const admin = useAdmin();

    const respuesta = await POST(pedido(eventoReady()));

    expect(respuesta.status).toBe(503);
    expect(admin.calls).toEqual([]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/mux/webhook — la firma es la única autorización", () => {
  it("sin header de firma: 401 y cero writes", async () => {
    const admin = useAdmin();
    const respuesta = await POST(
      new Request("https://dominicanos.com/api/mux/webhook", {
        method: "POST",
        body: JSON.stringify(eventoReady()),
      }),
    );
    expect(respuesta.status).toBe(401);
    expect(admin.calls).toEqual([]);
  });

  it("con firma de otro secreto: 401 y cero writes", async () => {
    const admin = useAdmin();
    const respuesta = await POST(pedido(eventoReady(), { secreto: "secreto-del-atacante" }));
    expect(respuesta.status).toBe(401);
    expect(admin.calls).toEqual([]);
  });

  it("con firma vencida (replay de una entrega vieja): 401 y cero writes", async () => {
    const admin = useAdmin();
    const haceMediaHora = Date.now() - 30 * 60 * 1000;
    const respuesta = await POST(pedido(eventoReady(), { timestampMs: haceMediaHora }));
    expect(respuesta.status).toBe(401);
    expect(admin.calls).toEqual([]);
  });

  it("si el body fue manipulado después de firmarse: 401", async () => {
    const admin = useAdmin();
    const original = pedido(eventoReady());
    const manipulado = new Request(original.url, {
      method: "POST",
      headers: original.headers,
      body: JSON.stringify(eventoReady({ playback_ids: [{ id: "playback-AJENO", policy: "public" }] })),
    });
    expect((await POST(manipulado)).status).toBe(401);
    expect(admin.calls).toEqual([]);
  });

  it("firma válida pero body que no es JSON: 400 (y tampoco escribe)", async () => {
    const admin = useAdmin();
    const body = "esto no es json";
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac("sha256", SECRETO).update(`${t}.${body}`).digest("hex");
    const respuesta = await POST(
      new Request("https://dominicanos.com/api/mux/webhook", {
        method: "POST",
        headers: { "mux-signature": `t=${t},v1=${v1}` },
        body,
      }),
    );
    expect(respuesta.status).toBe(400);
    expect(admin.calls).toEqual([]);
  });
});

describe("POST /api/mux/webhook — video.asset.ready", () => {
  it("deja la publicación lista y marca el evento procesado con su tenant", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    const respuesta = await POST(pedido(eventoReady()));

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toEqual({ received: true });

    const parche = admin.calls.find((c) => c.table === "posts" && c.method === "update");
    expect(parche?.args[0]).toEqual({
      mux_status: "ready",
      mux_asset_id: "asset-1",
      mux_playback_id: "playback-1",
      // 3 decimales: la precisión de `posts.mux_duration_seconds`.
      mux_duration_seconds: 42.123,
    });

    // El tenant sale de la publicación tocada, JAMÁS del payload.
    const cierre = admin.calls.filter(
      (c) => c.table === "mux_webhook_events" && c.method === "update",
    );
    expect(cierre.at(-1)?.args[0]).toEqual({ processed: true, tenant_id: "tenant-1" });
  });

  it("correlaciona por mux_upload_id, que es el id que guardó nuestro servidor", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    await POST(pedido(eventoReady()));

    const filtro = admin.calls.find(
      (c) => c.table === "posts" && c.method === "eq" && c.args[0] === "mux_upload_id",
    );
    expect(filtro?.args[1]).toBe("upload-1");
  });

  it("NO guarda un playback id que no sea público", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    const respuesta = await POST(
      pedido(eventoReady({ playback_ids: [{ id: "playback-firmado", policy: "signed" }] })),
    );

    // 200 igual (Mux no tiene que reintentar), pero la publicación no se toca:
    // un playback firmado guardado como público daría 403 en cada reproducción.
    expect(respuesta.status).toBe(200);
    expect(tocó(admin, "posts", "update")).toBe(false);
  });

  it("un video sin duración se guarda igual, sin inventarla", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    await POST(pedido(eventoReady({ duration: undefined })));

    const parche = admin.calls.find((c) => c.table === "posts" && c.method === "update");
    expect(parche?.args[0]).not.toHaveProperty("mux_duration_seconds");
    expect(parche?.args[0]).toMatchObject({ mux_status: "ready" });
  });

  it("no resucita un video ya dado por perdido: el gate de estado excluye 'errored'", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    await POST(pedido(eventoReady()));

    const gate = admin.calls.find(
      (c) => c.table === "posts" && c.method === "in" && c.args[0] === "mux_status",
    );
    expect(gate?.args[1]).toEqual(["uploading", "processing", "ready"]);
  });
});

describe("POST /api/mux/webhook — `passthrough` es dato de afuera", () => {
  it("sin upload_id, el camino por passthrough exige que la fila ya esté en el circuito de Mux", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    await POST(
      pedido(
        eventoReady({
          upload_id: undefined,
          passthrough: "01924f3a-7c1e-7a2b-9f10-3d4e5f6a7b8c",
        }),
      ),
    );

    // El UPDATE por passthrough lleva `mux_upload_id is not null`: una
    // publicación que nunca pasó por Mux no puede ser tocada por un evento.
    const guardia = admin.calls.find((c) => c.table === "posts" && c.method === "not");
    expect(guardia?.args).toEqual(["mux_upload_id", "is", null]);
  });

  it("un passthrough que no es uuid ni se intenta (sería un error de Postgres, no un 'no encontré')", async () => {
    const admin = useAdmin({ posts: { update: NINGUNA_FILA } });

    const respuesta = await POST(
      pedido(eventoReady({ upload_id: undefined, passthrough: "'; drop table posts; --" })),
    );

    expect(respuesta.status).toBe(200);
    expect(tocó(admin, "posts", "update")).toBe(false);
  });

  it("un evento que no correlaciona con nada responde 200 y no rompe", async () => {
    const admin = useAdmin({ posts: { update: NINGUNA_FILA } });

    const respuesta = await POST(pedido(eventoReady({ upload_id: "upload-desconocida" })));

    expect(respuesta.status).toBe(200);
    const cierre = admin.calls.filter(
      (c) => c.table === "mux_webhook_events" && c.method === "update",
    );
    // Se marca procesado, pero SIN tenant: no hubo publicación de la cual leerlo.
    expect(cierre.at(-1)?.args[0]).toEqual({ processed: true });
  });
});

describe("POST /api/mux/webhook — idempotencia con reclamo", () => {
  it("si el evento ya está reclamado por otro proceso, responde 200 y no toca la publicación", async () => {
    const admin = useAdmin({
      mux_webhook_events: { insert: EVENTO_DUPLICADO, update: RECLAMO_PERDIDO },
      posts: { update: POST_TOCADO },
    });

    const respuesta = await POST(pedido(eventoReady()));

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toEqual({ received: true, duplicated: true });
    // Lo que el reclamo compra: la segunda entrega NO reprocesa.
    expect(tocó(admin, "posts")).toBe(false);
  });

  it("un reclamo vencido (proceso que murió a mitad) sí se retoma", async () => {
    const admin = useAdmin({
      mux_webhook_events: { insert: EVENTO_DUPLICADO, update: [RECLAMO_GANADO, RECLAMO_GANADO] },
      posts: { update: POST_TOCADO },
    });

    const respuesta = await POST(pedido(eventoReady()));

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toEqual({ received: true });
    expect(tocó(admin, "posts", "update")).toBe(true);
  });

  it("el reclamo se toma con la ventana de 5 minutos, no con `processed` a secas", async () => {
    const admin = useAdmin({
      mux_webhook_events: { insert: EVENTO_DUPLICADO, update: [RECLAMO_GANADO, RECLAMO_GANADO] },
      posts: { update: POST_TOCADO },
    });

    await POST(pedido(eventoReady()));

    const condicion = admin.calls.find(
      (c) => c.table === "mux_webhook_events" && c.method === "or",
    );
    expect(String(condicion?.args[0])).toMatch(/^claimed_at\.is\.null,claimed_at\.lt\./);
  });

  it("el INSERT deja el evento ya reclamado, para que la carrera se resuelva ahí", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    await POST(pedido(eventoReady()));

    const insert = admin.calls.find(
      (c) => c.table === "mux_webhook_events" && c.method === "insert",
    );
    expect(insert?.args[0]).toMatchObject({
      provider: "mux",
      event_id: "evt-ready-1",
      event_type: "video.asset.ready",
    });
  });

  it("un error de base que no es 23505 devuelve 500 sin tocar la publicación", async () => {
    const admin = useAdmin({
      mux_webhook_events: { insert: { data: null, error: { code: "XX000" } } },
      posts: { update: POST_TOCADO },
    });

    const respuesta = await POST(pedido(eventoReady()));

    expect(respuesta.status).toBe(500);
    expect(tocó(admin, "posts")).toBe(false);
  });
});

describe("POST /api/mux/webhook — el resto de los eventos", () => {
  it("video.upload.asset_created guarda el asset y pasa a 'processing', sólo desde 'uploading'", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    const respuesta = await POST(
      pedido({
        id: "evt-created-1",
        type: "video.upload.asset_created",
        data: { id: "upload-1", asset_id: "asset-1", status: "asset_created" },
      }),
    );

    expect(respuesta.status).toBe(200);
    const parche = admin.calls.find((c) => c.table === "posts" && c.method === "update");
    expect(parche?.args[0]).toEqual({ mux_status: "processing", mux_asset_id: "asset-1" });
    // Fuera de orden: si `ready` llegó primero, esto no lo devuelve a "procesando".
    const gate = admin.calls.find(
      (c) => c.table === "posts" && c.method === "in" && c.args[0] === "mux_status",
    );
    expect(gate?.args[1]).toEqual(["uploading"]);
  });

  it("video.asset.errored marca la publicación como fallida", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    await POST(
      pedido({
        id: "evt-err-1",
        type: "video.asset.errored",
        data: { id: "asset-1", upload_id: "upload-1", passthrough: "post-1" },
      }),
    );

    const parche = admin.calls.find((c) => c.table === "posts" && c.method === "update");
    expect(parche?.args[0]).toEqual({ mux_status: "errored" });
  });

  it("video.upload.cancelled marca fallida una subida que nunca llegó", async () => {
    const admin = useAdmin({ posts: { update: POST_TOCADO } });

    await POST(
      pedido({
        id: "evt-cancel-1",
        type: "video.upload.cancelled",
        data: { id: "upload-1", status: "cancelled" },
      }),
    );

    const parche = admin.calls.find((c) => c.table === "posts" && c.method === "update");
    expect(parche?.args[0]).toEqual({ mux_status: "errored" });
  });

  it("un evento que no manejamos se acepta, se registra y no toca ninguna publicación", async () => {
    const admin = useAdmin();

    const respuesta = await POST(
      pedido({ id: "evt-track-1", type: "video.asset.track.ready", data: { id: "track-1" } }),
    );

    expect(respuesta.status).toBe(200);
    expect(tocó(admin, "posts")).toBe(false);
    expect(tocó(admin, "mux_webhook_events", "insert")).toBe(true);
  });

  it("un evento sin id o sin type se rechaza con 400 antes de registrarlo", async () => {
    const admin = useAdmin();
    expect((await POST(pedido({ type: "video.asset.ready", data: {} }))).status).toBe(400);
    expect((await POST(pedido({ id: "evt-1", data: {} }))).status).toBe(400);
    expect(admin.calls).toEqual([]);
  });
});

describe("POST /api/mux/webhook — cuando el handler falla", () => {
  it("suelta el reclamo además de guardar el error, para que el reintento no espere 5 minutos", async () => {
    const admin = useAdmin({
      posts: { update: { data: null, error: { code: "XX000" } } },
    });

    const respuesta = await POST(pedido(eventoReady()));

    expect(respuesta.status).toBe(500);
    const cierre = admin.calls.filter(
      (c) => c.table === "mux_webhook_events" && c.method === "update",
    );
    expect(cierre.at(-1)?.args[0]).toMatchObject({ processed: false, claimed_at: null });
  });
});
