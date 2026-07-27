// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JobQuestion } from "./helpers";
import { JobApplySheet } from "./job-apply-sheet";
import { COPY } from "./copy";

/**
 * Postularse es el momento en que la sección justifica su existencia. Lo que se
 * fija acá: que las respuestas que viajan a la action son EXACTAMENTE las que
 * tocó la persona (boolean para sí/no, el texto literal de la opción elegida),
 * que no se puede enviar con preguntas sin responder, y que cada código de
 * error del server sale en castellano y no como "own-job".
 */

const actions = vi.hoisted(() => ({
  applyToJobAction: vi.fn(),
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/app/(app)/empleos/actions", () => ({
  applyToJobAction: actions.applyToJobAction,
  updateJobApplicationAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/empleos/job-1",
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

const C = COPY.apply;

const QUESTIONS: JobQuestion[] = [
  { id: "q1", type: "yes_no", label: "¿Tenés experiencia cuidando niños?" },
  {
    id: "q2",
    type: "multiple_choice",
    label: "¿Qué días podés trabajar?",
    options: ["Lunes a viernes", "Fines de semana"],
  },
];

function openSheet() {
  render(<JobApplySheet jobId="job-1" questions={QUESTIONS} isLoggedIn />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(C.cta) }));
}

function answer(questionLabel: string, optionLabel: string) {
  const group = screen.getByRole("group", { name: questionLabel });
  fireEvent.click(within(group).getByRole("button", { name: optionLabel }));
}

describe("JobApplySheet", () => {
  beforeEach(() => {
    actions.applyToJobAction.mockReset();
    nav.push.mockReset();
    toasts.toast.mockReset();
  });
  afterEach(cleanup);

  it("manda las respuestas tal cual se tocaron: boolean en sí/no, texto en la opción", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: true });
    openSheet();

    answer(QUESTIONS[0]!.label, C.yes);
    answer(QUESTIONS[1]!.label, "Lunes a viernes");
    fireEvent.change(screen.getByLabelText(new RegExp(C.messageLabel)), {
      target: { value: "  Puedo empezar el lunes.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    expect(await screen.findByText(C.successBody)).toBeTruthy();
    expect(actions.applyToJobAction).toHaveBeenCalledWith({
      jobId: "job-1",
      // El mensaje viaja recortado: nadie quiere leer los espacios de más.
      message: "Puedo empezar el lunes.",
      answers: [
        { questionId: "q1", answer: true },
        { questionId: "q2", answer: "Lunes a viernes" },
      ],
    });
  });

  it("'No' viaja como false, no como el string 'No'", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: true });
    openSheet();

    answer(QUESTIONS[0]!.label, C.no);
    answer(QUESTIONS[1]!.label, "Fines de semana");
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    await screen.findByText(C.successBody);
    expect(actions.applyToJobAction.mock.calls[0]![0].answers[0]).toEqual({
      questionId: "q1",
      answer: false,
    });
  });

  it("sin responder todo no llama a la action y explica qué falta", () => {
    openSheet();

    answer(QUESTIONS[0]!.label, C.yes); // falta la segunda
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    expect(actions.applyToJobAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(C.errors.unanswered);
  });

  it("sin mensaje escrito manda null (el campo es opcional de verdad)", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: true });
    openSheet();

    answer(QUESTIONS[0]!.label, C.yes);
    answer(QUESTIONS[1]!.label, "Lunes a viernes");
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    await screen.findByText(C.successBody);
    expect(actions.applyToJobAction.mock.calls[0]![0].message).toBeNull();
  });

  it("cada código de error del server sale en castellano, nunca el code crudo", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: false, code: "own-job" });
    openSheet();

    answer(QUESTIONS[0]!.label, C.yes);
    answer(QUESTIONS[1]!.label, "Lunes a viernes");
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(C.errors.ownJob);
    expect(alert.textContent).not.toContain("own-job");
  });

  it("sin sesión el server manda a entrar y vuelve al aviso", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: false, code: "unauthenticated" });
    openSheet();

    answer(QUESTIONS[0]!.label, C.yes);
    answer(QUESTIONS[1]!.label, "Lunes a viernes");
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    await vi.waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith(
        `/entrar?next=${encodeURIComponent("/empleos/job-1")}`,
      ),
    );
  });

  it("deslogueado el CTA lleva a entrar en vez de abrir la hoja", () => {
    render(<JobApplySheet jobId="job-9" questions={QUESTIONS} isLoggedIn={false} />);

    const link = screen.getByRole("link", { name: new RegExp(C.ctaLoggedOut) });
    expect(link.getAttribute("href")).toBe(`/entrar?next=${encodeURIComponent("/empleos/job-9")}`);
    expect(screen.queryByText(C.intro)).toBeNull();
  });
});
