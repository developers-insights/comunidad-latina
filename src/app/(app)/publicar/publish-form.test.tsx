// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";
import { COPY } from "@/components/listings";

/**
 * Preselect de /publicar por query param (?kind=, menú crear-post del feed —
 * §d). page.tsx valida el param y pasa `initialKind`; acá se testea SOLO lo
 * que ese prop cambia en el wizard: arranca en el paso 1 con el tipo ya
 * fijado (paso 0 salteado) y ofrece "Cambiar tipo" para volver al selector.
 * Sin el prop, todo se comporta IGUAL que antes del rediseño.
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

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));

// El submit real no aplica acá: solo se testea el arranque del wizard.
vi.mock("./actions", () => ({
  createListingDraft: vi.fn(),
  finalizeListing: vi.fn(),
}));

import { PublishForm } from "./publish-form";

const C = COPY.publish;

function mount(
  initialKind?: "property" | "business" | "professional" | "event" | "job",
  opts?: { identidadVerificada?: boolean },
) {
  return render(
    <ToastProvider>
      <PublishForm
        tenantId="tenant-1"
        initialKind={initialKind}
        identidadVerificada={opts?.identidadVerificada}
      />
    </ToastProvider>,
  );
}

afterEach(cleanup);

describe("PublishForm — sin preselect (uso de siempre)", () => {
  it("arranca en el selector de tipo (paso 0), sin 'Cambiar tipo'", () => {
    mount();
    expect(screen.getByText(C.steps.kind.title)).toBeTruthy();
    expect(screen.queryByText(C.steps.text.title(null))).toBeNull();
    expect(screen.queryByText("Cambiar tipo")).toBeNull();
  });

  it("ningún tipo queda preseleccionado", () => {
    mount();
    const radios = screen.getAllByRole("radio");
    expect(radios.some((radio) => radio.getAttribute("aria-checked") === "true")).toBe(false);
  });
});

describe("PublishForm — con preselect (?kind= del menú crear-post)", () => {
  it("arranca directo en el paso 1, con el selector salteado", () => {
    mount("business");
    expect(screen.getByText(C.steps.text.title("business"))).toBeTruthy();
    expect(screen.queryByText(C.steps.kind.title)).toBeNull();
  });

  it('muestra un link discreto "Cambiar tipo"', () => {
    mount("property");
    expect(screen.getByText("Cambiar tipo")).toBeTruthy();
  });

  it('"Cambiar tipo" vuelve al selector, con el tipo preseleccionado resaltado', () => {
    mount("business");
    fireEvent.click(screen.getByText("Cambiar tipo"));

    expect(screen.getByText(C.steps.kind.title)).toBeTruthy();
    expect(screen.queryByText(C.steps.text.title("business"))).toBeNull();
    const businessOption = screen.getByRole("radio", { name: /Negocio/ });
    expect(businessOption.getAttribute("aria-checked")).toBe("true");
  });

  it("cada kind válido preselecciona su propio paso 1 (sin volver al selector)", () => {
    for (const kind of ["property", "business", "professional", "event", "job"] as const) {
      const { unmount } = mount(kind);
      expect(screen.getByText(C.steps.text.title(kind))).toBeTruthy();
      expect(screen.queryByText(C.steps.kind.title)).toBeNull();
      unmount();
    }
  });
});

describe("PublishForm — copy del paso texto según kind (feedback Geovanny)", () => {
  it("vivienda: título y placeholder hablan de 'propiedad', no de 'aviso' genérico", () => {
    mount("property");
    expect(screen.getByText(C.steps.text.title("property"))).toBeTruthy();
    expect(
      screen.getByPlaceholderText(C.steps.text.titlePlaceholder("property")),
    ).toBeTruthy();
  });

  it("evento: título y placeholder hablan de 'evento', no de 'aviso' genérico", () => {
    mount("event");
    expect(screen.getByText(C.steps.text.title("event"))).toBeTruthy();
    expect(
      screen.getByPlaceholderText(C.steps.text.titlePlaceholder("event")),
    ).toBeTruthy();
  });

  it("los 5 tipos tienen título propio — ninguno repite el genérico 'tu aviso'", () => {
    const kinds = ["property", "business", "professional", "event", "job"] as const;
    const titles = kinds.map((kind) => C.steps.text.title(kind));
    expect(new Set(titles).size).toBe(kinds.length);
    for (const title of titles) expect(title).not.toBe("Contanos sobre tu aviso");
  });
});

/* ===========================================================================
 * Campos nuevos en el wizard: la venta ya no se ofrece, y lo opcional está
 * plegado.
 * =========================================================================== */

