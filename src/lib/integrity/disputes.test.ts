import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * DISPUTAS DE CONTENIDO — contrato compartido + las cuatro resoluciones
 * =============================================================================
 *
 * DOS BLOQUES EN UN SOLO ARCHIVO, Y ESO NECESITA EXPLICACIÓN. La primera mitad
 * testea `disputes.ts` (lo que le corresponde por nombre). La segunda testea
 * `resolveDispute` —la action del panel de staff—, que vive en
 * `src/app/admin/moderacion/integridad/disputas/actions.ts`. Está acá y no al
 * lado de la action porque el reparto de archivos de esta tarea no asignó un
 * test bajo `disputas/`, y las cuatro resoluciones son justamente la parte que
 * NO se puede dejar sin cubrir: son las que le quitan a alguien el derecho de
 * usar su contenido. Si el reparto se abre, el segundo bloque se muda tal cual a
 * `disputas/actions.test.ts` sin tocar una línea.
 *
 * LO QUE SE FIJA:
 *  · Un link de evidencia con esquema ejecutable no pasa. `z.url()` NO alcanza:
 *    en zod v4 acepta `javascript:` porque es una URL válida.
 *  · Las tablas de dominio no se desincronizan de los CHECK de la 0086.
 *  · Cada una de las cuatro decisiones escribe el estado correcto en la disputa,
 *    el estado correcto en el asset, y queda auditada.
 *  · Devolver un archivo a `aprobado` es CONDICIONAL —sólo desde la pausa, y
 *    sólo si no quedan otros reclamos vivos—; bloquear no lo es.
 */

/* ========================================================================== */
/* Bloque 1 — el contrato de disputes.ts                                      */
/* ========================================================================== */

import {
  CLAIM_KINDS,
  CLAIM_KIND_OPTIONS,
  DISPUTE_DECISIONS,
  DISPUTE_STATUSES,
  DISPUTE_STATUS_META,
  LIVE_DISPUTE_STATUSES,
  MAX_EVIDENCE_URLS,
  assetReviewLabel,
  claimKindLabel,
  disputeFilterStatuses,
  disputeStatusMeta,
  isClaimConfirmed,
  isSafeHttpUrl,
  parseEvidenceUrls,
  resolveDisputeFilter,
} from "./disputes";

describe("isSafeHttpUrl — sólo http y https", () => {
  it("rechaza todo esquema que un click pueda ejecutar", () => {
    const peligrosos = [
      "javascript:alert(document.cookie)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)  ",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/1234",
      "ftp://example.com/archivo.zip",
      "mailto:alguien@example.com",
    ];
    for (const url of peligrosos) {
      expect(isSafeHttpUrl(url), url).toBe(false);
    }
  });

  it("rechaza lo que ni siquiera es una URL", () => {
    for (const raw of ["", "   ", "no soy una url", "/ruta/relativa", "example.com"]) {
      expect(isSafeHttpUrl(raw), raw).toBe(false);
    }
  });

  it("acepta http y https, con espacios al borde", () => {
    for (const url of [
      "https://registro.example/obra/123",
      "http://blog.example/post",
      "  https://example.com/con-espacios  ",
      "https://example.com/path?a=1&b=2#frag",
    ]) {
      expect(isSafeHttpUrl(url), url).toBe(true);
    }
  });

  it("rechaza un link absurdamente largo (tope de columna)", () => {
    expect(isSafeHttpUrl(`https://example.com/${"a".repeat(600)}`)).toBe(false);
  });
});

