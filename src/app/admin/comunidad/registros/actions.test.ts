import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del panel de registros privados (0131).
 *
 * Garantías cubiertas:
 *  · sin `domain_admin` no se escribe nada — ni siquiera se lee;
 *  · la transición prohibida por el trigger (volver a `new`) se frena ACÁ, con
 *    una frase, en vez de llegar a la base y volver como `BAD_TRANSITION`;
 *  · aprobar un LUGAR crea su ficha en `community_resources` con el tema que
 *    corresponde, publicada, con la fuente que escribió el equipo, y deja el
 *    registro apuntando a la ficha;
 *  · si el vínculo falla, la ficha recién creada se borra: una ficha publicada
 *    que nadie sabe de dónde salió queda en la app de la gente;
 *  · a la auditoría no viaja ni un teléfono ni el texto de las notas.
 */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(),
}));

vi.mock("../../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { publicarLugar, resolverRegistro } from "./actions";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const REGISTRO_ID = "44444444-4444-4444-8444-444444444444";
const RECURSO_ID = "55555555-5555-4555-8555-555555555555";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Stub del query builder con resultado POR TABLA: `publicarLugar` toca dos
 * tablas en el mismo request y cada una tiene que poder contestar distinto (y
 * fallar por separado, que es el caso interesante).
 */
function createSupabaseStub(porTabla: Record<string, { data: unknown; error: unknown }>) {
  const calls: RecordedCall[] = [];
  const from = vi.fn((table: string) => {
    const resultado = porTabla[table] ?? { data: null, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const metodo of ["insert", "select", "update", "delete", "eq"]) {
      builder[metodo] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: metodo, args });
        return builder;
      });
    }
    builder.maybeSingle = vi.fn(async () => resultado);
    builder.then = (resolve: (valor: unknown) => unknown) => resolve(resultado);
    return builder;
  });
  return { client: { from }, calls };
}

function staffOk(supabase: unknown) {
  return { supabase, user: { id: ADMIN_ID }, role: "domain_admin", tenantId: TENANT_ID };
}

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [clave, valor] of Object.entries(campos)) fd.set(clave, valor);
  return fd;
}

const LUGAR = {
  id: REGISTRO_ID,
  kind: "place",
  name: "Despensa San Rafael",
  contact_phone: "(718) 555-0110",
  area_label: "Corona, Queens",
  body: "Entregamos bolsones de comida seca.",
  details: {
    place_type: "comida",
    address: "103-25 Roosevelt Ave",
    hours_label: "Martes y jueves de 10 a 14",
  },
  resource_id: null,
};

const FUENTE = {
  registroId: REGISTRO_ID,
  fuenteName: "NYC Food Help",
  fuenteUrl: "https://www.nyc.gov/site/hra/help/food-assistance.page",
  fuenteCheckedAt: "2026-09-04",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.logAdminAction.mockResolvedValue(true);
});

describe("resolverRegistro", () => {
  it("sin rol staff no lee ni escribe", async () => {
    mocks.getStaffContext.mockResolvedValue(null);

    const estado = await resolverRegistro(
      { status: "idle" },
      formulario({ registroId: REGISTRO_ID, hasta: "contacted" }),
    );

    expect(estado.status).toBe("error");
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("frena la única transición que la base prohíbe: volver a `new`", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: {
        data: { id: REGISTRO_ID, kind: "volunteer", status: "contacted" },
        error: null,
      },
    });
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    const estado = await resolverRegistro(
      { status: "idle" },
      formulario({ registroId: REGISTRO_ID, hasta: "new" }),
    );

    expect(estado.status).toBe("error");
    expect(calls.some((call) => call.method === "update")).toBe(false);
  });

  it("mueve el estado y guarda la nota, sin mandar el texto a la auditoría", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: {
        data: { id: REGISTRO_ID, kind: "volunteer", status: "new" },
        error: null,
      },
    });
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    const estado = await resolverRegistro(
      { status: "idle" },
      formulario({
        registroId: REGISTRO_ID,
        hasta: "contacted",
        notas: "Llamé el martes, quedamos para el sábado.",
      }),
    );

    expect(estado.status).toBe("success");
    const update = calls.find((call) => call.method === "update")?.args[0] as Record<string, unknown>;
    expect(update.status).toBe("contacted");
    expect(update.admin_notes).toBe("Llamé el martes, quedamos para el sábado.");

    const auditoria = mocks.logAdminAction.mock.calls[0]?.[0] as { meta: Record<string, unknown> };
    expect(auditoria.meta).toEqual({
      kind: "volunteer",
      desde: "new",
      hasta: "contacted",
      notaLargo: "Llamé el martes, quedamos para el sábado.".length,
    });
    expect(JSON.stringify(auditoria.meta)).not.toContain("Llamé");
  });

  it("no resuelve un registro de otra comunidad (la lectura no lo encuentra)", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: { data: null, error: null },
    });
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    const estado = await resolverRegistro(
      { status: "idle" },
      formulario({ registroId: REGISTRO_ID, hasta: "approved" }),
    );

    expect(estado.status).toBe("error");
    expect(calls.some((call) => call.method === "update")).toBe(false);
  });
});

