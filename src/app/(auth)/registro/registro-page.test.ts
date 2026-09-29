import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  availableOAuthProviders: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("../oauth-actions", () => ({
  availableOAuthProviders: mocks.availableOAuthProviders,
  googleIdentityClientId: async () => "client-id.apps.googleusercontent.com",
}));
vi.mock("./registro-client", () => ({ RegistroClient: () => null }));

import RegistroPage from "./page";
import { RegistroClient } from "./registro-client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUserId.mockResolvedValue(null);
  mocks.availableOAuthProviders.mockResolvedValue(["google"]);
});

describe("/registro", () => {
  it("ya no redirige a /entrar: dibuja el alta con los proveedores del servidor", async () => {
    const page = (await RegistroPage()) as ReactElement<{ children: ReactElement }>;

    expect(mocks.redirect).not.toHaveBeenCalled();
    const provider = page.props.children as ReactElement<{ clientId: string; children: ReactElement }>;
    expect(provider.props.clientId).toBe("client-id.apps.googleusercontent.com");
    const client = provider.props.children as ReactElement<{ oauthProviders: string[] }>;
    expect(client.type).toBe(RegistroClient);
    expect(client.props.oauthProviders).toEqual(["google"]);
  });

  it("con sesión abierta manda directo a la app", async () => {
    mocks.getAuthUserId.mockResolvedValue("user-1");

    await expect(RegistroPage()).rejects.toThrow("NEXT_REDIRECT:/feed");
    expect(mocks.availableOAuthProviders).not.toHaveBeenCalled();
  });
});