describe("parseEvidenceUrls", () => {
  it("un solo link peligroso invalida el lote entero, y lo nombra", () => {
    const result = parseEvidenceUrls("https://ok.example/1\njavascript:alert(1)\nhttps://ok.example/2");
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "invalid") {
      expect(result.offending).toBe("javascript:alert(1)");
    } else {
      throw new Error("se esperaba reason=invalid");
    }
  });

  it("normaliza, deduplica y preserva el orden", () => {
    const result = parseEvidenceUrls(
      "  https://a.example/1  \r\nhttp://b.example/2\n\nhttps://a.example/1\n",
    );
    expect(result).toEqual({ ok: true, urls: ["https://a.example/1", "http://b.example/2"] });
  });

  it("vacío o ausente es una lista vacía, no un error", () => {
    expect(parseEvidenceUrls(null)).toEqual({ ok: true, urls: [] });
    expect(parseEvidenceUrls(undefined)).toEqual({ ok: true, urls: [] });
    expect(parseEvidenceUrls("   \n  \n")).toEqual({ ok: true, urls: [] });
  });

  it("corta en el tope del CHECK, y la deduplicación no lo esquiva", () => {
    const distintos = Array.from({ length: MAX_EVIDENCE_URLS + 1 }, (_, i) => `https://e.example/${i}`);
    const result = parseEvidenceUrls(distintos.join("\n"));
    expect(result).toEqual({ ok: false, reason: "too_many", count: MAX_EVIDENCE_URLS + 1 });

    // 11 líneas pero 10 links únicos SÍ entran: el tope es de evidencia, no de líneas.
    const conRepetido = [...distintos.slice(0, MAX_EVIDENCE_URLS), distintos[0]];
    const okResult = parseEvidenceUrls(conRepetido.join("\n"));
    expect(okResult.ok).toBe(true);
  });
});

describe("isClaimConfirmed — la afirmación no se infiere", () => {
  it("sólo un valor afirmativo explícito cuenta", () => {
    for (const value of ["true", "on", "1", "si", "SÍ", " YES "]) {
      expect(isClaimConfirmed(value), value).toBe(true);
    }
  });

  it("ausente, vacío o 'false' NO es una confirmación", () => {
    // El bug que esto previene es el de `z.coerce.boolean()`, que convierte la
    // cadena "false" en `true`. Con una afirmación legal eso es imperdonable.
    for (const value of [null, undefined, "", "false", "no", "0", "quizás"]) {
      expect(isClaimConfirmed(value), String(value)).toBe(false);
    }
  });
});

describe("dominio — nada se desincroniza de la 0086", () => {
  it("los cinco claim_kind del CHECK tienen etiqueta humana", () => {
    expect(CLAIM_KIND_OPTIONS.map((option) => option.value).sort()).toEqual([...CLAIM_KINDS].sort());
    for (const kind of CLAIM_KINDS) {
      expect(claimKindLabel(kind)).not.toBe("Sin clasificar");
    }
    expect(claimKindLabel("inventado")).toBe("Sin clasificar");
  });

  it("los seis status del CHECK tienen etiqueta, badge y significado", () => {
    expect(Object.keys(DISPUTE_STATUS_META).sort()).toEqual([...DISPUTE_STATUSES].sort());
    for (const status of DISPUTE_STATUSES) {
      const meta = disputeStatusMeta(status);
      expect(meta.label.length, status).toBeGreaterThan(0);
      expect(meta.meaning.length, status).toBeGreaterThan(0);
    }
    expect(disputeStatusMeta("marciano").label).toBe("Sin estado");
  });

  it("los estados vivos son exactamente los del índice único parcial", () => {
    expect([...LIVE_DISPUTE_STATUSES]).toEqual(["abierta", "en_revision", "apelada"]);
  });

  it("`apto_comercial` (0086) tiene etiqueta: si no, el panel diría 'Sin estado'", () => {
    for (const status of ["pendiente", "aprobado", "bloqueado", "en_investigacion", "apto_comercial"]) {
      expect(assetReviewLabel(status), status).not.toBe("Sin estado");
    }
  });

  it("un filtro inventado en la URL cae en 'abiertos', no en 'todos'", () => {
    expect(resolveDisputeFilter(undefined)).toBe("abiertos");
    expect(resolveDisputeFilter("no-existe")).toBe("abiertos");
    expect(resolveDisputeFilter(["resueltos", "todos"])).toBe("resueltos");
    expect(disputeFilterStatuses("abiertos")).toEqual(["abierta", "en_revision", "apelada"]);
    expect(disputeFilterStatuses("resueltos")).not.toContain("abierta");
  });

  it("sólo la decisión que bloquea baja la publicación, y sólo ella no es condicional", () => {
    expect(DISPUTE_DECISIONS.a_favor_reclamante.takesDownSubject).toBe(true);
    expect(DISPUTE_DECISIONS.a_favor_reclamante.restoreOnlyFromFrozen).toBe(false);
    for (const decision of ["revisar", "a_favor_uploader", "descartar"] as const) {
      expect(DISPUTE_DECISIONS[decision].takesDownSubject, decision).toBe(false);
    }
    // Tomar el caso no resuelve nada: no exige nota y no mueve el archivo.
    expect(DISPUTE_DECISIONS.revisar.requiresNote).toBe(false);
    expect(DISPUTE_DECISIONS.revisar.assetStatus).toBeNull();
  });
});

