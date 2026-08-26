// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * =============================================================================
 * EL AVISO SE MIRA SIN SALIR DEL FEED
 * =============================================================================
 *
 * Pedido literal del cliente (2026-08-20): "no te tiene que mover a otra
 * publicación; ahí nomás dentro de pantalla se tiene que fluir sin sacarte del
 * feed. Mientras menos pasos mejor".
 *
 * Esta card ya sabía hacerlo —abría una ficha en hoja— pero SÓLO cuando el
 * aviso no tenía página de detalle. Con página, navegaba. La revisión de código
 * del 2026-08-20 lo llamó "la inconsistencia demostrada en un solo archivo": la
 * buena solución existía y se usaba como plan B.
 *
 * Lo que se ancla acá es el CONTRATO del disparador, que tiene dos mitades y
 * las dos importan:
 *
 *   1. el toque simple NO navega y abre la ficha — el pedido del cliente;
 *   2. el disparador NO deja de ser un link — compartir, "copiar dirección",
 *      "abrir en otra pestaña", ctrl/cmd y el HTML sin JS siguen dando la
 *      página entera. Una mejora que rompa el deep link no es una mejora.
 *
 * Sin estos tests, cualquiera "simplifica" el disparador a un `<button>` y las
 * dos mitades se pierden en silencio: la card seguiría abriendo la hoja y nadie
 * notaría que el aviso dejó de ser compartible hasta que un vecino mande un
 * link roto por WhatsApp.
 */

const viewer = vi.hoisted(() => ({ open: vi.fn(), available: true }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const actions = vi.hoisted(() => ({
  /** Contacto (product/business/professional/event). */
  sendMessage: vi.fn(),
  /** Contexto de postulación a un empleo, pedido al tocar. */
  loadJobContext: vi.fn(),
  applyToJob: vi.fn(),
  prepareCvUpload: vi.fn(),
  /** Propuesta a una colaboración de creadores. */
  applyToGig: vi.fn(),
}));
/**
 * La hoja de sesión se pide por hook. Acá se registra el pedido y se guarda el
 * `onAuthenticated` para poder ejecutarlo como si la persona hubiera entrado
 * sin salir del feed — que es justamente lo que hay que poder demostrar.
 */
const authGate = vi.hoisted(() => ({
  calls: [] as { reason?: string; onAuthenticated?: () => void }[],
}));

vi.mock("./media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open, available: viewer.available }),
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { apply: "Entrá y mandá tu postulación", message: "Entrá y escribile" },
  useAuthSheetOpen: () => false,
  useAuthSessionNonce: () => 0,
  useRequireAuth: () => (args: { reason?: string; onAuthenticated?: () => void }) => {
    authGate.calls.push(args ?? {});
  },
}));

vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: actions.sendMessage,
}));

vi.mock("@/app/(app)/empleos/apply-context-action", () => ({
  loadJobApplyContextAction: actions.loadJobContext,
}));

vi.mock("@/app/(app)/empleos/actions", () => ({
  applyToJobAction: actions.applyToJob,
  prepareCvUploadAction: actions.prepareCvUpload,
}));

vi.mock("@/app/(app)/creadores/actions", () => ({
  applyToGig: actions.applyToGig,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ remove: vi.fn() }) },
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/feed",
}));

// useToast lanza fuera de su provider (lo usa la hoja de postulación a un
// empleo): se reemplaza SOLO ese hook, el resto de @/components/ui es el real.
vi.mock("@/components/ui", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui")>("@/components/ui");
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

// next/link sin router: sólo un <a href>. `style` viaja en los props, que es
// como el CTA pinta su acento.
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

// motion neutralizado: el DOM refleja el estado de la hoja al instante.
vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock(),
);

const { FeedListingCard } = await import("./feed-listing-card");

import type { FeedListingModel } from "./helpers";

const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const BUSINESS_ID = "bbbbbbbb-2222-4222-8222-222222222222";

/**
 * Foto de un host EXTERNO a propósito: `CardMedia` sólo pasa por `next/image`
 * cuando la URL es del storage propio, y fuera de un runtime de Next ese
 * componente no tiene loader. Con una URL de afuera renderiza un `<img>` pelado
 * y el test mide lo que vino a medir.
 */
