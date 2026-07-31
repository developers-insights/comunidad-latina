// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PublisherTrust } from "./publisher-trust";

/**
 * "VER PERFIL" EN LOS AVISOS — call del 29/7, 1:02:24: *"dale a María Peralta a
 * ver si puede ver el perfil. Solo sale el score, pero debería también salir
 * ahí, ver perfil… si quieres ver el perfil de la gente que está posteando,
 * para ver si es una gente confiable"*.
 *
 * Lo que se ancla acá son las TRES reglas, y las tres importan por separado:
 *   1. el botón aparece dentro del desglose del score (no al lado del badge);
 *   2. sin perfil detrás —un aviso de fuente externa— no hay botón, porque no
 *      hay perfil al que ir;
 *   3. la privacidad de quien publica lo APAGA (*"si ella pone que no vean el
 *      perfil cuando pone anuncio, pues no va a salir"*), y lo hace como VETO:
 *      el default es visible, y esconderlo hay que pedirlo.
 */

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

const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

function renderTrust(overrides: Partial<React.ComponentProps<typeof PublisherTrust>> = {}) {
  return render(
    <PublisherTrust
      displayName="María Peralta"
      firstName="María"
      score={72}
      level="confiable"
      signals={[{ label: "Identidad verificada", achieved: true }]}
      size="inline"
      {...overrides}
    />,
  );
}

/** Abre el desglose tocando el badge (es la única forma de llegar). */
function abrirDesglose() {
  fireEvent.click(screen.getAllByRole("button")[0]);
}

afterEach(() => cleanup());

describe("PublisherTrust: ver el perfil de quien publica", () => {
  it("con perfil, el desglose ofrece ir al perfil de esa persona", () => {
    renderTrust({ profileId: PROFILE_ID });
    abrirDesglose();

    const link = screen.getByRole("link", { name: /ver el perfil de maría/i });
    expect(link.getAttribute("href")).toBe(`/perfil/${PROFILE_ID}`);
  });

  it("el botón vive DENTRO del desglose, no suelto junto al badge", () => {
    // Con la hoja cerrada no hay ningún link: el badge por sí solo no compite
    // con el CTA de contacto del aviso.
    renderTrust({ profileId: PROFILE_ID });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("sin perfil detrás (aviso de fuente externa) no hay botón", () => {
    renderTrust({ profileId: null });
    abrirDesglose();
    expect(screen.queryByRole("link", { name: /ver el perfil/i })).toBeNull();
  });

  it("si la persona ocultó su perfil, el botón NO sale", () => {
    renderTrust({ profileId: PROFILE_ID, profileVisible: false });
    abrirDesglose();
    expect(screen.queryByRole("link", { name: /ver el perfil/i })).toBeNull();
  });

  it("la privacidad es un VETO: no pasarla deja el perfil visible", () => {
    // Modelarlo al revés —como permiso— haría que una pantalla que se olvida de
    // pasar el dato escondiera el botón en silencio, y nadie se entera.
    renderTrust({ profileId: PROFILE_ID });
    abrirDesglose();
    expect(screen.getByRole("link", { name: /ver el perfil de maría/i })).toBeTruthy();
  });

  it("el desglose sigue mostrando el score y sus señales", () => {
    // El botón es un agregado, no un reemplazo: el "por qué" del número sigue
    // siendo lo primero que se lee.
    renderTrust({ profileId: PROFILE_ID });
    abrirDesglose();
    // El 72 aparece dos veces (el badge y el número grande de la hoja): lo que
    // importa es que la hoja siga contando el porqué, no cuántas veces.
    expect(screen.getAllByText("72").length).toBeGreaterThan(0);
    expect(screen.getByText("Identidad verificada")).toBeTruthy();
  });
});
