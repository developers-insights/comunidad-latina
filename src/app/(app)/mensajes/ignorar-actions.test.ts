import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/notifications/solicitud-server", () => ({ avisarAceptacion: vi.fn() }));
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmailInBackground: vi.fn() }));
vi.mock("@/lib/email/recipients", () => ({ getRecipientEmail: vi.fn() }));
vi.mock("@/lib/email/templates", () => ({ newMessageEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { ignoreConversationAction } from "./actions";

const CONV = "55555555-5555-4555-8555-555555555555";

function stub(respuesta: { data: unknown; error: { code: string } | null }) {
  const rpc = vi.fn(async () => respuesta);
  const update = vi.fn();
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "yo" } } }) },
    rpc,
    from: () => ({ update }),
  });
  return { rpc, update };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ignoreConversationAction", () => {
  it("descarta la solicitud: no la bloquea", async () => {
    const { rpc, update } = stub({ data: "declined", error: null });

    const r = await ignoreConversationAction(CONV);

    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("descartar_solicitud", { p_conversation_id: CONV });
    expect(update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mensajes");
  });

  it("si ya la habían aceptado no dice que la eliminó", async () => {
    stub({ data: "accepted", error: null });
    expect(await ignoreConversationAction(CONV)).toEqual({ ok: false, code: "error" });
  });

  it("si la RPC falla devuelve error", async () => {
    stub({ data: null, error: { code: "P0001" } });
    expect(await ignoreConversationAction(CONV)).toEqual({ ok: false, code: "error" });
  });
});
