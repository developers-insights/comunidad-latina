import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_DAY,
  MAX_SENDS_PER_HOUR,
  canSend,
  consumeCode,
  generateCode,
  hashCode,
  issueCode,
  type CanSendResult,
  type ConsumeResult,
} from "./verification";
import { maskPhone, parsePhone } from "./e164";

/**
 * EL FLUJO DE CÓDIGO POR SMS.
 *
 * ── POR QUÉ ESTOS TESTS EXISTEN AUNQUE LA FEATURE ESTÉ APAGADA ───────────────
 * El teléfono está detrás de un gate LEGAL (`PHONE_VERIFICATION_ENABLED`,
 * apagado por defecto: `user_phones` es un mapa teléfono↔identidad y no se
 * recolectan números reales sin firma). Pero cuando se encienda, se va a
 * encender con una variable de entorno — no con una revisión de código. Las tres
 * defensas del pliego (expiración, tope de intentos y rate limit) tienen que
 * estar probadas ANTES, porque el día que se prendan nadie las va a mirar.
 *
 * ── QUÉ SE PRUEBA ACÁ Y QUÉ NO ──────────────────────────────────────────────
 * Desde la 0071, el rate limit y el canje viven en Postgres
 * (`public.phone_verification_can_send` / `_consume`, envoltorios de las de
 * `app` en 0066). Ese SQL es el dueño de la lógica: la app le pasa el hash y
 * traduce la respuesta. Entonces acá se prueba lo que la app SÍ decide:
 *
 *   · que llame a la RPC correcta con los argumentos correctos;
 *   · que traduzca CADA uno de los estados que la función puede devolver
 *     (los 3 de can_send y los 5 de consume) — ninguno puede quedar sin mapear;
 *   · que falle CERRADO ante un error o una respuesta inesperada;
 *   · que el código en claro nunca salga del proceso;
 *   · que los números del COPY sigan siendo los de la migración.
 *
 * Lo que NO se prueba acá es el comportamiento interno de la función SQL —el
 * `for update`, el orden de los chequeos, el incremento del contador— porque no
 * es código de este repo y mockearlo sería probar el mock. Es justamente el
 * punto de haberlo movido a la base: esa parte ya no se puede romper desde acá.
 */

const PEPPER = "pepper-de-prueba";
const PHONE = "+19175550142";
const TENANT = "11111111-1111-1111-1111-111111111111";

/** Cliente admin mockeado: sólo `rpc` y `from(...).insert(...)`. */
const rpc = vi.fn();
const insert = vi.fn();
const admin = {
  rpc,
  from: () => ({ insert }),
} as unknown as Parameters<typeof canSend>[0];

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
});

/* ────────────────── Los números del COPY vs. la migración ────────────────── */

/**
 * GUARDA DE REGRESIÓN. Los cuatro números son COPIA de la base: los usa el texto
 * que lee la persona ("tenés 5 intentos", "vence en 10 minutos") y quien los
 * aplica de verdad es Postgres. Si se separan, la app le miente sobre un límite
 * que no controla — le dice "te quedan 3 intentos" mientras el servidor ya cortó.
 */
