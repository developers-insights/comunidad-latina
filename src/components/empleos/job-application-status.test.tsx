// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobApplicationStatus } from "./job-application-status";
import { COPY } from "./copy";

/**
 * La tarjeta de estado reemplaza al CTA una vez que la persona se postuló. Lo
 * que se fija acá es el contrato con el usuario: cada estado dice lo que
 * realmente pasó y ofrece la ÚNICA salida que existe. En particular, ningún
 * estado resuelto vuelve a ofrecer postularse —la tabla tiene un registro único
 * por (aviso, persona)— ni ofrece retirarse, porque el embudo de 0047 solo
 * avanza y la base rechazaría el intento.
 */

const actions = vi.hoisted(() => ({ withdrawJobApplicationAction: vi.fn() }));
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/app/(app)/empleos/actions", () => ({
  withdrawJobApplicationAction: actions.withdrawJobApplicationAction,
  applyToJobAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }),
  usePathname: () => "/empleos/job-1",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui")>("@/components/ui");
  return { ...actual, useToast: () => ({ toast: toasts.toast }) };
});

const C = COPY.apply.status;

describe("JobApplicationStatus", () => {
  beforeEach(() => {
    actions.withdrawJobApplicationAction.mockReset();
    nav.refresh.mockReset();
    toasts.toast.mockReset();
  });
  afterEach(cleanup);

  it("enviada: dice que todavía no la abrieron y deja retirarla", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "submitted" }} />);

    expect(screen.getByText(C.submittedTitle)).toBeTruthy();
    expect(screen.getByText(C.submittedBody)).toBeTruthy();
    expect(screen.getByRole("button", { name: C.withdraw })).toBeTruthy();
  });

  it("en revisión: sigue viva, así que todavía se puede retirar", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "reviewing" }} />);

    expect(screen.getByText(C.reviewingTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: C.withdraw })).toBeTruthy();
  });

  it("entrevista: manda a Mensajes, que es donde se acuerda el día", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "interview" }} />);

    expect(screen.getByText(C.interviewTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: new RegExp(C.goToMessages) }).getAttribute("href"),
    ).toBe("/mensajes");
  });

  it("contratado: celebra y manda a Mensajes; ya no se puede retirar", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "hired" }} />);

    expect(screen.getByText(C.hiredTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: new RegExp(C.goToMessages) }).getAttribute("href"),
    ).toBe("/mensajes");
    expect(screen.queryByRole("button", { name: C.withdraw })).toBeNull();
  });

  it("no seleccionado: tono neutro y la salida es seguir mirando empleos", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "rejected" }} />);

    expect(screen.getByText(C.rejectedTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: C.browseMore }).getAttribute("href")).toBe("/empleos");
    expect(screen.queryByRole("button", { name: C.withdraw })).toBeNull();
  });

  it("vacante cerrada: explica que no hay nada que hacer", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "closed" }} />);

    expect(screen.getByText(C.closedTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: C.browseMore })).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.withdraw })).toBeNull();
  });

  it("retirada: lo dice de frente y NO reabre la postulación", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "withdrawn" }} />);

    expect(screen.getByText(C.withdrawnTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: C.browseMore })).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.withdraw })).toBeNull();
    expect(screen.queryByText(COPY.apply.cta)).toBeNull();
  });

  it("retirar PIDE CONFIRMACIÓN antes de tocar el server: no tiene vuelta atrás", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "submitted" }} />);

    fireEvent.click(screen.getByRole("button", { name: C.withdraw }));

    expect(screen.getByText(C.withdrawConfirmTitle)).toBeTruthy();
    expect(actions.withdrawJobApplicationAction).not.toHaveBeenCalled();
  });

  it("confirmado, pasa la tarjeta al estado 'retirada' y avisa", async () => {
    actions.withdrawJobApplicationAction.mockResolvedValue({ ok: true });
    render(<JobApplicationStatus application={{ id: "a1", status: "submitted" }} />);

    fireEvent.click(screen.getByRole("button", { name: C.withdraw }));
    fireEvent.click(screen.getByRole("button", { name: C.withdrawConfirm }));

    expect(await screen.findByText(C.withdrawnTitle)).toBeTruthy();
    expect(actions.withdrawJobApplicationAction).toHaveBeenCalledWith({ applicationId: "a1" });
    expect(toasts.toast).toHaveBeenCalledWith({ variant: "info", title: C.withdrawn });
  });

  it("si el server rechaza el retiro, la tarjeta NO miente: sigue enviada", async () => {
    actions.withdrawJobApplicationAction.mockResolvedValue({ ok: false, code: "error" });
    render(<JobApplicationStatus application={{ id: "a1", status: "submitted" }} />);

    fireEvent.click(screen.getByRole("button", { name: C.withdraw }));
    fireEvent.click(screen.getByRole("button", { name: C.withdrawConfirm }));

    await vi.waitFor(() =>
      expect(toasts.toast).toHaveBeenCalledWith({
        variant: "danger",
        title: C.withdrawError,
      }),
    );
    expect(screen.getByText(C.submittedTitle)).toBeTruthy();
  });
});
