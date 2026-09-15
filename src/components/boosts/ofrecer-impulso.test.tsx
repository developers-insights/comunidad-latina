// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OfrecerImpulso } from "./ofrecer-impulso";

/**
 * LA REGLA QUE NO SE PUEDE ROMPER DOS VECES.
 *
 * El 2026-09-07 se sacó el botón "Promocionar" de todo lo que no está
 * publicado: llevaba a una pantalla que exige `status = 'published'` sólo para
 * contestar que no. Ahora los cuatro wizards de publicación ofrecen impulsar al
 * terminar, y ese es exactamente el lugar donde el bug puede volver — un aviso
 * recién creado que queda en `pending_review` es el caso más común de todos.
 *
 * Estos tests anclan las dos mitades:
 *  · publicado    → hay oferta, y apunta a las rutas de impulso y campaña;
 *  · en revisión  → NO hay ninguna oferta, pero sí se puede VER cómo va a
 *                   quedar, que es el otro pedido del mismo video del cliente.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const LISTING = "019fa5dd-947f-71b3-8349-3b8483ec00a6";

function renderCon(status: string) {
  return render(
    <OfrecerImpulso listingId={LISTING} status={status} titulo="Cuarto en Astoria" />,
  );
}

function hrefs(): string[] {
  return screen
    .queryAllByRole("link")
    .map((el) => el.getAttribute("href") ?? "")
    .filter(Boolean);
}

describe("OfrecerImpulso — aviso publicado", () => {
  it("ofrece impulsar y crear campaña, a las rutas que existen", () => {
    renderCon("published");
    expect(hrefs()).toEqual([`/impulsar/${LISTING}`, `/impulsar/${LISTING}?modo=campana`]);
  });

  it("no le habla de la espera a quien ya está publicado", () => {
    renderCon("published");
    expect(screen.queryByText(/Ver cómo va a quedar/i)).toBeNull();
  });
});

describe("OfrecerImpulso — aviso en revisión", () => {
  it("NO ofrece ningún camino para promocionar", () => {
    // El bug que esto cierra: las dos rutas exigen `published`, así que un
    // botón acá manda a alguien a que le digan que no.
    renderCon("pending_review");
    expect(hrefs()).toEqual([]);
  });

  it("pero sí deja ver cómo va a quedar mientras espera", () => {
    renderCon("pending_review");
    expect(screen.getByRole("button", { name: /Ver cómo va a quedar/i })).toBeTruthy();
  });
});

describe("OfrecerImpulso — el resto de los estados", () => {
  it.each(["draft", "paused", "expired", "closed", "removed", "cualquier_cosa"])(
    "%s tampoco recibe oferta de promocionar",
    (status) => {
      // `estadoDePromocion` manda un status desconocido a "no_disponible", y
      // eso es lo correcto: el destino lo iba a rechazar igual.
      renderCon(status);
      expect(hrefs()).toEqual([]);
    },
  );
});
