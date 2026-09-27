import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/lib/creators/fake-db.test-helper";

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  createAdminClient: vi.fn(),
  stripeConfigured: { value: false },
  headers: vi.fn(),
  crearCheckoutSessionIdempotente: vi.fn(),
  stripe: {
    checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } },
    refunds: { create: vi.fn() },
  },
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/config/services", () => ({
  get isStripeConfigured() {
    return mocks.stripeConfigured.value;
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: () => mocks.stripe }));
vi.mock("@/lib/stripe/checkout", () => ({ crearCheckoutSessionIdempotente: mocks.crearCheckoutSessionIdempotente }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/rate-limit", () => ({
  HOUR_MS: 3_600_000,
  limit: () => ({ ok: true }),
  clientIpFromHeaders: (h: Headers) => h.get("x-real-ip") ?? "0.0.0.0",
}));

import {
  acceptProposal,
  cancelContract,
  deliveryFileUrl,
  editProposal,
  prepareDeliveryUpload,
  requestRevision,
  signContract,
  startPayment,
  submitDelivery,
} from "./actions";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTRACT_ID = "0199aaaa-0000-7000-8000-000000000001";
const HASH = "a".repeat(64);
const PNG = `data:image/png;base64,${"A".repeat(500)}`;

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    tenant_id: TENANT,
    code: "CL-CM-2026-000012",
    gig_id: null,
    client_id: CLIENT,
    creator_id: CREATOR,
    title: "4 videos promocionales",
    scope: "4 videos verticales de 30 segundos.",
    delivery_days: 10,
    amount_cents: 100_000,
    currency: "usd",
    fee_pct: 20,
    platform_fee_cents: 20_000,
    creator_net_cents: 80_000,
    status: "proposed",
    payment_mode: "stripe",
    revisions_included: 1,
    usage_rights: "Redes sociales · 90 días",
    proposal_message: null,
    terms_version: 1,
    terms_hash: null,
    contract_text: null,
    template_version: null,
    signed_at: null,
    review_deadline_at: null,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    stripe_transfer_id: null,
    stripe_refund_id: null,
    approved_at: null,
    released_at: null,
    payout_error: null,
    ...overrides,
  };
}

let fake: FakeDb;
let storage: {
  createSignedUploadUrl: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  createSignedUrl: ReturnType<typeof vi.fn>;
};

function setup(row: Record<string, unknown>, userId: string, extra: Record<string, Record<string, unknown>[]> = {}) {
  fake = createFakeDb({
    gig_contracts: [row],
    profiles: [
      { id: CLIENT, display_name: "Panadería La Espiga" },
      { id: CREATOR, display_name: "Ana Rivas" },
    ],
    ...extra,
  });
  storage = {
    createSignedUploadUrl: vi.fn(async (path: string) => ({ data: { path, token: `tok-${path.length}` }, error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://signed" }, error: null })),
  };
  const client = fake.client as Record<string, unknown>;
  const admin = { ...client, storage: { from: () => storage } };
  mocks.createAdminClient.mockReturnValue(admin);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT, name: "Comunidad Latina" },
    user: { id: userId, email: `${userId}@example.com` },
    supabase: client,
  });
}

function row() {
  return fake.tables.gig_contracts[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stripeConfigured.value = false;
  delete process.env.VERCEL_ENV;
  mocks.headers.mockResolvedValue(new Headers({ "x-real-ip": "203.0.113.7", "user-agent": "Test/1.0" }));
});

