import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las server actions de MONETIZACIÓN — la parte que cobra.
 *
 * Lo que estos tests defienden, en una línea: que el tope y el gate de premium
 * existan EN EL SERVIDOR. Un aviso `free` no puede guardar un botón externo ni
 * aunque el payload venga perfecto, y el tier se lee siempre de la fila, nunca
 * del cliente. La base tiene el CHECK que lo garantiza igual
 * (`listings_cta_premium_only`, 0048); esto prueba que además llega con copy y
 * sin gastar un round-trip que va a rebotar.
 *
 * Bordes mockeados con el patrón del repo (empleos/actions.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable del query builder.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  limit: vi.fn(() => ({ ok: true, remaining: 29, retryAfterMs: 0 })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));

import {
  recordCtaClickAction,
  saveCampaignAction,
  saveListingCtasAction,
} from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_ID = "88888888-8888-4888-8888-888888888888";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const CAMPAIGN_ID = "55555555-5555-4555-8555-555555555555";

function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING_ID,
    tenant_id: TENANT_ID,
    kind: "business",
    tier: "premium",
    status: "published",
    created_by: USER_ID,
    ...overrides,
  };
}

type OpResult = { data?: unknown; error?: unknown };

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(
  config: {
    listing?: OpResult;
    listingUpdate?: OpResult;
    campaignExisting?: OpResult;
    campaignInsert?: OpResult;
    campaignUpdate?: OpResult;
    rpc?: OpResult;
  } = {},
) {
  const calls: RecordedCall[] = [];

  const resolveFor = (table: string, mode: string): OpResult => {
    if (table === "listings") {
      if (mode === "update") return config.listingUpdate ?? { data: null, error: null };
      return config.listing ?? { data: listingRow(), error: null };
    }
    if (table === "campaigns") {
      if (mode === "insert") {
        return config.campaignInsert ?? { data: { id: CAMPAIGN_ID }, error: null };
      }
      if (mode === "update") return config.campaignUpdate ?? { data: null, error: null };
      return config.campaignExisting ?? { data: null, error: null };
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
      order: record("order"),
      limit: record("limit"),
      maybeSingle: vi.fn(async () => resolveFor(table, mode)),
      single: vi.fn(async () => resolveFor(table, mode)),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(resolveFor(table, mode)).then(resolve, reject),
    };
    return builder;
  });

  const rpc = vi.fn(async (name: string, args: unknown) => {
    calls.push({ table: "__rpc__", method: name, args: [args] });
    return config.rpc ?? { data: null, error: null };
  });

  return { client: { from, rpc }, calls, rpc };
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

/**
 * Lo que se terminó escribiendo en las 7 columnas `cta_*`, o null si no se
 * escribió nada.
 *
 * Desde la 0053 el guardado NO va por `.update()` sino por la RPC
 * `save_listing_ctas`: la policy `listings_update` (0004) excluye a propósito
 * `status='published'` —para que un aviso no se reescriba después de pasar
 * moderación— y eso rebotaba también este parche, que sólo toca los botones.
 * Los parámetros de la función se traducen de vuelta a nombres de columna para
 * que las aserciones de este archivo sigan hablando del ESQUEMA y no de la
 * forma de la llamada.
 */
const RPC_PARAM_TO_COLUMN: Record<string, string> = {
  p_phone: "cta_phone",
  p_whatsapp: "cta_whatsapp",
  p_website: "cta_website",
  p_purchase_url: "cta_purchase_url",
  p_tickets_url: "cta_tickets_url",
  p_booking_url: "cta_booking_url",
  p_address: "cta_address",
};

function updatePatch(stub: ReturnType<typeof createSupabaseStub>) {
  const call = stub.calls.find(
    (c) => c.table === "__rpc__" && c.method === "save_listing_ctas",
  );
  if (!call) return null;
  const args = call.args[0] as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [param, column] of Object.entries(RPC_PARAM_TO_COLUMN)) {
    patch[column] = args[param] ?? null;
  }
  return patch;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 29, retryAfterMs: 0 });
});

/* ------------------------------ saveListingCtas --------------------------- */

