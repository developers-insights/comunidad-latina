// @vitest-environment jsdom
import { type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CommentItem } from "./comment-item";
import type { AuthorView } from "./helpers";

/**
 * `PublisherTrust` arrastra el árbol de Trust (badge + sheet + motion). Acá se
 * testea el ITEM compartido (detalle SSR + hoja del feed), no ese badge: lo
 * stubeamos a un marcador para afirmar "hay/no hay badge" sin montar todo eso.
 */
vi.mock("@/components/listings", () => ({
  PublisherTrust: ({ score }: { score: number }) => (
    <span data-testid="trust-badge">confianza {score}</span>
  ),
  firstNameOf: (name: string) => name.trim().split(/\s+/)[0] ?? name,
}));

const baseAuthor: AuthorView = {
  profileId: "prof-1",
  displayName: "Rosa Peralta",
  avatarUrl: null,
  score: 72,
  level: "confiable",
  signals: [],
};

function renderItem(props: Partial<ComponentProps<typeof CommentItem>> = {}) {
  return render(
    <ul>
      <CommentItem
        author={baseAuthor}
        body="Bienvenida al barrio, cualquier cosa avisá."
        timeAgoLabel="hace 5 minutos"
        {...props}
      />
    </ul>,
  );
}

afterEach(cleanup);

describe("CommentItem", () => {
  it("muestra autor, cuerpo y tiempo", () => {
    renderItem();
    expect(screen.getByText("Rosa Peralta")).toBeTruthy();
    expect(
      screen.getByText("Bienvenida al barrio, cualquier cosa avisá."),
    ).toBeTruthy();
    expect(screen.getByText(/hace 5 minutos/)).toBeTruthy();
  });

  it("con perfil: muestra el badge de confianza", () => {
    renderItem();
    expect(screen.getByTestId("trust-badge")).toBeTruthy();
  });

  it("miembro anónimo (sin profileId): sin badge de confianza", () => {
    renderItem({ author: { ...baseAuthor, profileId: null } });
    expect(screen.queryByTestId("trust-badge")).toBeNull();
  });

  it("optimista en vuelo: atenúa el item y usa el label de envío", () => {
    const { container } = renderItem({ timeAgoLabel: "Enviando…", pending: true });
    const li = container.querySelector("li");
    expect(li?.className).toContain("opacity-60");
    expect(screen.getByText(/Enviando…/)).toBeTruthy();
  });
});
