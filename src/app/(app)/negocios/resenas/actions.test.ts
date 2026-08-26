import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las SERVER ACTIONS de reseñas (migración 0093).
 *
 * Bordes mockeados con el patrón del repo (marketplace/comments-actions.test.ts):
 * `vi.hoisted` + `vi.mock` + un stub encadenable y thenable del query builder.
 * Sin Supabase real.
 *
 * QUÉ SE PRUEBA ACÁ Y QUÉ NO. Las defensas de verdad —una reseña por persona,
 * no reseñar el negocio propio, quién puede tocar qué columna— viven en la base
 * y no se pueden testear con un stub: mentirían. Lo que sí se prueba es lo que
 * esta capa promete:
 *
 *   · el guard de tenant corre ANTES de escribir nada;
 *   · `tenant_id` y `author_id` salen del guard, NUNCA del formulario;
 *   · editar la reseña propia hace UPDATE y no un segundo INSERT;
 *   · la respuesta del negocio no manda autoría (la deriva el trigger);
 *   · cada error de Postgres se traduce a una frase accionable.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/rate-limit", () => ({
  limit: mocks.limit,
  DAY_MS: 86_400_000,
  HOUR_MS: 3_600_000,
}));

import {
  borrarResenaAction,
  publicarResenaAction,
  reportarResenaAction,
  responderResenaAction,
} from "./actions";
import { RESENA_STATE_INICIAL } from "./estado";
import { RESENAS_COPY } from "@/lib/resenas";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const REVIEW_ID = "66666666-6666-4666-8666-666666666666";

interface OpResult {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}
type TableOps = Partial<Record<"insert" | "update" | "delete" | "select", OpResult>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  let rpcResult: OpResult = { data: null, error: null };

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = () => tableConfig[op ?? "select"] ?? { data: null, error: null };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        op = "insert";
        return builder;
      }),
      update: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "update", args });
        op = "update";
        return builder;
      }),
      delete: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "delete", args });
        op = "delete";
        return builder;
      }),
      select: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        op = op ?? "select";
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => result()),
      single: vi.fn(async () => result()),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  const rpc = vi.fn(async (name: string, args: unknown) => {
    rpcCalls.push({ name, args });
    return rpcResult;
  });

  return {
    client: { from, rpc },
    calls,
    rpcCalls,
    setRpcResult(next: OpResult) {
      rpcResult = next;
    },
  };
}

function guardOk(config: Record<string, TableOps> = {}) {
  const stub = createSupabaseStub(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

function formData(entradas: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [clave, valor] of Object.entries(entradas)) fd.set(clave, valor);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
});

/* ================================ Publicar ================================ */