describe("publicarLugar", () => {
  it("crea la ficha con el tema del lugar, publicada y con la fuente del equipo", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: { data: LUGAR, error: null },
      community_resources: { data: { id: RECURSO_ID }, error: null },
    });
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    const estado = await publicarLugar({ status: "idle" }, formulario(FUENTE));

    expect(estado.status).toBe("success");

    const insert = calls.find(
      (call) => call.table === "community_resources" && call.method === "insert",
    );
    const ficha = insert?.args[0] as Record<string, unknown>;
    expect(ficha.tenant_id).toBe(TENANT_ID);
    expect(ficha.topic).toBe("comida");
    expect(ficha.status).toBe("published");
    expect(ficha.name).toBe("Despensa San Rafael");
    expect(ficha.address).toBe("103-25 Roosevelt Ave");
    expect(ficha.hours_note).toBe("Martes y jueves de 10 a 14");
    expect(ficha.source_name).toBe("NYC Food Help");
    expect(ficha.source_checked_at).toBe("2026-09-04");

    const update = calls.find(
      (call) => call.table === "community_registrations" && call.method === "update",
    )?.args[0] as Record<string, unknown>;
    expect(update).toEqual({ status: "approved", resource_id: RECURSO_ID });
  });

  it("un centro de acopio NO se publica como banco de comida", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: {
        data: { ...LUGAR, details: { ...LUGAR.details, place_type: "acopio" } },
        error: null,
      },
      community_resources: { data: { id: RECURSO_ID }, error: null },
    });
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    await publicarLugar({ status: "idle" }, formulario(FUENTE));

    const ficha = calls.find(
      (call) => call.table === "community_resources" && call.method === "insert",
    )?.args[0] as Record<string, unknown>;
    expect(ficha.topic).toBe("acopio");
  });

  it("sin una fuente verificable no se publica nada", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: { data: LUGAR, error: null },
    });
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    const estado = await publicarLugar(
      { status: "idle" },
      formulario({ ...FUENTE, fuenteUrl: "me lo dijo el dueño" }),
    );

    expect(estado.status).toBe("error");
    expect(calls.length).toBe(0);
  });

  it("no publica un registro que no es un lugar", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: { data: { ...LUGAR, kind: "volunteer" }, error: null },
    });
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    const estado = await publicarLugar({ status: "idle" }, formulario(FUENTE));

    expect(estado.status).toBe("error");
    expect(calls.some((call) => call.table === "community_resources")).toBe(false);
  });

  it("no publica dos veces el mismo lugar", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: { data: { ...LUGAR, resource_id: RECURSO_ID }, error: null },
    });
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    const estado = await publicarLugar({ status: "idle" }, formulario(FUENTE));

    expect(estado.status).toBe("error");
    expect(calls.some((call) => call.table === "community_resources")).toBe(false);
  });

  it("si el vínculo falla, borra la ficha que acababa de crear", async () => {
    const { client, calls } = createSupabaseStub({
      community_registrations: { data: LUGAR, error: null },
      community_resources: { data: { id: RECURSO_ID }, error: null },
    });
    // La lectura del registro y el update comparten tabla, así que el fallo del
    // update se simula reemplazando el resultado después de la lectura.
    let lecturaHecha = false;
    const original = client.from;
    client.from = vi.fn((table: string) => {
      if (table === "community_registrations" && lecturaHecha) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const builder: any = {};
        for (const metodo of ["update", "eq"]) {
          builder[metodo] = vi.fn((...args: unknown[]) => {
            calls.push({ table, method: metodo, args });
            return builder;
          });
        }
        builder.then = (resolve: (valor: unknown) => unknown) =>
          resolve({ data: null, error: { code: "42501" } });
        return builder;
      }
      if (table === "community_registrations") lecturaHecha = true;
      return original(table);
    }) as typeof client.from;
    mocks.getStaffContext.mockResolvedValue(staffOk(client));

    const estado = await publicarLugar({ status: "idle" }, formulario(FUENTE));

    expect(estado.status).toBe("error");
    expect(
      calls.some((call) => call.table === "community_resources" && call.method === "delete"),
    ).toBe(true);
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });
});
