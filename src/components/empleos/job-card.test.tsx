// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JobCardModel } from "@/app/(app)/empleos/queries";
import { JobCard } from "./job-card";
import { COPY } from "./copy";

/**
 * La card de empleo tiene que aguantar el caso que MÁS se va a dar: un aviso
 * SIN foto (nadie le saca una foto a "busco niñera"). Lo que se fija acá es que
 * sin foto la card no se vacía — el pago y el puesto siguen siendo lo que se
 * lee — y que el monto está siempre presente, aunque el aviso no traiga número.
 *
 * Y el reparto de gestos, que ahora son TRES:
 *  · la FOTO abre el visor con todas las fotos del aviso (feedback 2026-07-26);
 *  · "Postularme" RESUELVE en el listado — abre la hoja, no navega a ningún
 *    lado (cliente 2026-08-20: "mientras menos pasos mejor");
 *  · "Ver empleo" es el ÚNICO que navega, y quedó como acción secundaria.
 *
 * El tercer bloque es el que protege la mejora: si alguien vuelve a convertir
 * "Postularme" en un <Link>, o si la hoja deja de montarse desde la card,
 * postularse vuelve a costar dos pantallas y nadie se entera hasta producción.
 */

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const context = vi.hoisted(() => ({ load: vi.fn() }));
// La hoja de autenticación se pide por hook. Acá se registra el pedido y se
// guarda el `onAuthenticated` para poder ejecutarlo como si la persona hubiera
// entrado sin salir del listado.
const authGate = vi.hoisted(() => ({
  calls: [] as { reason?: string; onAuthenticated?: () => void }[],
}));
const actions = vi.hoisted(() => ({
  applyToJobAction: vi.fn(),
  prepareCvUploadAction: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/components/feed/media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open }),
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { apply: "Entrá y mandá tu postulación" },
  useRequireAuth: () => (args: { reason?: string; onAuthenticated?: () => void }) => {
    authGate.calls.push(args ?? {});
  },
}));

vi.mock("@/app/(app)/empleos/apply-context-action", () => ({
  loadJobApplyContextAction: context.load,
}));

vi.mock("@/app/(app)/empleos/actions", () => ({
  applyToJobAction: actions.applyToJobAction,
  prepareCvUploadAction: actions.prepareCvUploadAction,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ remove: vi.fn() }) },
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/empleos",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

// useToast lanza fuera de su provider: reemplazamos SOLO ese hook.
vi.mock("@/components/ui", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui")>("@/components/ui");
  return { ...actual, useToast: () => ({ toast: toasts.toast }) };
});

// motion neutralizado: la hoja aparece en el DOM al instante.
vi.mock("motion/react", () => {
  const filter = (props: Record<string, unknown>) => {
    const {
      layout,
      initial,
      animate,
      exit,
      transition,
      drag,
      dragConstraints,
      dragElastic,
      onDragEnd,
      whileTap,
      whileHover,
      ...rest
    } = props;
    return rest;
  };
  const div = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div {...filter(props)}>{children}</div>
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { div },
    motion: { div },
    useReducedMotion: () => true,
  };
});

const C = COPY.list;

const BASE: JobCardModel = {
  id: "job-1",
  title: "Niñera para dos nenes, tardes",
  salaryLabel: "US$ 18/hora",
  // Sin techo cargado, el rango es igual al piso — que es lo que devuelve
  // `etiquetaDeSalario` cuando `attrs.salary_max` viene vacío (el caso común).
  salaryRangeLabel: "US$ 18/hora",
  workMode: null,
  employmentType: "part_time",
  areaLabel: "Washington Heights",
  photoUrl: null,
  photos: [],
  publisher: { type: "external", name: "Rosa Medina" },
  boosted: false,
};

