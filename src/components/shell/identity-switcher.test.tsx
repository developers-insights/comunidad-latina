// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * La puerta de /perfil (pedido cliente: "que haya una chance... de cambiar de
 * perfil como en Instagram", dicho mirando /perfil) tiene que comportarse bien
 * en los DOS casos — con negocio y sin ninguno — y compartir la MISMA hoja y la
 * MISMA mutación que el avatar del header, nunca un segundo cambiador. Eso es
 * lo que se fija acá.
 */

const state = vi.hoisted(() => ({
  resultado: { ok: true, tipo: "negocio", nombre: "Panadería Giovanni" } as
    | { ok: true; tipo: "personal" | "negocio"; nombre: string }
    | { ok: false; mensaje: string },
  cambiarIdentidad: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/perfil-activo/actions", () => ({
  cambiarIdentidad: (input: unknown) => {
    state.cambiarIdentidad(input);
    return Promise.resolve(state.resultado);
  },
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: state.toast }) };
});

import {
  IdentitySwitcher,
  PerfilCambiarIdentidad,
  type IdentidadNegocioUI,
} from "./identity-switcher";

const PERSONAL = { displayName: "Giovanni Pérez", avatarUrl: null };
const NEGOCIO: IdentidadNegocioUI = {
  businessId: "11111111-1111-4111-8111-111111111111",
  nombre: "Panadería Giovanni",
  avatarUrl: null,
  rol: "propietario",
};

beforeEach(() => {
  state.cambiarIdentidad.mockReset();
  state.toast.mockReset();
  state.resultado = { ok: true, tipo: "negocio", nombre: "Panadería Giovanni" };
});
afterEach(cleanup);

describe("PerfilCambiarIdentidad: sin ningún negocio", () => {
  it("ofrece crearlo en vez de abrir una hoja vacía", () => {
    render(
      <PerfilCambiarIdentidad personal={PERSONAL} negocios={[]} activeBusinessId={null} />,
    );

    const puerta = screen.getByRole("link", { name: /crear una cuenta de negocio/i });
    expect(puerta.getAttribute("href")).toBe("/negocios/cuenta");
    // No hay hoja del cambiador que abrir: no hay diálogo en el documento.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("PerfilCambiarIdentidad: con al menos un negocio", () => {
  it("actuando como vos mismo, muestra el texto 'Cambiar de perfil' y abre la hoja", () => {
    render(
      <PerfilCambiarIdentidad
        personal={PERSONAL}
        negocios={[NEGOCIO]}
        activeBusinessId={null}
      />,
    );

    // El `aria-label` completa la frase con el nombre activo (mismo criterio
    // que el avatar del header); el texto visible del botón sigue siendo el
    // corto "Cambiar de perfil".
    const boton = screen.getByRole("button", { name: /Estás como Giovanni Pérez/i });
    expect(boton.textContent).toContain("Cambiar de perfil");

    fireEvent.click(boton);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Giovanni Pérez")).toBeTruthy();
    expect(screen.getByText("Panadería Giovanni")).toBeTruthy();
  });

  it("elegir el negocio en la hoja llama a cambiarIdentidad con su businessId", () => {
    render(
      <PerfilCambiarIdentidad
        personal={PERSONAL}
        negocios={[NEGOCIO]}
        activeBusinessId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Estás como Giovanni Pérez/i }));
    fireEvent.click(screen.getByRole("button", { name: /Panadería Giovanni/ }));

    expect(state.cambiarIdentidad).toHaveBeenCalledWith({ businessId: NEGOCIO.businessId });
  });

  it("actuando como el negocio, el botón lo dice — aria-label con el nombre, sin depender solo del color", () => {
    render(
      <PerfilCambiarIdentidad
        personal={PERSONAL}
        negocios={[NEGOCIO]}
        activeBusinessId={NEGOCIO.businessId}
      />,
    );

    const boton = screen.getByRole("button", { name: /Estás como Panadería Giovanni/i });
    expect(boton).toBeTruthy();
  });
});

describe("IdentitySwitcher (avatar del header): comportamiento sin cambios", () => {
  it("el avatar abre la MISMA hoja y elegir el personal vuelve al perfil propio", () => {
    render(
      <IdentitySwitcher
        personal={PERSONAL}
        negocios={[NEGOCIO]}
        activeBusinessId={NEGOCIO.businessId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Estás como Panadería Giovanni/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Giovanni Pérez/ }));
    expect(state.cambiarIdentidad).toHaveBeenCalledWith({ businessId: null });
  });
});
