import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las server actions de llamadas (0139).
 *
 * Tres cosas, y las tres son de plata o de datos:
 *
 *  1. `CALL_FULL` sale de acá como un código propio, y sale ENTERO — o sea que
 *     la pantalla puede decir "ya son 10" en vez de mostrar un `raise` de
 *     Postgres en español técnico.
 *  2. Invitar es de a UNA fila. Si eligieron cinco y entran tres, entran tres.
 *     En lote, el `CALL_FULL` de la cuarta tiraría abajo el INSERT entero y no
 *     entraría ninguna.
 *  3. Colgar SIEMPRE escribe `ended_at`, y una llamada que nadie atendió queda
 *     como `perdida`. De ese estado cuelga el "Llamada perdida" de la bandeja.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  limit: vi.fn(() => ({ ok: true, remaining: 10, retryAfterMs: 0 })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  invitarALlamadaAction,
  iniciarLlamadaAction,
  terminarLlamadaAction,
} from "./actions";

const USER_ID = "99999999-9999-4999-8999-999999999999";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const CALL_ID = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

type Resultado = { data?: unknown; error?: unknown };
type Operacion = "insert" | "update" | "delete" | "select";
type PorTabla = Partial<Record<Operacion, Resultado | Resultado[]>>;

interface Registro {
  tabla: string;
  metodo: string;
  args: unknown[];
}

/**
 * Stub del cliente de Supabase: encadenable y "thenable", que es como se usa de
 * verdad (`await db.from(x).update(y).eq(...)` sin `.single()`).
 *
 * Cuando el valor configurado es un array, se va consumiendo de a uno por
 * llamada: es lo que permite decir "la tercera inserción devuelve CALL_FULL".
 */
function crearDb(config: Record<string, PorTabla> = {}) {
  const registros: Registro[] = [];
  const consumidos = new Map<string, number>();

  const from = (tabla: string) => {
    const conf: PorTabla = config[tabla] ?? {};
    let op: Operacion = "select";

    const resolver = (): Resultado => {
      const valor = conf[op];
      if (Array.isArray(valor)) {
        const clave = `${tabla}:${op}`;
        const i = consumidos.get(clave) ?? 0;
        consumidos.set(clave, i + 1);
        return valor[Math.min(i, valor.length - 1)] ?? { data: null, error: null };
      }
      return valor ?? { data: null, error: null };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      then: (resolver2: (v: Resultado) => unknown) => Promise.resolve(resolver()).then(resolver2),
      single: async () => resolver(),
      maybeSingle: async () => resolver(),
    };

    for (const metodo of [
      "insert",
      "update",
      "delete",
      "select",
      "eq",
      "in",
      "is",
      "not",
      "neq",
      "gt",
      "or",
      "order",
      "limit",
    ]) {
      builder[metodo] = (...args: unknown[]) => {
        registros.push({ tabla, metodo, args });
        // Un `.select()` DESPUÉS de un write es su RETURNING, no una consulta
        // nueva: no puede pisar la operación en curso.
        if (metodo === "insert" || metodo === "update" || metodo === "delete") {
          op = metodo;
        }
        return builder;
      };
    }

    return builder;
  };

  return { cliente: { from: vi.fn(from) }, registros };
}

function guardCon(config: Record<string, PorTabla> = {}) {
  const { cliente, registros } = crearDb(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID },
    supabase: cliente,
    user: { id: USER_ID },
  });
  return registros;
}

const LLENA = { error: { message: "CALL_FULL: una llamada admite hasta 10 personas.", code: "P0001" } };
const DUPLICADA = { error: { code: "23505", message: "duplicate key value" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 10, retryAfterMs: 0 });
});

describe("invitarALlamadaAction", () => {
  it("traduce CALL_FULL cuando no entró ni una", async () => {
    guardCon({ call_participants: { insert: LLENA } });

    const resultado = await invitarALlamadaAction({ callId: CALL_ID, profileIds: [A] });

    expect(resultado).toEqual({ ok: false, code: "call-full" });
  });

  it("suma las que entran y corta al llenarse, en vez de perderlas todas", async () => {
    const registros = guardCon({
      call_participants: { insert: [{ error: null }, { error: null }, LLENA] },
    });

    const resultado = await invitarALlamadaAction({ callId: CALL_ID, profileIds: [A, B, C] });

    expect(resultado).toEqual({ ok: true, sumados: 2 });
    // Tres intentos, no uno en lote: es lo que permite el resultado parcial.
    const inserts = registros.filter((r) => r.tabla === "call_participants" && r.metodo === "insert");
    expect(inserts).toHaveLength(3);
    // El tenant sale del guard, nunca del input.
    expect(inserts[0].args[0]).toMatchObject({ tenant_id: TENANT_ID, call_id: CALL_ID });
  });

  it("una fila duplicada es 'ya estaba invitada', no un error", async () => {
    guardCon({ call_participants: { insert: DUPLICADA } });

    const resultado = await invitarALlamadaAction({ callId: CALL_ID, profileIds: [A] });

    expect(resultado).toEqual({ ok: true, sumados: 1 });
  });

  it("no llama a la base con ids que no son uuid", async () => {
    const registros = guardCon();

    const resultado = await invitarALlamadaAction({ callId: CALL_ID, profileIds: ["pepe"] });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(registros).toHaveLength(0);
  });
});

