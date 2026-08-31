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

/* ===========================================================================
 * Campos de la spec en el wizard: rango, modalidad, ficha plegada y negocio
 * =========================================================================== */

/** Completa el paso 1 y deja el wizard parado en el paso 2 (pago y condiciones). */
function goToPay() {
  fireEvent.change(screen.getByLabelText(C.steps.role.titleLabel), {
    target: { value: A_TITLE },
  });
  fireEvent.change(screen.getByLabelText(C.steps.role.descriptionLabel), {
    target: { value: A_DESCRIPTION },
  });
  clickNext();
}

/** Del paso 2 al 4 (zona, negocio y fotos), saltando el builder. */
function goToWhere() {
  goToPay();
  fireEvent.change(screen.getByLabelText(C.steps.pay.amountLabel), { target: { value: "18" } });
  clickNext();
  clickNext();
}

describe("Paso 2 — pago, modalidad y la ficha plegada", () => {
  it("ofrece un rango: 'Desde' y 'Hasta'", () => {
    mount();
    goToPay();
    expect(screen.getByLabelText(C.steps.pay.amountLabel)).toBeTruthy();
    expect(screen.getByLabelText(C.steps.pay.amountMaxLabel)).toBeTruthy();
  });

  it("la vista previa muestra el rango completo, con el formato del listado", () => {
    mount();
    goToPay();
    fireEvent.change(screen.getByLabelText(C.steps.pay.amountLabel), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText(C.steps.pay.amountMaxLabel), {
      target: { value: "22" },
    });
    // El guion largo lo pone el wizard; los números y el sufijo salen de
    // formatListingPrice, el mismo que pinta la tarjeta publicada.
    expect(screen.getByText(/18.*–.*22/)).toBeTruthy();
  });

  it("no deja avanzar con un máximo menor que el mínimo", () => {
    mount();
    goToPay();
    fireEvent.change(screen.getByLabelText(C.steps.pay.amountLabel), { target: { value: "22" } });
    fireEvent.change(screen.getByLabelText(C.steps.pay.amountMaxLabel), {
      target: { value: "18" },
    });
    clickNext();
    expect(screen.getByRole("alert").textContent).toMatch(/menor que el mínimo/i);
  });

  it("ofrece las tres modalidades de trabajo", () => {
    mount();
    goToPay();
    expect(screen.getByRole("radio", { name: /Presencial/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /A distancia/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Mixto/ })).toBeTruthy();
  });

  /**
   * La regla del wizard: obligatorio a la vista, opcional a un toque. Seis
   * campos más desplegados convertirían este paso en una planilla.
   */
  it("mantiene la ficha del puesto plegada hasta que se abre", () => {
    mount();
    goToPay();
    const bloque = screen.getByText(C.steps.pay.moreTitle).closest("details");
    expect(bloque).toBeTruthy();
    expect((bloque as HTMLDetailsElement).open).toBe(false);
    // Y adentro está todo lo que la spec pedía y no existía.
    expect(screen.getByLabelText(C.steps.pay.scheduleLabel)).toBeTruthy();
    expect(screen.getByLabelText(C.steps.pay.experienceLabel)).toBeTruthy();
    expect(screen.getByLabelText(C.steps.pay.startsOnLabel)).toBeTruthy();
    expect(screen.getByLabelText(C.steps.pay.applyByLabel)).toBeTruthy();
  });
});

/* ===========================================================================
 * L1 — changas: la tercera dedicación ("Ocasional" / one_off) y los campos
 * que dejan de tener sentido para un trabajo de una sola vez.
 * =========================================================================== */

