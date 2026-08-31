// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

/**
 * "Tus negocios" con hasta DIEZ perfiles (0121).
 *
 * Lo que se fija acá es lo que se rompía justamente al pasar de uno a varios:
 * que el estado activo se vea en UNA sola tarjeta, que los diez botones no
 * suenen todos igual para un lector de pantalla, y que la frase sobre el perfil
 * personal —que es un dato de la persona, no del negocio— no se repita una vez
 * por fila.
 */

const state = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/perfil-activo/actions", () => ({
  cambiarIdentidad: vi.fn().mockResolvedValue({ ok: true, tipo: "negocio", nombre: "x" }),
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: state.toast }) };
});

import type { IdentidadNegocio } from "@/lib/perfil-activo/identidad";
import { COPY } from "./copy";
import { NegocioCard } from "./negocio-card";

const BASE: IdentidadNegocio = {
  businessId: "11111111-1111-4111-8111-111111111111",
  nombre: "Panadería La Esperanza",
  categoria: "mercado",
  listingId: null,
  avatarUrl: null,
  rol: "propietario",
  esPropietario: true,
  verificada: false,
};

function negocio(overrides: Partial<IdentidadNegocio> = {}): IdentidadNegocio {
  return { ...BASE, ...overrides };
}

afterEach(cleanup);

describe("NegocioCard", () => {
  it("marca el perfil activo con palabras, no sólo con color", () => {
    render(<NegocioCard negocio={negocio()} activo nombrePersonal="Giovanni" />);

    expect(screen.getByText(COPY.card.activeNow)).toBeTruthy();
    // Y el botón deja de ofrecer "usar este perfil": ya lo estás usando.
    expect(
      screen.getByRole("button", { name: COPY.card.backToPersonal }),
    ).toBeTruthy();
  });

  it("no dice nada sobre el perfil personal en las tarjetas inactivas", () => {
    render(<NegocioCard negocio={negocio()} activo={false} nombrePersonal="Giovanni" />);

    // La frase del perfil personal se dice UNA vez, arriba de la lista. Si
    // volviera a la tarjeta, con nueve negocios inactivos se leería nueve veces.
    expect(screen.queryByText(/perfil personal/i)).toBeNull();
    expect(screen.queryByText(COPY.card.activeNow)).toBeNull();
  });

  it("le da al botón un nombre accesible con el negocio, aunque la etiqueta sea corta", () => {
    render(<NegocioCard negocio={negocio()} activo={false} nombrePersonal="Giovanni" />);

    const boton = screen.getByRole("button", {
      name: COPY.card.useItAria("Panadería La Esperanza"),
    });
    // La etiqueta VISIBLE es corta: es lo que evita que un nombre largo desborde
    // la tarjeta a 375px. El nombre completo vive en el `aria-label`.
    expect(boton.textContent).toBe(COPY.card.useIt);
  });

  it("dice la verificación con ícono Y palabra, en los dos estados", () => {
    const { rerender } = render(
      <NegocioCard negocio={negocio()} activo={false} nombrePersonal="Giovanni" />,
    );
    expect(screen.getByText(COPY.verificacion.pending)).toBeTruthy();

    rerender(
      <NegocioCard
        negocio={negocio({ verificada: true })}
        activo={false}
        nombrePersonal="Giovanni"
      />,
    );
    expect(screen.getByText(COPY.verificacion.verified)).toBeTruthy();
  });

  it("muestra rubro y rol en una sola línea legible", () => {
    render(<NegocioCard negocio={negocio()} activo={false} nombrePersonal="Giovanni" />);
    expect(screen.getByText("Mercado · Dueño")).toBeTruthy();
  });
});

describe("NegocioCard en una lista de diez", () => {
  /** El caso que el tope de la 0121 habilita: diez perfiles, uno activo. */
  const DIEZ = Array.from({ length: 10 }, (_, i) =>
    negocio({
      businessId: `1111111${i}-1111-4111-8111-111111111111`,
      nombre: `Negocio ${i + 1}`,
    }),
  );

  it("marca exactamente uno como activo y deja nueve botones distinguibles", () => {
    const activoId = DIEZ[6].businessId;
    render(
      <ul>
        {DIEZ.map((n) => (
          <li key={n.businessId}>
            <NegocioCard
              negocio={n}
              activo={n.businessId === activoId}
              nombrePersonal="Giovanni"
            />
          </li>
        ))}
      </ul>,
    );

    expect(screen.getAllByText(COPY.card.activeNow)).toHaveLength(1);

    const lista = screen.getByRole("list");
    expect(within(lista).getAllByRole("listitem")).toHaveLength(10);

    // Nueve botones "Usar este perfil" con nueve nombres accesibles distintos:
    // un lector de pantalla no puede anunciar diez veces lo mismo.
    const nombresAccesibles = new Set(
      screen
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    );
    expect(nombresAccesibles.size).toBe(10);
  });
});

describe("COPY de la lista", () => {
  it("nombra la lista con su número, y en singular cuando hay uno solo", () => {
    expect(COPY.card.heading(1)).toBe("Tu negocio");
    expect(COPY.card.heading(4)).toBe("Tus 4 negocios");
  });

  it("nombra el perfil activo, sea el personal o un negocio", () => {
    expect(COPY.card.usingPersonal("Giovanni")).toContain("Giovanni");
    expect(COPY.card.usingPersonal("Giovanni")).toContain("perfil personal");
    expect(COPY.card.usingBusiness("Panadería La Esperanza")).toContain(
      "Panadería La Esperanza",
    );
    expect(COPY.card.usingBusiness("Panadería La Esperanza")).not.toContain(
      "perfil personal",
    );
  });
});
