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
  esPropietario: true,
  verificada: false,
};

/** N negocios propios, para probar el tope y el scroll de la lista. */
function negociosPropios(cantidad: number): IdentidadNegocioUI[] {
  return Array.from({ length: cantidad }, (_, indice) => ({
    ...NEGOCIO,
    businessId: `1111111${indice}-1111-4111-8111-111111111111`,
    nombre: `Negocio ${indice + 1}`,
  }));
}

/** Abre la hoja desde la puerta de /perfil y devuelve el diálogo. */
function abrirHoja(negocios: IdentidadNegocioUI[]) {
  render(
    <PerfilCambiarIdentidad
      personal={PERSONAL}
      negocios={negocios}
      activeBusinessId={null}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Estás como/i }));
  return screen.getByRole("dialog");
}

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


/**
 * =============================================================================
 * HASTA DIEZ NEGOCIOS (0121)
 * =============================================================================
 *
 * El pedido del cliente llegó con una captura de esta hoja: la última fila
 * decía "Administrar tu cuenta de negocio" y no había ninguna que dijera
 * agregar. Lo que se fija acá es que agregar y administrar sean DOS filas
 * distintas que van a DOS lugares distintos, y que cuando no quedan lugares no
 * quede un botón que sólo puede fallar.
 */
describe("agregar otro negocio", () => {
  it("hay una fila para AGREGAR, distinta de la de administrar y a otra ruta", () => {
    abrirHoja([NEGOCIO]);

    const agregar = screen.getByRole("link", { name: /Agregar otro negocio/i });
    const administrar = screen.getByRole("link", { name: /Administrar tus negocios/i });

    expect(agregar.getAttribute("href")).toBe("/negocios/cuenta#nuevo");
    expect(administrar.getAttribute("href")).toBe("/negocios/cuenta");
    expect(agregar).not.toBe(administrar);
  });

  it("dice cuántos lugares quedan", () => {
    abrirHoja(negociosPropios(7));

    expect(screen.getByText(/Podés crear 3 más \(de 10\)/)).toBeTruthy();
  });

  it("con uno solo restante habla en singular", () => {
    abrirHoja(negociosPropios(9));

    expect(screen.getByText(/Podés crear 1 más \(de 10\)/)).toBeTruthy();
  });

  it("con diez, NO hay botón de agregar: se dice el máximo y qué sí se puede", () => {
    abrirHoja(negociosPropios(10));

    expect(screen.queryByRole("link", { name: /Agregar otro negocio/i })).toBeNull();
    expect(screen.getByText(/Llegaste al máximo de 10 negocios/)).toBeTruthy();
    // Administrar sigue estando: llegar al tope no te saca lo que ya tenés.
    expect(screen.getByRole("link", { name: /Administrar tus negocios/i })).toBeTruthy();
  });

  it("los negocios AJENOS no empujan contra el tope", () => {
    // Diez negocios que administrás para otras personas: el tope es sobre los
    // propios (0103), así que la fila de agregar tiene que seguir ahí.
    const ajenos = negociosPropios(10).map((negocio) => ({
      ...negocio,
      esPropietario: false,
      rol: "administrador" as const,
    }));

    abrirHoja(ajenos);

    expect(screen.getByRole("link", { name: /Agregar otro negocio/i })).toBeTruthy();
    expect(screen.queryByText(/Llegaste al máximo/)).toBeNull();
  });

  it("sin el dato de propiedad, ofrece agregar y no muestra contador", () => {
    // Los tres consumidores mapean campo por campo y pueden no mandar
    // `esPropietario`. Ante la duda se ofrece el lugar —la base lo rechaza con
    // un mensaje humano— en vez de esconder la función.
    const sinDato = negociosPropios(10).map(({ esPropietario: _omitido, ...resto }) => resto);

    abrirHoja(sinDato);

    expect(screen.getByRole("link", { name: /Agregar otro negocio/i })).toBeTruthy();
    expect(screen.queryByText(/Podés crear/)).toBeNull();
    expect(screen.queryByText(/Llegaste al máximo/)).toBeNull();
  });
});

describe("la lista scrollea por dentro y las acciones quedan ancladas", () => {
  it("con once filas, la lista tiene su propio scroll", () => {
    // Es lo que impide que "Agregar otro negocio" se vaya de la pantalla a
    // 375 px: sin esto scrollea la hoja entera y las acciones quedan abajo de
    // todo, después de diez negocios.
    abrirHoja(negociosPropios(10));

    const lista = screen.getByRole("dialog").querySelector("ul");
    expect(lista).toBeTruthy();
    expect(lista?.className).toContain("overflow-y-auto");
    expect(lista?.className).toContain("min-h-0");
    // Once filas: el perfil personal + los diez negocios.
    expect(lista?.querySelectorAll("li")).toHaveLength(11);
  });
});

describe("la insignia de verificado", () => {
  it("aparece en el perfil verificado y NO en el que falta", () => {
    abrirHoja([
      { ...NEGOCIO, nombre: "Verificado SA", verificada: true },
      {
        ...NEGOCIO,
        businessId: "22222222-2222-4222-8222-222222222222",
        nombre: "Pendiente SA",
        verificada: false,
      },
    ]);

    // Una sola insignia para dos negocios: el que no la tiene no muestra nada.
    // Con cero identidades verificadas en la base, el aviso negativo aparecería
    // en las once filas y la hoja dejaría de ser un cambiador.
    expect(screen.getAllByText("Verificado")).toHaveLength(1);
  });
});
