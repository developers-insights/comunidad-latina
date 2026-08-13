import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

/**
 * =============================================================================
 * CHECK AZUL — que un evento repetido no cobre ni regale dos veces
 * =============================================================================
 *
 * Stripe reintenta. No es una hipótesis: reintenta ante cualquier respuesta que
 * no sea 2xx, y durante tres días. Además el mismo hecho llega por más de un
 * camino (`checkout.session.completed` y `async_payment_succeeded`, el webhook y
 * el cron de red). Así que "el evento llega una sola vez" no es un supuesto que
 * este módulo pueda hacer, y estos tests son lo que lo demuestra.
 *
 * Lo que se prueba acá:
 *   · IDEMPOTENCIA del alta (upsert sobre profile_id: una fila, no dos).
 *   · IDEMPOTENCIA del regalo (el 23505 del UNIQUE se trata como éxito, no como
 *     error, y no dispara una segunda notificación).
 *   · AUTORIZACIÓN: nadie enciende la insignia de otro, de otra comunidad, sin
 *     identidad verificada, ni pagando de menos.
 *   · BAJA: dejar de pagar apaga el check, sin estados zombis.
 *   · ORDEN EN EL ROUTE: este handler no se traga eventos ajenos.
 */

const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
}));

vi.mock("@/lib/notifications/notify", () => ({
  createNotification: mocks.createNotification,
}));

import { periodFromInvoice } from "@/lib/stripe/subscription";
import { handleVerificacionEvent, isVerificacionEvent } from "./webhook-handlers";

const TENANT = "019fa477-58e6-7ab9-ae4f-cc41716f0001";
const PROFILE = "019fa477-58e6-7ab9-ae4f-cc41716f0002";
const OTRO_TENANT = "019fa477-58e6-7ab9-ae4f-cc41716f0009";
const SUB_ID = "sub_azul_1";

/* -------------------------------------------------------------------------- */
/* Dobles                                                                     */
/* -------------------------------------------------------------------------- */

interface Captura {
  upserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  grants: Record<string, unknown>[];
  auditoria: Record<string, unknown>[];
}

/**
 * Admin client mínimo con la forma que usan los handlers.
 *
 * `eq()` devuelve un objeto que es a la vez encadenable y `await`-eable: los
 * handlers usan `.update().eq()` (se espera ahí) y `.select().eq().maybeSingle()`
 * (se sigue encadenando). Un doble que sólo soporte una de las dos formas
 * pasaría los tests sin ejercitar el código real.
 */
function fakeAdmin(opts: {
  captura: Captura;
  profile?: { id: string; tenant_id: string; identity_verified: boolean } | null;
  suscripcion?: Record<string, unknown> | null;
  /** Código de error que devuelve el insert del crédito (23505 = ya existía). */
  grantInsertError?: string | null;
}) {
  const { captura } = opts;

  function tabla(nombre: string) {
    const builder: Record<string, unknown> = {};
    const datos = () => {
      if (nombre === "profiles") return opts.profile ?? null;
      if (nombre === "verification_subscriptions") return opts.suscripcion ?? null;
      return null;
    };

    const chain = {
      select: () => chain,
      eq: () => chain,
      lt: () => chain,
      maybeSingle: async () => ({ data: datos(), error: null }),
      single: async () => ({ data: datos(), error: null }),
      // Await directo sobre la cadena (`await …update().eq()`).
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: datos(), error: null }),
      update: (values: Record<string, unknown>) => {
        captura.updates.push({ tabla: nombre, ...values });
        return chain;
      },
      upsert: async (values: Record<string, unknown>) => {
        captura.upserts.push({ tabla: nombre, ...values });
        return { error: null };
      },
      insert: async (values: Record<string, unknown>) => {
        if (nombre === "verification_boost_grants") {
          if (opts.grantInsertError) {
            return { error: { code: opts.grantInsertError } };
          }
          captura.grants.push(values);
          return { error: null };
        }
        captura.auditoria.push(values);
        return { error: null };
      },
    };
    Object.assign(builder, chain);
    return chain;
  }

  return { from: (nombre: string) => tabla(nombre) } as never;
}

const METADATA_OK = {
  tenant_id: TENANT,
  profile_id: PROFILE,
  subject_type: "negocio",
  kind: "verificacion",
  price_cents: "999",
  price_currency: "USD",
};