/** Avanza del paso 0 (tipo) al paso 2 (precio y detalles) para un kind dado. */
function irAlPasoDePrecio(kind: "property" | "event", opts?: { identidadVerificada?: boolean }) {
  mount(kind, opts);
  fireEvent.change(screen.getByLabelText(C.steps.text.titleLabel), {
    target: { value: "Cuarto amplio en casa compartida" },
  });
  fireEvent.change(screen.getByLabelText(C.steps.text.descriptionLabel), {
    target: {
      value:
        "Cuarto con placard en casa tranquila, a tres cuadras del tren. Servicios incluidos.",
    },
  });
  fireEvent.click(screen.getByText(C.nav.next));
}

describe("PublishForm — vivienda: la venta salió del formulario", () => {
  /**
   * No alcanza con que el servidor la rechace: si la opción sigue en pantalla,
   * alguien la elige, llena el aviso entero y recién al final se entera de que
   * no se puede. Acá se verifica que ni siquiera se ofrezca.
   */
  it("no ofrece la opción 'Venta'", () => {
    irAlPasoDePrecio("property");
    expect(screen.queryByText("Venta")).toBeNull();
    expect(screen.queryByText("Un precio único por la propiedad")).toBeNull();
  });

  /**
   * Y en su lugar EXPLICA por qué. Un campo que desaparece sin decir nada se
   * lee como un error de la app, no como una decisión.
   */
  it("dice en una línea que por ahora sólo se publican alquileres", () => {
    irAlPasoDePrecio("property");
    expect(screen.getByText(/Publicás un alquiler/i)).toBeTruthy();
    expect(screen.getByText(/solo alquileres/i)).toBeTruthy();
  });

  it("ofrece el tipo 'Vivienda compartida' que pide la spec", () => {
    irAlPasoDePrecio("property");
    const select = screen.getByLabelText(C.steps.price.typeLabel) as HTMLSelectElement;
    const opciones = Array.from(select.options).map((option) => option.value);
    expect(opciones).toContain("vivienda_compartida");
    expect(opciones).toContain("cuarto");
  });

  /**
   * El DEPÓSITO queda a la vista y no plegado: después del alquiler es la
   * pregunta que más se hace, y esconderla la dejaría sin contestar en casi
   * todos los avisos.
   */
  it("muestra el depósito sin tener que abrir nada", () => {
    irAlPasoDePrecio("property");
    expect(screen.getByLabelText("Depósito")).toBeTruthy();
  });

  /**
   * El resto de las condiciones vive PLEGADO. La regla del wizard es
   * "obligatorio a la vista, opcional a un toque": cinco controles más
   * desplegados convertirían el paso en una planilla que nadie termina en un
   * teléfono.
   */
  it("mantiene el resto de las condiciones plegadas hasta que se abren", () => {
    irAlPasoDePrecio("property");
    const bloque = screen.getByText("Condiciones del alquiler").closest("details");
    expect(bloque).toBeTruthy();
    expect((bloque as HTMLDetailsElement).open).toBe(false);
  });
});

