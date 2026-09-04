import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las altas de los cuatro registros privados (0131).
 *
 * Se aíslan los bordes con el patrón del repo (empleos/publicar/actions.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable del query builder. Nunca se toca
 * Supabase real.
 *
 * Garantías cubiertas:
 *  · zod PURO primero: un formulario sin aceptar las reglas ni siquiera llega al
 *    guard → cero efectos colaterales, cero cuota consumida;
 *  · sin contacto no hay registro, que es la razón de ser de la tabla;
 *  · el insert lleva el tenant y el autor del GUARD, nunca del payload;
 *  · el cupo de uno abierto por formulario se traduce a una frase en castellano,
 *    tanto cuando lo frena el trigger (`ALREADY_OPEN`) como cuando lo gana el
 *    índice único en una carrera (`23505`);
 *  · retirar borra sólo lo propio.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ DAY_MS: 86_400_000, limit: mocks.limit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { COMUNIDAD_COPY } from "@/lib/comunidad";
import {
  ofrecerEspacio,
  registrarLugar,
  registrarVoluntario,
  retirarRegistro,
} from "./actions";

const C = COMUNIDAD_COPY.registros;

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const REGISTRO_ID = "44444444-4444-4444-8444-444444444444";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(
  resultado: { data: unknown; error: unknown } = { data: { id: REGISTRO_ID }, error: null },
) {
  const calls: RecordedCall[] = [];
  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const metodo of ["insert", "select", "delete", "update", "eq"]) {
      builder[metodo] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: metodo, args });
        return builder;
      });
    }
    builder.maybeSingle = vi.fn(async () => resultado);
    // `delete().eq().eq().eq()` termina sin `maybeSingle`: el builder tiene que
    // poder awaitearse solo, igual que el de PostgREST.
    builder.then = (resolve: (valor: unknown) => unknown) => resolve(resultado);
    return builder;
  });
  return { client: { from }, calls };
}

function guardOk(supabase: unknown) {
  return {
    ok: true as const,
    tenant: { id: TENANT_ID },
    supabase,
    user: { id: USER_ID },
  };
}

const VOLUNTARIO_OK = {
  name: "Rosa Jiménez",
  areaLabel: "Corona, Queens",
  body: "Puedo ayudar los sábados a la mañana con lo que haga falta.",
  contactPhone: "(917) 555-0134",
  skills: ["comida" as const],
  availability: ["finde" as const],
  aceptaReglas: true as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
});

