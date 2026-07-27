// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobApplicationStatus } from "./job-application-status";
import { COPY } from "./copy";

/**
 * La tarjeta de estado reemplaza al CTA una vez que la persona se postuló. Lo
 * que se fija acá es el contrato con el usuario: cada estado dice lo que
 * realmente pasó y ofrece la ÚNICA salida que existe. En particular, retirada o
 * rechazada NO vuelven a ofrecer postularse — la tabla tiene un registro único
 * por (aviso, persona) y un segundo intento chocaría contra el unique.
 */

const actions = vi.hoisted(() => ({ updateJobApplicationAction: vi.fn() }));
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/app/(app)/empleos/actions", () => ({
  updateJobApplicationAction: actions.updateJobApplicationAction,
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
    actions.updateJobApplicationAction.mockReset();
    nav.refresh.mockReset();
    toasts.toast.mockReset();
  });
  afterEach(cleanup);

  it("enviada: dice que está en revisión y deja retirarla", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "submitted" }} />);

    expect(screen.getByText(C.submittedTitle)).toBeTruthy();
    expect(screen.getByText(C.submittedBody)).toBeTruthy();
    expect(screen.getByRole("button", { name: C.withdraw })).toBeTruthy();
  });

  it("aceptada: celebra y manda a Mensajes, que es donde sigue la conversación", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "accepted" }} />);

    expect(screen.getByText(C.acceptedTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: new RegExp(C.goToMessages) }).getAttribute("href")).toBe(
      "/mensajes",
    );
    expect(screen.queryByRole("button", { name: C.withdraw })).toBeNull();
  });

  it("rechazada: tono neutro y la salida es seguir mirando empleos", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "declined" }} />);

    expect(screen.getByText(C.declinedTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: C.browseMore }).getAttribute("href")).toBe("/empleos");
    expect(screen.queryByRole("button", { name: C.withdraw })).toBeNull();
  });

  it("retirada: lo dice de frente y NO reabre la postulación", () => {
    render(<JobApplicationStatus application={{ id: "a1", status: "withdrawn" }} />);

    expect(screen.getByText(C.withdrawnTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: C.browseMore })).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.withdraw })).toBeNull();
    expect(screen.queryByText(COPY.apply.cta)).toBeNull();
  });

  it("retirar pasa la tarjeta al estado 'retirada' y avisa", async () => {
    actions.updateJobApplicationAction.mockResolvedValue({ ok: true, status: "withdrawn" });
    render(<JobApplicationStatus application={{ id: "a1", status: "submitted" }} />);

    fireEvent.click(screen.getByRole("button", { name: C.withdraw }));

    expect(await screen.findByText(C.withdrawnTitle)).toBeTruthy();
    expect(actions.updateJobApplicationAction).toHaveBeenCalledWith({
      applicationId: "a1",
      action: "withdraw",
    });
    expect(toasts.toast).toHaveBeenCalledWith({ variant: "info", title: C.withdrawn });
  });

  it("si el server rechaza el retiro, la tarjeta NO miente: sigue enviada", async () => {
    actions.updateJobApplicationAction.mockResolvedValue({ ok: false, code: "error" });
    render(<JobApplicationStatus application={{ id: "a1", status: "submitted" }} />);

    fireEvent.click(screen.getByRole("button", { name: C.withdraw }));

    await vi.waitFor(() =>
      expect(toasts.toast).toHaveBeenCalledWith({
        variant: "danger",
        title: C.withdrawError,
      }),
    );
    expect(screen.getByText(C.submittedTitle)).toBeTruthy();
  });
});
