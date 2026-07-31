// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * La tarjeta de una postulación en el panel.
 *
 * Lo que fija: que sobre un aviso de un miembro NO aparecen botones de
 * respuesta (el staff no contesta por el empleador) y que lo que la política
 * recortó server-side no se reconstruye acá. El componente recibe la
 * postulación YA filtrada — este test verifica que no la "rellena" sola.
 */

vi.mock("@/app/admin/empleos/actions", () => ({
  resolveJobApplication: vi.fn(),
}));

import type { DisclosedApplication } from "@/app/admin/empleos/policy";
import { JobApplicantCard } from "./job-applicant-card";

afterEach(cleanup);

const REVEALED: DisclosedApplication = {
  id: "app-1",
  status: "submitted",
  createdAtLabel: "hace 2 días",
  displayName: "Rosa M.",
  avatarUrl: null,
  message: "Puedo empezar el lunes.",
  answers: [{ question: "¿Tenés experiencia cuidando niños?", answer: "Sí" }],
};

/** Lo que sale de `discloseApplication("member", …)`: solo el esqueleto. */
const REDACTED: DisclosedApplication = {
  id: "app-2",
  status: "submitted",
  createdAtLabel: "hace 5 horas",
  displayName: null,
  avatarUrl: null,
  message: null,
  answers: [],
};

describe("<JobApplicantCard /> · aviso de la plataforma", () => {
  it("muestra quién es, su nota y sus respuestas", () => {
    render(<JobApplicantCard application={REVEALED} canResolve />);

    expect(screen.getByText("Rosa M.")).toBeDefined();
    expect(screen.getByText("Puedo empezar el lunes.")).toBeDefined();
    expect(screen.getByText("¿Tenés experiencia cuidando niños?")).toBeDefined();
    expect(screen.getByText("Sí")).toBeDefined();
  });

  it("ofrece aceptar y rechazar, y avisa en nombre de quién se responde", () => {
    render(<JobApplicantCard application={REVEALED} canResolve />);

    expect(screen.getByRole("button", { name: /Aceptar/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Rechazar/ })).toBeDefined();
    expect(screen.getByText(/equipo de la comunidad/)).toBeDefined();
  });

  it("una postulación ya resuelta no vuelve a ofrecer botones", () => {
    render(<JobApplicantCard application={{ ...REVEALED, status: "hired" }} canResolve />);

    expect(screen.queryByRole("button", { name: /Aceptar/ })).toBeNull();
    expect(screen.getByText("Contratado")).toBeDefined();
  });

  // 0047 renombró el vocabulario (`accepted`→`hired`, `declined`→`rejected`),
  // pero una fila que se resolvió con el build viejo puede seguir llegando con
  // la palabra anterior. La tarjeta la traduce en vez de dibujar el estado
  // crudo: mostrar "Contratado" siempre es mejor que mostrar "accepted".
  it("traduce el vocabulario viejo en vez de mostrar el estado crudo", () => {
    render(<JobApplicantCard application={{ ...REVEALED, status: "accepted" }} canResolve />);

    expect(screen.getByText("Contratado")).toBeDefined();
    expect(screen.queryByText("accepted")).toBeNull();
  });
});

describe("<JobApplicantCard /> · aviso de un miembro", () => {
  it("no ofrece responder: esa respuesta le toca a quien publicó", () => {
    render(<JobApplicantCard application={REDACTED} canResolve={false} />);

    expect(screen.queryByRole("button", { name: /Aceptar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Rechazar/ })).toBeNull();
  });

  it("no reconstruye nada de lo que la política recortó", () => {
    const { container } = render(
      <JobApplicantCard application={REDACTED} canResolve={false} />,
    );

    expect(screen.queryByText("Sus respuestas")).toBeNull();
    expect(screen.queryByText("Su nota")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("Rosa");
  });

  it("sí muestra el metadato operativo: estado y cuándo llegó", () => {
    render(<JobApplicantCard application={REDACTED} canResolve={false} />);

    expect(screen.getByText("Sin responder")).toBeDefined();
    expect(screen.getByText("hace 5 horas")).toBeDefined();
    expect(screen.getByText("Postulación")).toBeDefined();
  });
});
