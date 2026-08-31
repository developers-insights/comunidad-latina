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
  requireIdentidadVerificada: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ DAY_MS: 86_400_000, limit: mocks.limit }));
// El gate de identidad se mockea en el límite del módulo, igual que el guard de
// tenant: su lógica (qué verticales exigen identidad, qué mira de la identidad
// ACTIVA) es contrato de la 0106/0121 y se prueba en su propio archivo. Acá sólo
// se prueba la INTEGRACIÓN — que createJobDraft lo llame antes de gastar la
// cuota del día, y que traduzca el rechazo al resultado tipado que espera la UI.
vi.mock("@/lib/verificacion/gate", () => ({
  requireIdentidadVerificada: mocks.requireIdentidadVerificada,
}));

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
      /**
       * `.returns<T>()` es un no-op en runtime (sólo re-tipa el resultado), pero
       * la action lo encadena: `createJobDraft` escribe columnas que
       * `database.types.ts` todavía no lista (work_mode 0087,
       * business_listing_id 0107) y para eso usa un cliente sin tipar, igual que
       * `createGigDraft`. Sin este eslabón el stub corta la cadena.
       */
      returns: vi.fn(() => builder),
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
  // Default: identidad verificada. Los tests que prueban el bloqueo lo dicen
  // explícito — así el resto no arrastra un permiso implícito que, si el gate
  // se rompiera, dejaría pasar todo sin que ningún test se entere.
  mocks.requireIdentidadVerificada.mockReset();
  mocks.requireIdentidadVerificada.mockResolvedValue({ permitido: true });
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

/* ===========================================================================
 * L1 — changas ("one_off"): el tercer valor del enum, validado por
 * `z.enum(EMPLOYMENT_TYPES)` sin ninguna rama nueva en la action.
 * =========================================================================== */

