import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las server actions de EMPLEOS.
 *
 * Bordes mockeados con el patrón del repo (lib/tenant/guard.test.ts,
 * mensajes/inline-actions.test.ts): `vi.hoisted` + `vi.mock` + stub encadenable
 * del query builder. No se toca Supabase real ni la RLS.
 *
 * Garantías cubiertas:
 *  - Feliz: las respuestas se validan contra las preguntas REALES del aviso y
 *    el insert lleva el applicant del JWT, nunca uno del cliente.
 *  - Aviso propio → `own-job` con copy amable (no un error rojo).
 *  - Respuesta incompleta → `invalid` sin llegar al insert.
 *  - 23505 (unique job+applicant) → `alreadyApplied`, no un error.
 *  - CURRÍCULUM: un path del prefijo AJENO no se persiste nunca, y el tipo/peso
 *    se validan con los metadatos REALES del objeto en Storage, no con lo que
 *    declaró el navegador.
 *  - EMBUDO: la action no intenta una transición que la base va a rechazar, y
 *    el UPDATE es optimista sobre el estado que leyó (control de concurrencia).
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  limit: vi.fn(() => ({ ok: true, remaining: 29, retryAfterMs: 0 })),
  createNotification: vi.fn(async () => ({ ok: true })),
  createAdminClient: vi.fn(() => ({ admin: true })),
  getRecipientEmail: vi.fn(async () => null),
  sendEmailInBackground: vi.fn(),
  applicationReceivedEmail: vi.fn(() => ({ subject: "s", html: "<p>h</p>" })),
  getTenant: vi.fn(async () => ({ id: "t", name: "Dominicanos", brandHex: "#1A5EDB" })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: mocks.getTenant }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));
vi.mock("@/lib/email", () => ({ sendEmailInBackground: mocks.sendEmailInBackground }));
vi.mock("@/lib/email/recipients", () => ({ getRecipientEmail: mocks.getRecipientEmail }));
vi.mock("@/lib/email/templates", () => ({
  applicationReceivedEmail: mocks.applicationReceivedEmail,
}));

import {
  advanceJobApplicationAction,
  applyToJobAction,
  withdrawJobApplicationAction,
} from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const OWNER_ID = "88888888-8888-4888-8888-888888888888";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const APPLICATION_ID = "66666666-6666-4666-8666-666666666666";

const OWN_CV_PATH = `${TENANT_ID}/${USER_ID}/cv-abc.pdf`;
const OTHER_CV_PATH = `${TENANT_ID}/${OWNER_ID}/cv-secreto.pdf`;

const QUESTIONS = [
  { id: "q1", type: "yes_no", label: "¿Tenés experiencia cuidando niños?" },
  {
    id: "q2",
    type: "multiple_choice",
    label: "¿Qué disponibilidad tenés?",
    options: ["Mañanas", "Tardes"],
  },
];

const VALID_ANSWERS = [
  { questionId: "q1", answer: true },
  { questionId: "q2", answer: "Tardes" },
];

const JOB_ROW = {
  id: JOB_ID,
  title: "Niñera medio tiempo en Washington Heights",
  attrs: { employment_type: "part_time", questions: QUESTIONS },
  created_by: OWNER_ID,
  tenant_id: TENANT_ID,
};

type OpResult = { data?: unknown; error?: unknown };

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Stub encadenable: cada `from(tabla)` devuelve un builder que se acuerda de si
 * la operación fue select / insert / update y resuelve con lo que pida el test.
 */
