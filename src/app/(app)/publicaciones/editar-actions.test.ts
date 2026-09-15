import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las acciones de EDICIÓN de un aviso.
 *
 * Lo que se fija acá —y por qué cada cosa importa:
 *
 *  1. OWNERSHIP. La action nunca escribe sin que el `.eq('created_by')` y el
 *     `.eq('tenant_id')` viajen EN la query. No son "la" autorización (esa es la
 *     RLS), pero sin ellos el error de un aviso ajeno sería indistinguible del
 *     de uno inexistente, y la lectura previa devolvería la fila de otro.
 *  2. EL STATUS QUE SE ESCRIBE NUNCA ES 'published'. El WITH CHECK de
 *     `listings_update` no lo admite para el dueño: si alguna vez alguien lo
 *     "arregla" acá, la escritura entera rebota con 42501 en producción.
 *  3. EL CANDADO DE STATUS EN EL UPDATE. Entre la lectura y la escritura,
 *     moderación puede haber movido el aviso a `removed`. El `.in(status, ...)`
 *     es lo que hace que ahí no se escriba nada en vez de resucitarlo.
 *  4. LAS FOTOS NUEVAS PASAN POR EL MISMO PIPELINE QUE EN EL ALTA. Si no,
 *     editar sería la puerta de atrás para publicar lo que el alta rechaza.
 *
 * Bordes aislados con el patrón del repo (`marketplace/publicar/actions.test.ts`):
 * `vi.hoisted` + `vi.mock` + stub encadenable/thenable. Nunca se toca Supabase.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  moderateText: vi.fn(),
  moderationTier: vi.fn(),
  enqueueModeration: vi.fn(),
  createAdminClient: vi.fn(),
  registerUploadedMedia: vi.fn(),
  retireAssetFromSubject: vi.fn(),
  currentSourceHost: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({
  DAY_MS: 86_400_000,
  HOUR_MS: 3_600_000,
  limit: mocks.limit,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/config/services", () => ({ isVisionConfigured: false }));
vi.mock("@/lib/moderation", () => ({
  TIER_AUTO: 1,
  TIER_REVIEW: 2,
  TIER_HUMAN: 3,
  moderateText: mocks.moderateText,
  moderationTier: mocks.moderationTier,
  enqueueModeration: mocks.enqueueModeration,
}));
vi.mock("@/lib/integrity", () => ({
  registerUploadedMedia: mocks.registerUploadedMedia,
}));
// `retireAssetFromSubject` no sale del barril `@/lib/integrity` (ese index es de
// otro frente): la action lo importa por ruta directa y acá se dobla igual.
vi.mock("@/lib/integrity/retire", () => ({
  retireAssetFromSubject: mocks.retireAssetFromSubject,
}));
vi.mock("@/lib/integrity/source-host", () => ({
  currentSourceHost: mocks.currentSourceHost,
}));

import {
  cargarAvisoParaEditar,
  editarAvisoAction,
  pausarAvisoAction,
} from "./editar-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";

const FOTO_A = `${TENANT_ID}/${LISTING_ID}/aaaa.webp`;
const FOTO_B = `${TENANT_ID}/${LISTING_ID}/bbbb.webp`;

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"select" | "update", OpResult>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = () =>
      op ? (tableConfig[op] ?? { data: null, error: null }) : { data: null, error: null };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        op = op ?? "select";
        return builder;
      }),
      update: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "update", args });
        op = "update";
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return builder;
      }),
      in: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "in", args });
        return builder;
      }),
      maybeSingle: vi.fn(async () => result()),
      single: vi.fn(async () => result()),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

function useGuardOk(config: Record<string, TableOps> = {}) {
  const stub = createSupabaseStub(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos", currency: "USD" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

function filaPublicada(extra: Record<string, unknown> = {}) {
  return {
    id: LISTING_ID,
    kind: "product",
    status: "published",
    title: "Bicicleta rodado 29 casi nueva",
    description: "Usada tres meses, con luces y candado.",
    price_amount: 250,
    photos: [FOTO_A],
    attrs: { category: "deportes" },
    ...extra,
  };
}

const ENTRADA_VALIDA = {
  listingId: LISTING_ID,
  title: "Bicicleta rodado 29 impecable",
  description: "Usada tres meses, con luces y candado.",
  priceAmount: 230,
  photoPaths: [FOTO_A],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 39, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    score: 0,
    categories: [],
    skipped: false,
  });
  mocks.moderationTier.mockReturnValue(1);
  mocks.enqueueModeration.mockResolvedValue({ ok: true });
  mocks.registerUploadedMedia.mockResolvedValue({
    needsHumanReview: false,
    reasons: [],
    assetIds: [],
  });
  mocks.retireAssetFromSubject.mockResolvedValue(true);
  mocks.currentSourceHost.mockResolvedValue("dominicanos.example");
  mocks.createAdminClient.mockReturnValue({});
});

