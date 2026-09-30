import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));

import { resolveModerationItem } from "./actions";

type Op = {
  table: string;
  action: "select" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
};
type Respuesta = { data: unknown; error: { code: string } | null };

function fakeClient(responder: (op: Op) => Respuesta) {
  const ops: Op[] = [];
  const client = {
    ops,
    from(table: string) {
      const op: Op = { table, action: "select", filters: [] };
      ops.push(op);
      const builder = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          op.action = "update";
          op.payload = payload;
          return builder;
        },
        delete: () => {
          op.action = "delete";
          return builder;
        },
        eq: (col: string, val: unknown) => {
          op.filters.push(["eq", col, val]);
          return builder;
        },
        in: (col: string, val: unknown) => {
          op.filters.push(["in", col, val]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(responder(op)),
        then: (res: (r: Respuesta) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(responder(op)).then(res, rej),
      };
      return builder;
    },
  };
  return client;
}

const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "22222222-2222-4222-8222-222222222222",
  subject_kind: "listing",
  subject_id: "33333333-3333-4333-8333-333333333333",
  tier: 3,
  status: "pending",
};

const FECHAS = {
  expires_at: "2026-10-20T00:00:00.000Z",
  expiry_warn_at: "2026-10-17T00:00:00.000Z",
  expiry_warned_at: null,
};

function form(decision: "approve" | "reject") {
  const fd = new FormData();
  fd.set("itemId", ITEM.id);
  fd.set("decision", decision);
  return fd;
}

function staffCon(aviso: Record<string, unknown> | null) {
  return fakeClient((op) => {
    if (op.table === "moderation_queue" && op.action === "select") return { data: ITEM, error: null };
    if (op.table === "moderation_queue") return { data: { id: ITEM.id }, error: null };
    if (op.table === "listings" && op.action === "select") return { data: aviso, error: null };
    return { data: { id: ITEM.subject_id }, error: null };
  });
}

const updatesDeAvisos = (c: ReturnType<typeof fakeClient>) =>
  c.ops.filter((o) => o.table === "listings" && o.action === "update");

let admin: ReturnType<typeof fakeClient>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  admin = fakeClient(() => ({ data: null, error: null }));
  mocks.createAdminClient.mockReturnValue(admin);
  mocks.logAdminAction.mockResolvedValue(undefined);
});

describe("aprobar un aviso desde la cola", () => {
  it("la primera publicación estrena published_at y deja el vencimiento al trigger", async () => {
    const staff = staffCon({ status: "pending_review", published_at: null, ...FECHAS });
    mocks.getStaffContext.mockResolvedValue({ supabase: staff, user: { id: "staff" } });

    const r = await resolveModerationItem({ status: "idle" }, form("approve"));

    expect(r).toEqual({ status: "success" });
    const [update] = updatesDeAvisos(staff);
    expect(update.payload).toMatchObject({ status: "published" });
    expect(typeof update.payload?.published_at).toBe("string");
    expect(updatesDeAvisos(admin)).toHaveLength(0);
  });

  it("un aviso que ya estuvo publicado no recibe published_at nuevo: sería un boost gratis", async () => {
    const staff = staffCon({
      status: "pending_review",
      published_at: "2026-09-01T00:00:00.000Z",
      ...FECHAS,
    });
    mocks.getStaffContext.mockResolvedValue({ supabase: staff, user: { id: "staff" } });

    await resolveModerationItem({ status: "idle" }, form("approve"));

    const [update] = updatesDeAvisos(staff);
    expect(update.payload).toEqual({ status: "published" });
  });

  it("y se le repone el vencimiento previo con el admin client, que la guarda de la 0178 deja pasar", async () => {
    const staff = staffCon({
      status: "pending_review",
      published_at: "2026-09-01T00:00:00.000Z",
      ...FECHAS,
    });
    mocks.getStaffContext.mockResolvedValue({ supabase: staff, user: { id: "staff" } });

    await resolveModerationItem({ status: "idle" }, form("approve"));

    const [repone] = updatesDeAvisos(admin);
    expect(repone.payload).toEqual(FECHAS);
    expect(repone.filters).toEqual(
      expect.arrayContaining([
        ["eq", "id", ITEM.subject_id],
        ["eq", "tenant_id", ITEM.tenant_id],
        ["eq", "status", "published"],
      ]),
    );
  });

  it("si el aviso ya estaba publicado (foto monitoreada) no hay transición y no se toca el vencimiento", async () => {
    const staff = staffCon({
      status: "published",
      published_at: "2026-09-01T00:00:00.000Z",
      ...FECHAS,
    });
    mocks.getStaffContext.mockResolvedValue({ supabase: staff, user: { id: "staff" } });

    await resolveModerationItem({ status: "idle" }, form("approve"));

    expect(updatesDeAvisos(staff)[0].payload).toEqual({ status: "published" });
    expect(updatesDeAvisos(admin)).toHaveLength(0);
  });

  it("rechazar sigue dando de baja el aviso", async () => {
    const staff = staffCon({ status: "pending_review", published_at: null, ...FECHAS });
    mocks.getStaffContext.mockResolvedValue({ supabase: staff, user: { id: "staff" } });

    await resolveModerationItem({ status: "idle" }, form("reject"));

    expect(updatesDeAvisos(staff)[0].payload).toEqual({ status: "removed" });
  });
});
