import { describe, expect, it, vi } from "vitest";

import { concederUnaSolaVez } from "./concesion";

/**
 * =============================================================================
 * UNA CONCESIÓN POR PAGO — el gate que faltaba en los tres productos por
 * suscripción
 * =============================================================================
 *
 * `activateBoost` y `activatePostPromotion` ya gateaban la transición en el
 * `WHERE` del UPDATE (`.eq("status","pending_payment")`), así que dos entregas
 * del mismo pago no duplicaban nada. Los TRES productos por suscripción —premium
 * de aviso, membresía de tienda y check azul— hacían en cambio un `upsert` a
 * ciegas y seguían de largo hasta la notificación y la auditoría: la segunda
 * entrega mandaba un segundo "ya está activo" y escribía una segunda fila de
 * `audit_log`, y una entrega demorada del alta podía resucitar a `active` una
 * suscripción que ya se había cancelado.
 *
 * Este módulo mueve ese gate al `WHERE`, igual que el boost. Los tests de acá
 * son sobre la MECÁNICA (qué se manda a la base y cómo se lee lo que vuelve);
 * el efecto de punta a punta por producto se prueba en los suites del webhook.
 */

type Resultado = { data?: unknown; error?: unknown };

interface Programa {
  /** Lo que devuelve el UPDATE del paso 1. */
  update?: Resultado;
  /** Lo que devuelve el INSERT del paso 2. */
  insert?: Resultado;
  /** Lo que devuelve la relectura desambiguadora del paso 3. */
  select?: Resultado;
}

interface Llamada {
  metodo: string;
  args: unknown[];
}

/**
 * Cliente falso encadenable. La operación RAÍZ se fija en la primera llamada
 * (`update().eq().or().select()` resuelve como `update`), igual que el stub de
 * `premium.test.ts` — sin eso, el `.select()` final del reclamo se leería como
 * si fuera una lectura.
 */
function clienteFalso(programa: Programa = {}) {
  const llamadas: Llamada[] = [];

  const from = vi.fn(() => {
    let raiz: keyof Programa | null = null;
    const fijar = (op: keyof Programa) => {
      if (raiz === null) raiz = op;
    };
    const resultado = () => programa[raiz ?? "select"] ?? { data: null, error: null };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const metodo of ["update", "insert", "select"] as const) {
      builder[metodo] = vi.fn((...args: unknown[]) => {
        llamadas.push({ metodo, args });
        fijar(metodo);
        return builder;
      });
    }
    for (const metodo of ["eq", "or"] as const) {
      builder[metodo] = vi.fn((...args: unknown[]) => {
        llamadas.push({ metodo, args });
        return builder;
      });
    }
    builder.maybeSingle = vi.fn(async () => resultado());
    builder.then = (ok: (v: Resultado) => unknown, mal: (e: unknown) => unknown) =>
      Promise.resolve(resultado()).then(ok, mal);
    return builder;
  });

  return { cliente: { from }, llamadas };
}

const CONCESION = {
  tabla: "listing_premiums",
  columnaSujeto: "listing_id",
  sujeto: "listing-1",
  columnaPago: "stripe_checkout_session_id",
  pago: "cs_test_123",
  valores: { listing_id: "listing-1", status: "active" },
};

/** El 23505 tal como lo devuelve PostgREST. */
const DUPLICADA = { error: { code: "23505", message: "duplicate key", details: "" } };

