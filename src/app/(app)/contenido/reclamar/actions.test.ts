import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * ABRIR UN RECLAMO — las reglas que importan, verificadas en el BACKEND
 * =============================================================================
 *
 * Que el formulario no se dibuje para cierto caso no prueba nada: una server
 * action es un endpoint POST al que se le puede pegar sin pasar por la UI (lo
 * dice la propia guía de Next). Lo que se fija acá:
 *
 *  1. Nadie reclama contenido PROPIO — y se corta ANTES de la RPC, con un
 *     mensaje humano en vez del `check_violation` crudo de la base.
 *  2. Un link de evidencia con esquema peligroso (`javascript:`, `data:`) no
 *     llega nunca a la base. Ese string terminaría en un `href` del panel de
 *     moderación, o sea en un click de alguien con permisos de staff.
 *  3. Un reclamo duplicado no crea otro: el índice único parcial de la 0086 ya
 *     lo impide, pero la app lo dice con palabras y no con un 23505.
 *  4. La action NUNCA lanza. Un throw acá sería la pantalla de error de Next
 *     sobre un formulario que la persona acaba de escribir entero.
 *  5. `tenant_id` y `claimant_id` no viajan jamás en el payload de la RPC: los
 *     deriva la función del lado servidor. Mandarlos a mano no cambia nada.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({
  DAY_MS: 86_400_000,
  HOUR_MS: 3_600_000,
  limit: mocks.limit,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { abrirReclamoDeContenido, type ReclamoState } from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "77777777-7777-4777-8777-777777777777";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_USER = "88888888-8888-4888-8888-888888888888";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const DISPUTE_ID = "55555555-5555-4555-8555-555555555555";

const IDLE: ReclamoState = { status: "idle" };

const VALID_TEXT =
  "La foto la saqué yo en marzo y la publiqué en mi perfil el 12 de abril, tengo el original.";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

interface StubConfig {
  /** Fila que devuelve `content_assets` (RLS: sólo si el asset es MÍO). */
  ownAsset?: { id: string; uploader_id: string } | null;
  assetError?: { message: string } | null;
  /** Disputas vivas propias sobre el mismo asset. */
  liveDisputes?: { id: string }[];
  liveError?: { message: string } | null;
  rpcResult?: { data: unknown; error: { code?: string; message: string } | null };
}

/** Query builder falso, encadenable y thenable (patrón del repo). */
function createSupabaseStub(config: StubConfig = {}) {
  const calls: RecordedCall[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    const record = (method: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.fn((...args: any[]) => {
        calls.push({ table, method, args });
        return builder;
      });

    const result = () => {
      if (table === "content_assets") {
        return { data: config.ownAsset ?? null, error: config.assetError ?? null };
      }
      return { data: config.liveDisputes ?? [], error: config.liveError ?? null };
    };

    builder.select = record("select");
    builder.eq = record("eq");
    builder.in = record("in");
    builder.order = record("order");
    builder.limit = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "limit", args });
      return Promise.resolve(result());
    });
    builder.maybeSingle = vi.fn(async () => result());
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  });

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return config.rpcResult ?? { data: DISPUTE_ID, error: null };
  });

  return { client: { from, rpc }, from, rpc, calls, rpcCalls };
}

/**
 * No se llama `useGuardOk` como en los tests hermanos a propósito: acá se
 * invoca dentro de un `for` (un caso por esquema peligroso), y el prefijo `use`
 * hace que `react-hooks/rules-of-hooks` lo trate como un hook llamado en loop.
 */
function mountGuard(config: StubConfig = {}) {
  const stub = createSupabaseStub(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos", currency: "USD" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

function claimForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("assetId", ASSET_ID);
  fd.set("claimKind", "autoria");
  fd.set("claimText", VALID_TEXT);
  fd.set("confirmed", "true");
  for (const [key, value] of Object.entries(over)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 4, retryAfterMs: 0 });
});

/* ---------------------------------- Tests --------------------------------- */

