// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

vi.mock("@/components/share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/share")>();
  return {
    ...actual,
    CompartirSheet: ({ open, kind, id }: { open: boolean; kind: string; id: string }) =>
      open ? <section role="dialog" aria-label={`Compartir ${kind} ${id}`} /> : null,
  };
});

import { ShareProfileButton } from "./share-profile-button";

afterEach(cleanup);

describe("ShareProfileButton", () => {
  it("abre el panel interno y externo con el id público del perfil", () => {
    const id = "55555555-5555-4555-8555-555555555555";
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });

    render(<ShareProfileButton path={`/perfil/${id}`} displayName="Ana Pérez" />);
    fireEvent.click(screen.getByRole("button", { name: "Compartir perfil" }));

    expect(screen.getByRole("dialog", { name: `Compartir profile ${id}` })).toBeTruthy();
  });
});