/* ============================ 1 · No es tuyo ============================== */

describe("no se edita el aviso de otra persona", () => {
  it("la lectura previa filtra por tenant Y por created_by, y sin fila no escribe nada", async () => {
    // Así responde la base cuando el aviso es de otro: la RLS de SELECT ni
    // siquiera lo devuelve, y el `.eq('created_by')` lo vuelve a descartar.
    const stub = useGuardOk({ listings: { select: { data: null, error: null } } });

    const result = await editarAvisoAction(ENTRADA_VALIDA);

    expect(result.ok).toBe(false);
    expect(stub.calls).toContainEqual({
      table: "listings",
      method: "eq",
      args: ["created_by", USER_ID],
    });
    expect(stub.calls).toContainEqual({
      table: "listings",
      method: "eq",
      args: ["tenant_id", TENANT_ID],
    });
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
    expect(mocks.registerUploadedMedia).not.toHaveBeenCalled();
    expect(mocks.enqueueModeration).not.toHaveBeenCalled();
  });

  it("el UPDATE también viaja con el dueño y el tenant, no sólo la lectura", async () => {
    const stub = useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    await editarAvisoAction(ENTRADA_VALIDA);

    const desdeElUpdate = stub.calls.slice(
      stub.calls.findIndex((call) => call.method === "update"),
    );
    expect(desdeElUpdate).toContainEqual({
      table: "listings",
      method: "eq",
      args: ["created_by", USER_ID],
    });
    expect(desdeElUpdate).toContainEqual({
      table: "listings",
      method: "eq",
      args: ["tenant_id", TENANT_ID],
    });
  });

  it("sin sesión no hay lectura ni escritura", async () => {
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });

    const result = await editarAvisoAction(ENTRADA_VALIDA);

    expect(result).toMatchObject({ ok: false, needsAuth: true });
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});

/* ====================== 2 · El status que se escribe ====================== */

describe("el status que se escribe nunca es 'published'", () => {
  it("un aviso publicado vuelve a pending_review", async () => {
    const stub = useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    const result = await editarAvisoAction(ENTRADA_VALIDA);

    expect(result).toMatchObject({ ok: true, status: "pending_review" });
    const update = stub.calls.find((call) => call.method === "update");
    expect(update?.args[0]).toMatchObject({
      title: "Bicicleta rodado 29 impecable",
      price_amount: 230,
      status: "pending_review",
    });
  });

  it("un aviso pausado por su dueño sigue pausado", async () => {
    const stub = useGuardOk({
      listings: {
        select: {
          data: filaPublicada({ status: "paused", attrs: { paused_reason: "owner" } }),
          error: null,
        },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    const result = await editarAvisoAction(ENTRADA_VALIDA);

    expect(result).toMatchObject({ ok: true, status: "paused" });
    const update = stub.calls.find((call) => call.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "paused" });
  });

  it("el UPDATE lleva el candado de status: moderación pudo haberlo movido", async () => {
    const stub = useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    await editarAvisoAction(ENTRADA_VALIDA);

    expect(stub.calls).toContainEqual({
      table: "listings",
      method: "in",
      args: ["status", ["published", "paused", "pending_review"]],
    });
  });

  it("si el candado no matchea fila, no se encola moderación ni se retira nada", async () => {
    useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: null, error: null },
      },
    });

    const result = await editarAvisoAction({ ...ENTRADA_VALIDA, photoPaths: [FOTO_B] });

    expect(result.ok).toBe(false);
    expect(mocks.enqueueModeration).not.toHaveBeenCalled();
    expect(mocks.retireAssetFromSubject).not.toHaveBeenCalled();
  });
});

/* ================= 3 · Estados que no se editan nunca ==================== */

