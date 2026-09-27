import { describe, expect, it, vi } from "vitest";

const page = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: page.redirect,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/config/services", () => ({ isPhoneVerificationEnabled: true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: vi.fn() }));

describe("la home es pública", () => {
  it("next.config ya no manda / al login", async () => {
    const { default: config } = await import("../../next.config");
    const redirects = (await config.redirects?.()) ?? [];

    expect(redirects.find((r) => r.source === "/")).toBeUndefined();
  }, 30_000);

  it("una ruta privada sigue mandando al anónimo a /entrar", async () => {
    const { default: TelefonoAjustesPage } = await import("./(app)/ajustes/telefono/page");

    await expect(TelefonoAjustesPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(page.redirect).toHaveBeenCalledWith("/entrar?next=/ajustes/telefono");
  }, 30_000);
});