/* ========================================================================== */
/* Bloque 2 — las cuatro resoluciones del panel                               */
/* ========================================================================== */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(async () => true),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/admin/guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  resolveDispute,
  type ResolveDisputeState,
} from "@/app/admin/moderacion/integridad/disputas/actions";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const DISPUTE_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const POST_ID = "66666666-6666-4666-8666-666666666666";
const RESPONDENT_ID = "88888888-8888-4888-8888-888888888888";

const IDLE: ResolveDisputeState = { status: "idle" };
const NOTE = "El reclamante aportó el original con metadatos de 2024.";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

interface StaffStubConfig {
  dispute?: Record<string, unknown> | null;
  readError?: { message: string } | null;
  updated?: { id: string } | null;
  updateError?: { message: string } | null;
  /** Otros reclamos VIVOS sobre el mismo asset. */
  otherLive?: { id: string }[];
}

/**
 * Query builder falso. Decide el resultado por la FORMA de la cadena, que es lo
 * que distingue los tres accesos a `content_disputes` en la action: leer
 * (maybeSingle sin update), resolver (update + maybeSingle) y contar otros vivos
 * (limit).
 */
function createStaffStub(config: StaffStubConfig = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    let didUpdate = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    const record = (method: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.fn((...args: any[]) => {
        calls.push({ table, method, args });
        if (method === "update") didUpdate = true;
        return builder;
      });

    const result = () => {
      if (table !== "content_disputes") return { data: null, error: null };
      if (didUpdate) {
        return {
          data: config.updated === undefined ? { id: DISPUTE_ID } : config.updated,
          error: config.updateError ?? null,
        };
      }
      return { data: config.dispute ?? null, error: config.readError ?? null };
    };

    builder.select = record("select");
    builder.update = record("update");
    builder.eq = record("eq");
    builder.neq = record("neq");
    builder.in = record("in");
    builder.limit = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "limit", args });
      return Promise.resolve({ data: config.otherLive ?? [], error: null });
    });
    builder.maybeSingle = vi.fn(async () => result());
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  });

  return { client: { from }, from, calls };
}

function createAdminStub(subject: { subject_kind: string; subject_id: string | null } | null = {
  subject_kind: "post",
  subject_id: POST_ID,
}) {
  const calls: RecordedCall[] = [];
  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    const record = (method: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.fn((...args: any[]) => {
        calls.push({ table, method, args });
        return builder;
      });
    builder.update = record("update");
    builder.select = record("select");
    builder.eq = record("eq");
    builder.maybeSingle = vi.fn(async () => ({ data: subject, error: null }));
    return builder;
  });
  const client = { from };
  mocks.createAdminClient.mockReturnValue(client);
  return { client, from, calls };
}