function createSupabaseStub(
  config: {
    listing?: OpResult;
    insert?: OpResult;
    application?: OpResult;
    update?: OpResult;
    /** Metadatos que devuelve Storage para el objeto del CV. */
    cvInfo?: OpResult;
  } = {},
) {
  const calls: RecordedCall[] = [];
  const removed: string[][] = [];

  const storage = {
    from: vi.fn(() => ({
      info: vi.fn(async () =>
        config.cvInfo ?? { data: { size: 1024, contentType: "application/pdf" }, error: null },
      ),
      remove: vi.fn(async (paths: string[]) => {
        removed.push(paths);
        return { data: null, error: null };
      }),
    })),
  };

  const resolveFor = (table: string, mode: string): OpResult => {
    if (table === "listings") {
      return config.listing ?? { data: JOB_ROW, error: null };
    }
    if (table === "job_applications") {
      if (mode === "insert") return config.insert ?? { data: null, error: null };
      if (mode === "update") return config.update ?? { data: { id: APPLICATION_ID }, error: null };
      return (
        config.application ?? {
          data: {
            id: APPLICATION_ID,
            job_id: JOB_ID,
            applicant_id: USER_ID,
            status: "submitted",
          },
          error: null,
        }
      );
    }
    if (table === "profiles") {
      return { data: { display_name: "Rosa" }, error: null };
    }
    return { data: null, error: null };
  };

  const from = vi.fn((table: string) => {
    let mode = "select";
    const record = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        if (method === "insert" || method === "update") mode = method;
        return builder;
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: record("select"),
      insert: record("insert"),
      update: record("update"),
      eq: record("eq"),
      in: record("in"),
      or: record("or"),
      order: record("order"),
      limit: record("limit"),
      maybeSingle: vi.fn(async () => resolveFor(table, mode)),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(resolveFor(table, mode)).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from, storage }, from, calls, removed };
}

function useGuardOk(config: Parameters<typeof createSupabaseStub>[0] = {}) {
  const stub = createSupabaseStub(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 29, retryAfterMs: 0 });
  mocks.createNotification.mockResolvedValue({ ok: true });
  mocks.createAdminClient.mockReturnValue({ admin: true });
  mocks.getRecipientEmail.mockResolvedValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* ------------------------------ applyToJobAction --------------------------- */

