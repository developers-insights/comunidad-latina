import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `createJobDraft` — la puerta de entrada de un EMPLEO.
 *
 * Se aíslan los bordes con el patrón del repo (feed/engagement-actions.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable del query builder. Nunca se toca
 * Supabase real.
 *
 * Garantías cubiertas:
 *  - zod PURO primero: un payload inválido (preguntas rotas, salario ausente)
 *    ni siquiera llega al guard → cero efectos colaterales.
 *  - las preguntas se validan contra el CONTRATO compartido (jobQuestionsSchema):
 *    máximo 5, opción múltiple con ≥2 opciones, sí/no sin `options`.
 *  - el insert es el correcto: kind='job', status='draft', período de pago y
 *    attrs { employment_type, questions }.
 *  - rate limit agotado → no se inserta nada.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ DAY_MS: 86_400_000, limit: mocks.limit }));

import { createJobDraft } from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(result: { data: unknown; error: unknown } = {
  data: { id: LISTING_ID },
  error: null,
}) {
  const calls: RecordedCall[] = [];
  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        return builder;
      }),
      select: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        return builder;
      }),
      single: vi.fn(async () => result),
    };
    return builder;
  });
  return { client: { from }, calls };
}

function useGuardOk() {
  const stub = createSupabaseStub();
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos", currency: "USD" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

/** Payload válido mínimo; cada test cambia lo que quiere romper. */
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Niñera para dos nenes por la tarde",
    description:
      "De lunes a viernes de 3 a 7 pm: los retirás del colegio, merienda y tarea. Se paga por hora.",
    salaryAmount: 18,
    payPeriod: "hour" as const,
    employmentType: "part_time" as const,
    areaLabel: "Washington Heights, NYC",
    questions: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.requireTenantMatch.mockReset();
  mocks.limit.mockReset();
  mocks.limit.mockReturnValue({ ok: true, remaining: 9, retryAfterMs: 0 });
});

/* ---------------------------------- Tests --------------------------------- */

describe("createJobDraft — validación de preguntas (contrato compartido)", () => {
  it("rechaza una opción múltiple con menos de 2 opciones, sin tocar el guard", async () => {
    const result = await createJobDraft(
      validInput({
        questions: [
          { id: "q1", type: "multiple_choice", label: "¿Qué días podés?", options: ["Lunes"] },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("rechaza una opción múltiple sin `options`", async () => {
    const result = await createJobDraft(
      validInput({ questions: [{ id: "q1", type: "multiple_choice", label: "¿Qué días podés?" }] }),
    );

    expect(result.ok).toBe(false);
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("rechaza una pregunta de sí/no que traiga opciones", async () => {
    const result = await createJobDraft(
      validInput({
        questions: [
          { id: "q1", type: "yes_no", label: "¿Tenés experiencia?", options: ["Sí", "No"] },
        ],
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("rechaza más de 5 preguntas", async () => {
    const questions = Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      type: "yes_no" as const,
      label: `¿Pregunta número ${i}?`,
    }));

    const result = await createJobDraft(validInput({ questions }));

    expect(result.ok).toBe(false);
  });

  it("rechaza un tipo de pregunta inventado", async () => {
    const result = await createJobDraft(
      validInput({ questions: [{ id: "q1", type: "free_text", label: "Contame de vos" }] }),
    );

    expect(result.ok).toBe(false);
  });
});

describe("createJobDraft — el salario no es opcional", () => {
  it("rechaza monto 0", async () => {
    const result = await createJobDraft(validInput({ salaryAmount: 0 }));
    expect(result.ok).toBe(false);
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("rechaza un período de pago que la DB no admite", async () => {
    const result = await createJobDraft(validInput({ payPeriod: "year" }));
    expect(result.ok).toBe(false);
  });
});

describe("createJobDraft — camino feliz", () => {
  it("inserta kind='job', status='draft' y las preguntas en attrs", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(
      validInput({
        questions: [
          { id: "q1", type: "yes_no", label: "¿Tenés experiencia cuidando niños?" },
          {
            id: "q2",
            type: "multiple_choice",
            label: "¿Qué días podés trabajar?",
            options: ["Lunes a viernes", "Fines de semana"],
          },
        ],
      }),
    );

    expect(result).toEqual({ ok: true, listingId: LISTING_ID });

    const insert = stub.calls.find((call) => call.method === "insert");
    expect(insert?.table).toBe("listings");
    expect(insert?.args[0]).toMatchObject({
      tenant_id: TENANT_ID,
      created_by: USER_ID,
      kind: "job",
      status: "draft",
      price_amount: 18,
      price_currency: "USD",
      price_period: "hour",
      area_label: "Washington Heights, NYC",
      attrs: {
        employment_type: "part_time",
        questions: [
          { id: "q1", type: "yes_no", label: "¿Tenés experiencia cuidando niños?" },
          {
            id: "q2",
            type: "multiple_choice",
            label: "¿Qué días podés trabajar?",
            options: ["Lunes a viernes", "Fines de semana"],
          },
        ],
      },
    });
  });

  it("publicar sin preguntas es válido", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(validInput());

    expect(result.ok).toBe(true);
    const insert = stub.calls.find((call) => call.method === "insert");
    expect((insert?.args[0] as { attrs: { questions: unknown[] } }).attrs.questions).toEqual([]);
  });
});

describe("createJobDraft — guard y cuota antes de escribir", () => {
  it("sin sesión devuelve needsAuth y no inserta", async () => {
    const stub = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "Entrá a tu cuenta.",
      tenant: { id: TENANT_ID, currency: "USD" },
      supabase: stub.client,
      user: null,
    });

    const result = await createJobDraft(validInput());

    expect(result).toMatchObject({ ok: false, needsAuth: true });
    expect(stub.calls).toHaveLength(0);
  });

  it("con la cuota diaria agotada no inserta nada", async () => {
    const stub = useGuardOk();
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const result = await createJobDraft(validInput());

    expect(result.ok).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });
});
