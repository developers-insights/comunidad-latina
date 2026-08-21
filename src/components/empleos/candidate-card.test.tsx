// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Escribirle a un candidato tiraba a `/mensajes/[id]`, así que quien estaba
 * revisando doce postulaciones —con su filtro puesto y su scroll hecho— caía
 * adentro de un hilo y volvía a empezar (cliente 2026-08-20: "mientras menos
 * pasos mejor").
 *
 * Las dos garantías de esta tarjeta:
 *  1. abrir el chat NO navega: el hilo queda como una opción en la confirmación;
 *  2. si el hilo YA existía, se dice. Es la diferencia entre "esta persona
 *     todavía no se enteró de nada" y "hay una conversación con historia que
 *     conviene leer antes de escribir", y quien contrata necesita saber cuál es.
 */

const actions = vi.hoisted(() => ({
  startCandidateConversationAction: vi.fn(),
  saveCandidateAction: vi.fn(),
  removeSavedCandidateAction: vi.fn(),
  advanceJobApplicationAction: vi.fn(),
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/app/(app)/empleos/actions", () => actions);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/empleos/job-1/candidatos",
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

// El Trust Score y sus fuentes son de otro módulo y tienen sus propios tests.
vi.mock("@/components/listings", () => ({
  PublisherTrust: () => null,
  firstNameOf: (name: string) => name,
  toTrustLevel: () => "medio",
}));

// Estos dos hablan con sus propias actions; acá sólo estorban.
vi.mock("./candidate-note", () => ({ CandidateNote: () => null }));
vi.mock("./cv-download-button", () => ({ CvDownloadButton: () => null }));

import { CandidateCard } from "./candidate-card";
import type { JobCandidateView } from "@/app/(app)/empleos/queries";
import { COPY } from "./copy";

const C = COPY.candidates;

const CANDIDATE: JobCandidateView = {
  id: "44444444-4444-4444-8444-444444444444",
  applicantId: "99999999-9999-4999-8999-999999999999",
  status: "submitted",
  createdAtLabel: "hace 2 días",
  message: "Tengo cinco años de experiencia.",
  answers: [],
  hasCv: false,
  portfolioLinks: [],
  profile: {
    displayName: "Rosa Pérez",
    avatarUrl: null,
    areaLabel: "Miami",
    identityVerified: false,
    trust: null,
  },
  note: null,
  saved: false,
};

function renderCard(overrides: Partial<JobCandidateView> = {}) {
  return render(
    <ul>
      <CandidateCard candidate={{ ...CANDIDATE, ...overrides }} trustSignals={[]} />
    </ul>,
  );
}

beforeEach(() => {
  actions.startCandidateConversationAction.mockReset();
  actions.saveCandidateAction.mockReset();
  actions.removeSavedCandidateAction.mockReset();
  actions.advanceJobApplicationAction.mockReset();
  nav.push.mockReset();
  toasts.toast.mockReset();
});

afterEach(cleanup);

describe("CandidateCard · escribirle sin perder la lista", () => {
  it("abrir el chat no navega: confirma acá y deja el hilo como opción", async () => {
    actions.startCandidateConversationAction.mockResolvedValue({
      ok: true,
      conversationId: "conv-8",
      reused: false,
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: C.sendMessage }));

    // El texto tiene que decir lo que DE VERDAD pasó: la conversación nace en
    // `pending` y `sendMessageAction` no deja escribir hasta que la aceptan
    // (revisión de código 2026-08-21). Prometer "ya podés escribirle" mandaba a
    // un hilo sin campo de texto.
    expect(await screen.findByText("Le mandamos tu solicitud")).toBeTruthy();
    expect(screen.queryByText(/Ya podés escribirle/)).toBeNull();
    // Y tampoco puede decir que no le llegó nada: la bandeja lista los pending.
    expect(screen.queryByText(/Todavía no le llegó nada/)).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Ver la solicitud/ }).getAttribute("href")).toBe(
      "/mensajes/conv-8",
    );
    // Y la tarjeta sigue entera: la lista de postulantes no se movió.
    expect(screen.getByText("Rosa Pérez")).toBeTruthy();
  });

  it("si el hilo ya existía lo dice, en vez de anunciarlo como recién abierto", async () => {
    actions.startCandidateConversationAction.mockResolvedValue({
      ok: true,
      conversationId: "conv-8",
      reused: true,
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: C.sendMessage }));

    expect(await screen.findByText("Ya tenían un chat abierto")).toBeTruthy();
    expect(screen.queryByText("Le mandamos tu solicitud")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("un fallo del servidor se cuenta y no deja una confirmación falsa", async () => {
    actions.startCandidateConversationAction.mockResolvedValue({
      ok: false,
      code: "error",
      message: "Esta persona ya no está disponible.",
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: C.sendMessage }));

    await vi.waitFor(() => expect(toasts.toast).toHaveBeenCalled());
    expect(toasts.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Esta persona ya no está disponible." }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("sin perfil compartido no se ofrece el chat", () => {
    renderCard({ applicantId: null, profile: null });

    expect(screen.queryByRole("button", { name: C.sendMessage })).toBeNull();
  });
});
