import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  createAdminClient: vi.fn(),
  requestPhoneVerification: vi.fn(),
  consumeAndBind: vi.fn(),
  removeVerifiedPhone: vi.fn(),
  send: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/config/services", () => ({
  isPhoneVerificationEnabled: true,
  isPhonePepperConfigured: true,
  isSmsConfigured: true,
}));
vi.mock("@/lib/phone/sms", () => ({
  getSmsSender: () => ({ name: "test", send: mocks.send }),
  verificationSmsBody: () => "código",
}));
vi.mock("@/lib/phone/verification", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/phone/verification")>();
  return {
    ...original,
    requestPhoneVerification: mocks.requestPhoneVerification,
    consumeAndBind: mocks.consumeAndBind,
    removeVerifiedPhone: mocks.removeVerifiedPhone,
  };
});

import { removePhoneAction, sendPhoneCodeAction, verifyPhoneCodeAction } from "./actions";

const TENANT = { id: "11111111-1111-1111-1111-111111111111", name: "Comunidad Latina" };
const USER = { id: "22222222-2222-2222-2222-222222222222" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PHONE_CODE_PEPPER", "pepper-de-prueba");
  mocks.createAdminClient.mockReturnValue({ from: vi.fn(), rpc: vi.fn() });
  mocks.requireTenantMatch.mockResolvedValue({ ok: true, tenant: TENANT, user: USER, supabase: {} });
  mocks.requestPhoneVerification.mockResolvedValue({ status: "send", code: "123456" });
  mocks.consumeAndBind.mockResolvedValue("ok");
  mocks.removeVerifiedPhone.mockResolvedValue(true);
  mocks.send.mockResolvedValue({ ok: true });
});

describe("acciones de teléfono", () => {
  it("corta una divergencia de tenant antes del admin client", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "tenant-mismatch",
      message: "Comunidad distinta",
      tenant: TENANT,
      user: USER,
      supabase: {},
    });

    const result = await sendPhoneCodeAction({ phone: "+19175550142" });

    expect(result).toEqual({ ok: false, formError: "Comunidad distinta" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.requestPhoneVerification).not.toHaveBeenCalled();
  });

  it("no consulta user_phones y reserva el intento con una RPC", async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() };
    mocks.createAdminClient.mockReturnValue(admin);

    await sendPhoneCodeAction({ phone: "+19175550142" });

    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.requestPhoneVerification).toHaveBeenCalledWith(admin, TENANT.id, {
      phone: "+19175550142",
      profileId: USER.id,
      pepper: "pepper-de-prueba",
    });
  });

  it("ante un número ocupado responde igual que si hubiera enviado y no manda SMS", async () => {
    mocks.requestPhoneVerification.mockResolvedValue({ status: "accepted" });

    const result = await sendPhoneCodeAction({ phone: "+19175550142" });

    expect(result).toEqual({ ok: true, maskedPhone: "+191 ••• 0142" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("verifica teléfono e insignia mediante una única RPC", async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() };
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await verifyPhoneCodeAction({ phone: "+19175550142", code: "123456" });

    expect(result).toEqual({ ok: true });
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.consumeAndBind).toHaveBeenCalledWith(admin, TENANT.id, {
      phone: "+19175550142",
      profileId: USER.id,
      code: "123456",
      pepper: "pepper-de-prueba",
    });
  });

  it("quita teléfono e insignia mediante una única RPC", async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() };
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await removePhoneAction();

    expect(result).toEqual({ ok: true });
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.removeVerifiedPhone).toHaveBeenCalledWith(admin, TENANT.id, USER.id);
  });
});