describe("concederUnaSolaVez", () => {
  it("concede cuando no había fila: el reclamo no matchea y el alta entra", async () => {
    const { cliente, llamadas } = clienteFalso({
      update: { data: [], error: null },
      insert: { error: null },
    });

    const resultado = await concederUnaSolaVez(cliente, CONCESION);

    expect(resultado).toEqual({ estado: "concedido" });
    expect(llamadas.filter((l) => l.metodo === "insert")).toHaveLength(1);
  });

  it("concede una reactivación: la fila existe pero la escribió OTRO pago", async () => {
    const { cliente, llamadas } = clienteFalso({
      update: { data: [{ listing_id: "listing-1" }], error: null },
    });

    const resultado = await concederUnaSolaVez(cliente, CONCESION);

    expect(resultado).toEqual({ estado: "concedido" });
    // No hace falta el alta: el reclamo ya escribió.
    expect(llamadas.filter((l) => l.metodo === "insert")).toHaveLength(0);
  });

  it("EL GATE VA EN EL WHERE, no en un if sobre una fila ya leída", async () => {
    const { cliente, llamadas } = clienteFalso({
      update: { data: [{ listing_id: "listing-1" }], error: null },
    });

    await concederUnaSolaVez(cliente, CONCESION);

    // Sin este predicado, dos entregas concurrentes matchean las dos y las dos
    // notifican. Con él, Postgres serializa y la segunda no toca ninguna fila.
    expect(llamadas).toContainEqual({
      metodo: "or",
      args: [
        "stripe_checkout_session_id.is.null,stripe_checkout_session_id.neq.cs_test_123",
      ],
    });
    expect(llamadas).toContainEqual({ metodo: "eq", args: ["listing_id", "listing-1"] });
  });

  it("la SEGUNDA entrega del mismo pago no concede: la fila ya lleva este pago", async () => {
    const { cliente } = clienteFalso({
      update: { data: [], error: null },
      insert: DUPLICADA,
      select: { data: { stripe_checkout_session_id: "cs_test_123" }, error: null },
    });

    const resultado = await concederUnaSolaVez(cliente, CONCESION);

    expect(resultado).toEqual({ estado: "duplicado" });
  });

  it("un pago que ya enciende OTRO sujeto no concede acá", async () => {
    const { cliente } = clienteFalso({
      update: { data: [], error: null },
      insert: DUPLICADA,
      // No hay fila para este sujeto: el choque fue contra el unique del pago.
      select: { data: null, error: null },
    });

    const resultado = await concederUnaSolaVez(cliente, CONCESION);

    expect(resultado).toEqual({ estado: "pago_ya_usado" });
  });

  it("un reclamo que choca contra el unique del pago tampoco concede", async () => {
    const { cliente } = clienteFalso({ update: DUPLICADA });

    const resultado = await concederUnaSolaVez(cliente, CONCESION);

    expect(resultado).toEqual({ estado: "pago_ya_usado" });
  });

  it("un fallo transitorio devuelve error CON código, para que el caller lance", async () => {
    const { cliente } = clienteFalso({
      update: { error: { code: "57014", message: "statement timeout" } },
    });

    const resultado = await concederUnaSolaVez(cliente, CONCESION);

    // Un timeout SÍ lo arregla el reintento de Stripe: tiene que llegar al
    // caller como error, no tragarse como "duplicado".
    expect(resultado).toEqual({ estado: "error", codigo: "57014" });
  });

  it("un alta que falla por algo que no es 23505 también devuelve error", async () => {
    const { cliente } = clienteFalso({
      update: { data: [], error: null },
      insert: { error: { code: "23514", message: "check constraint" } },
    });

    const resultado = await concederUnaSolaVez(cliente, CONCESION);

    expect(resultado).toEqual({ estado: "error", codigo: "23514" });
  });

  it("sin token de pago no arma el predicado — no hay con qué distinguir entregas", async () => {
    const { cliente, llamadas } = clienteFalso({
      update: { data: [{ listing_id: "listing-1" }], error: null },
    });

    const resultado = await concederUnaSolaVez(cliente, { ...CONCESION, pago: null });

    expect(resultado).toEqual({ estado: "concedido" });
    expect(llamadas.filter((l) => l.metodo === "or")).toHaveLength(0);
  });

  it("un token de pago con caracteres raros no se manda como filtro", async () => {
    const { cliente, llamadas } = clienteFalso({
      update: { data: [{ listing_id: "listing-1" }], error: null },
    });

    // PostgREST parsea `or=(...)` como texto: una coma o un paréntesis en el
    // valor rompería el filtro y lo convertiría en otro filtro. Los ids de
    // Stripe nunca los traen, pero el módulo no lo asume.
    await concederUnaSolaVez(cliente, { ...CONCESION, pago: "cs_test,evil)" });

    expect(llamadas.filter((l) => l.metodo === "or")).toHaveLength(0);
  });
});
