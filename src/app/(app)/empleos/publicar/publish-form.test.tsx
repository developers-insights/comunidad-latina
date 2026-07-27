// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";
import { COPY } from "@/components/empleos/copy";
import { MAX_JOB_QUESTIONS } from "@/components/empleos/helpers";

/**
 * Wizard de /empleos/publicar, con foco en el BUILDER DE PREGUNTAS (la pieza
 * propia del módulo: hasta 5 preguntas sí/no u opción múltiple que viajan en
 * `attrs.questions`).
 *
 * Lo que se garantiza acá:
 *  - agregar / quitar preguntas y cambiar el tipo sin perder lo escrito;
 *  - una opción múltiple NO deja avanzar sin 2 opciones completas;
 *  - se puede publicar SIN preguntas y SIN fotos (los dos son opcionales);
 *  - el payload respeta el contrato: yes_no jamás lleva `options`.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// El módulo de motion toca matchMedia / IntersectionObserver, que jsdom no
// implementa: acá solo interesa el contenido, no la coreografía.
vi.mock("@/components/motion", () => ({
  Celebration: () => null,
  Reveal: ({ children, as }: { children: React.ReactNode; as?: string }) =>
    as === "li" ? <li>{children}</li> : <div>{children}</div>,
  useCelebration: () => ({ celebrating: false, celebrate: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1", app_metadata: { tenant_id: "tenant-1" } } },
        error: null,
      }),
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));

const mocks = vi.hoisted(() => ({
  createJobDraft: vi.fn(),
  finalizeJob: vi.fn(),
}));

vi.mock("./actions", () => ({
  createJobDraft: mocks.createJobDraft,
  finalizeJob: mocks.finalizeJob,
}));

import { JobPublishForm } from "./publish-form";

const C = COPY.publish;
const Q = C.steps.questions;

const A_TITLE = "Niñera para dos nenes por la tarde";
const A_DESCRIPTION =
  "De lunes a viernes de 3 a 7 pm: los retirás del colegio, merienda y tarea. Se paga por hora.";

function mount() {
  return render(
    <ToastProvider>
      <JobPublishForm tenantId="tenant-1" currency="USD" />
    </ToastProvider>,
  );
}

function clickNext() {
  fireEvent.click(screen.getByRole("button", { name: C.nav.next }));
}

/** Completa los pasos 1 y 2 y deja el wizard parado en el builder (paso 3). */
function goToQuestions() {
  fireEvent.change(screen.getByLabelText(C.steps.role.titleLabel), {
    target: { value: A_TITLE },
  });
  fireEvent.change(screen.getByLabelText(C.steps.role.descriptionLabel), {
    target: { value: A_DESCRIPTION },
  });
  clickNext();
  fireEvent.change(screen.getByLabelText(C.steps.pay.amountLabel), { target: { value: "18" } });
  clickNext();
}

/** Tiles de "agregar": se buscan por su pista, que es única en la pantalla. */
function addYesNo() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(Q.addYesNoHint) }));
}

function addChoice() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(Q.addChoiceHint) }));
}

beforeEach(() => {
  mocks.createJobDraft.mockReset();
  mocks.finalizeJob.mockReset();
  mocks.createJobDraft.mockResolvedValue({ ok: true, listingId: "listing-1" });
  mocks.finalizeJob.mockResolvedValue({ ok: true, status: "pending_review" });
});

afterEach(cleanup);

