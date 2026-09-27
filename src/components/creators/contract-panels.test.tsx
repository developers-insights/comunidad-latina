// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  signContract: vi.fn(),
  startPayment: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/app/(app)/creadores/colaboraciones/actions", () => ({
  signContract: state.signContract,
  startPayment: state.startPayment,
  requestTermsChanges: vi.fn(),
  cancelContract: vi.fn(),
  approveDelivery: vi.fn(),
  requestRevision: vi.fn(),
  openDispute: vi.fn(),
  deliveryFileUrl: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: state.refresh, replace: vi.fn() }),
  usePathname: () => "/creadores/colaboraciones/c-1",
}));

import { ToastProvider } from "@/components/ui";
import { FLOW_COPY } from "./flow-copy";
import { PaymentPanel } from "./payment-panel";
import { ReviewPanel } from "./review-panel";
import { SigningPanel } from "./signing-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSigning(youSigned = false) {
  return render(
    <ToastProvider>
      <SigningPanel
        contractId="c-1"
        termsHash={"a".repeat(64)}
        contractText="CONTRATO"
        versionLabel="Versión 1"
        parties={[
          { role: "client", name: "Panadería", signed: true, isYou: false },
          { role: "creator", name: "Ana Rivas", signed: false, isYou: true },
        ]}
        summary={[{ label: "Monto", value: "$1,000" }]}
        cancellation={["Antes de pagar se cancela sin costo."]}
        signatures={[]}
        youSigned={youSigned}
      />
    </ToastProvider>,
  );
}

describe("SigningPanel", () => {
  it("muestra el estado de cada parte", () => {
    renderSigning();
    expect(screen.getByText(FLOW_COPY.signing.signed)).toBeTruthy();
    expect(screen.getByText(FLOW_COPY.signing.waiting)).toBeTruthy();
    expect(screen.getByText(FLOW_COPY.signing.paymentGate)).toBeTruthy();
  });

  it("no deja firmar sin nombre, firma dibujada y casilla", () => {
    renderSigning();
    const submit = screen.getByRole("button", { name: FLOW_COPY.signing.submit });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(FLOW_COPY.signing.legalName), { target: { value: "Ana Rivas" } });
    fireEvent.click(screen.getByLabelText(FLOW_COPY.signing.consent));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(state.signContract).not.toHaveBeenCalled();
  });

  it("si ya firmaste, no vuelve a pedir la firma", () => {
    renderSigning(true);
    expect(screen.getByText(FLOW_COPY.signing.youSigned)).toBeTruthy();
    expect(screen.queryByRole("button", { name: FLOW_COPY.signing.submit })).toBeNull();
  });
});

describe("PaymentPanel", () => {
  it("el creador ve que espera el pago, sin botón de pagar", () => {
    render(
      <ToastProvider>
        <PaymentPanel contractId="c-1" role="creator" amountLabel="$1,000" breakdown={<div />} checkoutOpen={false} returnState={null} />
      </ToastProvider>,
    );
    expect(screen.getByText(FLOW_COPY.payment.creatorWaiting)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pagar/ })).toBeNull();
  });

  it("al volver de Stripe con éxito muestra que se está confirmando y no ofrece pagar de nuevo", () => {
    render(
      <ToastProvider>
        <PaymentPanel contractId="c-1" role="client" amountLabel="$1,000" breakdown={<div />} checkoutOpen returnState="exito" />
      </ToastProvider>,
    );
    expect(screen.getByText(FLOW_COPY.payment.processing)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pagar/ })).toBeNull();
  });

  it("el negocio paga y se lo manda a Stripe", async () => {
    state.startPayment.mockResolvedValue({ ok: true, url: "https://checkout.stripe.test/cs_1", demo: false });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
    render(
      <ToastProvider>
        <PaymentPanel contractId="c-1" role="client" amountLabel="$1,000" breakdown={<div />} checkoutOpen={false} returnState={null} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Pagar \$1,000/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs_1"));
  });
});

describe("ReviewPanel", () => {
  const base = {
    contractId: "c-1",
    delivery: { version: 1, note: "Acá van", createdAtLabel: "hoy", files: [{ path: "t/c-1/v1/u-a.mp4", name: "a.mp4" }] },
    deadlineIso: new Date(Date.now() + 66 * 3_600_000 + 30 * 60_000).toISOString(),
    deadlineLabel: "30 sept",
    revisionsIncluded: 2,
    revisionsUsed: 2,
    netAmountLabel: "$800",
  };

  it("muestra el tiempo que queda y el monto a liberar", () => {
    render(
      <ToastProvider>
        <ReviewPanel {...base} role="client" />
      </ToastProvider>,
    );
    expect(screen.getByText("2 días 18 horas")).toBeTruthy();
    expect(screen.getByRole("button", { name: FLOW_COPY.review.approve("$800") })).toBeTruthy();
  });

  it("sin revisiones disponibles, el botón de revisión está apagado", () => {
    render(
      <ToastProvider>
        <ReviewPanel {...base} role="client" />
      </ToastProvider>,
    );
    const button = screen.getByRole("button", { name: new RegExp(FLOW_COPY.review.requestRevision) });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(FLOW_COPY.review.noRevisionsLeft)).toBeTruthy();
  });

  it("el creador no ve los botones del negocio", () => {
    render(
      <ToastProvider>
        <ReviewPanel {...base} role="creator" />
      </ToastProvider>,
    );
    expect(screen.queryByRole("button", { name: FLOW_COPY.review.approve("$800") })).toBeNull();
    expect(screen.getByText(FLOW_COPY.review.creatorWaiting("30 sept"))).toBeTruthy();
  });
});