describe("registrarVoluntario", () => {
  it("no toca nada si no aceptó las reglas", async () => {
    const resultado = await registrarVoluntario({ ...VOLUNTARIO_OK, aceptaReglas: false as never });

    expect(resultado).toEqual({ ok: false, error: C.errores.reglas });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("no toca nada si no dejó forma de contestarle", async () => {
    const { contactPhone: _omitido, ...sinContacto } = VOLUNTARIO_OK;
    const resultado = await registrarVoluntario(sinContacto);

    expect(resultado).toEqual({ ok: false, error: C.errores.contacto });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("inserta con el tenant y el autor del guard, y con la versión de las reglas", async () => {
    const { client, calls } = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue(guardOk(client));

    const resultado = await registrarVoluntario(VOLUNTARIO_OK);

    expect(resultado).toEqual({ ok: true, registroId: REGISTRO_ID });
    const insert = calls.find((call) => call.method === "insert");
    expect(insert?.table).toBe("community_registrations");
    const fila = insert?.args[0] as Record<string, unknown>;
    expect(fila.tenant_id).toBe(TENANT_ID);
    expect(fila.created_by).toBe(USER_ID);
    expect(fila.kind).toBe("volunteer");
    expect(fila.contact_phone).toBe("(917) 555-0134");
    expect((fila.details as Record<string, unknown>).rules_version).toBeTruthy();
    // Nada de la decisión del equipo viaja desde el cliente.
    expect(fila).not.toHaveProperty("status");
    expect(fila).not.toHaveProperty("admin_notes");
  });

  it("manda a entrar cuando no hay sesión, sin gastar cuota", async () => {
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });

    const resultado = await registrarVoluntario(VOLUNTARIO_OK);

    expect(resultado).toEqual({ ok: false, needsAuth: true, error: C.needLogin });
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("traduce el cupo del trigger a una frase", async () => {
    const { client } = createSupabaseStub({
      data: null,
      error: { code: "P0001", message: "ALREADY_OPEN: ya tenés un registro de este tipo" },
    });
    mocks.requireTenantMatch.mockResolvedValue(guardOk(client));

    const resultado = await registrarVoluntario(VOLUNTARIO_OK);
    expect(resultado).toEqual({ ok: false, error: C.errores.abierto });
  });

  it("traduce también la carrera que gana el índice único (23505)", async () => {
    const { client } = createSupabaseStub({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    mocks.requireTenantMatch.mockResolvedValue(guardOk(client));

    const resultado = await registrarVoluntario(VOLUNTARIO_OK);
    expect(resultado).toEqual({ ok: false, error: C.errores.abierto });
  });

  it("con la cuota diaria agotada no inserta nada", async () => {
    const { client, calls } = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue(guardOk(client));
    mocks.limit.mockReturnValue({ ok: false });

    const resultado = await registrarVoluntario(VOLUNTARIO_OK);

    expect(resultado).toEqual({ ok: false, error: C.errores.abierto });
    expect(calls.some((call) => call.method === "insert")).toBe(false);
  });
});

describe("registrarLugar", () => {
  it("deja el tipo, la dirección y el horario en details, no en columnas", async () => {
    const { client, calls } = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue(guardOk(client));

    const resultado = await registrarLugar({
      name: "Despensa San Rafael",
      areaLabel: "Corona, Queens",
      body: "Entregamos bolsones de comida seca, sin papeles ni turno.",
      contactPhone: "(718) 555-0110",
      placeType: "comida",
      address: "103-25 Roosevelt Ave, Corona, NY",
      hoursLabel: "Martes y jueves de 10 a 14",
    });

    expect(resultado.ok).toBe(true);
    const fila = calls.find((call) => call.method === "insert")?.args[0] as Record<string, unknown>;
    expect(fila.kind).toBe("place");
    expect(fila.details).toEqual({
      place_type: "comida",
      address: "103-25 Roosevelt Ave, Corona, NY",
      hours_label: "Martes y jueves de 10 a 14",
    });
  });
});

describe("ofrecerEspacio", () => {
  it("rechaza sin decir para qué lo prestaría", async () => {
    const resultado = await ofrecerEspacio({
      name: "Panadería La Esperanza",
      areaLabel: "Jackson Heights",
      body: "El salón del fondo, con diez mesas largas.",
      contactPhone: "(718) 555-0111",
      address: "82-14 Northern Blvd",
      capacity: 30,
      daysLabel: "Sábados de 9 a 13",
      activities: [],
    });

    expect(resultado).toEqual({ ok: false, error: C.errores.chips });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});

describe("retirarRegistro", () => {
  it("borra acotando por tenant y por autor", async () => {
    const { client, calls } = createSupabaseStub({ data: null, error: null });
    mocks.requireTenantMatch.mockResolvedValue(guardOk(client));

    const resultado = await retirarRegistro({ registroId: REGISTRO_ID });

    expect(resultado).toEqual({ ok: true });
    expect(calls.some((call) => call.method === "delete")).toBe(true);
    const eqs = calls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(eqs).toContainEqual(["id", REGISTRO_ID]);
    expect(eqs).toContainEqual(["tenant_id", TENANT_ID]);
    expect(eqs).toContainEqual(["created_by", USER_ID]);
  });

  it("un id que no es un id no llega a la base", async () => {
    const resultado = await retirarRegistro({ registroId: "todos" });
    expect(resultado).toEqual({ ok: false, error: C.errores.retirar });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});