describe("Builder de preguntas — agregar, quitar, cambiar tipo", () => {
  it("arranca vacío, con ideas para empezar", () => {
    mount();
    goToQuestions();
    expect(screen.getByText(Q.emptyTitle)).toBeTruthy();
    expect(screen.queryByLabelText(Q.questionTitle(1))).toBeNull();
  });

  it("agrega preguntas y las numera", () => {
    mount();
    goToQuestions();
    addYesNo();
    expect(screen.getByLabelText(Q.questionTitle(1))).toBeTruthy();
    addChoice();
    expect(screen.getByLabelText(Q.questionTitle(2))).toBeTruthy();
  });

  it("quita una pregunta y renumera el resto", () => {
    mount();
    goToQuestions();
    addYesNo();
    addYesNo();
    fireEvent.click(
      screen.getByRole("button", { name: `${Q.removeQuestion}: ${Q.questionTitle(1)}` }),
    );
    expect(screen.getByLabelText(Q.questionTitle(1))).toBeTruthy();
    expect(screen.queryByLabelText(Q.questionTitle(2))).toBeNull();
  });

  it("cambia de sí/no a opción múltiple conservando el texto y abriendo 2 opciones", () => {
    mount();
    goToQuestions();
    addYesNo();
    fireEvent.change(screen.getByLabelText(Q.questionTitle(1)), {
      target: { value: "¿Qué días podés trabajar?" },
    });
    expect(screen.queryByLabelText(Q.optionAriaLabel(1, 1))).toBeNull();

    fireEvent.click(screen.getAllByRole("radio", { name: Q.typeChoice })[0]);

    expect((screen.getByLabelText(Q.questionTitle(1)) as HTMLInputElement).value).toBe(
      "¿Qué días podés trabajar?",
    );
    expect(screen.getByLabelText(Q.optionAriaLabel(1, 1))).toBeTruthy();
    expect(screen.getByLabelText(Q.optionAriaLabel(1, 2))).toBeTruthy();
  });

  it("agrega y quita opciones dentro del rango 2–6", () => {
    mount();
    goToQuestions();
    addChoice();
    // Con el mínimo (2) no se ofrece quitar ninguna.
    expect(screen.queryByRole("button", { name: `${Q.removeOption} 1` })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: Q.addOption }));
    expect(screen.getByLabelText(Q.optionAriaLabel(1, 3))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `${Q.removeOption} 3` }));
    expect(screen.queryByLabelText(Q.optionAriaLabel(1, 3))).toBeNull();
  });

  it("corta en 5 preguntas y lo explica", () => {
    mount();
    goToQuestions();
    for (let i = 0; i < MAX_JOB_QUESTIONS; i += 1) addYesNo();
    expect(screen.getByLabelText(Q.questionTitle(MAX_JOB_QUESTIONS))).toBeTruthy();
    expect(screen.getByText(Q.maxReached)).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(Q.addYesNoHint) })).toBeNull();
  });
});

describe("Builder de preguntas — validación antes de avanzar", () => {
  it("no deja avanzar con una pregunta sin texto", () => {
    mount();
    goToQuestions();
    addYesNo();
    clickNext();
    expect(screen.getByText(C.errors.questionsInvalid)).toBeTruthy();
    expect(screen.getByText(C.errors.questionLabelShort)).toBeTruthy();
    expect(screen.getByText(Q.title)).toBeTruthy(); // sigue en el paso 3
  });

  it("una opción múltiple exige 2 opciones completas", () => {
    mount();
    goToQuestions();
    addChoice();
    fireEvent.change(screen.getByLabelText(Q.questionTitle(1)), {
      target: { value: "¿Qué días podés trabajar?" },
    });

    // Sin ninguna opción cargada.
    clickNext();
    expect(screen.getByText(C.errors.questionOptionsShort)).toBeTruthy();

    // Con una sola, sigue faltando.
    fireEvent.change(screen.getByLabelText(Q.optionAriaLabel(1, 1)), {
      target: { value: "Lunes a viernes" },
    });
    clickNext();
    expect(screen.getByText(C.errors.questionOptionsShort)).toBeTruthy();

    // Con las dos, avanza al último paso.
    fireEvent.change(screen.getByLabelText(Q.optionAriaLabel(1, 2)), {
      target: { value: "Fines de semana" },
    });
    clickNext();
    expect(screen.getByText(C.steps.where.title)).toBeTruthy();
  });

  it("editar la pregunta borra su error sin tener que reintentar", () => {
    mount();
    goToQuestions();
    addYesNo();
    clickNext();
    expect(screen.getByText(C.errors.questionLabelShort)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(Q.questionTitle(1)), {
      target: { value: "¿Tenés experiencia cuidando niños?" },
    });
    expect(screen.queryByText(C.errors.questionLabelShort)).toBeNull();
  });
});