describe("PublishForm — evento: los campos que faltaban", () => {
  it("pide categoría, entrada y modalidad, todo a la vista", () => {
    irAlPasoDePrecio("event");
    expect(screen.getByLabelText("Categoría")).toBeTruthy();
    expect(screen.getByText("Entrada")).toBeTruthy();
    expect(screen.getByText("Gratis")).toBeTruthy();
    expect(screen.getByText("¿Dónde es?")).toBeTruthy();
    expect(screen.getByText("En línea")).toBeTruthy();
  });

  /**
   * Un evento gratis no tiene precio. El campo no se "deshabilita": se va. Un
   * input vacío y apagado sigue invitando a preguntarse qué habría que poner.
   */
  it("al marcar 'Gratis' desaparece el campo de precio", () => {
    irAlPasoDePrecio("event");
    expect(screen.queryByLabelText(C.steps.price.priceLabel)).toBeTruthy();

    fireEvent.click(screen.getByText("Gratis"));

    expect(screen.queryByLabelText(C.steps.price.priceLabel)).toBeNull();
  });

  it("deja el enlace de entradas disponible sin pagar nada", () => {
    irAlPasoDePrecio("event");
    expect(screen.getByLabelText("Enlace de entradas o inscripción")).toBeTruthy();
  });

  it("capacidad y público quedan plegados", () => {
    irAlPasoDePrecio("event");
    const bloque = screen.getByText("Más datos del evento").closest("details");
    expect(bloque).toBeTruthy();
    expect((bloque as HTMLDetailsElement).open).toBe(false);
  });
});

/* ===========================================================================
 * Gate de identidad (spec cliente, cerrado 2026-08-31): "para vender dentro
 * de la plataforma, tenés que estar verificado sí o sí". Sin `identidadVerificada`
 * (como en TODOS los tests de arriba), el wizard se comporta exactamente
 * igual que antes de este gate — por eso el default del prop es `true`.
 * =========================================================================== */

describe("PublishForm — gate de identidad", () => {
  it("property sin identidad verificada: bloquea apenas se elige, antes del paso 1", () => {
    mount("property", { identidadVerificada: false });

    expect(screen.getByText(C.needIdentityTitle)).toBeTruthy();
    // Nunca llegó a mostrar el paso 1 — ni una letra del formulario.
    expect(screen.queryByText(C.steps.text.title("property"))).toBeNull();
  });

  it("job sin identidad verificada también bloquea", () => {
    mount("job", { identidadVerificada: false });
    expect(screen.getByText(C.needIdentityTitle)).toBeTruthy();
  });

  it("business y professional NO bloquean aunque la identidad no esté verificada", () => {
    mount("business", { identidadVerificada: false });
    expect(screen.queryByText(C.needIdentityTitle)).toBeNull();
    expect(screen.getByText(C.steps.text.title("business"))).toBeTruthy();
  });

  it("property CON identidad verificada no bloquea", () => {
    mount("property", { identidadVerificada: true });
    expect(screen.queryByText(C.needIdentityTitle)).toBeNull();
    expect(screen.getByText(C.steps.text.title("property"))).toBeTruthy();
  });

  it('"Elegir otro tipo de aviso" saca del gate y vuelve al selector', () => {
    mount("property", { identidadVerificada: false });
    fireEvent.click(screen.getByText(C.needIdentityBackKind));

    expect(screen.getByText(C.steps.kind.title)).toBeTruthy();
    expect(screen.queryByText(C.needIdentityTitle)).toBeNull();
  });

  it("un evento gratis NO bloquea sin identidad — sólo cobrar entrada lo hace", () => {
    irAlPasoDePrecio("event", { identidadVerificada: false });
    expect(screen.queryByText(C.needIdentityTitle)).toBeNull();

    fireEvent.click(screen.getByText("Con entrada paga"));

    expect(screen.getByText(C.needIdentityTitle)).toBeTruthy();
  });

  it('evento pago: "Volver" saca del gate sin perder el título ya escrito', () => {
    irAlPasoDePrecio("event", { identidadVerificada: false });
    fireEvent.click(screen.getByText("Con entrada paga"));
    expect(screen.getByText(C.needIdentityTitle)).toBeTruthy();

    fireEvent.click(screen.getByText(C.needIdentityBackEvent));

    // De vuelta en el paso de precio, con "Entrada" otra vez sin elegir.
    expect(screen.getByText("Entrada")).toBeTruthy();
    expect(screen.queryByText(C.needIdentityTitle)).toBeNull();
  });

  it("el botón lleva a /perfil/verificar", () => {
    mount("job", { identidadVerificada: false });
    const link = screen.getByText(C.needIdentityCta).closest("a");
    expect(link?.getAttribute("href")).toBe("/perfil/verificar");
  });
});