describe("applyToJobAction", () => {
  it("guarda la postulación con las respuestas validadas contra el aviso", async () => {
    const stub = useGuardOk();

    const result = await applyToJobAction({
      jobId: JOB_ID,
      message: "  Puedo empezar la semana que viene.  ",
      answers: VALID_ANSWERS,
    });

    expect(result).toEqual({ ok: true });
    const inserted = stub.calls.find((call) => call.method === "insert");
    expect(inserted?.table).toBe("job_applications");
    // El applicant sale del JWT y el mensaje llega trimeado.
    expect(inserted?.args[0]).toEqual({
      tenant_id: TENANT_ID,
      job_id: JOB_ID,
      applicant_id: USER_ID,
      message: "Puedo empezar la semana que viene.",
      answers: VALID_ANSWERS,
      cv_url: null,
      portfolio_links: [],
      share_profile: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/empleos/${JOB_ID}`);
  });

  it("avisa al dueño del aviso (notificación best-effort) sin romper el flujo", async () => {
    useGuardOk();

    await applyToJobAction({ jobId: JOB_ID, answers: VALID_ANSWERS });

    expect(mocks.createNotification).toHaveBeenCalledWith(
      { admin: true },
      expect.objectContaining({
        tenantId: TENANT_ID,
        profileId: OWNER_ID,
        kind: "job_application",
        href: `/empleos/${JOB_ID}/candidatos`,
        category: "trabajos",
      }),
    );
  });

  it("también le confirma al postulante que su solicitud salió", async () => {
    useGuardOk();

    await applyToJobAction({ jobId: JOB_ID, answers: VALID_ANSWERS });

    expect(mocks.createNotification).toHaveBeenCalledWith(
      { admin: true },
      expect.objectContaining({
        profileId: USER_ID,
        kind: "job_application_sent",
        href: "/empleos/mis-aplicaciones",
        category: "trabajos",
      }),
    );
  });

  it("una notificación caída NO tumba la postulación ya guardada", async () => {
    useGuardOk();
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("sin admin client");
    });

    const result = await applyToJobAction({ jobId: JOB_ID, answers: VALID_ANSWERS });

    expect(result).toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/empleos/${JOB_ID}`);
  });

  it("el aviso propio devuelve 'own-job' con copy amable y no inserta nada", async () => {
    const stub = useGuardOk({
      listing: { data: { ...JOB_ROW, created_by: USER_ID }, error: null },
    });

    const result = await applyToJobAction({ jobId: JOB_ID, answers: VALID_ANSWERS });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("own-job");
    expect(result.message).toBeTruthy();
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("rechaza una postulación incompleta con el copy de la validación", async () => {
    const stub = useGuardOk();

    const result = await applyToJobAction({
      jobId: JOB_ID,
      answers: [{ questionId: "q1", answer: true }],
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("invalid");
    expect(result.message).toContain("Respondé todas");
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("rechaza una opción inventada que no está en el aviso", async () => {
    const stub = useGuardOk();

    const result = await applyToJobAction({
      jobId: JOB_ID,
      answers: [
        { questionId: "q1", answer: true },
        { questionId: "q2", answer: "Madrugadas" },
      ],
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("invalid");
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("trata el 23505 como 'ya te postulaste', no como error", async () => {
    useGuardOk({ insert: { data: null, error: { code: "23505", message: "duplicate key" } } });

    const result = await applyToJobAction({ jobId: JOB_ID, answers: VALID_ANSWERS });

    expect(result).toEqual({ ok: true, alreadyApplied: true });
  });

  it("un aviso que ya no está publicado no llega al insert", async () => {
    const stub = useGuardOk({ listing: { data: null, error: null } });

    const result = await applyToJobAction({ jobId: JOB_ID, answers: VALID_ANSWERS });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("error");
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("un jobId que no es uuid muere en zod, antes del guard", async () => {
    const result = await applyToJobAction({ jobId: "no-es-uuid", answers: [] });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("invalid");
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("sin sesión no consume el rate limit ni toca la DB", async () => {
    const stub = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "copy del guard",
      tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
      supabase: stub.client,
      user: null,
    });

    const result = await applyToJobAction({ jobId: JOB_ID, answers: VALID_ANSWERS });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("unauthenticated");
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("con el rate limit agotado no lee el aviso siquiera", async () => {
    const stub = useGuardOk();
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const result = await applyToJobAction({ jobId: JOB_ID, answers: VALID_ANSWERS });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("rate-limited");
    expect(stub.from).not.toHaveBeenCalled();
  });
});

/* --------------------------- El currículum adjunto ------------------------- */

describe("applyToJobAction · currículum", () => {
  it("persiste la ruta cuando es del prefijo propio y el objeto es un PDF de buen peso", async () => {
    const stub = useGuardOk();

    const result = await applyToJobAction({
      jobId: JOB_ID,
      answers: VALID_ANSWERS,
      cvPath: OWN_CV_PATH,
    });

    expect(result).toEqual({ ok: true });
    const inserted = stub.calls.find((call) => call.method === "insert");
    expect((inserted?.args[0] as { cv_url: string }).cv_url).toBe(OWN_CV_PATH);
  });

  it("RECHAZA el path de OTRA persona sin tocar Storage ni la base", async () => {
    const stub = useGuardOk();

    const result = await applyToJobAction({
      jobId: JOB_ID,
      answers: VALID_ANSWERS,
      cvPath: OTHER_CV_PATH,
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("cv");
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
    // Y no se borra: el archivo es de otra persona, no nuestro para tocarlo.
    expect(stub.removed).toEqual([]);
  });

  it("rechaza el objeto que Storage registró como otra cosa (el File.type mentía)", async () => {
    const stub = useGuardOk({
      cvInfo: { data: { size: 2048, contentType: "text/html" }, error: null },
    });

    const result = await applyToJobAction({
      jobId: JOB_ID,
      answers: VALID_ANSWERS,
      cvPath: OWN_CV_PATH,
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("cv");
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
    // El objeto propio que no sirve se limpia, no queda de basura en el bucket.
    expect(stub.removed).toEqual([[OWN_CV_PATH]]);
  });

  it("rechaza por peso con el tamaño REAL del objeto, no con el declarado", async () => {
    useGuardOk({
      cvInfo: {
        data: { size: 6 * 1024 * 1024, contentType: "application/pdf" },
        error: null,
      },
    });

    const result = await applyToJobAction({
      jobId: JOB_ID,
      answers: VALID_ANSWERS,
      cvPath: OWN_CV_PATH,
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("cv");
  });

  it("un enlace de portafolio sin http(s) no llega al insert", async () => {
    const stub = useGuardOk();

    const result = await applyToJobAction({
      jobId: JOB_ID,
      answers: VALID_ANSWERS,
      portfolioLinks: ["javascript:alert(1)"],
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("portfolio");
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("share_profile=false viaja tal cual: el consentimiento es de la persona", async () => {
    const stub = useGuardOk();

    await applyToJobAction({
      jobId: JOB_ID,
      answers: VALID_ANSWERS,
      shareProfile: false,
    });

    const inserted = stub.calls.find((call) => call.method === "insert");
    expect((inserted?.args[0] as { share_profile: boolean }).share_profile).toBe(false);
  });
});

/* ----------------------- advanceJobApplicationAction ----------------------- */

describe("advanceJobApplicationAction", () => {
  it("avanza a 'en revisión' con UPDATE optimista sobre el estado que leyó", async () => {
    const stub = useGuardOk();

    const result = await advanceJobApplicationAction({
      applicationId: APPLICATION_ID,
      next: "reviewing",
    });

    expect(result).toEqual({ ok: true, status: "reviewing" });
    const updated = stub.calls.find((call) => call.method === "update");
    expect(updated?.args[0]).toEqual({ status: "reviewing" });
    // Control de concurrencia: si alguien la movió mientras tanto, no hay fila.
    expect(stub.calls).toContainEqual({
      table: "job_applications",
      method: "eq",
      args: ["status", "submitted"],
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/empleos/${JOB_ID}/candidatos`);
  });

  it("NO intenta una transición que la base va a rechazar (contratado → rechazado)", async () => {
    const stub = useGuardOk({
      application: {
        data: {
          id: APPLICATION_ID,
          job_id: JOB_ID,
          applicant_id: USER_ID,
          status: "hired",
        },
        error: null,
      },
    });

    const result = await advanceJobApplicationAction({
      applicationId: APPLICATION_ID,
      next: "rejected",
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("conflict");
    // Ni siquiera se manda el UPDATE: el trigger habría tirado PROTECTED_TRANSITION.
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("tampoco deja retroceder de entrevista a en revisión", async () => {
    const stub = useGuardOk({
      application: {
        data: {
          id: APPLICATION_ID,
          job_id: JOB_ID,
          applicant_id: USER_ID,
          status: "interview",
        },
        error: null,
      },
    });

    const result = await advanceJobApplicationAction({
      applicationId: APPLICATION_ID,
      next: "reviewing",
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("conflict");
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("al contratar le avisa al postulante con copy de buenas noticias", async () => {
    useGuardOk();

    await advanceJobApplicationAction({ applicationId: APPLICATION_ID, next: "hired" });

    expect(mocks.createNotification).toHaveBeenCalledWith(
      { admin: true },
      expect.objectContaining({
        profileId: USER_ID,
        kind: "job_application_update",
        href: "/empleos/mis-aplicaciones",
        category: "trabajos",
        title: expect.stringContaining("Te eligieron"),
      }),
    );
  });

  it("si la RLS no devuelve fila (aviso ajeno) avisa sin inventar", async () => {
    useGuardOk({ update: { data: null, error: null } });

    const result = await advanceJobApplicationAction({
      applicationId: APPLICATION_ID,
      next: "rejected",
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("conflict");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("un estado que el empleador no puede escribir muere en zod, antes del guard", async () => {
    const result = await advanceJobApplicationAction({
      applicationId: APPLICATION_ID,
      next: "withdrawn" as "hired",
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("invalid");
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});

/* ----------------------- withdrawJobApplicationAction ---------------------- */

describe("withdrawJobApplicationAction", () => {
  it("retira la propia postulación y le avisa al dueño del aviso", async () => {
    const stub = useGuardOk();

    const result = await withdrawJobApplicationAction({ applicationId: APPLICATION_ID });

    expect(result).toEqual({ ok: true });
    const updated = stub.calls.find((call) => call.method === "update");
    expect(updated?.args[0]).toEqual({ status: "withdrawn" });
    // El filtro por applicant_id es explícito: retirarse es de quien se postuló.
    expect(stub.calls).toContainEqual({
      table: "job_applications",
      method: "eq",
      args: ["applicant_id", USER_ID],
    });
  });

  it("quien se retira NO se auto-notifica: acaba de hacerlo con el dedo", async () => {
    useGuardOk();

    await withdrawJobApplicationAction({ applicationId: APPLICATION_ID });

    const targets = (
      mocks.createNotification.mock.calls as unknown as Array<[unknown, { profileId: string }]>
    ).map(([, payload]) => payload.profileId);
    expect(targets).not.toContain(USER_ID);
  });

  it("una postulación ya resuelta no se puede retirar", async () => {
    const stub = useGuardOk({
      application: {
        data: {
          id: APPLICATION_ID,
          job_id: JOB_ID,
          applicant_id: USER_ID,
          status: "rejected",
        },
        error: null,
      },
    });

    const result = await withdrawJobApplicationAction({ applicationId: APPLICATION_ID });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("conflict");
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("un applicationId que no es uuid muere en zod, antes del guard", async () => {
    const result = await withdrawJobApplicationAction({ applicationId: "no-es-uuid" });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("invalid");
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});
