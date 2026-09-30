// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ServiceOwnerMenu } from "./service-owner-menu";
import { EDICION_COPY } from "@/lib/listings/edicion";

/**
 * El gate visual de "Editar" en un servicio: sólo el dueño ve el menú. No es la
 * seguridad (esa vive en las actions y la RLS), pero es lo que decide si alguien
 * ve un botón que promete algo que no podría cumplir.
 */

const actions = vi.hoisted(() => ({
  cargarServicioParaEditar: vi.fn(),
  editarServicioAction: vi.fn(),
  pausarAvisoAction: vi.fn(),
  eliminarAvisoAction: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: actions.refresh }),
  usePathname: () => "/empleos",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());
vi.mock("@/components/ui", async () => {
  const real = await vi.importActual<typeof import("@/components/ui")>("@/components/ui");
  return { ...real, useToast: () => ({ toast: actions.toast }) };
});
vi.mock("@/app/(app)/empleos/editar-servicio-actions", () => ({
  cargarServicioParaEditar: actions.cargarServicioParaEditar,
  editarServicioAction: actions.editarServicioAction,
}));
vi.mock("@/app/(app)/publicaciones/editar-actions", () => ({
  pausarAvisoAction: actions.pausarAvisoAction,
  cargarAvisoParaEditar: vi.fn(),
  editarAvisoAction: vi.fn(),
}));
vi.mock("@/app/(app)/publicaciones/eliminar-action", () => ({
  eliminarAvisoAction: actions.eliminarAvisoAction,
}));

afterEach(cleanup);

const BASE = {
  listingId: "44444444-4444-4444-8444-444444444444",
  title: "Jardinería y corte de pasto",
};

const SERVICIO = {
  id: BASE.listingId,
  status: "published",
  title: "Jardinería y corte de pasto",
  description: "Corto el pasto, podo y limpio patios. Llevo mi propia máquina.",
  priceAmount: 25,
  payPeriod: "hour",
  workMode: "presencial",
  areaLabel: "Corona, Queens",
  days: ["sat", "sun"],
  schedule: "de 8 a 14",
  currency: "USD",
  bloqueadoPorModeracion: false,
  tier: "free",
  video: null,
  videoDisponible: false,
};

describe("ServiceOwnerMenu", () => {
  it("sobre un servicio ajeno no dibuja nada", () => {
    const { container } = render(<ServiceOwnerMenu {...BASE} esMio={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("el dueño ve el ⋯ y adentro la fila Editar", () => {
    render(<ServiceOwnerMenu {...BASE} esMio />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(BASE.title) }));
    expect(screen.getByRole("button", { name: EDICION_COPY.menu.editar })).toBeTruthy();
  });

  it("Editar abre el formulario del servicio precargado y guarda con la action", async () => {
    actions.cargarServicioParaEditar.mockResolvedValue({ ok: true, servicio: SERVICIO });
    actions.editarServicioAction.mockResolvedValue({ ok: true, status: "published" });
    const onGuardado = vi.fn();
    render(<ServiceOwnerMenu {...BASE} esMio onGuardado={onGuardado} />);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(BASE.title) }));
    fireEvent.click(screen.getByRole("button", { name: EDICION_COPY.menu.editar }));

    const titulo = (await screen.findByLabelText(/Tu servicio/)) as HTMLInputElement;
    expect(titulo.value).toBe(SERVICIO.title);
    expect((screen.getByLabelText(/^Zona/) as HTMLInputElement).value).toBe("Corona, Queens");
    expect((screen.getByLabelText(/^Horario/) as HTMLInputElement).value).toBe("de 8 a 14");

    fireEvent.change(titulo, { target: { value: "Jardinería, poda y corte" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(actions.editarServicioAction).toHaveBeenCalledTimes(1));
    expect(actions.editarServicioAction.mock.calls[0][0]).toMatchObject({
      listingId: BASE.listingId,
      title: "Jardinería, poda y corte",
      workMode: "presencial",
      days: ["sat", "sun"],
    });
    await waitFor(() => expect(onGuardado).toHaveBeenCalled());
    expect(onGuardado.mock.calls[0][0]).toMatchObject({ title: "Jardinería, poda y corte" });
  });

  it("muestra el error del servidor en vez de cerrar", async () => {
    actions.cargarServicioParaEditar.mockResolvedValue({ ok: true, servicio: SERVICIO });
    actions.editarServicioAction.mockResolvedValue({
      ok: false,
      error: EDICION_COPY.errores.noEsTuya,
    });
    render(<ServiceOwnerMenu {...BASE} esMio />);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(BASE.title) }));
    fireEvent.click(screen.getByRole("button", { name: EDICION_COPY.menu.editar }));
    const titulo = await screen.findByLabelText(/Tu servicio/);
    fireEvent.change(titulo, { target: { value: "Jardinería, poda y corte" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText(EDICION_COPY.errores.noEsTuya)).toBeTruthy();
  });
});

describe("ServiceOwnerMenu · volver a publicar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function reactivar() {
    render(<ServiceOwnerMenu {...BASE} esMio status="paused" />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(BASE.title) }));
    fireEvent.click(await waitFor(() => screen.getByText(EDICION_COPY.menu.reactivar)));
    await waitFor(() => expect(actions.toast).toHaveBeenCalled());
    return actions.toast.mock.calls[0][0];
  }

  it("si volvió a la vista, lo dice en vez de prometer una revisión", async () => {
    actions.pausarAvisoAction.mockResolvedValue({ ok: true, status: "published" });
    expect(await reactivar()).toMatchObject({ title: EDICION_COPY.ok.reactivadaVisibleTitulo });
  });

  it("si quedó en revisión, avisa que la mandamos a revisión", async () => {
    actions.pausarAvisoAction.mockResolvedValue({ ok: true, status: "pending_review" });
    expect(await reactivar()).toMatchObject({ title: EDICION_COPY.ok.reactivadaTitulo });
  });
});