describe("abrirReclamoDeContenido — nadie reclama lo suyo", () => {
  it("si el asset es visible y el uploader soy yo, corta antes de la RPC", async () => {
    // `content_assets_select` (0061) sólo devuelve fila al uploader o al staff:
    // que la consulta traiga algo con mi uuid ES la prueba de que es mío.
    const stub = mountGuard({ ownAsset: { id: ASSET_ID, uploader_id: USER_ID } });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("lo subiste vos") });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("si la fila visible es de OTRA persona (soy staff), el reclamo sigue su curso", async () => {
    const stub = mountGuard({ ownAsset: { id: ASSET_ID, uploader_id: OTHER_USER } });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state.status).toBe("success");
    expect(stub.rpc).toHaveBeenCalledTimes(1);
  });

  it("el check_violation de la RPC sobre contenido propio se traduce a copy humano", async () => {
    // Camino de defensa en profundidad: si el pre-chequeo no aplica (asset
    // ajeno para la RLS pero inadmisible para `app.disputa_admisible`), la RPC
    // corta igual y la app no muestra un errcode.
    const stub = mountGuard({
      rpcResult: {
        data: null,
        error: { code: "23514", message: "No se puede abrir una disputa sobre ese contenido" },
      },
    });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("No encontramos") });
    expect(stub.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("abrirReclamoDeContenido — evidencia", () => {
  it("un link con esquema peligroso se rechaza y no se llama a la base", async () => {
    for (const bad of [
      "javascript:alert(document.cookie)",
      "data:text/html,<script>1</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "no-soy-una-url",
    ]) {
      const stub = mountGuard();
      const state = await abrirReclamoDeContenido(IDLE, claimForm({ evidence: bad }));

      expect(state.status, bad).toBe("error");
      expect(stub.rpc, bad).not.toHaveBeenCalled();
    }
  });

  it("un link peligroso escondido entre links válidos también corta", async () => {
    const stub = mountGuard();
    const state = await abrirReclamoDeContenido(
      IDLE,
      claimForm({ evidence: "https://ok.example/a\njavascript:alert(1)\nhttps://ok.example/b" }),
    );

    expect(state.status).toBe("error");
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("los links válidos llegan como array, deduplicados y en orden", async () => {
    const stub = mountGuard();
    const state = await abrirReclamoDeContenido(
      IDLE,
      claimForm({ evidence: " https://a.example/1 \nhttp://b.example/2\nhttps://a.example/1\n\n" }),
    );

    expect(state.status).toBe("success");
    expect(stub.rpcCalls[0].args.p_evidence_urls).toEqual([
      "https://a.example/1",
      "http://b.example/2",
    ]);
  });

  it("más de 10 links se rechazan acá, no con un 23514 crudo del CHECK", async () => {
    const stub = mountGuard();
    const evidence = Array.from({ length: 11 }, (_, i) => `https://e.example/${i}`).join("\n");

    const state = await abrirReclamoDeContenido(IDLE, claimForm({ evidence }));

    expect(state.status).toBe("error");
    expect(stub.rpc).not.toHaveBeenCalled();
  });
});

describe("abrirReclamoDeContenido — duplicados", () => {
  it("con un reclamo vivo propio sobre el mismo asset no se crea otro", async () => {
    const stub = mountGuard({ liveDisputes: [{ id: DISPUTE_ID }] });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("Ya tenés un reclamo abierto") });
    expect(stub.rpc).not.toHaveBeenCalled();
    // El filtro tiene que viajar EN la query: los estados vivos son los tres del
    // índice único parcial, no "todos menos resuelta".
    expect(stub.calls).toContainEqual({
      table: "content_disputes",
      method: "in",
      args: ["status", ["abierta", "en_revision", "apelada"]],
    });
  });

  it("un 23505 de la base (dos envíos a la par) también se traduce", async () => {
    mountGuard({
      rpcResult: { data: null, error: { code: "23505", message: "duplicate key value" } },
    });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state).toMatchObject({
      status: "error",
      message: expect.stringContaining("Ya tenés un reclamo abierto"),
    });
  });
});

describe("abrirReclamoDeContenido — nunca lanza", () => {
  it("un error de la base al leer el asset devuelve status error, no un throw", async () => {
    const stub = mountGuard({ assetError: { message: "connection reset" } });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state.status).toBe("error");
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("un error inesperado de la RPC devuelve status error", async () => {
    mountGuard({
      rpcResult: { data: null, error: { code: "XX000", message: "internal error" } },
    });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state).toMatchObject({ status: "error", message: expect.stringContaining("no es tu culpa") });
  });

  it("si el guard mismo explota, la action devuelve error en vez de propagar", async () => {
    mocks.requireTenantMatch.mockRejectedValue(new Error("supabase caído"));

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state.status).toBe("error");
  });
});

describe("abrirReclamoDeContenido — validación y aislamiento", () => {
  it("sin la confirmación marcada no se toca la base", async () => {
    const stub = mountGuard();
    const fd = claimForm();
    fd.delete("confirmed");

    const state = await abrirReclamoDeContenido(IDLE, fd);

    expect(state.status).toBe("error");
    expect(stub.rpc).not.toHaveBeenCalled();
    // Ni siquiera se consume cuota: la validación de forma va antes del guard.
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("un claim_kind inventado no pasa (espeja el CHECK de la 0086)", async () => {
    const stub = mountGuard();

    const state = await abrirReclamoDeContenido(IDLE, claimForm({ claimKind: "porque_si" }));

    expect(state.status).toBe("error");
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("un relato de dos palabras se rechaza con copy, no con un insert vacío", async () => {
    const stub = mountGuard();

    const state = await abrirReclamoDeContenido(IDLE, claimForm({ claimText: "es mio" }));

    expect(state.status).toBe("error");
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("un tenant_id o claimant_id inyectados en el formulario NO viajan a la RPC", async () => {
    const stub = mountGuard();
    const fd = claimForm();
    fd.set("tenant_id", OTHER_TENANT);
    fd.set("tenantId", OTHER_TENANT);
    fd.set("claimant_id", OTHER_USER);

    const state = await abrirReclamoDeContenido(IDLE, fd);

    expect(state.status).toBe("success");
    expect(stub.rpcCalls[0].name).toBe("abrir_disputa_de_contenido");
    expect(Object.keys(stub.rpcCalls[0].args).sort()).toEqual([
      "p_asset_id",
      "p_claim_kind",
      "p_claim_text",
      "p_evidence_urls",
    ]);
  });

  it("con la cuota diaria agotada no se lee ni se escribe nada", async () => {
    const stub = mountGuard();
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state.status).toBe("error");
    expect(mocks.limit).toHaveBeenCalledWith(`reclamo-contenido:${USER_ID}`, 5, 86_400_000);
    expect(stub.from).not.toHaveBeenCalled();
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("sin sesión no se consume cuota ni se toca la base", async () => {
    const stub = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "entrá",
      tenant: { id: TENANT_ID },
      supabase: stub.client,
      user: null,
    });

    const state = await abrirReclamoDeContenido(IDLE, claimForm());

    expect(state.status).toBe("error");
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(stub.rpc).not.toHaveBeenCalled();
  });
});
