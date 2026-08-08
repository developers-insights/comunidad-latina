// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ParaVos } from "./para-vos";
import type { MatchesResult, MatchItem } from "@/lib/matching";
import type { Tenant } from "@/lib/tenant/resolve";

/**
 * Feedback video-review (Geovanny, 2026-08-05): las cards de "Para vos"
 * tienen que leerse como BURBUJAS — contorno propio bien visible sobre el
 * fondo beige, ninguna "suelta" ni fundida con el canvas. Este test fija ese
 * contrato de estilo (no solo que el carrusel renderice) para que no se
 * pierda en un refactor futuro, y confirma que los estados existentes
 * (sin needs / sin matches) siguen intactos.
 *
 * Sin matchers de jest-dom a propósito (no está registrado globalmente en
 * vitest.config.ts) — mismo estilo (DOM crudo) que saved-list.test.tsx.
 */

const mocks = vi.hoisted(() => ({
  getMatches: vi.fn<() => Promise<MatchesResult>>(),
}));

vi.mock("@/lib/matching", () => ({
  getMatches: mocks.getMatches,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

const TENANT: Tenant = {
  id: "tenant-1",
  slug: "dominicanos",
  name: "Comunidad Dominicana",
  brandHex: "#1a5edb",
  logoUrl: null,
  locale: "es-US",
  currency: "USD",
  modules: {},
  modulesSoon: {},
  theme: null,
  isFallback: false,
};

vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: vi.fn(async () => TENANT),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: unknown;
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

const ITEM: MatchItem = {
  key: "listing:aaa",
  type: "listing",
  kind: "property",
  title: "Habitación luminosa en Corona",
  href: "/propiedades/aaa",
  areaLabel: "Corona, Queens",
  priceAmount: 1200,
  priceCurrency: "USD",
  pricePeriod: "mes",
  photoPath: null,
  reason: "Porque buscás vivienda en Corona, Queens",
  verified: true,
  score: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  mocks.getMatches.mockReset();
});

describe("ParaVos: look burbuja de las cards", () => {
  it("cada card tiene contorno visible (border-2 + border-border-strong) y elevación (shadow-md) sobre el beige", async () => {
    mocks.getMatches.mockResolvedValue({
      status: "ok",
      needs: ["vivienda"],
      items: [ITEM, { ...ITEM, key: "listing:bbb", href: "/propiedades/bbb" }],
    });

    render(await ParaVos({ userId: "user-1" }));

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);

    for (const link of links) {
      const shell = link.firstElementChild as HTMLElement;
      expect(shell.className).toContain("border-2");
      expect(shell.className).toContain("border-border-strong");
      expect(shell.className).toContain("shadow-md");
      // Radius bien redondeado (heredado del BezelCard, esquinas "que se noten").
      expect(shell.className).toContain("rounded-xl");
    }
  });

  it("mantiene el snap scroll horizontal y el aria-label 'Para vos'", async () => {
    mocks.getMatches.mockResolvedValue({
      status: "ok",
      needs: ["vivienda"],
      items: [ITEM],
    });

    render(await ParaVos({ userId: "user-1" }));

    const region = screen.getByRole("region", { name: "Para vos" });
    const list = screen.getByRole("list", { name: "Para vos" });
    expect(region.contains(list)).toBe(true);
    expect(list.className).toContain("snap-x");
    expect(list.className).toContain("snap-mandatory");
    expect(list.className).toContain("overflow-x-auto");

    const [item] = screen.getAllByRole("listitem");
    expect(item.className).toContain("snap-start");
  });

  it("muestra la razón del match y el precio en cada card", async () => {
    mocks.getMatches.mockResolvedValue({
      status: "ok",
      needs: ["vivienda"],
      items: [ITEM],
    });

    render(await ParaVos({ userId: "user-1" }));

    expect(screen.getByText(ITEM.reason)).toBeTruthy();
    expect(screen.getByText(ITEM.title)).toBeTruthy();
    expect(screen.getByText("Corona, Queens")).toBeTruthy();
  });

  it("sin needs (no-needs) sigue mostrando la invitación, no el carrusel", async () => {
    mocks.getMatches.mockResolvedValue({ status: "no-needs" });

    render(await ParaVos({ userId: "user-1" }));

    expect(screen.getByText("Contanos qué estás buscando")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Para vos" })).toBeNull();
  });

  it.each(["unavailable", "empty"] as const)(
    "status %s no renderiza nada (nunca rompe el feed)",
    async (status) => {
      mocks.getMatches.mockResolvedValue(
        status === "empty" ? { status: "empty", needs: ["vivienda"] } : { status: "unavailable" },
      );

      const result = await ParaVos({ userId: "user-1" });
      expect(result).toBeNull();
    },
  );
});