function checkoutEvent(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_azul_1",
        payment_status: "paid",
        amount_total: 999,
        currency: "usd",
        customer: "cus_1",
        subscription: SUB_ID,
        metadata: METADATA_OK,
        ...over,
      },
    },
  } as unknown as Stripe.Event;
}

/** Factura con UNA línea de suscripción, que es de donde sale el período. */
function invoiceEvent(start: number, end: number, extras: unknown[] = []): Stripe.Event {
  return {
    id: "evt_inv",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_1",
        amount_paid: 999,
        currency: "usd",
        parent: {
          subscription_details: { subscription: SUB_ID, metadata: METADATA_OK },
        },
        lines: {
          data: [
            { period: { start, end }, parent: { subscription_item_details: { proration: false } } },
            ...extras,
          ],
        },
      },
    },
  } as unknown as Stripe.Event;
}

const PERFIL_OK = { id: PROFILE, tenant_id: TENANT, identity_verified: true };
const SUB_ROW = { id: "row-1", tenant_id: TENANT, profile_id: PROFILE, status: "active" };

function nuevaCaptura(): Captura {
  return { upserts: [], updates: [], grants: [], auditoria: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */

describe("el handler no se traga eventos que no son suyos", () => {
  /**
   * Importa MÁS que de costumbre: este handler corre ANTES que
   * `handleInvoicePaidEvent` en el route (si corriera después nunca vería un
   * `invoice.paid`). Si además devolviera `true` de más, dejaría a los otros
   * productos sin procesar sus propias facturas.
   */
  it("devuelve false ante una suscripción de otro producto", async () => {
    const captura = nuevaCaptura();
    const evento = {
      id: "evt_x",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_tienda", metadata: { kind: "store_membership" } } },
    } as unknown as Stripe.Event;

    const manejado = await handleVerificacionEvent(fakeAdmin({ captura }), evento);
    expect(manejado).toBe(false);
    expect(captura.updates).toHaveLength(0);
  });

  it("devuelve false ante una factura de otro producto", async () => {
    const captura = nuevaCaptura();
    const evento = {
      id: "evt_y",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_x",
          parent: { subscription_details: { subscription: "sub_z", metadata: { kind: "listing_premium" } } },
          lines: { data: [] },
        },
      },
    } as unknown as Stripe.Event;

    expect(await handleVerificacionEvent(fakeAdmin({ captura }), evento)).toBe(false);
    expect(captura.grants).toHaveLength(0);
  });

  it("reconoce los suyos por metadata.kind", () => {
    expect(isVerificacionEvent({ kind: "verificacion" })).toBe(true);
    expect(isVerificacionEvent({ kind: "store_membership" })).toBe(false);
    expect(isVerificacionEvent(null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("alta: sólo se enciende con plata verificada y con derecho", () => {
  it("el camino feliz escribe UNA fila activa con lo pactado", async () => {
    const captura = nuevaCaptura();
    await handleVerificacionEvent(
      fakeAdmin({ captura, profile: PERFIL_OK }),
      checkoutEvent(),
    );

    expect(captura.upserts).toHaveLength(1);
    expect(captura.upserts[0]).toMatchObject({
      tabla: "verification_subscriptions",
      profile_id: PROFILE,
      tenant_id: TENANT,
      subject_type: "negocio",
      status: "active",
      price_cents: 999,
      currency: "USD",
      stripe_subscription_id: SUB_ID,
    });
  });

  it("un evento REPETIDO no crea una segunda suscripción: upsert por profile_id", async () => {
    const captura = nuevaCaptura();
    const admin = fakeAdmin({ captura, profile: PERFIL_OK });

    await handleVerificacionEvent(admin, checkoutEvent());
    await handleVerificacionEvent(admin, checkoutEvent());

    // Dos upserts idénticos sobre la MISMA clave. La base los colapsa en una
    // fila (unique profile_id) — lo que se prueba acá es que el handler no
    // cambia de estrategia en el reintento: mismos valores, misma clave.
    expect(captura.upserts).toHaveLength(2);
    expect(captura.upserts[0]).toEqual(captura.upserts[1]);
  });

  it("SIN identidad verificada NO se concede — la insignia no puede ser mentira", async () => {
    const captura = nuevaCaptura();
    await handleVerificacionEvent(
      fakeAdmin({ captura, profile: { ...PERFIL_OK, identity_verified: false } }),
      checkoutEvent(),
    );

    expect(captura.upserts).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("un perfil de OTRA comunidad NO se concede", async () => {
    const captura = nuevaCaptura();
    await handleVerificacionEvent(
      fakeAdmin({ captura, profile: { ...PERFIL_OK, tenant_id: OTRO_TENANT } }),
      checkoutEvent(),
    );
    expect(captura.upserts).toHaveLength(0);
  });

  it("pagar de MENOS que lo pactado NO se concede", async () => {
    const captura = nuevaCaptura();
    await handleVerificacionEvent(
      fakeAdmin({ captura, profile: PERFIL_OK }),
      checkoutEvent({ amount_total: 1 }),
    );
    expect(captura.upserts).toHaveLength(0);
  });

  it("pagar en OTRA MONEDA el mismo número NO se concede", async () => {
    const captura = nuevaCaptura();
    await handleVerificacionEvent(
      fakeAdmin({ captura, profile: PERFIL_OK }),
      checkoutEvent({ currency: "ars" }),
    );
    expect(captura.upserts).toHaveLength(0);
  });

  it("sin plata adentro (pago diferido) espera, no concede", async () => {
    const captura = nuevaCaptura();
    const manejado = await handleVerificacionEvent(
      fakeAdmin({ captura, profile: PERFIL_OK }),
      checkoutEvent({ payment_status: "unpaid" }),
    );

    // Lo maneja (es suyo) pero no concede: espera al async_payment_succeeded.
    expect(manejado).toBe(true);
    expect(captura.upserts).toHaveLength(0);
  });

  it("un subject_type inventado NO se concede: no hay escalón fuera del enum", async () => {
    const captura = nuevaCaptura();
    await handleVerificacionEvent(
      fakeAdmin({ captura, profile: PERFIL_OK }),
      checkoutEvent({
        metadata: { ...METADATA_OK, subject_type: "gratis" } as Stripe.Metadata,
      }),
    );
    expect(captura.upserts).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("el regalo mensual: un período, un impulso", () => {
  it("la primera factura del período otorga el crédito y avisa", async () => {
    const captura = nuevaCaptura();
    const inicio = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);
    const fin = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);

    await handleVerificacionEvent(
      fakeAdmin({ captura, suscripcion: SUB_ROW }),
      invoiceEvent(inicio, fin),
    );

    expect(captura.grants).toHaveLength(1);
    expect(captura.grants[0]).toMatchObject({
      subscription_id: "row-1",
      profile_id: PROFILE,
      tenant_id: TENANT,
      period_start: "2026-09-01T00:00:00.000Z",
      expires_at: "2026-10-01T00:00:00.000Z",
      duration_days: 7,
    });
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  /**
   * ⭐ EL TEST QUE JUSTIFICA TODO EL DISEÑO.
   *
   * El UNIQUE (subscription_id, period_start) rechaza el segundo insert con
   * 23505. Este test comprueba que el handler lo trata como ÉXITO —no lanza, no
   * devuelve 500, no notifica de nuevo—, que es lo que evita que un reintento
   * de Stripe se convierta en un segundo impulso gratis.
   */
  it("la MISMA factura repetida no otorga un segundo crédito ni vuelve a avisar", async () => {
    const captura = nuevaCaptura();
    const inicio = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);
    const fin = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);

    // 1ª vez: entra.
    await handleVerificacionEvent(
      fakeAdmin({ captura, suscripcion: SUB_ROW }),
      invoiceEvent(inicio, fin),
    );
    // 2ª vez: la base responde 23505, como haría el UNIQUE.
    await expect(
      handleVerificacionEvent(
        fakeAdmin({ captura, suscripcion: SUB_ROW, grantInsertError: "23505" }),
        invoiceEvent(inicio, fin),
      ),
    ).resolves.toBe(true);

    expect(captura.grants).toHaveLength(1);
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("un error REAL de la base sí lanza, para que Stripe reintente", async () => {
    const captura = nuevaCaptura();
    await expect(
      handleVerificacionEvent(
        fakeAdmin({ captura, suscripcion: SUB_ROW, grantInsertError: "08006" }),
        invoiceEvent(1_756_684_800, 1_759_276_800),
      ),
    ).rejects.toThrow(/verification_boost_grants/);
  });

  it("el mes SIGUIENTE sí otorga otro crédito: la clave es el período", async () => {
    const captura = nuevaCaptura();
    const sep = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);
    const oct = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);
    const nov = Math.floor(Date.parse("2026-11-01T00:00:00Z") / 1000);

    const admin = fakeAdmin({ captura, suscripcion: SUB_ROW });
    await handleVerificacionEvent(admin, invoiceEvent(sep, oct));
    await handleVerificacionEvent(admin, invoiceEvent(oct, nov));

    expect(captura.grants.map((g) => g.period_start)).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  it("sin período legible NO inventa una fecha: deja el crédito al cron de red", async () => {
    const captura = nuevaCaptura();
    const evento = {
      id: "evt_inv",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_2",
          parent: { subscription_details: { subscription: SUB_ID, metadata: METADATA_OK } },
          lines: { data: [] },
        },
      },
    } as unknown as Stripe.Event;

    expect(
      await handleVerificacionEvent(fakeAdmin({ captura, suscripcion: SUB_ROW }), evento),
    ).toBe(true);
    expect(captura.grants).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("periodFromInvoice: de dónde sale la clave de idempotencia", () => {
  /**
   * Si esta función devolviera la misma fecha dos meses seguidos, el segundo mes
   * pago chocaría contra el UNIQUE del primero y se quedaría sin regalo. Por eso
   * NO se leen `invoice.period_start/period_end`, que describen cuándo se
   * crearon los ítems y no el servicio facturado.
   */
  it("ignora las líneas de prorrata, que empiezan cuando se calcularon", () => {
    const inicio = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);
    const fin = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);
    const mitadDeMes = Math.floor(Date.parse("2026-09-15T00:00:00Z") / 1000);

    const invoice = {
      // Los de la RAÍZ están puestos MAL a propósito: si la función los mirara,
      // este test lo delataría.
      period_start: 0,
      period_end: 0,
      lines: {
        data: [
          {
            period: { start: mitadDeMes, end: fin },
            parent: { subscription_item_details: { proration: true } },
          },
          {
            period: { start: inicio, end: fin },
            parent: { subscription_item_details: { proration: false } },
          },
        ],
      },
    } as unknown as Stripe.Invoice;

    expect(periodFromInvoice(invoice)).toEqual({
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-10-01T00:00:00.000Z",
    });
  });

  it("sin líneas utilizables devuelve null en vez de adivinar", () => {
    expect(periodFromInvoice({ lines: { data: [] } } as unknown as Stripe.Invoice)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("baja y morosidad: sin estados zombis", () => {
  it("cancelar apaga la insignia y deja fecha de baja", async () => {
    const captura = nuevaCaptura();
    const evento = {
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: { object: { id: SUB_ID, status: "canceled", metadata: METADATA_OK, items: { data: [] } } },
    } as unknown as Stripe.Event;

    await handleVerificacionEvent(fakeAdmin({ captura, suscripcion: SUB_ROW }), evento);

    expect(captura.updates[0]).toMatchObject({
      tabla: "verification_subscriptions",
      status: "canceled",
    });
    expect(captura.updates[0].canceled_at).toBeTruthy();
  });

  it("un impago pasa a past_due — que NO pinta la insignia (llevaCheckAzul)", async () => {
    const captura = nuevaCaptura();
    const evento = {
      id: "evt_upd",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: SUB_ID,
          status: "past_due",
          metadata: METADATA_OK,
          items: { data: [{ current_period_start: 1_756_684_800, current_period_end: 1_759_276_800 }] },
        },
      },
    } as unknown as Stripe.Event;

    await handleVerificacionEvent(fakeAdmin({ captura, suscripcion: SUB_ROW }), evento);
    expect(captura.updates[0]).toMatchObject({ status: "past_due" });
  });

  it("una sincronización NO puede ascender el escalón por metadata", async () => {
    const captura = nuevaCaptura();
    const evento = {
      id: "evt_upd2",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: SUB_ID,
          status: "active",
          // Metadata editada en el Dashboard para pasar de 6.99 a 19.99.
          metadata: { ...METADATA_OK, subject_type: "profesional" },
          items: { data: [{ current_period_start: 1_756_684_800, current_period_end: 1_759_276_800 }] },
        },
      },
    } as unknown as Stripe.Event;

    await handleVerificacionEvent(fakeAdmin({ captura, suscripcion: SUB_ROW }), evento);

    // Mueve ESTADO, nunca NIVEL: el escalón sólo lo concede un Checkout cobrado.
    expect(captura.updates[0]).not.toHaveProperty("subject_type");
    expect(captura.updates[0]).not.toHaveProperty("price_cents");
  });
});
