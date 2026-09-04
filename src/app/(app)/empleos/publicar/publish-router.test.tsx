// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * EL DEFECTO QUE FILMÓ NACHO (feedback 2026-09-03, punto 3): en "Publicar un
 * empleo" —cuatro pasos— no había forma de volver; la única salida era tocar
 * "Buscar" en la barra de abajo, o sea tirar lo escrito.
 *
 * Con la barra superior, el "Volver" de este wizard tiene que ir de adentro
 * hacia afuera y NUNCA saltarse un nivel:
 *   1. un paso atrás dentro del formulario (el MISMO `goBack` del pie);
 *   2. en el primer paso, de vuelta al selector Empleo/Servicio — preguntando
 *      antes si hay algo escrito, porque volver ahí descarta el borrador;
 *   3. desde el selector, recién ahí se sale de /empleos/publicar.
 *
 * Los formularios se stubean: acá se prueba el CABLEADO (quién decide qué), no
 * los 4 pasos, que ya tienen su propio archivo (`publish-form.test.tsx`).
 */

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
const wizard = vi.hoisted(() => ({ retroceder: false, hayDatos: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: nav.back, push: nav.push }),
}));

vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());

vi.mock("./kind-picker", () => ({
  KindPicker: ({ onSelect }: { onSelect: (kind: "job" | "service") => void }) => (
    <button type="button" onClick={() => onSelect("job")}>
      stub-elegir-empleo
    </button>
  ),
}));

/**
 * Doble del formulario: llena el `wizardRef` con lo que pida cada test, desde
 * un efecto y no en el render — igual que el formulario de verdad.
 */
function FormularioStub({
  wizardRef,
}: {
  wizardRef?: { current: { retroceder: () => boolean; hayDatos: () => boolean } | null };
}) {
  useEffect(() => {
    if (!wizardRef) return;
    wizardRef.current = {
      retroceder: () => wizard.retroceder,
      hayDatos: () => wizard.hayDatos,
    };
    return () => {
      wizardRef.current = null;
    };
  });

  return <div data-testid="formulario" />;
}

vi.mock("./publish-form", () => ({ JobPublishForm: FormularioStub }));
vi.mock("./service-form", () => ({ ServicePublishForm: FormularioStub }));

import { PublishRouter } from "./publish-router";

const volver = () => screen.getByRole("button", { name: "Volver" });

function montar() {
  return render(
    <PublishRouter tenantId="t1" currency="USD" businesses={[]} identidadVerificada />,
  );
}

beforeEach(() => {
  nav.back.mockClear();
  nav.push.mockClear();
  wizard.retroceder = false;
  wizard.hayDatos = false;
  // Entrada directa: sin historial de la app, salir del flujo va al fallback.
  window.history.replaceState(null, "", "/empleos/publicar");
});

afterEach(cleanup);

describe("Volver en el wizard de publicar un empleo", () => {
  it("desde el selector sale del flujo, a Empleos si no hay historial detrás", () => {
    montar();

    fireEvent.click(volver());

    expect(nav.push).toHaveBeenCalledWith("/empleos");
  });

  it("en un paso intermedio retrocede UN paso y no se va de la pantalla", () => {
    montar();
    fireEvent.click(screen.getByText("stub-elegir-empleo"));
    wizard.retroceder = true; // el formulario dice "yo me encargo"

    fireEvent.click(volver());

    expect(screen.getByTestId("formulario")).toBeDefined();
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.back).not.toHaveBeenCalled();
  });

  it("en el primer paso y sin nada escrito, vuelve al selector sin preguntar", () => {
    montar();
    fireEvent.click(screen.getByText("stub-elegir-empleo"));

    fireEvent.click(volver());

    expect(screen.getByText("stub-elegir-empleo")).toBeDefined();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("en el primer paso y con datos escritos, pregunta antes de descartar", () => {
    wizard.hayDatos = true;
    montar();
    fireEvent.click(screen.getByText("stub-elegir-empleo"));

    fireEvent.click(volver());

    expect(screen.getByText("¿Descartás lo que escribiste?")).toBeDefined();
    expect(screen.getByTestId("formulario")).toBeDefined(); // todavía no se descartó

    fireEvent.click(screen.getByRole("button", { name: "Sí, volver" }));
    expect(screen.getByText("stub-elegir-empleo")).toBeDefined();
  });

  it('"Seguir acá" deja todo como estaba', () => {
    wizard.hayDatos = true;
    montar();
    fireEvent.click(screen.getByText("stub-elegir-empleo"));
    fireEvent.click(volver());

    fireEvent.click(screen.getByRole("button", { name: "Seguir acá" }));

    expect(screen.getByTestId("formulario")).toBeDefined();
    expect(nav.push).not.toHaveBeenCalled();
  });
});