const OPEN_DISPUTE = {
  id: DISPUTE_ID,
  tenant_id: TENANT_ID,
  asset_id: ASSET_ID,
  claim_kind: "autoria",
  status: "abierta",
  respondent_id: RESPONDENT_ID,
};

function useStaff(config: StaffStubConfig = {}, role = "moderator") {
  const stub = createStaffStub({ dispute: OPEN_DISPUTE, ...config });
  mocks.getStaffContext.mockImplementation(async (min: string) => {
    const rank: Record<string, number> = { moderator: 1, domain_admin: 2, global_admin: 3 };
    if ((rank[role] ?? 0) < (rank[min] ?? 1)) return null;
    return { supabase: stub.client, user: { id: STAFF_ID }, role, tenantId: TENANT_ID };
  });
  return stub;
}

function decisionForm(decision: string, note: string | null = NOTE): FormData {
  const fd = new FormData();
  fd.set("disputeId", DISPUTE_ID);
  fd.set("decision", decision);
  if (note !== null) fd.set("note", note);
  return fd;
}

/** El payload del `.update()` sobre una tabla. */
function updatePayload(calls: RecordedCall[], table: string): Record<string, unknown> | undefined {
  const call = calls.find((entry) => entry.table === table && entry.method === "update");
  return call?.args[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.logAdminAction.mockResolvedValue(true);
});

describe("resolveDispute — las cuatro decisiones escriben el estado correcto", () => {
  it("tomar el caso: en_revision, sin firmar y sin tocar el archivo", async () => {
    const staff = useStaff();
    const admin = createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("revisar", null));

    expect(state).toEqual({ status: "success" });
    expect(updatePayload(staff.calls, "content_disputes")).toMatchObject({
      status: "en_revision",
      resolved_by: null,
      resolved_at: null,
    });
    // Tomar el caso NO es resolver: no espeja nada en el asset.
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: STAFF_ID,
        action: "dispute.revisar",
        tenantId: TENANT_ID,
        subjectKind: "content_dispute",
        subjectId: DISPUTE_ID,
      }),
    );
  });

  it("a favor del reclamante: bloquea el archivo y baja la publicación", async () => {
    const staff = useStaff();
    const admin = createAdminStub({ subject_kind: "post", subject_id: POST_ID });

    const state = await resolveDispute(IDLE, decisionForm("a_favor_reclamante"));

    expect(state).toEqual({ status: "success" });
    expect(updatePayload(staff.calls, "content_disputes")).toMatchObject({
      status: "resuelta_a_favor_reclamante",
      resolved_by: STAFF_ID,
      resolution_note: NOTE,
    });
    expect(updatePayload(admin.calls, "content_assets")).toMatchObject({
      review_status: "bloqueado",
      reviewed_by: STAFF_ID,
    });
    // Bloquear no es condicional: no se filtra por review_status.
    expect(admin.calls).not.toContainEqual(
      expect.objectContaining({ method: "eq", args: ["review_status", "en_investigacion"] }),
    );
    // Y tiene que MORDER: un archivo bloqueado cuyo post sigue arriba es una
    // decisión que no pasó nada.
    expect(updatePayload(staff.calls, "posts")).toMatchObject({ status: "removed" });
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dispute.a_favor_reclamante",
        meta: expect.objectContaining({ asset_id: ASSET_ID, claim_kind: "autoria" }),
      }),
    );
  });

  it("a favor del uploader: saca el archivo de la pausa, sólo desde la pausa", async () => {
    const staff = useStaff();
    const admin = createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("a_favor_uploader"));

    expect(state).toEqual({ status: "success" });
    expect(updatePayload(staff.calls, "content_disputes")).toMatchObject({
      status: "resuelta_a_favor_uploader",
      resolved_by: STAFF_ID,
    });
    expect(updatePayload(admin.calls, "content_assets")).toMatchObject({
      review_status: "aprobado",
    });
    // El candado: un archivo que un moderador bloqueó por otro motivo NO se
    // desbloquea porque un reclamo distinto se haya caído.
    expect(admin.calls).toContainEqual({
      table: "content_assets",
      method: "eq",
      args: ["review_status", "en_investigacion"],
    });
    expect(staff.calls.find((call) => call.table === "posts")).toBeUndefined();
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dispute.a_favor_uploader" }),
    );
  });

  it("descartar: estado propio, y no se confunde con darle la razón al uploader", async () => {
    const staff = useStaff();
    const admin = createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("descartar"));

    expect(state).toEqual({ status: "success" });
    expect(updatePayload(staff.calls, "content_disputes")).toMatchObject({
      status: "descartada",
      resolved_by: STAFF_ID,
    });
    // El archivo igual sale de la pausa: un reclamo sin sustancia no puede
    // dejar congelado el contenido de otro para siempre.
    expect(updatePayload(admin.calls, "content_assets")).toMatchObject({
      review_status: "aprobado",
    });
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dispute.descartar" }),
    );
  });
});