describe("estados que no se editan", () => {
  it.each([["removed"], ["closed"], ["expired"], ["draft"]])(
    "un aviso en '%s' se rechaza sin escribir",
    async (status) => {
      const stub = useGuardOk({
        listings: { select: { data: filaPublicada({ status }), error: null } },
      });

      const result = await editarAvisoAction(ENTRADA_VALIDA);

      expect(result.ok).toBe(false);
      expect(stub.calls.some((call) => call.method === "update")).toBe(false);
    },
  );

  it("una pausa por denuncias no se destraba editando", async () => {
    const stub = useGuardOk({
      listings: {
        select: {
          data: filaPublicada({ status: "paused", attrs: { paused_reason: "reports" } }),
          error: null,
        },
      },
    });

    const result = await editarAvisoAction(ENTRADA_VALIDA);

    expect(result.ok).toBe(false);
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("un negocio se manda a su propia página en vez de editarse desde la hoja", async () => {
    const stub = useGuardOk({
      listings: { select: { data: filaPublicada({ kind: "business" }), error: null } },
    });

    const result = await editarAvisoAction(ENTRADA_VALIDA);

    expect(result.ok).toBe(false);
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });
});

/* ======================= 4 · Validación de forma ========================= */

describe("validación de forma — antes de tocar la base", () => {
  it("un título corto no llega ni a la lectura", async () => {
    const stub = useGuardOk();
    const result = await editarAvisoAction({ ...ENTRADA_VALIDA, title: "Bici" });
    expect(result.ok).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });

  it("un precio negativo se rechaza", async () => {
    const stub = useGuardOk();
    const result = await editarAvisoAction({ ...ENTRADA_VALIDA, priceAmount: -5 });
    expect(result.ok).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });

  it("una foto fuera de la carpeta del aviso se rechaza sin escribir", async () => {
    const stub = useGuardOk({
      listings: { select: { data: filaPublicada(), error: null } },
    });

    const ajena = `${TENANT_ID}/00000000-0000-4000-8000-000000000000/robada.webp`;
    const result = await editarAvisoAction({ ...ENTRADA_VALIDA, photoPaths: [ajena] });

    expect(result.ok).toBe(false);
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
    expect(mocks.registerUploadedMedia).not.toHaveBeenCalled();
  });

  it("un path con '..' se rechaza", async () => {
    useGuardOk({ listings: { select: { data: filaPublicada(), error: null } } });
    const result = await editarAvisoAction({
      ...ENTRADA_VALIDA,
      photoPaths: [`${TENANT_ID}/${LISTING_ID}/../otra.webp`],
    });
    expect(result.ok).toBe(false);
  });

  it("sin cambios no se escribe: sacar el aviso del muro a cambio de nada sería peor", async () => {
    const stub = useGuardOk({
      listings: { select: { data: filaPublicada(), error: null } },
    });

    const result = await editarAvisoAction({
      listingId: LISTING_ID,
      title: "Bicicleta rodado 29 casi nueva",
      description: "Usada tres meses, con luces y candado.",
      priceAmount: 250,
      photoPaths: [FOTO_A],
    });

    expect(result).toMatchObject({ ok: true, sinCambios: true, status: "published" });
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("agotada la cuota, ni lee", async () => {
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });
    const stub = useGuardOk();
    const result = await editarAvisoAction(ENTRADA_VALIDA);
    expect(result.ok).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });
});

/* =================== 5 · Moderación de las fotos nuevas =================== */

describe("una foto nueva pasa por el MISMO camino que en el alta", () => {
  it("se registra en el libro de procedencia con el sujeto correcto", async () => {
    useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    await editarAvisoAction({ ...ENTRADA_VALIDA, photoPaths: [FOTO_A, FOTO_B] });

    expect(mocks.registerUploadedMedia).toHaveBeenCalledTimes(1);
    const input = mocks.registerUploadedMedia.mock.calls[0][0];
    expect(input).toMatchObject({
      tenantId: TENANT_ID,
      uploaderId: USER_ID,
      subjectKind: "listing",
      subjectId: LISTING_ID,
    });
    // SÓLO la nueva: volver a huellar la que ya estaba duplicaría filas de
    // procedencia y la marcaría como duplicado de sí misma.
    expect(input.items).toEqual([
      { mediaKind: "imagen", storageBucket: "listing-photos", storagePath: FOTO_B },
    ]);
  });

  it("sin Vision configurado, una foto nueva encola revisión humana", async () => {
    useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    await editarAvisoAction({ ...ENTRADA_VALIDA, photoPaths: [FOTO_A, FOTO_B] });

    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);
    const encolado = mocks.enqueueModeration.mock.calls[0][1];
    expect(encolado).toMatchObject({
      tenantId: TENANT_ID,
      subjectKind: "listing",
      subjectId: LISTING_ID,
      tier: 3,
    });
    expect(encolado.reasons).toContain("photo_pending_review");
  });

  it("si el pipeline de integridad pide humano, el motivo viaja a la cola", async () => {
    mocks.registerUploadedMedia.mockResolvedValue({
      needsHumanReview: true,
      reasons: ["integrity_duplicate"],
      assetIds: [],
    });
    useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    await editarAvisoAction({ ...ENTRADA_VALIDA, photoPaths: [FOTO_A, FOTO_B] });

    expect(mocks.enqueueModeration.mock.calls[0][1].reasons).toContain(
      "integrity_duplicate",
    );
  });

  it("sin fotos nuevas no se vuelve a huellar nada, pero el texto sí se modera", async () => {
    useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    await editarAvisoAction(ENTRADA_VALIDA);

    expect(mocks.registerUploadedMedia).not.toHaveBeenCalled();
    expect(mocks.moderateText).toHaveBeenCalledTimes(1);
    expect(mocks.moderateText.mock.calls[0][0]).toContain("Bicicleta rodado 29 impecable");
  });

  it("un texto marcado por la IA encola con tier humano", async () => {
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      score: 0.9,
      categories: ["harassment"],
      skipped: false,
    });
    useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    await editarAvisoAction(ENTRADA_VALIDA);

    expect(mocks.enqueueModeration.mock.calls[0][1]).toMatchObject({ tier: 3 });
  });

  it("la foto que se saca queda anotada como retirada, no borrada del libro", async () => {
    useGuardOk({
      listings: {
        select: {
          data: filaPublicada({ photos: [FOTO_A, FOTO_B] }),
          error: null,
        },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    await editarAvisoAction({ ...ENTRADA_VALIDA, photoPaths: [FOTO_A] });

    expect(mocks.retireAssetFromSubject).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        subjectKind: "listing",
        subjectId: LISTING_ID,
        storagePath: FOTO_B,
      }),
    );
  });
});

