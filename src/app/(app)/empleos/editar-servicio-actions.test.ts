import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editar un SERVICIO propio.
 *
 * Lo que se fija:
 *  1. OWNERSHIP: la lectura y la escritura viajan con tenant, dueño y
 *     kind='service'. Un aviso ajeno responde "no es tuya" y no escribe nada.
 *  2. La escritura del dueño JAMÁS lleva `published` (la RLS lo rebota); volver
 *     a publicado lo hace el admin client, y sólo si el aviso ya estaba a la
 *     vista y el texto pasó la moderación.
 *  3. Un pausado sigue pausado; uno sin cambios no se manda a revisión.
 *  4. Valida con el MISMO esquema que el alta.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  moderateText: vi.fn(),
  moderationTier: vi.fn(),
  enqueueModeration: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  fetchVideoDeAviso: vi.fn(),
  validarVideoDeAviso: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ DAY_MS: 86_400_000, limit: mocks.limit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/moderation", () => ({
  TIER_AUTO: 1,
  TIER_REVIEW: 2,
  TIER_HUMAN: 3,
  moderateText: mocks.moderateText,
  moderationTier: mocks.moderationTier,
  enqueueModeration: mocks.enqueueModeration,
}));
vi.mock("@/lib/media/listing-video-queries", () => ({
  fetchVideoDeAviso: mocks.fetchVideoDeAviso,
}));
vi.mock("@/lib/media/listing-video-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/listing-video-server")>()),
  validarVideoDeAviso: mocks.validarVideoDeAviso,
}));

import { cargarServicioParaEditar, editarServicioAction } from "./editar-servicio-actions";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"select" | "update", OpResult>>;
interface RecordedCall {
  method: string;
  args: unknown[];
}