describe("Publicación", () => {
  it("publica sin preguntas y sin fotos", async () => {
    mount();
    goToQuestions();
    clickNext(); // paso 3 vacío es válido
    fireEvent.change(screen.getByLabelText(C.steps.where.areaLabel), {
      target: { value: "Washington Heights, NYC" },
    });
    fireEvent.click(screen.getByRole("button", { name: C.nav.submit }));

    await waitFor(() => expect(mocks.createJobDraft).toHaveBeenCalledTimes(1));
    expect(mocks.createJobDraft.mock.calls[0][0]).toMatchObject({
      title: A_TITLE,
      salaryAmount: 18,
      payPeriod: "hour",
      employmentType: "full_time",
      areaLabel: "Washington Heights, NYC",
      questions: [],
    });
    expect(mocks.finalizeJob).toHaveBeenCalledWith({
      listingId: "listing-1",
      photoPaths: [],
    });
    await waitFor(() => expect(screen.getByText(C.successReviewTitle)).toBeTruthy());
  });

  it("manda las preguntas con la forma del contrato (yes_no sin `options`)", async () => {
    mount();
    goToQuestions();

    addYesNo();
    fireEvent.change(screen.getByLabelText(Q.questionTitle(1)), {
      target: { value: "¿Tenés experiencia cuidando niños?" },
    });
    addChoice();
    fireEvent.change(screen.getByLabelText(Q.questionTitle(2)), {
      target: { value: "¿Qué días podés trabajar?" },
    });
    fireEvent.change(screen.getByLabelText(Q.optionAriaLabel(2, 1)), {
      target: { value: "Lunes a viernes" },
    });
    fireEvent.change(screen.getByLabelText(Q.optionAriaLabel(2, 2)), {
      target: { value: "Fines de semana" },
    });
    clickNext();

    fireEvent.change(screen.getByLabelText(C.steps.where.areaLabel), {
      target: { value: "Bronx, NYC" },
    });
    fireEvent.click(screen.getByRole("button", { name: C.nav.submit }));

    await waitFor(() => expect(mocks.createJobDraft).toHaveBeenCalledTimes(1));
    const sent = mocks.createJobDraft.mock.calls[0][0].questions;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      type: "yes_no",
      label: "¿Tenés experiencia cuidando niños?",
    });
    expect("options" in sent[0]).toBe(false);
    expect(sent[1]).toMatchObject({
      type: "multiple_choice",
      options: ["Lunes a viernes", "Fines de semana"],
    });
    expect(typeof sent[0].id).toBe("string");
    expect(sent[0].id).not.toBe(sent[1].id);
  });

  it("muestra el error del servidor sin tragárselo", async () => {
    mocks.createJobDraft.mockResolvedValue({ ok: false, error: "Ya publicaste varios hoy." });
    mount();
    goToQuestions();
    clickNext();
    fireEvent.change(screen.getByLabelText(C.steps.where.areaLabel), {
      target: { value: "Queens, NYC" },
    });
    fireEvent.click(screen.getByRole("button", { name: C.nav.submit }));

    await waitFor(() => expect(screen.getByText("Ya publicaste varios hoy.")).toBeTruthy());
    expect(mocks.finalizeJob).not.toHaveBeenCalled();
  });

  it("el salario es obligatorio: sin monto no se pasa del paso 2", () => {
    mount();
    fireEvent.change(screen.getByLabelText(C.steps.role.titleLabel), {
      target: { value: A_TITLE },
    });
    fireEvent.change(screen.getByLabelText(C.steps.role.descriptionLabel), {
      target: { value: A_DESCRIPTION },
    });
    clickNext();
    clickNext();
    expect(screen.getByText(C.errors.salaryRequired)).toBeTruthy();
    expect(screen.getByText(C.steps.pay.title)).toBeTruthy();
  });
});