describe("Paso 2 — 'Ocasional' (changa) y los campos que no aplican", () => {
  it("ofrece Ocasional como tercera dedicación, junto a las otras dos", () => {
    mount();
    goToPay();
    expect(screen.getByRole("radio", { name: "Tiempo completo" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Medio tiempo" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Ocasional" })).toBeTruthy();
  });

  it("por defecto (Tiempo completo) la ficha sigue mostrando los días recurrentes", () => {
    mount();
    goToPay();
    expect(screen.getByText(C.steps.pay.daysLabel)).toBeTruthy();
    expect(screen.getByLabelText(C.steps.pay.startsOnLabel)).toBeTruthy();
  });

  /**
   * Una changa no tiene "días que se trabaja" en el sentido recurrente del
   * campo: si el trabajo se repite cada semana el tipo correcto es "Medio
   * tiempo", no "Ocasional". El resto de la ficha (horario, experiencia,
   * idiomas, fecha límite) sigue aplicando igual.
   */
  it("elegir Ocasional oculta los días recurrentes, pero conserva el resto de la ficha", () => {
    mount();
    goToPay();
    fireEvent.click(screen.getByRole("radio", { name: "Ocasional" }));

    expect(screen.queryByText(C.steps.pay.daysLabel)).toBeNull();
    expect(screen.getByLabelText(C.steps.pay.scheduleLabel)).toBeTruthy();
    expect(screen.getByLabelText(C.steps.pay.experienceLabel)).toBeTruthy();
    expect(screen.getByLabelText(C.steps.pay.applyByLabel)).toBeTruthy();
  });

  /** Volver a Tiempo completo/Medio tiempo devuelve los días — no se pierde el control. */
  it("volver a Tiempo completo muestra los días de nuevo", () => {
    mount();
    goToPay();
    fireEvent.click(screen.getByRole("radio", { name: "Ocasional" }));
    expect(screen.queryByText(C.steps.pay.daysLabel)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Tiempo completo" }));
    expect(screen.getByText(C.steps.pay.daysLabel)).toBeTruthy();
  });

  /** "Cuándo empieza" no tiene sentido para un trabajo de una sola vez. */
  it("elegir Ocasional cambia la etiqueta de fecha a 'Fecha del trabajo'", () => {
    mount();
    goToPay();
    expect(screen.getByLabelText(C.steps.pay.startsOnLabel)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Ocasional" }));

    expect(screen.queryByLabelText(C.steps.pay.startsOnLabel)).toBeNull();
    expect(screen.getByLabelText(C.steps.pay.startsOnLabelOneOff)).toBeTruthy();
  });

  /** ¿Salario por hora vs. pago único? Ahora el período lo ofrece. */
  it("el período de pago ofrece 'Pago único', además de hora/día/semana/mes", () => {
    mount();
    goToPay();
    const select = screen.getByLabelText(C.steps.pay.periodLabel) as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.text);
    expect(labels).toEqual(["Por hora", "Por día", "Por semana", "Por mes", "Pago único"]);
  });

  it("publica una changa: employmentType 'one_off' y sin días recurrentes", async () => {
    mount();
    goToPay();
    fireEvent.click(screen.getByRole("radio", { name: "Ocasional" }));
    fireEvent.change(screen.getByLabelText(C.steps.pay.amountLabel), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(C.steps.pay.periodLabel), {
      target: { value: "one_time" },
    });
    clickNext();
    clickNext();
    fireEvent.change(screen.getByLabelText(C.steps.where.areaLabel), {
      target: { value: "Corona, Queens" },
    });
    fireEvent.click(screen.getByRole("button", { name: C.nav.submit }));

    await waitFor(() => expect(mocks.createJobDraft).toHaveBeenCalledTimes(1));
    expect(mocks.createJobDraft.mock.calls[0][0]).toMatchObject({
      employmentType: "one_off",
      payPeriod: "one_time",
      salaryAmount: 50,
      days: [],
    });
  });
});

describe("Paso 4 — zona según modalidad y negocio vinculado", () => {
  it("pide la zona cuando el trabajo es presencial", () => {
    mount();
    goToWhere();
    expect(screen.getByLabelText(C.steps.where.areaLabel)).toBeTruthy();
  });

  /**
   * Con "a distancia" no hay zona que declarar, y se EXPLICA por qué: un campo
   * que desaparece sin decir nada se lee como un error de la app. Antes había
   * que escribir "Remoto" en un campo de ubicación, que es justo el texto libre
   * que la 0087 vino a reemplazar.
   */
  it("a distancia no pide zona y dice por qué", () => {
    mount();
    goToPay();
    fireEvent.click(screen.getByRole("radio", { name: /A distancia/ }));
    fireEvent.change(screen.getByLabelText(C.steps.pay.amountLabel), { target: { value: "18" } });
    clickNext();
    clickNext();

    expect(screen.queryByLabelText(C.steps.where.areaLabel)).toBeNull();
    expect(screen.getByText(C.steps.where.areaRemoteTitle)).toBeTruthy();
  });

  it("a distancia deja publicar sin haber escrito ninguna zona", async () => {
    mount();
    goToPay();
    fireEvent.click(screen.getByRole("radio", { name: /A distancia/ }));
    fireEvent.change(screen.getByLabelText(C.steps.pay.amountLabel), { target: { value: "18" } });
    clickNext();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: C.nav.submit }));

    await waitFor(() => expect(mocks.createJobDraft).toHaveBeenCalled());
    expect(mocks.createJobDraft.mock.calls[0][0]).toMatchObject({
      workMode: "remoto",
      areaLabel: null,
    });
  });

  /**
   * Sin fichas propias el desplegable NO se dibuja: una pregunta con una sola
   * respuesta posible ("a nombre personal") no es una pregunta.
   */
  it("sin negocios propios no muestra el desplegable", () => {
    mount();
    goToWhere();
    expect(screen.queryByLabelText(C.steps.where.businessLabel)).toBeNull();
  });

  it("con negocios propios ofrece vincular, y por defecto va a nombre personal", async () => {
    render(
      <ToastProvider>
        <JobPublishForm
          tenantId="tenant-1"
          currency="USD"
          businesses={[{ id: "22222222-2222-4222-8222-222222222222", title: "Panadería La Espiga" }]}
        />
      </ToastProvider>,
    );
    goToWhere();

    const select = screen.getByLabelText(C.steps.where.businessLabel) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByText("Panadería La Espiga")).toBeTruthy();

    fireEvent.change(select, { target: { value: "22222222-2222-4222-8222-222222222222" } });
    fireEvent.change(screen.getByLabelText(C.steps.where.areaLabel), {
      target: { value: "Washington Heights, NYC" },
    });
    fireEvent.click(screen.getByRole("button", { name: C.nav.submit }));

    await waitFor(() => expect(mocks.createJobDraft).toHaveBeenCalled());
    expect(mocks.createJobDraft.mock.calls[0][0]).toMatchObject({
      businessListingId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
