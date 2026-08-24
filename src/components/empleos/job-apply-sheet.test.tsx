// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AUTH_REASON, AuthSheetProvider } from "@/components/auth/auth-sheet";
import type { JobQuestion } from "./helpers";
import { JobApplySheet } from "./job-apply-sheet";
import { COPY } from "./copy";

/**
 * Postularse es el momento en que la sección justifica su existencia. Lo que se
 * fija acá: que las respuestas que viajan a la action son EXACTAMENTE las que
 * tocó la persona (boolean para sí/no, el texto literal de la opción elegida),
 * que no se puede avanzar con preguntas sin responder, que el paso de revisión
 * muestra lo que el empleador va a recibir —incluido el efecto de NO compartir
 * el perfil— y que cada código de error del server sale en castellano y no como
 * "own-job".
 */

const actions = vi.hoisted(() => ({
  applyToJobAction: vi.fn(),
  prepareCvUploadAction: vi.fn(),
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));

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
  usePathname: () => "/empleos/job-1",
}));

/**
 * El panel de la hoja de entrada se stubea entero (mismo criterio que
 * `auth-sheet.test.tsx`): trae los formularios de auth y sus server actions, que
 * importan `next/headers`. Acá sólo importa CUÁNDO se monta y qué pasa cuando
 * avisa que hay sesión.
 */