describe("resolveDispute — reglas de estado que no son obvias", () => {
  it("con OTRO reclamo vivo sobre el mismo archivo, la pausa no se levanta", async () => {
    const staff = useStaff({ otherLive: [{ id: "99999999-9999-4999-8999-999999999999" }] });
    const admin = createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("descartar"));

    // La disputa SÍ se resuelve; el archivo NO se descongela.
    expect(state).toEqual({ status: "success" });
    expect(updatePayload(staff.calls, "content_disputes")).toMatchObject({ status: "descartada" });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("un reclamo ya resuelto no se vuelve a resolver", async () => {
    const staff = useStaff({ dispute: { ...OPEN_DISPUTE, status: "descartada" } });
    createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("a_favor_reclamante"));

    expect(state.status).toBe("error");
    expect(updatePayload(staff.calls, "content_disputes")).toBeUndefined();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("si otro moderador llegó primero, el UPDATE no matchea y no se audita", async () => {
    // El `.in(status, vivos)` de la query devuelve cero filas.
    const staff = useStaff({ updated: null });
    createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("a_favor_reclamante"));

    expect(state.status).toBe("error");
    expect(staff.calls).toContainEqual({
      table: "content_disputes",
      method: "in",
      args: ["status", ["abierta", "en_revision", "apelada"]],
    });
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("resolveDispute — permisos y validación", () => {
  it("sin rol de staff no se lee ni se escribe nada", async () => {
    const staff = createStaffStub({ dispute: OPEN_DISPUTE });
    mocks.getStaffContext.mockResolvedValue(null);
    createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("a_favor_reclamante"));

    expect(state.status).toBe("error");
    expect(staff.from).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("resolver sin nota no se guarda — la nota es lo que leen las dos partes", async () => {
    const staff = useStaff();
    createAdminStub();

    for (const decision of ["a_favor_reclamante", "a_favor_uploader", "descartar"]) {
      const state = await resolveDispute(IDLE, decisionForm(decision, null));
      expect(state.status, decision).toBe("error");
    }
    expect(staff.from).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("una decisión inventada no pasa", async () => {
    const staff = useStaff();
    createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("borrar_todo"));

    expect(state.status).toBe("error");
    expect(staff.from).not.toHaveBeenCalled();
  });

  it("un error de la base no se disfraza de éxito ni se audita", async () => {
    useStaff({ updateError: { message: "connection reset" }, updated: null });
    createAdminStub();

    const state = await resolveDispute(IDLE, decisionForm("descartar"));

    expect(state.status).toBe("error");
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("si el admin client no está configurado, la resolución igual queda asentada", async () => {
    // La disputa YA se resolvió cuando se intenta espejar el asset: devolverle un
    // error a quien ya decidió sería mentirle sobre lo que pasó.
    useStaff();
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente");
    });

    const state = await resolveDispute(IDLE, decisionForm("a_favor_reclamante"));

    expect(state).toEqual({ status: "success" });
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dispute.a_favor_reclamante" }),
    );
  });
});