const PHOTO = "https://cdn.example.com/aviso-1.webp";

function aviso(overrides: Partial<FeedListingModel> = {}): FeedListingModel {
  return {
    id: JOB_ID,
    kind: "job",
    title: "Ayudante de cocina en Corona",
    description: "Turno tarde, de miércoles a domingo. Se paga semanal.",
    priceLabel: "US$ 18 por hora",
    areaLabel: "Corona, Queens",
    photoUrl: null,
    verifiedDateLabel: null,
    publisherName: "Rotisería La Esquina",
    publisherTrust: null,
    ...overrides,
  };
}

function cta() {
  return screen.getByRole("link", { name: /ver detalles/i });
}

/** La ficha está abierta cuando su aviso de seguridad está en pantalla. */
function fichaAbierta() {
  return screen.queryByRole("note", { name: "Aviso de seguridad" }) !== null;
}

beforeEach(() => {
  viewer.open.mockReset();
  viewer.available = true;
  nav.push.mockReset();
  nav.refresh.mockReset();
  actions.sendMessage.mockReset();
  actions.loadJobContext.mockReset();
  actions.applyToJob.mockReset();
  actions.applyToGig.mockReset();
  authGate.calls.length = 0;
});

afterEach(() => cleanup());

describe("el gesto del feed abre la ficha, no otra pantalla", () => {
  it("el toque simple en 'Ver detalles' NO navega y abre la ficha", () => {
    render(<FeedListingCard listing={aviso()} />);

    // fireEvent devuelve false cuando alguien llamó preventDefault: eso es,
    // literalmente, "no navegó".
    expect(fireEvent.click(cta())).toBe(false);
    expect(fichaAbierta()).toBe(true);
    expect(screen.getByText("Turno tarde, de miércoles a domingo. Se paga semanal.")).toBeTruthy();
  });

  it("el marco sin foto también abre la ficha en vez de navegar", () => {
    render(<FeedListingCard listing={aviso()} />);
    const marco = screen.getByRole("link", {
      name: "Ver los detalles de Ayudante de cocina en Corona",
    });

    expect(fireEvent.click(marco)).toBe(false);
    expect(fichaAbierta()).toBe(true);
  });

  it("Escape cierra la ficha y devuelve el feed", () => {
    render(<FeedListingCard listing={aviso()} />);
    fireEvent.click(cta());
    expect(fichaAbierta()).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(fichaAbierta()).toBe(false);
  });
});

/**
 * La otra mitad del contrato. Un aviso es una cosa que se comparte por WhatsApp
 * entre vecinos: la URL canónica no puede desaparecer porque mejoramos el
 * camino corto.
 */
describe("el disparador sigue siendo un link de verdad", () => {
  it("conserva el href al aviso: compartir y el deep link no cambian", () => {
    render(<FeedListingCard listing={aviso()} />);
    expect(cta().getAttribute("href")).toBe(`/empleos/${JOB_ID}`);
  });

  it("con ctrl/cmd deja pasar el link (abrir en otra pestaña)", () => {
    render(<FeedListingCard listing={aviso()} />);

    expect(fireEvent.click(cta(), { ctrlKey: true })).toBe(true);
    expect(fichaAbierta()).toBe(false);

    expect(fireEvent.click(cta(), { metaKey: true })).toBe(true);
    expect(fichaAbierta()).toBe(false);
  });

  it("con shift/alt o botón del medio tampoco se mete", () => {
    render(<FeedListingCard listing={aviso()} />);

    expect(fireEvent.click(cta(), { shiftKey: true })).toBe(true);
    expect(fireEvent.click(cta(), { altKey: true })).toBe(true);
    expect(fireEvent.click(cta(), { button: 1 })).toBe(true);
    expect(fichaAbierta()).toBe(false);
  });

  /**
   * SIN JS NAVEGA COMO ANTES.
   *
   * El HTML que sale del servidor es lo que se mide acá: antes de hidratar no
   * hay handler que intercepte nada, así que el toque lo resuelve el navegador
   * con el `href` que ya está en el marcado. La ficha es una MEJORA sobre ese
   * camino, no un reemplazo — y esta prueba es la única que lo demuestra sin
   * depender de que React haya llegado.
   */
  it("el HTML sin hidratar ya trae el ancla al aviso", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(<FeedListingCard listing={aviso()} />);

    expect(html).toContain(`href="/empleos/${JOB_ID}"`);
    // Y la hoja NO viaja en el HTML: se monta recién en el cliente.
    expect(html).not.toContain("Aviso de seguridad");
  });
});