describe("saveListingCtasAction — el gate de premium", () => {
  // EL TEST QUE PIDE EL CONTRATO.
  it("un aviso FREE no puede guardar un CTA, aunque el payload sea válido", async () => {
    const stub = useGuardOk({ listing: { data: listingRow({ tier: "free" }), error: null } });

    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { phone: "+1 305 555 0134", whatsapp: "+1 305 555 0134" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("premium");
    // Y no se gasta un UPDATE que la base va a rebotar con un 23514.
    expect(updatePatch(stub)).toBeNull();
  });

  it("el tier sale de la FILA: mandarlo en el payload no sirve de nada", async () => {
    const stub = useGuardOk({ listing: { data: listingRow({ tier: "free" }), error: null } });

    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      // @ts-expect-error — exactamente lo que intentaría un fetch a mano.
      tier: "premium",
      ctas: { phone: "+1 305 555 0134" },
    });

    expect(result.ok).toBe(false);
    expect(updatePatch(stub)).toBeNull();
  });

  it("premium guarda y escribe las 7 columnas (lo vacío va a NULL)", async () => {
    const stub = useGuardOk();

    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { phone: "+1 305 555 0134", website: "https://donarosa.com" },
    });

    expect(result).toEqual({ ok: true, saved: ["phone", "website"] });
    expect(updatePatch(stub)).toEqual({
      cta_phone: "+1 305 555 0134",
      cta_whatsapp: null,
      cta_website: "https://donarosa.com/",
      cta_purchase_url: null,
      cta_tickets_url: null,
      cta_booking_url: null,
      cta_address: null,
    });
  });

  it("sólo guarda los botones que el MÓDULO ofrece", async () => {
    // Un evento ofrece boletos y cómo llegar; "comprar" no es suyo aunque venga.
    const stub = useGuardOk({ listing: { data: listingRow({ kind: "event" }), error: null } });

    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: {
        tickets: "https://boleteria.com/fiesta",
        purchase: "https://otracosa.com",
        phone: "+1 305 555 0134",
      },
    });

    expect(result).toEqual({ ok: true, saved: ["tickets"] });
    const patch = updatePatch(stub);
    expect(patch?.cta_tickets_url).toBe("https://boleteria.com/fiesta");
    expect(patch?.cta_purchase_url).toBeNull();
    expect(patch?.cta_phone).toBeNull();
  });

  it("no es tuyo → no se toca nada", async () => {
    const stub = useGuardOk({
      listing: { data: listingRow({ created_by: OTHER_ID }), error: null },
    });
    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { phone: "+1 305 555 0134" },
    });
    expect(result.ok).toBe(false);
    expect(updatePatch(stub)).toBeNull();
  });
});

describe("saveListingCtasAction — links que parecen links", () => {
  it.each([
    ["javascript:alert(1)", "javascript: — el que zod.url() deja pasar"],
    ["data:text/html,<script>alert(1)</script>", "data:"],
    ["vbscript:msgbox(1)", "vbscript:"],
    ["file:///etc/passwd", "file:"],
    ["pagina de donaciones", "texto suelto sin esquema"],
    ["/interna", "ruta interna: no es un sitio web"],
  ])("rechaza %s (%s)", async (value) => {
    const stub = useGuardOk();
    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { website: value },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("website");
    expect(updatePatch(stub)).toBeNull();
  });

  /**
   * `//evil.com` y `/\evil.com` son las dos formas con las que se coló una
   * navegación interna en la auditoría del 2026-07-27. Acá la garantía NO es
   * "se rechazan" —son dominios válidos y alguien puede querer poner uno— sino
   * que JAMÁS se guardan como si fueran del propio sitio: quedan resueltas a
   * una URL absoluta externa, que es lo que la UI abre en otra pestaña con
   * `rel="noopener noreferrer"` y con el aviso de que sale de la app.
   */
  it.each([
    ["//evil.com", "https://evil.com/"],
    ["/\\evil.com", "https://evil.com/"],
  ])("normaliza %s a una URL externa absoluta (%s)", async (value, expected) => {
    const stub = useGuardOk();
    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { website: value },
    });
    expect(result.ok).toBe(true);
    expect(updatePatch(stub)?.cta_website).toBe(expected);
  });

  it("acepta http(s) y guarda la URL normalizada", async () => {
    const stub = useGuardOk();
    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { website: "  https://Doña-Rosa.example/menu?x=1  " },
    });
    expect(result.ok).toBe(true);
    expect(String(updatePatch(stub)?.cta_website)).toContain("https://");
  });

  it("rechaza un teléfono con letras y una dirección de 3 caracteres", async () => {
    const phone = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { phone: "llamame" },
    });
    expect(phone.ok).toBe(false);

    useGuardOk();
    const address = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { directions: "NYC" },
    });
    expect(address.ok).toBe(false);
  });

  it("acepta el formato laxo que la base acepta (+1 (305) 555-0134)", async () => {
    const stub = useGuardOk();
    const result = await saveListingCtasAction({
      listingId: LISTING_ID,
      ctas: { phone: "+1 (305) 555-0134" },
    });
    expect(result.ok).toBe(true);
    expect(updatePatch(stub)?.cta_phone).toBe("+1 (305) 555-0134");
  });
});