describe("terminarLlamadaAction", () => {
  it("escribe ended_at y deja PERDIDA la llamada que nadie llegó a atender", async () => {
    const registros = guardCon({
      call_participants: { select: { data: [] }, update: { error: null } },
      calls: { select: { data: { status: "sonando", started_at: null } }, update: { error: null } },
    });

    const resultado = await terminarLlamadaAction({ callId: CALL_ID });

    expect(resultado).toEqual({ ok: true, callId: CALL_ID });
    const update = registros.find((r) => r.tabla === "calls" && r.metodo === "update");
    expect(update?.args[0]).toMatchObject({ status: "perdida" });
    expect((update?.args[0] as { ended_at?: string }).ended_at).toBeTruthy();
  });

  it("una llamada que sí se atendió termina como TERMINADA, con su ended_at", async () => {
    const registros = guardCon({
      call_participants: { select: { data: [] }, update: { error: null } },
      calls: {
        select: { data: { status: "en_curso", started_at: "2026-09-07T20:00:00.000Z" } },
        update: { error: null },
      },
    });

    await terminarLlamadaAction({ callId: CALL_ID });

    const update = registros.find((r) => r.tabla === "calls" && r.metodo === "update");
    expect(update?.args[0]).toMatchObject({ status: "terminada" });
  });

  it("con dos personas todavía hablando NO cierra la llamada", async () => {
    const registros = guardCon({
      call_participants: {
        select: { data: [{ profile_id: A }, { profile_id: B }] },
        update: { error: null },
      },
    });

    const resultado = await terminarLlamadaAction({ callId: CALL_ID });

    expect(resultado).toEqual({ ok: true, callId: CALL_ID });
    expect(registros.some((r) => r.tabla === "calls" && r.metodo === "update")).toBe(false);
  });

  it("sólo cierra MI fila de participante, y sólo si había entrado", async () => {
    const registros = guardCon({
      call_participants: { select: { data: [] }, update: { error: null } },
      calls: { select: { data: { status: "en_curso", started_at: "2026-09-07T20:00:00.000Z" } } },
    });

    await terminarLlamadaAction({ callId: CALL_ID });

    const filtros = registros.filter((r) => r.tabla === "call_participants");
    expect(filtros.some((r) => r.metodo === "eq" && r.args[0] === "profile_id" && r.args[1] === USER_ID)).toBe(true);
    // El CHECK de la 0139 prohíbe left_at sin joined_at.
    expect(filtros.some((r) => r.metodo === "not" && r.args[0] === "joined_at")).toBe(true);
  });
});

describe("iniciarLlamadaAction", () => {
  it("nunca manda el canal: lo pone el trigger de la base", async () => {
    const registros = guardCon({
      calls: { insert: { data: { id: CALL_ID }, error: null } },
      call_participants: { insert: { error: null } },
    });

    const resultado = await iniciarLlamadaAction({ kind: "audio", profileId: A });

    expect(resultado).toEqual({ ok: true, callId: CALL_ID });
    const insert = registros.find((r) => r.tabla === "calls" && r.metodo === "insert");
    expect(insert?.args[0]).not.toHaveProperty("canal");
    expect(insert?.args[0]).toMatchObject({
      tenant_id: TENANT_ID,
      iniciada_por: USER_ID,
      status: "sonando",
    });
  });

  it("cierra la llamada si no se pudo invitar a nadie, en vez de dejarla sonando para siempre", async () => {
    const registros = guardCon({
      calls: { insert: { data: { id: CALL_ID }, error: null }, update: { error: null } },
      call_participants: {
        insert: { error: { code: "42501", message: "row-level security" } },
      },
    });

    const resultado = await iniciarLlamadaAction({ kind: "video", profileId: A });

    expect(resultado).toEqual({ ok: false, code: "forbidden" });
    const cierre = registros.find((r) => r.tabla === "calls" && r.metodo === "update");
    expect(cierre?.args[0]).toMatchObject({ status: "terminada" });
  });

  it("rechaza pedir una llamada a una persona Y a un grupo a la vez", async () => {
    const registros = guardCon();

    const resultado = await iniciarLlamadaAction({ kind: "audio", profileId: A, groupId: B });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(registros).toHaveLength(0);
  });
});