vi.mock("@/components/auth/auth-sheet-panel", () => ({
  AuthSheetPanel: ({ onAuthenticated }: { onAuthenticated: () => void }) => (
    <button type="button" onClick={onAuthenticated}>
      stub-entrar
    </button>
  ),
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
vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock(),
);

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

const PROFILE = {
  displayName: "Rosa Fernández",
  avatarUrl: null,
  areaLabel: "Washington Heights",
  identityVerified: true,
  trust: { score: 72, level: "trusted" },
};

function openSheet(profile = PROFILE) {
  render(
    <JobApplySheet jobId="job-1" questions={QUESTIONS} isLoggedIn profile={profile} />,
  );
  fireEvent.click(screen.getByRole("button", { name: new RegExp(C.cta) }));
}

function answer(questionLabel: string, optionLabel: string) {
  const group = screen.getByRole("group", { name: questionLabel });
  fireEvent.click(within(group).getByRole("button", { name: optionLabel }));
}

/** Responde todo y llega al paso de revisión. */
function fillAndReview() {
  answer(QUESTIONS[0]!.label, C.yes);
  answer(QUESTIONS[1]!.label, "Lunes a viernes");
  fireEvent.click(screen.getByRole("button", { name: C.review.cta }));
}

describe("JobApplySheet", () => {
  beforeEach(() => {
    actions.applyToJobAction.mockReset();
    actions.prepareCvUploadAction.mockReset();
    nav.push.mockReset();
    toasts.toast.mockReset();
  });
  afterEach(cleanup);

  it("manda las respuestas tal cual se tocaron: boolean en sí/no, texto en la opción", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: true });
    openSheet();

    fireEvent.change(screen.getByLabelText(new RegExp(C.messageLabel)), {
      target: { value: "  Puedo empezar el lunes.  " },
    });
    fillAndReview();
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
      cvPath: null,
      portfolioLinks: [],
      shareProfile: true,
    });
  });

  it("'No' viaja como false, no como el string 'No'", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: true });
    openSheet();

    answer(QUESTIONS[0]!.label, C.no);
    answer(QUESTIONS[1]!.label, "Fines de semana");
    fireEvent.click(screen.getByRole("button", { name: C.review.cta }));
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    await screen.findByText(C.successBody);
    expect(actions.applyToJobAction.mock.calls[0]![0].answers[0]).toEqual({
      questionId: "q1",
      answer: false,
    });
  });

  it("sin responder todo no llega a revisión y explica qué falta", () => {
    openSheet();

    answer(QUESTIONS[0]!.label, C.yes); // falta la segunda
    fireEvent.click(screen.getByRole("button", { name: C.review.cta }));

    expect(actions.applyToJobAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(C.errors.unanswered);
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
  });

  it("sin mensaje escrito manda null (el campo es opcional de verdad)", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: true });
    openSheet();

    fillAndReview();
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    await screen.findByText(C.successBody);
    expect(actions.applyToJobAction.mock.calls[0]![0].message).toBeNull();
  });

  it("el paso de revisión muestra el perfil que va a ver quien contrata", () => {
    openSheet();
    fillAndReview();

    expect(screen.getByText(C.review.title)).toBeTruthy();
    expect(screen.getByText(PROFILE.displayName)).toBeTruthy();
    expect(screen.getByText(PROFILE.areaLabel)).toBeTruthy();
  });

  it("al no compartir el perfil, la revisión lo dice y el envío lleva shareProfile:false", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: true });
    openSheet();

    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(C.profile.toggleLabel) }));
    expect(screen.getByText(C.profile.hiddenHint)).toBeTruthy();

    fillAndReview();
    expect(screen.getByText(C.review.profileHidden)).toBeTruthy();
    // El nombre no se muestra en la revisión: es exactamente lo que NO se comparte.
    expect(screen.queryByText(PROFILE.displayName)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: C.submit }));
    await screen.findByText(C.successBody);
    expect(actions.applyToJobAction.mock.calls[0]![0].shareProfile).toBe(false);
  });

  it("un enlace de portafolio inválido frena el paso a revisión", () => {
    openSheet();

    answer(QUESTIONS[0]!.label, C.yes);
    answer(QUESTIONS[1]!.label, "Lunes a viernes");
    fireEvent.change(screen.getByLabelText(C.portfolio.inputLabel(1)), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: C.review.cta }));

    expect(actions.applyToJobAction).not.toHaveBeenCalled();
    expect(screen.getByText(C.portfolio.errorInvalid)).toBeTruthy();
  });

  it("los enlaces válidos viajan limpios, sin renglones vacíos", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: true });
    openSheet();

    fireEvent.change(screen.getByLabelText(C.portfolio.inputLabel(1)), {
      target: { value: "  https://midominio.com  " },
    });
    fillAndReview();
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    await screen.findByText(C.successBody);
    expect(actions.applyToJobAction.mock.calls[0]![0].portfolioLinks).toEqual([
      "https://midominio.com",
    ]);
  });

  it("cada código de error del server sale en castellano, nunca el code crudo", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: false, code: "own-job" });
    openSheet();

    fillAndReview();
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(C.errors.ownJob);
    expect(alert.textContent).not.toContain("own-job");
  });

  it("un rechazo del currículum devuelve al formulario, donde se puede corregir", async () => {
    actions.applyToJobAction.mockResolvedValue({ ok: false, code: "cv" });
    openSheet();

    fillAndReview();
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    expect(await screen.findByText(C.errors.cv)).toBeTruthy();
    // De vuelta en el formulario: el adjunto está acá, no en la pantalla de revisión.
    expect(screen.getByRole("button", { name: new RegExp(C.cv.choose) })).toBeTruthy();
  });

  /**
   * ESTOS DOS TESTS CAMBIARON DE SUJETO EL 2026-08-20, y por qué importa.
   *
   * Antes exigían justo lo que el cliente vino a sacar: que sin sesión la
   * postulación NAVEGARA a /entrar. Uno de los dos casos era el más absurdo de
   * toda la ronda — la hoja ya estaba abierta, con las preguntas respondidas, y
   * el server contestaba "unauthenticated" desde adentro: se expulsaba a alguien
   * de un formulario lleno para mandarlo a una pantalla donde lo perdía todo.
   *
   * Lo que se fija ahora es lo contrario y es lo único que la persona percibe:
   * nadie cambia de ruta, la puerta se abre encima, y al entrar la postulación
   * sigue exactamente donde estaba.
   */
  it("sin sesión DESDE ADENTRO de la hoja abierta: no expulsa, pide la puerta encima y reintenta el envío", async () => {
    actions.applyToJobAction
      .mockResolvedValueOnce({ ok: false, code: "unauthenticated" })
      .mockResolvedValueOnce({ ok: true });
    render(
      <AuthSheetProvider>
        <JobApplySheet jobId="job-1" questions={QUESTIONS} isLoggedIn profile={PROFILE} />
      </AuthSheetProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(C.cta) }));

    fillAndReview();
    fireEvent.click(screen.getByRole("button", { name: C.submit }));

    // La puerta se abre ACÁ MISMO: ni un `router.push`.
    expect(await screen.findByText(AUTH_REASON.apply)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText("stub-entrar"));

    // El envío se reintenta solo y con el MISMO paquete: nada que rehacer.
    expect(await screen.findByText(C.successBody)).toBeTruthy();
    expect(actions.applyToJobAction).toHaveBeenCalledTimes(2);
    expect(actions.applyToJobAction.mock.calls[1]![0]).toEqual(
      actions.applyToJobAction.mock.calls[0]![0],
    );
  });

  it("deslogueado el CTA no navega: abre la puerta y, al entrar, la postulación", async () => {
    render(
      <AuthSheetProvider>
        <JobApplySheet jobId="job-9" questions={QUESTIONS} isLoggedIn={false} profile={null} />
      </AuthSheetProvider>,
    );

    // El CTA es el MISMO que ve quien tiene cuenta: no hay una puerta distinta
    // para quien todavía no entró.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(C.cta) }));
    expect(nav.push).not.toHaveBeenCalled();
    // La postulación no se abrió todavía: primero la cuenta, así nadie escribe
    // media hoja para descubrir al final que le falta entrar.
    expect(screen.queryByText(C.intro)).toBeNull();

    fireEvent.click(await screen.findByText("stub-entrar"));
    expect(await screen.findByText(C.intro)).toBeTruthy();
  });
});