function createStub(config: TableOps = {}) {
  const calls: RecordedCall[] = [];
  let op: keyof TableOps | null = null;
  const result = () => (op ? (config[op] ?? { data: null, error: null }) : { data: null, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: vi.fn((...args: unknown[]) => {
      calls.push({ method: "select", args });
      op = op ?? "select";
      return builder;
    }),
    update: vi.fn((...args: unknown[]) => {
      calls.push({ method: "update", args });
      op = "update";
      return builder;
    }),
    eq: vi.fn((...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return builder;
    }),
    in: vi.fn((...args: unknown[]) => {
      calls.push({ method: "in", args });
      return builder;
    }),
    maybeSingle: vi.fn(async () => result()),
    then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
  return { client: { from: vi.fn(() => builder) }, calls };
}

function useGuardOk(config: TableOps) {
  const stub = createStub(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos", currency: "USD" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

const FECHAS_PREVIAS = {
  expires_at: "2026-10-20T00:00:00.000Z",
  expiry_warn_at: "2026-10-17T00:00:00.000Z",
  expiry_warned_at: null,
};

function adminStub(result: OpResult = { data: { id: LISTING_ID }, error: null }) {
  const stub = createStub({ select: { data: FECHAS_PREVIAS, error: null }, update: result });
  mocks.createAdminClient.mockReturnValue(stub.client);
  return stub;
}

function filaServicio(extra: Record<string, unknown> = {}) {
  return {
    id: LISTING_ID,
    kind: "service",
    status: "published",
    title: "Jardinería y corte de pasto",
    description: "Corto el pasto, podo y limpio patios. Llevo mi propia máquina.",
    price_amount: 25,
    price_period: "hour",
    area_label: "Corona, Queens",
    work_mode: "presencial",
    attrs: { work_days: ["sat", "sun"], schedule: "de 8 a 14" },
    ...extra,
  };
}

const ENTRADA = {
  listingId: LISTING_ID,
  title: "Jardinería y corte de pasto",
  description: "Corto el pasto, podo y limpio patios. Llevo mi propia máquina.",
  priceAmount: 25,
  payPeriod: "hour" as const,
  workMode: "presencial" as const,
  areaLabel: "Corona, Queens",
  days: ["sat", "sun"],
  schedule: "de 8 a 14",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 39, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({ flagged: false, score: 0, categories: [], skipped: false });
  mocks.moderationTier.mockReturnValue(1);
  mocks.enqueueModeration.mockResolvedValue({ ok: true });
  mocks.fetchVideoDeAviso.mockResolvedValue({ tier: "free", video: null });
  mocks.validarVideoDeAviso.mockResolvedValue({ ok: true, columns: null });
  adminStub();
});

describe("cargarServicioParaEditar", () => {
  it("devuelve los valores del servicio propio para precargar el formulario", async () => {
    useGuardOk({ select: { data: filaServicio(), error: null } });
    const result = await cargarServicioParaEditar({ listingId: LISTING_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.servicio).toMatchObject({
      title: "Jardinería y corte de pasto",
      priceAmount: 25,
      payPeriod: "hour",
      workMode: "presencial",
      areaLabel: "Corona, Queens",
      days: ["sat", "sun"],
      schedule: "de 8 a 14",
      currency: "USD",
    });
  });

  it("un aviso ajeno (la consulta por dueño no devuelve fila) responde que no es tuyo", async () => {
    const stub = useGuardOk({ select: { data: null, error: null } });
    const result = await cargarServicioParaEditar({ listingId: LISTING_ID });
    expect(result.ok).toBe(false);
    expect(stub.calls).toContainEqual({ method: "eq", args: ["created_by", USER_ID] });
    expect(stub.calls).toContainEqual({ method: "eq", args: ["tenant_id", TENANT_ID] });
    expect(stub.calls).toContainEqual({ method: "eq", args: ["kind", "service"] });
  });
});

describe("editarServicioAction", () => {
  it("el dueño guarda: escribe los campos del servicio, nunca `published`, y el admin lo vuelve a publicar", async () => {
    const stub = useGuardOk({
      select: { data: filaServicio(), error: null },
      update: { data: { id: LISTING_ID }, error: null },
    });
    const admin = adminStub();

    const result = await editarServicioAction({
      ...ENTRADA,
      title: "Jardinería, poda y corte de pasto",
      workMode: "hibrido",
      days: ["sat"],
      schedule: null,
      priceAmount: 30,
      payPeriod: "day",
    });

    expect(result).toEqual({ ok: true, status: "published" });
    const update = stub.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({
      title: "Jardinería, poda y corte de pasto",
      work_mode: "hibrido",
      price_amount: 30,
      price_period: "day",
      area_label: "Corona, Queens",
      status: "pending_review",
    });
    const attrs = (update?.args[0] as { attrs: Record<string, unknown> }).attrs;
    expect(attrs.work_days).toEqual(["sat"]);
    expect(attrs).not.toHaveProperty("schedule");
    expect(stub.calls).toContainEqual({ method: "eq", args: ["created_by", USER_ID] });
    expect(stub.calls).toContainEqual({ method: "eq", args: ["kind", "service"] });

    const adminUpdates = admin.calls.filter((c) => c.method === "update").map((c) => c.args[0]);
    expect(adminUpdates[0]).toEqual({ status: "published" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/empleos");
  });

  it("volver a publicar no es un boost ni una renovación gratis", async () => {
    useGuardOk({
      select: { data: filaServicio(), error: null },
      update: { data: { id: LISTING_ID }, error: null },
    });
    const admin = adminStub();

    await editarServicioAction({ ...ENTRADA, title: "Jardinería y poda de árboles" });

    const adminUpdates = admin.calls.filter((c) => c.method === "update").map((c) => c.args[0]);
    expect(adminUpdates.some((u) => "published_at" in (u as object))).toBe(false);
    expect(adminUpdates[1]).toEqual(FECHAS_PREVIAS);
    expect(admin.calls).toContainEqual({ method: "eq", args: ["status", "pending_review"] });
    expect(mocks.enqueueModeration).not.toHaveBeenCalled();
  });

  it("si no se puede volver a publicar, queda en la cola en vez de huérfano", async () => {
    useGuardOk({
      select: { data: filaServicio(), error: null },
      update: { data: { id: LISTING_ID }, error: null },
    });
    adminStub({ data: null, error: { code: "XX000" } });

    const result = await editarServicioAction({ ...ENTRADA, title: "Jardinería y poda de árboles" });

    expect(result).toEqual({ ok: true, status: "pending_review" });
    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueModeration.mock.calls[0][1]).toMatchObject({
      tier: 3,
      reasons: expect.arrayContaining(["edited_listing"]),
    });
  });

  it("editado en pausa con el texto marcado entra a la cola: al reactivarlo no puede salir solo", async () => {
    useGuardOk({
      select: { data: filaServicio({ status: "paused" }), error: null },
      update: { data: { id: LISTING_ID }, error: null },
    });
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      score: 0.9,
      categories: ["scam"],
      skipped: false,
    });

    const result = await editarServicioAction({ ...ENTRADA, title: "Mandá dinero por adelantado" });

    expect(result).toEqual({ ok: true, status: "paused" });
    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);
  });

  it("un no-dueño es rechazado y no se escribe nada", async () => {
    const stub = useGuardOk({ select: { data: null, error: null } });
    const result = await editarServicioAction({ ...ENTRADA, title: "Otro título distinto" });
    expect(result).toMatchObject({ ok: false });
    expect(stub.calls.some((c) => c.method === "update")).toBe(false);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("sin sesión pide entrar", async () => {
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    const result = await editarServicioAction(ENTRADA);
    expect(result).toMatchObject({ ok: false, needsAuth: true });
  });

  it("valida igual que el alta: presencial sin zona se rechaza con el mensaje de zona", async () => {
    const stub = useGuardOk({ select: { data: filaServicio(), error: null } });
    const result = await editarServicioAction({ ...ENTRADA, areaLabel: "" });
    expect(result).toMatchObject({ ok: false });
    expect(stub.calls.length).toBe(0);
  });

  it("a distancia guarda la zona en null", async () => {
    const stub = useGuardOk({
      select: { data: filaServicio(), error: null },
      update: { data: { id: LISTING_ID }, error: null },
    });
    await editarServicioAction({ ...ENTRADA, workMode: "remoto", areaLabel: "Corona" });
    const update = stub.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({ work_mode: "remoto", area_label: null });
  });

  it("sin cambios no toca la fila ni la manda a revisión", async () => {
    const stub = useGuardOk({ select: { data: filaServicio(), error: null } });
    const result = await editarServicioAction(ENTRADA);
    expect(result).toMatchObject({ ok: true, sinCambios: true, status: "published" });
    expect(stub.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("si la moderación marca el texto queda en revisión y se encola para una persona", async () => {
    useGuardOk({
      select: { data: filaServicio(), error: null },
      update: { data: { id: LISTING_ID }, error: null },
    });
    const admin = adminStub();
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      score: 0.9,
      categories: ["scam"],
      skipped: false,
    });

    const result = await editarServicioAction({ ...ENTRADA, title: "Mandá dinero por adelantado" });

    expect(result).toEqual({ ok: true, status: "pending_review" });
    expect(admin.calls.some((c) => c.method === "update")).toBe(false);
    expect(mocks.enqueueModeration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ subjectId: LISTING_ID, tier: 3 }),
    );
  });

  it("un servicio pausado sigue pausado al editarse", async () => {
    const stub = useGuardOk({
      select: { data: filaServicio({ status: "paused" }), error: null },
      update: { data: { id: LISTING_ID }, error: null },
    });
    const result = await editarServicioAction({ ...ENTRADA, title: "Jardinería y poda de árboles" });
    expect(result).toEqual({ ok: true, status: "paused" });
    const update = stub.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "paused" });
  });

  it("uno en revisión no se publica solo porque se lo edita", async () => {
    useGuardOk({
      select: { data: filaServicio({ status: "pending_review" }), error: null },
      update: { data: { id: LISTING_ID }, error: null },
    });
    const admin = adminStub();
    const result = await editarServicioAction({ ...ENTRADA, title: "Jardinería y poda de árboles" });
    expect(result).toEqual({ ok: true, status: "pending_review" });
    expect(admin.calls.some((c) => c.method === "update")).toBe(false);
    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);
  });

  it("pausado por denuncias no se edita", async () => {
    useGuardOk({
      select: {
        data: filaServicio({ status: "paused", attrs: { paused_reason: "reports" } }),
        error: null,
      },
    });
    const result = await editarServicioAction({ ...ENTRADA, title: "Jardinería y poda de árboles" });
    expect(result).toMatchObject({ ok: false });
  });
});