/* ------------------------------ recordCtaClick ---------------------------- */

describe("recordCtaClickAction", () => {
  it("llama la RPC con el botón normalizado", async () => {
    const stub = useGuardOk();
    await recordCtaClickAction({ listingId: LISTING_ID, kind: "whatsapp" });
    expect(stub.rpc).toHaveBeenCalledWith("record_cta_click", {
      p_listing_id: LISTING_ID,
      p_cta_kind: "whatsapp",
    });
  });

  it("un botón desconocido no llega a la base", async () => {
    const stub = useGuardOk();
    await recordCtaClickAction({ listingId: LISTING_ID, kind: "email" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("nunca lanza: si la RPC falla, el contacto sigue funcionando", async () => {
    useGuardOk({ rpc: { data: null, error: { code: "P0001" } } });
    await expect(
      recordCtaClickAction({ listingId: LISTING_ID, kind: "phone" }),
    ).resolves.toBeUndefined();
  });

  it("sin sesión sale en silencio", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "…",
    });
    await expect(
      recordCtaClickAction({ listingId: LISTING_ID, kind: "chat" }),
    ).resolves.toBeUndefined();
  });
});

/* ------------------------------- saveCampaign ----------------------------- */

describe("saveCampaignAction", () => {
  function campaignInput(overrides: Record<string, unknown> = {}) {
    return {
      listingId: LISTING_ID,
      objective: "messages" as const,
      budgetUsd: 50,
      durationDays: 14,
      ...overrides,
    };
  }

  it("nace SIEMPRE como borrador, sin fechas ni checkout", async () => {
    const stub = useGuardOk();
    const result = await saveCampaignAction(campaignInput());

    expect(result).toEqual({ ok: true, campaignId: CAMPAIGN_ID, status: "draft" });
    const insert = stub.calls.find((c) => c.table === "campaigns" && c.method === "insert");
    const payload = insert?.args[0] as Record<string, unknown>;
    expect(payload.status).toBe("draft");
    expect(payload.budget_cents).toBe(5_000);
    expect(payload).not.toHaveProperty("starts_at");
    expect(payload).not.toHaveProperty("stripe_checkout_session_id");
  });

  it("recorta las listas a los topes de la 0048 y deduplica", async () => {
    const stub = useGuardOk();
    await saveCampaignAction(
      campaignInput({
        languages: "Español, español , Inglés, , Portugués",
        interests: Array.from({ length: 40 }, (_, i) => `tema${i}`).join(","),
      }),
    );
    const payload = stub.calls.find(
      (c) => c.table === "campaigns" && c.method === "insert",
    )?.args[0] as Record<string, unknown>;

    expect(payload.languages).toEqual(["Español", "Inglés", "Portugués"]);
    expect((payload.interests as string[]).length).toBe(30);
  });

  it("edad mínima mayor que la máxima se rechaza antes de tocar la base", async () => {
    const stub = useGuardOk();
    const result = await saveCampaignAction(campaignInput({ ageMin: 40, ageMax: 20 }));
    expect(result.ok).toBe(false);
    expect(stub.calls.some((c) => c.table === "campaigns")).toBe(false);
  });

  it("enviar a revisión hace la ÚNICA transición que el dueño puede", async () => {
    const stub = useGuardOk();
    const result = await saveCampaignAction(campaignInput({ submitForReview: true }));

    expect(result).toEqual({
      ok: true,
      campaignId: CAMPAIGN_ID,
      status: "pending_review",
    });
    const update = stub.calls.find((c) => c.table === "campaigns" && c.method === "update");
    expect(update?.args[0]).toEqual({ status: "pending_review" });
  });

  it("un aviso sin publicar no puede tener campaña", async () => {
    const stub = useGuardOk({
      listing: { data: listingRow({ status: "pending_review" }), error: null },
    });
    const result = await saveCampaignAction(campaignInput());
    expect(result.ok).toBe(false);
    expect(stub.calls.some((c) => c.table === "campaigns")).toBe(false);
  });

  it("reusa el borrador existente en vez de acumular campañas gemelas", async () => {
    const stub = useGuardOk({
      campaignExisting: { data: { id: CAMPAIGN_ID, status: "rejected" }, error: null },
    });
    const result = await saveCampaignAction(campaignInput());

    expect(result.ok).toBe(true);
    expect(stub.calls.some((c) => c.table === "campaigns" && c.method === "insert")).toBe(
      false,
    );
    const update = stub.calls.find((c) => c.table === "campaigns" && c.method === "update");
    // Un rechazo vuelve a borrador: es la transición que desbloquea editar la plata.
    expect((update?.args[0] as Record<string, unknown>).status).toBe("draft");
  });
});
