import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({ createNotification: vi.fn() }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));

import { activarImpulsoDePerfil, idDeImpulsoDePerfil } from "./webhook-handlers";

type Fila = Record<string, unknown>;

const PENDIENTE = {
  id: "cpb-1",
  tenant_id: "tenant-1",
  creator_id: "creator-1",
  duration_days: 7,
  status: "pending_payment",
  amount_cents: 1000,
  currency: "usd",
  stripe_checkout_session_id: "cs_1",
};

function session(over: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id: "cs_1",
    amount_total: 1000,
    currency: "usd",
    payment_status: "paid",
    metadata: { creator_profile_boost_id: "cpb-1" },
    ...over,
  } as Stripe.Checkout.Session;
}

function admin(fila: Fila | null, activadas: Fila[] = [{ id: "cpb-1" }]) {
  const updates: Fila[] = [];
  const audits: Fila[] = [];
  const client = {
    from(table: string) {
      if (table === "audit_log") {
        return {
          insert: async (values: Fila) => {
            audits.push(values);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: fila, error: null }) }),
        }),
        update: (values: Fila) => {
          updates.push(values);
          const chain = {
            eq: () => chain,
            select: async () => ({ data: activadas, error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { client: client as never, updates, audits };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("idDeImpulsoDePerfil", () => {
  it("lee la clave de metadata que escribe la action", () => {
    expect(idDeImpulsoDePerfil(session())).toBe("cpb-1");
    expect(idDeImpulsoDePerfil(session({ metadata: {} }))).toBeNull();
  });
});

describe("activarImpulsoDePerfil", () => {
  it("activa por la duración pagada, avisa y audita", async () => {
    const a = admin(PENDIENTE);
    await activarImpulsoDePerfil(a.client, "cpb-1", session());

    expect(a.updates).toHaveLength(1);
    const { status, starts_at, ends_at } = a.updates[0] as {
      status: string;
      starts_at: string;
      ends_at: string;
    };
    expect(status).toBe("active");
    expect(Date.parse(ends_at) - Date.parse(starts_at)).toBe(7 * 86_400_000);
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
    expect(mocks.createNotification.mock.calls[0][1]).toMatchObject({
      profileId: "creator-1",
      category: "publicidad",
      ignorePrefs: true,
    });
    expect(a.audits[0]).toMatchObject({ action: "creator_profile_boost_activated" });
  });

  it("si no existe, no hace nada", async () => {
    const a = admin(null);
    await activarImpulsoDePerfil(a.client, "cpb-1", session());
    expect(a.updates).toHaveLength(0);
  });

  it("un reintento sobre uno ya activo no lo vuelve a tocar", async () => {
    const a = admin({ ...PENDIENTE, status: "active" });
    await activarImpulsoDePerfil(a.client, "cpb-1", session());
    expect(a.updates).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("un cancelado no se reactiva aunque llegue el pago", async () => {
    const a = admin({ ...PENDIENTE, status: "canceled" });
    await activarImpulsoDePerfil(a.client, "cpb-1", session());
    expect(a.updates).toHaveLength(0);
  });

  it("una sesión distinta a la vinculada no activa", async () => {
    const a = admin(PENDIENTE);
    await activarImpulsoDePerfil(a.client, "cpb-1", session({ id: "cs_otra" }));
    expect(a.updates).toHaveLength(0);
  });

  it("un monto distinto al pactado no activa", async () => {
    const a = admin(PENDIENTE);
    await activarImpulsoDePerfil(a.client, "cpb-1", session({ amount_total: 500 }));
    expect(a.updates).toHaveLength(0);
  });

  it("la misma cifra en otra moneda no activa", async () => {
    const a = admin(PENDIENTE);
    await activarImpulsoDePerfil(a.client, "cpb-1", session({ currency: "dop" }));
    expect(a.updates).toHaveLength(0);
  });

  it("si otra entrega lo activó primero, no duplica aviso ni auditoría", async () => {
    const a = admin(PENDIENTE, []);
    await activarImpulsoDePerfil(a.client, "cpb-1", session());
    expect(a.updates).toHaveLength(1);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(a.audits).toHaveLength(0);
  });
});