/* =========================== 6 · Pausar / reactivar ======================= */

describe("pausar y volver a publicar", () => {
  it("pausar marca el motivo 'owner' — el trigger de pausas por denuncias no debe dispararse", async () => {
    const stub = useGuardOk({
      listings: {
        select: { data: filaPublicada(), error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    const result = await pausarAvisoAction({ listingId: LISTING_ID, pausar: true });

    expect(result).toMatchObject({ ok: true, status: "paused" });
    const update = stub.calls.find((call) => call.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "paused" });
    expect((update?.args[0] as { attrs: Record<string, unknown> }).attrs).toMatchObject({
      category: "deportes",
      paused_reason: "owner",
    });
  });

  it("volver a publicar manda a revisión, nunca directo a 'published'", async () => {
    const stub = useGuardOk({
      listings: {
        select: {
          data: filaPublicada({ status: "paused", attrs: { paused_reason: "owner" } }),
          error: null,
        },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });

    const result = await pausarAvisoAction({ listingId: LISTING_ID, pausar: false });

    expect(result).toMatchObject({ ok: true, status: "pending_review" });
    const update = stub.calls.find((call) => call.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "pending_review" });
    // El motivo de la pausa se va con la pausa: si quedara, la app seguiría
    // creyendo que el aviso está pausado por algo.
    expect(
      (update?.args[0] as { attrs: Record<string, unknown> }).attrs.paused_reason,
    ).toBeUndefined();
  });

  it("un aviso pausado por denuncias no lo reactiva su dueño", async () => {
    const stub = useGuardOk({
      listings: {
        select: {
          data: filaPublicada({ status: "paused", attrs: { paused_reason: "reports" } }),
          error: null,
        },
      },
    });

    const result = await pausarAvisoAction({ listingId: LISTING_ID, pausar: false });

    expect(result.ok).toBe(false);
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("no se pausa lo que no está publicado", async () => {
    const stub = useGuardOk({
      listings: {
        select: { data: filaPublicada({ status: "pending_review" }), error: null },
      },
    });

    const result = await pausarAvisoAction({ listingId: LISTING_ID, pausar: true });

    expect(result.ok).toBe(false);
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });
});

/* ============================ 7 · La carga ============================== */

describe("cargarAvisoParaEditar", () => {
  it("devuelve los valores actuales de un aviso propio", async () => {
    useGuardOk({ listings: { select: { data: filaPublicada(), error: null } } });

    const result = await cargarAvisoParaEditar({ listingId: LISTING_ID });

    expect(result).toMatchObject({
      ok: true,
      aviso: {
        id: LISTING_ID,
        kind: "product",
        status: "published",
        title: "Bicicleta rodado 29 casi nueva",
        priceAmount: 250,
        photos: [FOTO_A],
        tenantId: TENANT_ID,
      },
    });
  });

  it("de un aviso ajeno no dice nada más que 'no lo encontramos'", async () => {
    const stub = useGuardOk({ listings: { select: { data: null, error: null } } });

    const result = await cargarAvisoParaEditar({ listingId: LISTING_ID });

    expect(result.ok).toBe(false);
    expect(stub.calls).toContainEqual({
      table: "listings",
      method: "eq",
      args: ["created_by", USER_ID],
    });
  });
});