describe("publicarResenaAction", () => {
  it("sin puntaje no llega ni a mirar la sesión", async () => {
    const resultado = await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "" }),
    );

    expect(resultado).toEqual({ status: "invalid", message: RESENAS_COPY.errores.sinPuntaje });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("rechaza un puntaje fuera del 1 a 5", async () => {
    const resultado = await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "9" }),
    );
    expect(resultado.status).toBe("invalid");
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("sin sesión pide entrar, en criollo", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "…",
      user: null,
      tenant: { id: TENANT_ID },
      supabase: {},
    });

    const resultado = await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "5" }),
    );

    expect(resultado).toEqual({ status: "error", message: RESENAS_COPY.errores.sinCuenta });
  });

  it("EL TENANT Y EL AUTOR SALEN DEL GUARD, no del formulario", async () => {
    const stub = guardOk({ listing_reviews: { select: { data: null, error: null } } });

    const resultado = await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({
        listingId: LISTING_ID,
        rating: "5",
        body: "  Muy bien atendido  ",
        // Intento de inyección: los dos se ignoran.
        tenant_id: "00000000-0000-4000-8000-000000000000",
        author_id: "00000000-0000-4000-8000-000000000001",
      }),
    );

    expect(resultado.status).toBe("success");
    const insert = stub.calls.find((c) => c.method === "insert");
    expect(insert?.table).toBe("listing_reviews");
    expect(insert?.args[0]).toEqual({
      tenant_id: TENANT_ID,
      listing_id: LISTING_ID,
      author_id: USER_ID,
      // Sin identidad de negocio activa, la reseña sale a nombre de la persona.
      entity_listing_id: null,
      rating: 5,
      body: "Muy bien atendido",
    });
  });

  it("un texto en blanco se guarda como null y no como cadena vacía", async () => {
    const stub = guardOk({ listing_reviews: { select: { data: null, error: null } } });

    await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "4", body: "   " }),
    );

    const insert = stub.calls.find((c) => c.method === "insert");
    expect((insert?.args[0] as { body: unknown }).body).toBeNull();
  });

  it("si ya reseñé, EDITA: hace update y no un segundo insert", async () => {
    const stub = guardOk({
      listing_reviews: {
        select: { data: { id: REVIEW_ID }, error: null },
        update: { data: null, error: null },
      },
    });

    const resultado = await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "3", body: "Cambié de opinión" }),
    );

    expect(resultado).toEqual({ status: "success", message: RESENAS_COPY.actualizada });
    expect(stub.calls.some((c) => c.method === "insert")).toBe(false);
    const update = stub.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toEqual({ rating: 3, body: "Cambié de opinión" });
  });

  it("el choque con el índice único se traduce a 'editá la que dejaste'", async () => {
    guardOk({
      listing_reviews: {
        select: { data: null, error: null },
        insert: { data: null, error: { code: "23505", message: "duplicate key" } },
      },
    });

    const resultado = await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "5" }),
    );

    expect(resultado).toEqual({ status: "error", message: RESENAS_COPY.errores.duplicada });
  });

  it("la RLS que frena reseñar el negocio propio se explica como tal", async () => {
    guardOk({
      listing_reviews: {
        select: { data: null, error: null },
        insert: { data: null, error: { code: "42501", message: "row-level security" } },
      },
    });

    const resultado = await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "5" }),
    );

    expect(resultado).toEqual({ status: "error", message: RESENAS_COPY.errores.propioNegocio });
  });

  it("el cupo diario corta antes de escribir", async () => {
    const stub = guardOk();
    mocks.limit.mockReturnValue({ ok: false });

    const resultado = await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "5" }),
    );

    expect(resultado).toEqual({ status: "error", message: RESENAS_COPY.errores.demasiadas });
    expect(stub.calls).toHaveLength(0);
  });

  it("al publicar revalida las fichas de las dos verticales", async () => {
    guardOk({ listing_reviews: { select: { data: null, error: null } } });

    await publicarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ listingId: LISTING_ID, rating: "5" }),
    );

    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/negocios/${LISTING_ID}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/profesionales/${LISTING_ID}`);
  });
});

/* ================================= Borrar ================================= */

describe("borrarResenaAction", () => {
  it("borra sólo la propia: filtra por autor además de por id", async () => {
    const stub = guardOk({ listing_reviews: { delete: { data: null, error: null } } });

    const resultado = await borrarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ reviewId: REVIEW_ID, listingId: LISTING_ID }),
    );

    expect(resultado).toEqual({ status: "success", message: RESENAS_COPY.borrada });
    const filtros = stub.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(filtros).toContainEqual(["id", REVIEW_ID]);
    expect(filtros).toContainEqual(["author_id", USER_ID]);
  });
});

/* =============================== Responder ================================ */

describe("responderResenaAction", () => {
  it("NO manda la autoría de la respuesta: la deriva el trigger", async () => {
    const stub = guardOk({ listing_reviews: { update: { data: null, error: null } } });

    const resultado = await responderResenaAction(
      RESENA_STATE_INICIAL,
      formData({
        reviewId: REVIEW_ID,
        listingId: LISTING_ID,
        reply: "Gracias por escribirnos",
        // Aunque el cliente los mande, no viajan.
        owner_reply_by: "00000000-0000-4000-8000-000000000002",
      }),
    );

    expect(resultado.status).toBe("success");
    const update = stub.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toEqual({ owner_reply: "Gracias por escribirnos" });
  });

  it("una respuesta vacía la quita en vez de guardar una cadena vacía", async () => {
    const stub = guardOk({ listing_reviews: { update: { data: null, error: null } } });

    await responderResenaAction(
      RESENA_STATE_INICIAL,
      formData({ reviewId: REVIEW_ID, listingId: LISTING_ID, reply: "   " }),
    );

    const update = stub.calls.find((c) => c.method === "update");
    expect((update?.args[0] as { owner_reply: unknown }).owner_reply).toBeNull();
  });

  it("el trigger que impide corregir el puntaje ajeno se explica en español", async () => {
    guardOk({
      listing_reviews: {
        update: { data: null, error: { code: "P0001", message: "PUNTAJE_AJENO: …" } },
      },
    });

    const resultado = await responderResenaAction(
      RESENA_STATE_INICIAL,
      formData({ reviewId: REVIEW_ID, listingId: LISTING_ID, reply: "hola" }),
    );

    expect(resultado).toEqual({
      status: "error",
      message: RESENAS_COPY.errores.sinPermisoRespuesta,
    });
  });
});

/* ================================ Reportar ================================ */

describe("reportarResenaAction", () => {
  it("sin motivo no se manda nada", async () => {
    const resultado = await reportarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ reviewId: REVIEW_ID, listingId: LISTING_ID, reason: "  " }),
    );

    expect(resultado).toEqual({
      status: "invalid",
      message: RESENAS_COPY.errores.motivoRequerido,
    });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("va por la RPC de scam_reports y no inventa una tabla propia", async () => {
    const stub = guardOk();

    const resultado = await reportarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ reviewId: REVIEW_ID, listingId: LISTING_ID, reason: "No es un cliente" }),
    );

    expect(resultado).toEqual({ status: "success", message: RESENAS_COPY.reportada });
    expect(stub.rpcCalls).toEqual([
      {
        name: "report_listing_review",
        args: { p_review_id: REVIEW_ID, p_reason: "No es un cliente" },
      },
    ]);
    // Ninguna escritura directa a tablas: el peso del reporte lo pone el trigger.
    expect(stub.calls).toHaveLength(0);
  });

  it("traduce TARGET_NOT_FOUND en vez de mostrar el error de Postgres", async () => {
    const stub = guardOk();
    stub.setRpcResult({ data: null, error: { message: "TARGET_NOT_FOUND: …" } });

    const resultado = await reportarResenaAction(
      RESENA_STATE_INICIAL,
      formData({ reviewId: REVIEW_ID, listingId: LISTING_ID, reason: "algo" }),
    );

    expect(resultado).toEqual({ status: "invalid", message: RESENAS_COPY.errores.noEncontrado });
  });
});