/**
 * El visor de medios es un provider del layout. Fuera de él —o si alguien monta
 * esta card en una sección nueva sin acordarse— la foto no puede quedar siendo
 * un botón que no hace nada: cae a la ficha, que es lo más parecido a lo que la
 * persona pidió. `available` existe en el hook justo para esto.
 */
describe("sin visor de medios montado", () => {
  it("la foto no queda muerta: abre la ficha y sigue teniendo href", () => {
    viewer.available = false;
    render(<FeedListingCard listing={aviso({ photoUrl: PHOTO })} />);

    const marco = screen.getByRole("link", {
      name: "Ver los detalles de Ayudante de cocina en Corona",
    });
    expect(marco.getAttribute("href")).toBe(`/empleos/${JOB_ID}`);
    expect(fireEvent.click(marco)).toBe(false);
    expect(fichaAbierta()).toBe(true);
    expect(viewer.open).not.toHaveBeenCalled();
  });

  it("con visor montado, la foto sigue abriendo el visor (gesto 2026-07-26)", () => {
    render(<FeedListingCard listing={aviso({ photoUrl: PHOTO })} />);

    fireEvent.click(screen.getByRole("button", { name: /ver fotos de/i }));
    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(fichaAbierta()).toBe(false);
  });
});

/**
 * Si la ficha es lo que ve TODO el mundo, tiene que alcanzar para decidir sin
 * ir a ningún lado. Estas dos cosas estaban en la card y no en la hoja: tocar
 * "Ver detalles" abría una ficha con MENOS información de la que ya estaba en
 * pantalla.
 */