describe("los límites del COPY son los de la migración 0066", () => {
  const MIGRATION = readFileSync(
    fileURLToPath(
      new URL(
        "../../../supabase/migrations/0066_telefono_por_tenant_y_codigos_sms.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("la migración existe y se pudo leer (si no, el test es decorativo)", () => {
    expect(MIGRATION).toContain("app.phone_verification_can_send");
  });

  it(`el tope por hora es ${MAX_SENDS_PER_HOUR} en los dos lados`, () => {
    expect(MIGRATION).toContain(`if v_hora >= ${MAX_SENDS_PER_HOUR} then`);
  });

  it(`el tope por día es ${MAX_SENDS_PER_DAY} en los dos lados`, () => {
    expect(MIGRATION).toContain(`if v_dia  >= ${MAX_SENDS_PER_DAY} then`);
  });

  it(`el tope de intentos es ${MAX_ATTEMPTS} en los dos lados`, () => {
    expect(MIGRATION).toContain(`max_attempts int not null default ${MAX_ATTEMPTS}`);
  });

  it(`el vencimiento es de ${CODE_TTL_MINUTES} minutos en los dos lados`, () => {
    expect(MIGRATION).toContain(`now() + interval '${CODE_TTL_MINUTES} minutes'`);
  });
});

/* ───────────────────────────── El código ───────────────────────────── */

describe("generateCode", () => {
  it("son siempre 6 dígitos", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });

  it("no repite el mismo código una y otra vez", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateCode()));
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe("hashCode", () => {
  it("devuelve el formato que exige el CHECK de la base (^[a-f0-9]{64}$)", () => {
    expect(hashCode("123456", PEPPER)).toMatch(/^[a-f0-9]{64}$/);
    // Un código con ceros a la izquierda tiene que hashear igual de bien: es de
    // donde viene la tentación de excluirlo del espacio de 10^6.
    expect(hashCode("000000", PEPPER)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("el pepper cambia el hash: un volcado de la tabla no alcanza", () => {
    expect(hashCode("123456", "uno")).not.toBe(hashCode("123456", "otro"));
  });

  it("el código en claro no aparece en el hash", () => {
    expect(hashCode("123456", PEPPER)).not.toContain("123456");
  });
});

/* ───────────────── canSend: los 3 estados + fail closed ───────────────── */

describe("canSend", () => {
  it("llama a la RPC de public con el tenant y el teléfono", async () => {
    rpc.mockResolvedValue({ data: "ok", error: null });
    await canSend(admin, TENANT, PHONE);

    // `public.phone_verification_can_send`, no `app.*`: el schema `app` no está
    // expuesto por PostgREST y una llamada ahí devuelve 404.
    expect(rpc).toHaveBeenCalledWith("phone_verification_can_send", {
      p_tenant: TENANT,
      p_phone: PHONE,
    });
  });

  it.each<CanSendResult>(["ok", "rate_limited_hora", "rate_limited_dia"])(
    "traduce el estado %s tal cual",
    async (state) => {
      rpc.mockResolvedValue({ data: state, error: null });
      expect(await canSend(admin, TENANT, PHONE)).toBe(state);
    },
  );

  /**
   * FAIL CLOSED. Equivocarse hacia el otro lado significa un teléfono ajeno
   * bombardeado a códigos: es acoso, y encima cada SMS cuesta plata.
   */
  it.each([
    ["un error de la RPC", { data: null, error: { code: "42883" } }],
    ["una respuesta nula", { data: null, error: null }],
    ["un estado desconocido", { data: "quien_sabe", error: null }],
    ["un tipo inesperado", { data: 42, error: null }],
  ])("con %s bloquea el envío", async (_caso, response) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue(response);
    expect(await canSend(admin, TENANT, PHONE)).toBe("rate_limited_hora");
  });
});

/* ─────────────────────────── issueCode ─────────────────────────── */

describe("issueCode", () => {
  it("guarda el HASH y nunca el código en claro", async () => {
    const issued = await issueCode(admin, TENANT, {
      phone: PHONE,
      profileId: "u1",
      pepper: PEPPER,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const [row] = insert.mock.calls[0];
    expect(row.code_hash).toBe(hashCode(issued.code, PEPPER));
    expect(JSON.stringify(row)).not.toContain(issued.code);
  });

  it("la fila lleva el tenant: el aislamiento por dominio lo pone el WHERE", async () => {
    await issueCode(admin, TENANT, { phone: PHONE, profileId: "u1", pepper: PEPPER });
    const [row] = insert.mock.calls[0];
    expect(row).toMatchObject({ tenant_id: TENANT, phone_e164: PHONE, profile_id: "u1" });
  });

  /**
   * El TTL y el tope de intentos los pone la TABLA, no la app. Mandarlos desde
   * acá les daría dos dueños y dejaría que el reloj de Node —que puede estar
   * corrido respecto del de Postgres— decidiera cuándo vence un código.
   */
  it("no manda expires_at ni max_attempts: los pone la tabla", async () => {
    await issueCode(admin, TENANT, { phone: PHONE, profileId: "u1", pepper: PEPPER });
    const [row] = insert.mock.calls[0];
    expect(row).not.toHaveProperty("expires_at");
    expect(row).not.toHaveProperty("max_attempts");
  });

  it("acepta profileId null (verificar ANTES de tener cuenta)", async () => {
    await issueCode(admin, TENANT, { phone: PHONE, profileId: null, pepper: PEPPER });
    const [row] = insert.mock.calls[0];
    expect(row.profile_id).toBeNull();
  });

  it("si el insert falla, no devuelve un código que no existe", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    insert.mockResolvedValue({ error: { code: "23514" } });
    expect(
      await issueCode(admin, TENANT, { phone: PHONE, profileId: "u1", pepper: PEPPER }),
    ).toEqual({ ok: false });
  });
});

/* ──────────────── consumeCode: los 5 estados + fail closed ──────────────── */

describe("consumeCode", () => {
  it("manda el HASH, nunca el código en claro", async () => {
    rpc.mockResolvedValue({ data: "ok", error: null });
    await consumeCode(admin, TENANT, { phone: PHONE, code: "123456", pepper: PEPPER });

    expect(rpc).toHaveBeenCalledWith("phone_verification_consume", {
      p_tenant: TENANT,
      p_phone: PHONE,
      p_code_hash: hashCode("123456", PEPPER),
    });
    // El código en claro no viaja a la base bajo ninguna forma.
    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain("123456");
  });

  it.each<ConsumeResult>(["ok", "invalido", "expirado", "agotado", "sin_codigo"])(
    "traduce el estado %s tal cual",
    async (state) => {
      rpc.mockResolvedValue({ data: state, error: null });
      expect(
        await consumeCode(admin, TENANT, { phone: PHONE, code: "123456", pepper: PEPPER }),
      ).toBe(state);
    },
  );

  /**
   * FAIL CLOSED, y acá es lo más importante de todo el archivo: un error o una
   * respuesta rara NUNCA pueden traducirse a `ok`. `sin_codigo` es el estado que
   * no verifica a nadie.
   */
  it.each([
    ["un error de la RPC", { data: null, error: { code: "42883" } }],
    ["una respuesta nula", { data: null, error: null }],
    ["un estado desconocido", { data: "verificado", error: null }],
    ["un booleano", { data: true, error: null }],
  ])("con %s NO verifica a nadie", async (_caso, response) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue(response);
    expect(
      await consumeCode(admin, TENANT, { phone: PHONE, code: "123456", pepper: PEPPER }),
    ).toBe("sin_codigo");
  });

  it("con otro pepper manda un hash distinto (y la base lo rechaza)", async () => {
    rpc.mockResolvedValue({ data: "invalido", error: null });
    await consumeCode(admin, TENANT, { phone: PHONE, code: "123456", pepper: "otro" });

    const [, args] = rpc.mock.calls[0];
    expect(args.p_code_hash).not.toBe(hashCode("123456", PEPPER));
  });
});

/* ────────────────────────── El número en E.164 ────────────────────────── */

describe("parsePhone", () => {
  it.each([
    ["(917) 555-0142", "+19175550142"],
    ["917 555 0142", "+19175550142"],
    ["9175550142", "+19175550142"],
    ["19175550142", "+19175550142"],
    ["+1 917 555 0142", "+19175550142"],
    ["001 917 555 0142", "+19175550142"],
    ["+54 9 11 5555 5555", "+5491155555555"],
  ])("normaliza %j a %s", (raw, expected) => {
    const result = parsePhone(raw);
    expect(result.ok && result.e164).toBe(expected);
  });

  it("NO adivina el país de un número sin + que no tiene 10 dígitos", () => {
    // Inventarle un +1 a un número de 9 dígitos manda el SMS a otra persona.
    expect(parsePhone("555012345").ok).toBe(false);
  });

  it.each([
    ["", "vacio"],
    ["123", "corto"],
    ["+9999999999999999999", "largo"],
    ["no soy un teléfono", "formato"],
    ["+0123456789", "formato"],
  ] as const)("rechaza %j con el problema %s", (raw, problem) => {
    const result = parsePhone(raw);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toBe(problem);
  });

  it("todo lo que acepta cumple el CHECK de la base", () => {
    const inputs = ["(917) 555-0142", "+5491155555555", "9175550142", "+34612345678"];
    for (const input of inputs) {
      const result = parsePhone(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.e164).toMatch(/^\+[1-9]\d{7,14}$/);
    }
  });
});

describe("maskPhone", () => {
  it("deja ver sólo los últimos cuatro dígitos", () => {
    const masked = maskPhone("+19175550142");
    expect(masked).toContain("0142");
    expect(masked).not.toContain("9175550142");
    expect(masked).toContain("•");
  });

  it("un valor que no es E.164 no se filtra a medias", () => {
    expect(maskPhone("cualquier cosa")).toBe("•••");
  });
});