const CON_FOTOS: JobCardModel = {
  ...BASE,
  photoUrl: "https://cdn.example.com/local.webp",
  photos: ["https://cdn.example.com/local.webp", "https://cdn.example.com/local-2.webp"],
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

function applyButton() {
  return screen.getByRole("button", { name: /^postularme a /i });
}

function detailLink() {
  return screen.getByRole("link", { name: new RegExp(C.viewJob) });
}

beforeEach(() => {
  viewer.open.mockReset();
  nav.push.mockReset();
  nav.refresh.mockReset();
  actions.applyToJobAction.mockReset();
  context.load.mockReset();
  context.load.mockResolvedValue({ state: "ready", questions: [], profile: null });
});
afterEach(cleanup);

describe("JobCard", () => {
  it("con foto: la muestra y mantiene el pago como dato protagonista", () => {
    const { container } = render(<JobCard job={CON_FOTOS} />);

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/local.webp");
    expect(screen.getByText("US$ 18/hora")).toBeTruthy();
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
  });

  it("sin foto: no hay <img> pero el pago y el puesto siguen a la vista", () => {
    const { container } = render(<JobCard job={BASE} />);

    // El fallback del módulo es un gradiente + ícono (svg), nunca un <img> roto.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("US$ 18/hora")).toBeTruthy();
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
    expect(screen.getByText("Washington Heights")).toBeTruthy();
  });

  it("sin monto cargado dice 'Pago a convenir' en vez de dejar el hueco", () => {
    // Los dos en null y no sólo `salaryLabel`: sin piso cargado
    // `etiquetaDeSalario` también devuelve null (no hay rango que armar sin
    // desde dónde). Dejar el rango con valor acá probaría un estado que la
    // query no puede producir.
    render(<JobCard job={{ ...BASE, salaryLabel: null, salaryRangeLabel: null }} />);
    expect(screen.getByText(C.salaryToAgree)).toBeTruthy();
  });

  it("con techo cargado muestra el rango completo, no sólo el piso", () => {
    render(<JobCard job={{ ...BASE, salaryRangeLabel: "US$ 18 a US$ 22/hora" }} />);
    expect(screen.getByText("US$ 18 a US$ 22/hora")).toBeTruthy();
  });

  it("muestra la jornada del aviso y omite el chip si no la tiene", () => {
    const { unmount } = render(<JobCard job={BASE} />);
    expect(screen.getByText("Medio tiempo")).toBeTruthy();
    unmount();

    render(<JobCard job={{ ...BASE, employmentType: null }} />);
    expect(screen.queryByText("Medio tiempo")).toBeNull();
    expect(screen.queryByText("Tiempo completo")).toBeNull();
  });
});

describe("JobCard: la foto abre el visor, solo 'Ver empleo' navega", () => {
  it("tocar la foto abre el visor con TODAS las fotos del aviso", () => {
    render(<JobCard job={CON_FOTOS} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(viewer.open).toHaveBeenCalledWith({
      items: [
        { kind: "image", url: "https://cdn.example.com/local.webp" },
        { kind: "image", url: "https://cdn.example.com/local-2.webp" },
      ],
      authorName: CON_FOTOS.title,
    });
  });

  it("el ÚNICO link de la card sigue siendo el detalle: ni la foto ni postularse navegan", () => {
    render(<JobCard job={CON_FOTOS} />);
    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/empleos/job-1");
  });

  it("'Ver empleo' navega al detalle, se nombra con el puesto y NO abre el visor", () => {
    render(<JobCard job={CON_FOTOS} />);
    const link = detailLink();

    // Label-in-name (2.5.3): el nombre accesible contiene el texto visible.
    expect(link.getAttribute("aria-label")).toBe(`${C.viewJob}: ${CON_FOTOS.title}`);
    fireEvent.click(link);
    expect(viewer.open).not.toHaveBeenCalled();
  });

  it("sin foto no hay área tocable: el gradiente del módulo no abre visor", () => {
    render(<JobCard job={BASE} />);
    expect(screen.queryByRole("button", { name: /ver fotos de/i })).toBeNull();
  });
});

describe("JobCard: postularse se resuelve en la lista", () => {
  it("'Postularme' es un BOTÓN, no un link — no puede navegar aunque se quiera", () => {
    render(<JobCard job={BASE} />);
    expect(applyButton().tagName).toBe("BUTTON");
    expect(screen.queryByRole("link", { name: /postularme/i })).toBeNull();
  });

  it("abre la hoja SOBRE el listado: aparece el diálogo y nadie navega", async () => {
    render(<JobCard job={BASE} />);
    fireEvent.click(applyButton());

    const sheet = await screen.findByRole("dialog");
    expect(sheet).toBeTruthy();
    expect(context.load).toHaveBeenCalledWith("job-1");
    expect(nav.push).not.toHaveBeenCalled();
    // El link al detalle sigue siendo el único: la hoja no agregó navegación.
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/empleos/job-1")).toBe(
      true,
    );
  });

  it("si ya se había postulado no abre formulario: lo dice y listo", async () => {
    context.load.mockResolvedValue({ state: "already-applied" });
    render(<JobCard job={BASE} />);
    fireEvent.click(applyButton());

    expect(await screen.findByText("Ya te postulaste")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("si el aviso es suyo lo explica en una línea, sin cartel de error", async () => {
    context.load.mockResolvedValue({ state: "own-job" });
    render(<JobCard job={BASE} />);
    fireEvent.click(applyButton());

    expect(await screen.findByText("Este aviso es tuyo.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * Antes esto navegaba a /entrar y volvía al DETALLE del aviso: postularse sin
   * cuenta costaba salir de la app, volver a otra pantalla y arrancar de nuevo.
   * Desde 2026-08-20 la sesión se pide encima del listado y el intento se
   * reanuda solo — cero navegaciones también para quien todavía no tiene
   * cuenta, que en un tablero de empleos es la mitad de la gente que llega.
   */
  it("sin sesión pide entrar SIN navegar, y al volver reintenta solo", async () => {
    authGate.calls.length = 0;
    context.load.mockResolvedValue({ state: "unauthenticated" });
    render(<JobCard job={BASE} />);
    fireEvent.click(applyButton());

    await waitFor(() => expect(authGate.calls).toHaveLength(1));
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    // Entró: el reintento vuelve a pedir el contexto, ahora con sesión, y la
    // hoja de postulación se abre sin que haya que tocar el botón otra vez.
    context.load.mockResolvedValue({
      state: "ready",
      questions: [],
      profile: { displayName: "Ana", avatarUrl: null },
    });
    authGate.calls[0].onAuthenticated?.();

    await waitFor(() => expect(context.load).toHaveBeenCalledTimes(2));
    expect(nav.push).not.toHaveBeenCalled();
  });
});