describe("createJobDraft — L1 (changas): employmentType 'one_off'", () => {
  it("acepta 'one_off' igual que full_time/part_time", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(validInput({ employmentType: "one_off" }));

    expect(result.ok).toBe(true);
    expect(insertedRow(stub)?.attrs).toMatchObject({ employment_type: "one_off" });
  });

  it("rechaza un employmentType inventado, sin tocar el guard", async () => {
    const result = await createJobDraft(validInput({ employmentType: "freelance" }));
    expect(result.ok).toBe(false);
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  /**
   * "one_time" (pago único) suma para changas — la DB ya lo admite en
   * `price_period` (0004_listings.sql) y ahora también en JOB_PAY_PERIODS.
   */
  it("acepta payPeriod 'one_time' (pago único)", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(
      validInput({ employmentType: "one_off", payPeriod: "one_time" }),
    );

    expect(result.ok).toBe(true);
    expect(insertedRow(stub)?.price_period).toBe("one_time");
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

/* ===========================================================================
 * Gate de identidad — «para vender tenés que estar verificado sí o sí»
 *
 * La regla también vive en la policy `listings_insert` (0126), que es la que
 * de verdad no se puede saltear. Esta rama existe para que el rechazo llegue
 * con un texto que se entiende: sin ella PostgREST devuelve un 42501 crudo y
 * la persona no se entera de que le falta verificarse — ni de que es gratis.
 * =========================================================================== */

describe("createJobDraft — gate de identidad", () => {
  it("sin identidad verificada no inserta, y lo dice con un mensaje accionable", async () => {
    const stub = useGuardOk();
    mocks.requireIdentidadVerificada.mockResolvedValue({
      permitido: false,
      motivo: "identidad",
    });

    const result = await createJobDraft(validInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.needsIdentity).toBe(true);
    expect(result.error).toContain("verificar tu identidad");
    // Que sea GRATIS es la mitad del mensaje: sin eso el bloqueo se lee como
    // un muro de pago y la persona no intenta.
    expect(result.error).toContain("gratis");
    expect(stub.calls).toHaveLength(0);
  });

  it("un empleo siempre gatea: pregunta por kind 'job', sin condición de precio", async () => {
    useGuardOk();

    await createJobDraft(validInput());

    expect(mocks.requireIdentidadVerificada).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "job" },
    );
  });

  it("gatea ANTES del rate limit: quien no puede publicar no gasta su cuota del día", async () => {
    useGuardOk();
    mocks.requireIdentidadVerificada.mockResolvedValue({
      permitido: false,
      motivo: "identidad",
    });

    await createJobDraft(validInput());

    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("con identidad verificada publica normal", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(validInput());

    expect(result.ok).toBe(true);
    expect(stub.calls.length).toBeGreaterThan(0);
  });
});

/* ===========================================================================
 * Campos de la spec: rango salarial, modalidad, ficha del puesto y negocio
 * =========================================================================== */

/** La fila que efectivamente se mandó a `listings.insert`. */
function insertedRow(stub: ReturnType<typeof createSupabaseStub>) {
  const call = stub.calls.find((entry) => entry.method === "insert");
  return call?.args[0] as Record<string, unknown> | undefined;
}

function attrsOf(stub: ReturnType<typeof createSupabaseStub>) {
  return (insertedRow(stub)?.attrs ?? {}) as Record<string, unknown>;
}

describe("createJobDraft — rango salarial", () => {
  /**
   * EL REPARTO QUE HAY QUE PROTEGER: el PISO va a la columna `price_amount` —lo
   * que ordena, filtra y formatea toda la app— y sólo el techo a `attrs`. Mover
   * el salario entero a `attrs` para que "quepa" el rango sacaría a los empleos
   * del orden por precio y del formateador de las tarjetas.
   */
  it("el piso va a price_amount y el techo a attrs", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(validInput({ salaryAmount: 18, salaryMax: 22 }));

    expect(result.ok).toBe(true);
    expect(insertedRow(stub)?.price_amount).toBe(18);
    expect(attrsOf(stub).salary_max).toBe(22);
  });

  it("sin techo no se escribe la clave: un monto único sigue siendo monto único", async () => {
    const stub = useGuardOk();
    await createJobDraft(validInput());
    expect(attrsOf(stub)).not.toHaveProperty("salary_max");
  });

  /** Un "rango" de $18 a $18 no es un rango. Se guarda como lo que es. */
  it("un techo igual al piso se guarda como monto único", async () => {
    const stub = useGuardOk();
    await createJobDraft(validInput({ salaryAmount: 18, salaryMax: 18 }));
    expect(attrsOf(stub)).not.toHaveProperty("salary_max");
  });

  /**
   * Contradicción, no dato incompleto: elegir cuál de los dos gana sería
   * inventar qué quiso decir la persona. Y el mensaje es accionable, no un
   * "revisá los datos" que la deja buscando a ciegas.
   */
  it("rechaza un techo menor que el piso, con un mensaje que se entiende", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(validInput({ salaryAmount: 22, salaryMax: 18 }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/menor que el mínimo/i);
    expect(stub.calls).toHaveLength(0);
  });
});

describe("createJobDraft — modalidad (columna work_mode, 0087)", () => {
  /**
   * Se REUSA la columna que ya existe con su CHECK y su índice parcial, en vez
   * de inventar un `attrs.work_mode` paralelo: el mismo hecho escrito en dos
   * lugares se termina contradiciendo.
   */
  it("la modalidad va a la COLUMNA, no a attrs", async () => {
    const stub = useGuardOk();

    await createJobDraft(validInput({ workMode: "hibrido" }));

    expect(insertedRow(stub)?.work_mode).toBe("hibrido");
    expect(attrsOf(stub)).not.toHaveProperty("work_mode");
  });

  /**
   * Con "a distancia" no hay zona que declarar. Se guarda NULL y no el string
   * "Remoto": ese texto libre en un campo de ubicación es exactamente lo que la
   * 0087 vino a reemplazar.
   */
  it("a distancia no exige zona y la guarda como NULL", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(validInput({ workMode: "remoto", areaLabel: null }));

    expect(result.ok).toBe(true);
    expect(insertedRow(stub)?.area_label).toBeNull();
  });

  it("presencial sigue exigiendo la zona", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(
      validInput({ workMode: "presencial", areaLabel: null }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/zona/i);
    expect(stub.calls).toHaveLength(0);
  });

  /** Sin modalidad declarada se pide la zona: falla del lado seguro. */
  it("sin modalidad se comporta como presencial", async () => {
    const stub = useGuardOk();
    const result = await createJobDraft(validInput({ areaLabel: null }));
    expect(result.ok).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });
});

describe("createJobDraft — ficha del puesto en attrs", () => {
  it("guarda sólo lo declarado, en las claves del contrato", async () => {
    const stub = useGuardOk();

    await createJobDraft(
      validInput({
        days: ["fri", "mon"],
        schedule: "  de 9 a 17  ",
        experience: "hasta_1",
        languages: ["ingles", "espanol"],
        startsOn: "2026-09-01",
        applyBy: "2026-08-25",
      }),
    );

    expect(attrsOf(stub)).toMatchObject({
      // Orden del CATÁLOGO, no el de llegada.
      work_days: ["mon", "fri"],
      schedule: "de 9 a 17",
      experience: "hasta_1",
      languages: ["espanol", "ingles"],
      starts_on: "2026-09-01",
      apply_by: "2026-08-25",
    });
  });

  it("un aviso sin ficha no escribe ninguna clave de más", async () => {
    const stub = useGuardOk();
    await createJobDraft(validInput());
    const attrs = attrsOf(stub);
    for (const key of [
      "work_days",
      "schedule",
      "experience",
      "languages",
      "starts_on",
      "apply_by",
    ]) {
      expect(attrs).not.toHaveProperty(key);
    }
  });

  it("descarta días e idiomas fuera del catálogo", async () => {
    const stub = useGuardOk();
    await createJobDraft(
      validInput({ days: ["mon", "lunes", "caturday"], languages: ["espanol", "aleman"] }),
    );
    expect(attrsOf(stub).work_days).toEqual(["mon"]);
    expect(attrsOf(stub).languages).toEqual(["espanol"]);
  });

  /**
   * Un aviso al que hay que postularse DESPUÉS de que el trabajo empezó no le
   * sirve a nadie. Se rechaza en vez de guardar las dos fechas al revés.
   */
  it("rechaza una fecha límite posterior al inicio", async () => {
    const stub = useGuardOk();

    const result = await createJobDraft(
      validInput({ startsOn: "2026-09-01", applyBy: "2026-09-10" }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/antes de que empiece/i);
    expect(stub.calls).toHaveLength(0);
  });
});

describe("createJobDraft — negocio vinculado (columna business_listing_id, 0107)", () => {
  const BUSINESS_ID = "22222222-2222-4222-8222-222222222222";

  /**
   * Va a una COLUMNA y no a `attrs` porque es una REFERENCIA a otra fila, no una
   * descripción: necesita FK (que el negocio exista), tipo (que sea un uuid) e
   * índice (la ficha del negocio va a listar sus empleos, y un
   * `attrs->>'business_listing_id' = $1` sobre `listings` es un scan).
   */
  it("va a la columna, no a attrs", async () => {
    const stub = useGuardOk();

    await createJobDraft(validInput({ businessListingId: BUSINESS_ID }));

    expect(insertedRow(stub)?.business_listing_id).toBe(BUSINESS_ID);
    expect(attrsOf(stub)).not.toHaveProperty("business_listing_id");
  });

  it("sin vínculo se manda NULL: publicar a nombre personal es el caso normal", async () => {
    const stub = useGuardOk();
    await createJobDraft(validInput());
    expect(insertedRow(stub)?.business_listing_id).toBeNull();
  });

  it("un id que no es un uuid ni llega a la base", async () => {
    const stub = useGuardOk();
    const result = await createJobDraft(validInput({ businessListingId: "mi-negocio" }));
    expect(result.ok).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });

  /**
   * La PERTENENCIA la impone `app.check_business_listing_link()` en la base —el
   * único lugar donde no se puede saltear— y vuelve como VINCULO_INVALIDO. Acá
   * se verifica que ese error se traduzca a algo accionable: la persona puede
   * elegir otro negocio o ninguno, y un "probá de nuevo en un ratito" la
   * dejaría reintentando algo que nunca va a funcionar.
   */
  it("el rechazo del trigger se traduce a un mensaje accionable", async () => {
    const stub = createSupabaseStub({
      data: null,
      error: {
        code: "P0001",
        message: "VINCULO_INVALIDO: sólo podés vincular un empleo a un negocio tuyo",
      },
    });
    mocks.requireTenantMatch.mockResolvedValue({
      ok: true,
      tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos", currency: "USD" },
      supabase: stub.client,
      user: { id: USER_ID },
    });

    const result = await createJobDraft(validInput({ businessListingId: BUSINESS_ID }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/negocio/i);
    expect(!result.ok && result.error).not.toMatch(/en un ratito/i);
  });
});