describe("la ficha alcanza para decidir", () => {
  it("muestra la foto y el sello de licencia, que antes sólo estaban en la card", () => {
    render(
      <FeedListingCard
        listing={aviso({ photoUrl: PHOTO, verifiedDateLabel: "12/08/2026" })}
      />,
    );
    fireEvent.click(cta());

    // Dentro de la hoja: la foto de referencia (tocable) y la licencia.
    expect(screen.getAllByRole("button", { name: /ver fotos de/i }).length).toBe(2);
    expect(screen.getAllByText("Licencia activa al 12/08/2026").length).toBe(2);
  });

  it("dice el precio, la zona y quién publica", () => {
    render(<FeedListingCard listing={aviso()} />);
    fireEvent.click(cta());

    expect(screen.getAllByText("US$ 18 por hora").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Corona, Queens").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rotisería La Esquina/).length).toBeGreaterThan(0);
  });
});

/**
 * El negocio era el kind sin página propia, y por eso la ficha terminaba
 * empujando al DIRECTORIO entero: una salida dentro de la hoja que existe para
 * evitar salidas, y encima hacia la lista de todos los negocios en vez de hacia
 * el que se estaba mirando. `/negocios/[id]` existe desde el 2026-07-30.
 */
describe("el negocio dejó de ser la excepción", () => {
  it("la salida de la ficha lleva al negocio, no al directorio", () => {
    render(
      <FeedListingCard
        listing={aviso({ id: BUSINESS_ID, kind: "business", title: "Panadería Doña Flor" })}
      />,
    );
    fireEvent.click(cta());

    const salida = screen.getByRole("link", { name: /ver el aviso completo/i });
    expect(salida.getAttribute("href")).toBe(`/negocios/${BUSINESS_ID}`);
    expect(screen.queryByRole("link", { name: /directorio/i })).toBeNull();
  });
});

/**
 * =============================================================================
 * LA ACCIÓN PRINCIPAL VIVE ADENTRO DE LA FICHA
 * =============================================================================
 *
 * Hallazgo BLOQUEANTE de la revisión de código (2026-08-20): esta ficha había
 * agregado un paso a lo único que convierte. "Ver detalles" llevaba a la página
 * del aviso, donde está el CTA de postularse o contactar —UN toque hasta la
 * acción—; con la ficha eran DOS, porque el CTA quedaba del otro lado de "Ver
 * el aviso completo". Para leer, la ficha ganaba; para HACER, empeoró los seis
 * verticales a la vez.
 *
 * Estos tests son el candado de la corrección: si alguien saca la acción de la
 * hoja, o la convierte en un link a la página, o la manda a `/entrar`, vuelve a
 * costar dos pantallas y nadie se entera hasta producción. Por eso se prueba
 * kind por kind y no "en general": el bug era exactamente eso, un vertical sin
 * cubrir.
 */

const PRODUCT_ID = "cccccccc-3333-4333-8333-333333333333";
const GIG_ID = "dddddddd-4444-4444-8444-444444444444";
const EVENT_ID = "eeeeeeee-5555-4555-8555-555555555555";
const PRO_ID = "ffffffff-6666-4666-8666-666666666666";

/** Publica alguien CON cuenta: es la condición para que haya chat del otro lado. */
const MIEMBRO: NonNullable<FeedListingModel["publisherTrust"]> = {
  displayName: "Marta Gómez",
  firstName: "Marta",
  score: 0,
  level: "nuevo",
  signals: [],
  profileId: null,
};

/** Aviso de alguien de la comunidad (no una fuente externa sin bandeja). */
function avisoDeMiembro(overrides: Partial<FeedListingModel> = {}): FeedListingModel {
  return aviso({ publisherName: null, publisherTrust: MIEMBRO, ...overrides });
}

/** Abre la ficha por el camino real: el toque simple en "Ver detalles". */
function abrirFicha(listing: FeedListingModel) {
  render(<FeedListingCard listing={listing} />);
  fireEvent.click(cta());
}

/** Escribe en el composer del contacto y toca enviar. */
function escribirYEnviar(texto: string) {
  fireEvent.change(screen.getByLabelText("Escribí tu mensaje"), {
    target: { value: texto },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
}

describe("empleo: postularse desde la ficha, sin ir al aviso", () => {
  it("'Postularme' está en la ficha y abre el formulario sin navegar", async () => {
    actions.loadJobContext.mockResolvedValue({ state: "ready", questions: [], profile: null });
    abrirFicha(aviso());

    fireEvent.click(
      screen.getByRole("button", { name: "Postularme a Ayudante de cocina en Corona" }),
    );

    // El contexto se pide con el id que la card YA tenía: sin campos nuevos en
    // FeedListingModel, que era la condición de todo este arreglo.
    expect(actions.loadJobContext).toHaveBeenCalledWith(JOB_ID);
    expect(await screen.findByText("Postularte a este empleo")).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
    // Y la ficha sigue abierta detrás: nadie salió del feed.
    expect(fichaAbierta()).toBe(true);
  });

  it("si el servidor dice que ya se postuló, lo dice — no abre un formulario inútil", async () => {
    actions.loadJobContext.mockResolvedValue({ state: "already-applied" });
    abrirFicha(aviso());

    fireEvent.click(
      screen.getByRole("button", { name: "Postularme a Ayudante de cocina en Corona" }),
    );

    expect(await screen.findByText("Ya te postulaste")).toBeTruthy();
    expect(screen.queryByText("Postularte a este empleo")).toBeNull();
  });
});

describe("colaboración de creadores: la propuesta se manda desde la ficha", () => {
  it("'Postularme' abre la hoja de propuesta encima del feed", () => {
    abrirFicha(
      avisoDeMiembro({ id: GIG_ID, kind: "creator_gig", title: "Reels para la panadería" }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Postularme a Reels para la panadería" }),
    );

    expect(screen.getByText("Postularme a este trabajo")).toBeTruthy();
    expect(screen.getByLabelText("Tu propuesta")).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("los cuatro verticales que se contactan por chat", () => {
  const casos = [
    {
      kind: "product",
      id: PRODUCT_ID,
      title: "Bici rodado 26",
      trigger: "Escribirle a quien vende",
    },
    {
      kind: "business",
      id: BUSINESS_ID,
      title: "Panadería Doña Flor",
      trigger: "Escribirle al negocio",
    },
    {
      kind: "professional",
      id: PRO_ID,
      title: "Plomero matriculado",
      trigger: "Consultar por el servicio",
    },
    {
      kind: "event",
      id: EVENT_ID,
      title: "Feria de la plaza",
      trigger: "Consultar por el evento",
    },
  ] as const;

  it.each(casos)(
    "$kind: la ficha trae su propio composer, y el botón dice a quién se le escribe",
    ({ kind, id, title, trigger }) => {
      abrirFicha(avisoDeMiembro({ id, kind, title }));

      const boton = screen.getByRole("button", { name: `${trigger} ${title}` });
      expect(boton.textContent).toContain(trigger);

      fireEvent.click(boton);
      expect(screen.getByLabelText("Escribí tu mensaje")).toBeTruthy();
      expect(nav.push).not.toHaveBeenCalled();
    },
  );

  it("enviar manda el id del aviso y confirma en la misma pantalla", async () => {
    actions.sendMessage.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    abrirFicha(avisoDeMiembro({ id: PRODUCT_ID, kind: "product", title: "Bici rodado 26" }));

    fireEvent.click(screen.getByRole("button", { name: /Escribirle a quien vende/ }));
    escribirYEnviar("Hola, ¿sigue disponible?");

    expect(await screen.findByText("Mensaje enviado")).toBeTruthy();
    expect(actions.sendMessage).toHaveBeenCalledWith({
      listingId: PRODUCT_ID,
      body: "Hola, ¿sigue disponible?",
    });
    expect(nav.push).not.toHaveBeenCalled();
    // El hilo es una OPCIÓN al final, nunca un peaje.
    expect(screen.getByRole("link", { name: /Abrir el chat/ }).getAttribute("href")).toBe(
      "/mensajes/conv-1",
    );
  });

  /**
   * El defecto que ya apareció tres veces en este repo: festejar un alta que
   * nunca ocurrió. Si el servidor avisa que la conversación ya existía, la
   * ficha lo dice con esas palabras.
   */
  it("si ya había conversación no la pinta como alta nueva", async () => {
    actions.sendMessage.mockResolvedValue({ ok: true, conversationId: "conv-7", reused: true });
    abrirFicha(avisoDeMiembro({ id: PRODUCT_ID, kind: "product", title: "Bici rodado 26" }));

    fireEvent.click(screen.getByRole("button", { name: /Escribirle a quien vende/ }));
    escribirYEnviar("Otra consulta");

    expect(await screen.findByText("Lo sumamos al chat que ya tenían")).toBeTruthy();
    expect(screen.queryByText("Mensaje enviado")).toBeNull();
  });

  /**
   * La ficha del feed no sabe si hay sesión (se monta con el modelo del aviso y
   * nada más), así que no gatea de entrada: manda, y si el servidor dice que no
   * hay sesión ofrece entrar ACÁ y reintenta con el texto ya escrito. Lo que no
   * puede pasar es un `push` a /entrar ni que el mensaje se pierda.
   */
  it("sin sesión no expulsa: ofrece entrar y reenvía lo que ya estaba escrito", async () => {
    actions.sendMessage.mockResolvedValue({ ok: false, code: "unauthenticated" });
    abrirFicha(avisoDeMiembro({ id: PRODUCT_ID, kind: "product", title: "Bici rodado 26" }));

    fireEvent.click(screen.getByRole("button", { name: /Escribirle a quien vende/ }));
    escribirYEnviar("Hola, ¿sigue disponible?");

    expect(await screen.findByText(/Necesitás tu cuenta para enviarlo/)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();

    actions.sendMessage.mockResolvedValue({ ok: true, conversationId: "conv-2" });
    fireEvent.click(screen.getByRole("button", { name: "Entrar a mi cuenta" }));
    expect(authGate.calls).toHaveLength(1);

    // Vuelve de la hoja de sesión: el reintento NO vuelve a pasar por ningún
    // guard de cliente (eso reabriría la hoja en bucle).
    await act(async () => {
      authGate.calls[0]?.onAuthenticated?.();
    });

    expect(await screen.findByText("Mensaje enviado")).toBeTruthy();
    expect(actions.sendMessage).toHaveBeenLastCalledWith({
      listingId: PRODUCT_ID,
      body: "Hola, ¿sigue disponible?",
    });
    expect(authGate.calls).toHaveLength(1);
  });
});

/**
 * Un aviso de fuente externa no tiene cuenta del otro lado: `request_contact`
 * lo rechaza. Ofrecer el composer sería dejar que alguien escriba un mensaje
 * entero para enterarse después — y con un error genérico, encima.
 */
describe("aviso de una fuente externa", () => {
  it("lo dice antes de que nadie escriba, y no monta composer", () => {
    abrirFicha(
      aviso({
        id: PRODUCT_ID,
        kind: "product",
        title: "Bici rodado 26",
        publisherName: "Feria de Corona",
        publisherTrust: null,
      }),
    );

    expect(screen.getByText(/Feria de Corona publicó este aviso fuera de la app/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Escribirle a quien vende/ })).toBeNull();
    // La salida a la página entera sigue estando, que es donde están sus datos.
    expect(
      screen.getByRole("link", { name: /ver el aviso completo/i }).getAttribute("href"),
    ).toBe(`/marketplace/${PRODUCT_ID}`);
  });

  it("en empleos SÍ se puede postular: una postulación no necesita bandeja del otro lado", () => {
    actions.loadJobContext.mockResolvedValue({ state: "ready", questions: [], profile: null });
    abrirFicha(aviso());

    expect(
      screen.getByRole("button", { name: "Postularme a Ayudante de cocina en Corona" }),
    ).toBeTruthy();
  });
});

/**
 * La acción no puede nacer abajo del pliegue. En un teléfono de 375px la ficha
 * con foto, precio y descripción no entra en 85dvh, así que si el CTA scrollea
 * con el contenido cambiamos "un toque de más" por "un scroll de más" — que
 * para quien mira es lo mismo. Va en un pie anclado, fuera del contenedor que
 * scrollea.
 */
describe("el pie de la ficha", () => {
  it("la acción NO vive dentro del contenedor que scrollea", () => {
    abrirFicha(avisoDeMiembro({ id: PRODUCT_ID, kind: "product", title: "Bici rodado 26" }));

    const boton = screen.getByRole("button", { name: /Escribirle a quien vende/ });
    expect(boton.closest(".overflow-y-auto")).toBeNull();
    // El aviso de seguridad, en cambio, sí scrollea con el resto.
    expect(
      screen.getByRole("note", { name: "Aviso de seguridad" }).closest(".overflow-y-auto"),
    ).not.toBeNull();
  });

  it("un kind sin acción in-situ no dibuja pie y la ficha queda como estaba", () => {
    // Un kind que todavía no existe: sin página propia, el disparador es un
    // botón honesto (no hay `href` que fingir) y no hay acción que montar.
    render(<FeedListingCard listing={avisoDeMiembro({ kind: "otro-vertical", title: "Algo nuevo" })} />);
    fireEvent.click(screen.getByRole("button", { name: /ver detalles/i }));

    expect(fichaAbierta()).toBe(true);
    expect(screen.queryByRole("button", { name: /Postularme/ })).toBeNull();
    expect(screen.queryByLabelText("Escribí tu mensaje")).toBeNull();
  });
});

/**
 * Escape es la salida de la capa de ARRIBA, no de todas a la vez: con el
 * composer abierto tiene que cerrar el composer y dejar la ficha —y el texto
 * escrito— donde estaban. Cerrar las dos de un saque perdería el mensaje.
 */
describe("Escape con el composer abierto", () => {
  it("cierra el composer y deja la ficha abierta", () => {
    abrirFicha(avisoDeMiembro({ id: PRODUCT_ID, kind: "product", title: "Bici rodado 26" }));
    fireEvent.click(screen.getByRole("button", { name: /Escribirle a quien vende/ }));

    const campo = screen.getByLabelText("Escribí tu mensaje");
    fireEvent.keyDown(campo, { key: "Escape" });

    expect(screen.queryByLabelText("Escribí tu mensaje")).toBeNull();
    expect(fichaAbierta()).toBe(true);
  });
});