describe("aislamiento", () => {
  it("un contrato de otra comunidad no se opera aunque el usuario sea parte", async () => {
    setup(contract({ tenant_id: OTHER_TENANT }), CREATOR);
    const result = await acceptProposal(CONTRACT_ID);
    expect(result.ok).toBe(false);
    expect(row().status).toBe("proposed");
  });

  it("un tercero no opera un contrato ajeno", async () => {
    setup(contract(), "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect((await acceptProposal(CONTRACT_ID)).ok).toBe(false);
  });
});

describe("acceptProposal", () => {
  it("genera el contrato: congela el texto y su huella sha256", async () => {
    setup(contract(), CREATOR);
    const result = await acceptProposal(CONTRACT_ID);
    expect(result).toEqual({ ok: true });
    expect(row().status).toBe("accepted");
    const text = String(row().contract_text);
    expect(text).toContain("CL-CM-2026-000012");
    expect(text).toContain("Ana Rivas");
    expect(row().terms_hash).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    expect(fake.tables.gig_contract_events.map((e) => e.kind)).toEqual(["accepted"]);
  });

  it("el negocio no acepta su propia propuesta", async () => {
    setup(contract(), CLIENT);
    expect((await acceptProposal(CONTRACT_ID)).ok).toBe(false);
  });
});

describe("editProposal", () => {
  const edit = {
    title: "5 videos promocionales",
    scope: "5 videos verticales de 30 segundos.",
    deliveryDays: 12,
    amountCents: 120_000,
    revisionsIncluded: 2,
    usageRights: "Redes sociales · 1 año",
    proposalMessage: "Sumamos uno más",
  };

  it("el negocio edita en propuesta y sube la versión de las condiciones", async () => {
    setup(contract(), CLIENT);
    expect(await editProposal(CONTRACT_ID, edit)).toEqual({ ok: true });
    expect(row()).toMatchObject({ amount_cents: 120_000, revisions_included: 2, terms_version: 2, terms_hash: null });
  });

  it("revisiones fuera de rango no pasan", async () => {
    setup(contract(), CLIENT);
    expect((await editProposal(CONTRACT_ID, { ...edit, revisionsIncluded: 9 })).ok).toBe(false);
  });

  it("el creador no edita las condiciones", async () => {
    setup(contract(), CREATOR);
    expect((await editProposal(CONTRACT_ID, edit)).ok).toBe(false);
  });
});

describe("signContract", () => {
  it("firma con el usuario de la sesión, la IP y el navegador del request", async () => {
    setup(contract({ status: "accepted", terms_hash: HASH }), CLIENT);
    fake.rpcResult("firmar_contrato_de_colaboracion", { data: { ok: true, both: false, already: false }, error: null });

    const result = await signContract(CONTRACT_ID, {
      legalName: "Juan Pérez",
      signaturePng: PNG,
      accepted: true,
      termsHash: HASH,
    });

    expect(result).toEqual({ ok: true, bothSigned: false });
    expect(fake.rpcCalls[0]).toEqual({
      fn: "firmar_contrato_de_colaboracion",
      args: {
        p_contract_id: CONTRACT_ID,
        p_signer_id: CLIENT,
        p_legal_name: "Juan Pérez",
        p_signature_png: PNG,
        p_terms_hash: HASH,
        p_ip: "203.0.113.7",
        p_user_agent: "Test/1.0",
      },
    });
  });

  it("sin la casilla tildada no llama a la base", async () => {
    setup(contract({ status: "accepted", terms_hash: HASH }), CLIENT);
    const result = await signContract(CONTRACT_ID, { legalName: "Juan Pérez", signaturePng: PNG, accepted: false, termsHash: HASH });
    expect(result.ok).toBe(false);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("si el texto cambió, avisa que hay que revisar la versión nueva", async () => {
    setup(contract({ status: "accepted", terms_hash: HASH }), CLIENT);
    fake.rpcResult("firmar_contrato_de_colaboracion", { data: { ok: false, reason: "stale_terms" }, error: null });
    const result = await signContract(CONTRACT_ID, { legalName: "Juan Pérez", signaturePng: PNG, accepted: true, termsHash: HASH });
    expect(result).toMatchObject({ ok: false, stale: true });
  });
});

describe("startPayment", () => {
  it("sin Stripe y fuera de producción, el pago es de demostración", async () => {
    setup(contract({ status: "signed" }), CLIENT);
    const result = await startPayment(CONTRACT_ID);
    expect(result).toEqual({ ok: true, url: null, demo: true });
    expect(row()).toMatchObject({ status: "funded", payment_mode: "demo" });
  });

  it("sin Stripe en producción no se regala un 'pagado'", async () => {
    process.env.VERCEL_ENV = "production";
    setup(contract({ status: "signed" }), CLIENT);
    const result = await startPayment(CONTRACT_ID);
    expect(result.ok).toBe(false);
    expect(row().status).toBe("signed");
  });

  it("con Stripe abre el checkout del monto del contrato", async () => {
    mocks.stripeConfigured.value = true;
    mocks.crearCheckoutSessionIdempotente.mockResolvedValue({ id: "cs_1", url: "https://checkout/cs_1" });
    setup(contract({ status: "signed" }), CLIENT);
    const result = await startPayment(CONTRACT_ID);
    expect(result).toEqual({ ok: true, url: "https://checkout/cs_1", demo: false });
    expect(row().stripe_checkout_session_id).toBe("cs_1");
  });

  it("sin las dos firmas no se paga", async () => {
    setup(contract({ status: "accepted" }), CLIENT);
    expect((await startPayment(CONTRACT_ID)).ok).toBe(false);
  });

  it("el creador no paga", async () => {
    setup(contract({ status: "signed" }), CREATOR);
    expect((await startPayment(CONTRACT_ID)).ok).toBe(false);
  });
});

describe("entrega", () => {
  it("sólo el creador pide URLs de subida, y las rutas quedan dentro del contrato", async () => {
    setup(contract({ status: "funded" }), CREATOR);
    const result = await prepareDeliveryUpload(CONTRACT_ID, [{ name: "Video 1.mp4", size: 1000, type: "video/mp4" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe(1);
      expect(result.uploads[0].path.startsWith(`${TENANT}/${CONTRACT_ID}/v1/`)).toBe(true);
    }
  });

  it("rechaza tipos de archivo no permitidos", async () => {
    setup(contract({ status: "funded" }), CREATOR);
    const result = await prepareDeliveryUpload(CONTRACT_ID, [{ name: "x.html", size: 10, type: "text/html" }]);
    expect(result.ok).toBe(false);
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("el negocio no sube entregas", async () => {
    setup(contract({ status: "funded" }), CLIENT);
    expect((await prepareDeliveryUpload(CONTRACT_ID, [{ name: "a.mp4", size: 1, type: "video/mp4" }])).ok).toBe(false);
  });

  it("no acepta rutas de otro contrato", async () => {
    setup(contract({ status: "funded" }), CREATOR);
    const result = await submitDelivery(CONTRACT_ID, {
      version: 1,
      paths: [`${TENANT}/otro-contrato/v1/x.mp4`],
      note: "",
    });
    expect(result.ok).toBe(false);
    expect(row().status).toBe("funded");
  });

  it("no acepta archivos que no se subieron", async () => {
    setup(contract({ status: "funded" }), CREATOR);
    const result = await submitDelivery(CONTRACT_ID, {
      version: 1,
      paths: [`${TENANT}/${CONTRACT_ID}/v1/fantasma.mp4`],
      note: "",
    });
    expect(result.ok).toBe(false);
  });

  it("con los archivos subidos, entrega y abre la ventana de 72 horas", async () => {
    setup(contract({ status: "funded" }), CREATOR);
    storage.list.mockResolvedValue({ data: [{ name: "u-video.mp4" }], error: null });
    const before = Date.now();
    const result = await submitDelivery(CONTRACT_ID, {
      version: 1,
      paths: [`${TENANT}/${CONTRACT_ID}/v1/u-video.mp4`],
      note: "Acá van los 4 videos.",
    });
    expect(result).toEqual({ ok: true });
    expect(row().status).toBe("delivered");
    const deadline = new Date(String(row().review_deadline_at)).getTime();
    expect(deadline - before).toBeGreaterThanOrEqual(72 * 3_600_000 - 1000);
    expect(fake.tables.job_deliverables[0]).toMatchObject({ version: 1, submitted_by: CREATOR });
  });
});

describe("requestRevision", () => {
  it("con revisiones disponibles, vuelve el trabajo al creador y pausa el reloj", async () => {
    setup(contract({ status: "delivered", review_deadline_at: "2026-10-01T00:00:00.000Z" }), CLIENT);
    const result = await requestRevision(CONTRACT_ID, "Cambiá la música del segundo video, por favor.");
    expect(result).toEqual({ ok: true });
    expect(row()).toMatchObject({ status: "changes_requested", review_deadline_at: null });
    expect(fake.tables.job_revisions).toHaveLength(1);
  });

  it("sin revisiones disponibles no deja pedir otra", async () => {
    setup(contract({ status: "delivered", revisions_included: 1 }), CLIENT, {
      job_revisions: [{ id: "r1", contract_id: CONTRACT_ID }],
    });
    const result = await requestRevision(CONTRACT_ID, "Otra vuelta de cambios, por favor.");
    expect(result.ok).toBe(false);
    expect(row().status).toBe("delivered");
  });
});

describe("cancelContract", () => {
  it("cancelar un contrato pagado devuelve la plata", async () => {
    mocks.stripeConfigured.value = true;
    mocks.stripe.refunds.create.mockResolvedValue({ id: "re_1" });
    setup(contract({ status: "funded", stripe_payment_intent_id: "pi_1" }), CLIENT);
    const result = await cancelContract(CONTRACT_ID);
    expect(result).toEqual({ ok: true, refundPending: false });
    expect(row()).toMatchObject({ status: "canceled", stripe_refund_id: "re_1" });
  });

  it("si el reembolso falla, cancela igual y avisa que está pendiente", async () => {
    mocks.stripeConfigured.value = true;
    mocks.stripe.refunds.create.mockRejectedValue(new Error("timeout"));
    setup(contract({ status: "funded", stripe_payment_intent_id: "pi_1" }), CLIENT);
    const result = await cancelContract(CONTRACT_ID);
    expect(result).toEqual({ ok: true, refundPending: true });
    expect(row().status).toBe("canceled");
  });

  it("entregado ya no se cancela", async () => {
    setup(contract({ status: "delivered" }), CLIENT);
    expect((await cancelContract(CONTRACT_ID)).ok).toBe(false);
  });
});

describe("deliveryFileUrl", () => {
  it("sólo firma archivos que están en una entrega de ese contrato", async () => {
    const path = `${TENANT}/${CONTRACT_ID}/v1/u-video.mp4`;
    setup(contract({ status: "delivered" }), CLIENT, {
      job_deliverables: [{ contract_id: CONTRACT_ID, tenant_id: TENANT, files: [path] }],
    });
    expect(await deliveryFileUrl(CONTRACT_ID, path)).toEqual({ ok: true, url: "https://signed" });
    expect((await deliveryFileUrl(CONTRACT_ID, `${TENANT}/${CONTRACT_ID}/v1/otro.mp4`)).ok).toBe(false);
    expect((await deliveryFileUrl(CONTRACT_ID, `${OTHER_TENANT}/x/v1/a.mp4`)).ok).toBe(false);
  });
});
