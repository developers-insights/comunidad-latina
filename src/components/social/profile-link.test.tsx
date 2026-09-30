// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProfileLink, profileHref } from "./profile-link";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: unknown; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

const ID = "019fa477-58e6-7ab9-ae4f-cc41716f6420";
const OTRO = "019fa477-58e6-7ab9-ae4f-cc41716f6499";

afterEach(cleanup);

describe("profileHref", () => {
  it("apunta al perfil público de otra persona", () => {
    expect(profileHref(ID, OTRO)).toBe(`/perfil/${ID}`);
    expect(profileHref(ID)).toBe(`/perfil/${ID}`);
  });

  it("el perfil propio va a /perfil, sin pasar por el redirect", () => {
    expect(profileHref(ID, ID)).toBe("/perfil");
  });

  it("sin cuenta detrás, o con un id que no es uuid, no hay destino", () => {
    expect(profileHref(null)).toBeNull();
    expect(profileHref(undefined)).toBeNull();
    expect(profileHref("")).toBeNull();
    expect(profileHref("null")).toBeNull();
  });
});

describe("ProfileLink", () => {
  it("envuelve el nombre en un link con un nombre accesible que lo incluye", () => {
    render(
      <ProfileLink profileId={ID} name="Rosa Peralta">
        <span>Rosa Peralta</span>
      </ProfileLink>,
    );

    const link = screen.getByRole("link", { name: "Ver el perfil de Rosa Peralta" });
    expect(link.getAttribute("href")).toBe(`/perfil/${ID}`);
    expect(link.textContent).toBe("Rosa Peralta");
    expect(link.className).toContain("focus-visible:ring-");
    expect(link.className).toContain("after:h-11");
  });

  it("sin perfil pinta el contenido como texto, sin link", () => {
    render(
      <ProfileLink profileId={null} name="Miembro de la comunidad">
        <span>Miembro de la comunidad</span>
      </ProfileLink>,
    );

    expect(screen.getByText("Miembro de la comunidad")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("el avatar duplicado sale del orden de tabulación y del árbol accesible", () => {
    const { container } = render(
      <ProfileLink profileId={ID} name="Rosa" variant="avatar" duplicate>
        <span>R</span>
      </ProfileLink>,
    );

    const link = container.querySelector("a");
    expect(link?.getAttribute("tabindex")).toBe("-1");
    expect(link?.getAttribute("aria-hidden")).toBe("true");
    expect(link?.className).toContain("after:size-11");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("acepta otro perfil de la misma persona, pero sólo si hay cuenta", () => {
    const { rerender } = render(
      <ProfileLink profileId={ID} href={`/creadores/perfil/${ID}`} name="Rosa">
        Rosa
      </ProfileLink>,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/creadores/perfil/${ID}`);

    rerender(
      <ProfileLink profileId={null} href="/creadores/perfil/x" name="Rosa">
        Rosa
      </ProfileLink>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("en el perfil propio lleva a /perfil", () => {
    render(
      <ProfileLink profileId={ID} viewerId={ID} name="Rosa">
        Rosa
      </ProfileLink>,
    );

    expect(screen.getByRole("link").getAttribute("href")).toBe("/perfil");
  });
});
