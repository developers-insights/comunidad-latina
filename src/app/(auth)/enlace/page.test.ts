import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/auth-card", () => ({ AuthCard: () => null }));

import { metadata } from "./page";

describe("/enlace", () => {
  it("no manda Origin: null en el POST ni deja salir el token del sitio", () => {
    expect(metadata.referrer).toBe("same-origin");
  });
});
