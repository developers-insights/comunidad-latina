import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del CONTRATO de `compartirEnChatAction`.
 *
 * Bordes mockeados con el patrón del repo (`grupos/actions.test.ts`,
 * `inline-actions.test.ts`): `vi.hoisted` + `vi.mock` + un stub thenable del
 * query builder. No se toca ni Supabase ni la RLS real.
 *
 * QUÉ SE VERIFICA Y QUÉ NO. Acá se verifica lo que ESTA action decide: que zod
 * corte antes de tocar la base, que el techo se cobre por destino, que un
 * destino que falla no cancele a los demás, que la respuesta no filtre CUÁL
 * falló, y que la fila que se inserta respete los CHECK de la 0136. La
 * AUTORIZACIÓN no se testea acá porque no vive acá: vive en las policies de
 * `messages` (0006) y `chat_group_messages` (0133). Lo que sí se verifica es que
 * la action traduzca bien el "no" de la base.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  // Los parámetros van declarados aunque el cuerpo los ignore: sin ellos vitest
  // infiere `calls: []` y leer `calls[0][0]` deja de compilar — que es lo que
  // hace el test del bucket acá abajo.
  limit: vi.fn((_key: string, _max: number, _windowMs: number) => ({
    ok: true,
    remaining: 10,
    retryAfterMs: 0,
  })),
  moderateText: vi.fn(async () => ({
    flagged: false,
    categories: [] as string[],
    score: 0,
    skipped: true,
  })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({
  limit: mocks.limit,
  HOUR_MS: 3_600_000,
  DAY_MS: 86_400_000,
}));
vi.mock("@/lib/moderation", () => ({ moderateText: mocks.moderateText }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn,
}));

import { compartirEnChatAction } from "./compartir-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const OTRA_PERSONA = "88888888-8888-4888-8888-888888888888";
const TERCERA_PERSONA = "77777777-7777-4777-8777-777777777777";
const GRUPO_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSACION_ID = "33333333-3333-4333-8333-333333333333";
const AVISO_ID = "44444444-4444-4444-8444-444444444444";

type OpResult = { data?: unknown; error?: unknown };

type Insertado = { tabla: string; fila: Record<string, unknown> };

/**
 * Stub del query builder. Registra cada insert para poder afirmar sobre la FILA
 * —que es el contrato real con la 0136— y no sólo sobre el valor de retorno.
 */
function crearStub(
  config: {
    /** Error por tabla en el insert. */
    insertError?: Record<string, unknown>;
    /** Respuesta del RPC `solicitar_contacto_directo`. */
    rpc?: OpResult;
    /** Filas que devuelve el chequeo de idempotencia. */
    idempotencia?: unknown[];
  } = {},
) {
  const insertados: Insertado[] = [];
  let insertsFallidos = 0;

  const from = vi.fn((tabla: string) => {
    const builder: Record<string, unknown> = {
      insert: vi.fn((fila: Record<string, unknown>) => {
        const error = config.insertError?.[tabla];
        if (error) {
          insertsFallidos += 1;
          return Promise.resolve({ data: null, error });
        }
        insertados.push({ tabla, fila });
        return Promise.resolve({ data: null, error: null });
      }),
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      limit: vi.fn(() =>
        Promise.resolve({ data: config.idempotencia ?? [], error: null }),
      ),
    };
    return builder;
  });

  const rpc = vi.fn(async () =>
    config.rpc ?? { data: CONVERSACION_ID, error: null },
  );

  return { supabase: { from, rpc }, insertados, from, rpc, get insertsFallidos() {
    return insertsFallidos;
  } };
}

function guardOk(stub: { supabase: unknown }) {
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Comunidad Latina" },
    supabase: stub.supabase,
    user: { id: USER_ID },
  });
}

const ENTRADA_BASE = {
  destinos: [{ tipo: "persona" as const, id: OTRA_PERSONA }],
  compartidoKind: "listing" as const,
  compartidoId: AVISO_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 10, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    categories: [],
    score: 0,
    skipped: true,
  });
});

/* ------------------------------ zod, primero ------------------------------ */

describe("validación antes de tocar la base", () => {
  it("rechaza una lista de destinos vacía sin llamar al guard", async () => {
    const resultado = await compartirEnChatAction({ ...ENTRADA_BASE, destinos: [] });
    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("rechaza un id que no es uuid", async () => {
    const resultado = await compartirEnChatAction({
      ...ENTRADA_BASE,
      compartidoId: "no-soy-un-uuid",
    });
    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("rechaza un compartidoKind fuera del CHECK de la 0136", async () => {
    const resultado = await compartirEnChatAction({
      ...ENTRADA_BASE,
      // @ts-expect-error — justamente lo que zod tiene que frenar en runtime.
      compartidoKind: "cualquier-cosa",
    });
    expect(resultado).toEqual({ ok: false, code: "invalid" });
  });

  it("rechaza más destinos que el tope por envío", async () => {
    const resultado = await compartirEnChatAction({
      ...ENTRADA_BASE,
      destinos: Array.from({ length: 13 }, () => ({
        tipo: "persona" as const,
        id: OTRA_PERSONA,
      })),
    });
    expect(resultado).toEqual({ ok: false, code: "invalid" });
  });

  it("rechaza una nota más larga que el CHECK de body (2000)", async () => {
    const resultado = await compartirEnChatAction({
      ...ENTRADA_BASE,
      nota: "x".repeat(2001),
    });
    expect(resultado).toEqual({ ok: false, code: "invalid" });
  });
});

/* --------------------------------- guard --------------------------------- */

describe("guard y techo", () => {
  it("sin sesión devuelve unauthenticated y no escribe", async () => {
    const stub = crearStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      supabase: stub.supabase,
      user: null,
    });
    const resultado = await compartirEnChatAction(ENTRADA_BASE);
    expect(resultado).toEqual({ ok: false, code: "unauthenticated" });
    expect(stub.insertados).toHaveLength(0);
  });

  it("con divergencia de comunidad devuelve tenant-mismatch y no escribe", async () => {
    const stub = crearStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "tenant-mismatch",
      supabase: stub.supabase,
      user: { id: USER_ID },
    });
    const resultado = await compartirEnChatAction(ENTRADA_BASE);
    expect(resultado).toEqual({ ok: false, code: "tenant-mismatch" });
    expect(stub.insertados).toHaveLength(0);
  });

  it("cobra el techo UNA VEZ POR DESTINO, no una por envío", async () => {
    const stub = crearStub();
    guardOk(stub);
    await compartirEnChatAction({
      ...ENTRADA_BASE,
      destinos: [
        { tipo: "persona", id: OTRA_PERSONA },
        { tipo: "persona", id: TERCERA_PERSONA },
        { tipo: "grupo", id: GRUPO_ID },
      ],
    });
    expect(mocks.limit).toHaveBeenCalledTimes(3);
    // Y con el MISMO bucket que el chat 1-a-1 y los grupos: si fueran distintos,
    // el techo real de la persona sería el doble.
    expect(mocks.limit.mock.calls[0][0]).toBe(`mensaje:${USER_ID}`);
  });

  it("con el techo agotado no escribe nada", async () => {
    const stub = crearStub();
    guardOk(stub);
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });
    const resultado = await compartirEnChatAction(ENTRADA_BASE);
    expect(resultado).toEqual({ ok: false, code: "rate-limited" });
    expect(stub.insertados).toHaveLength(0);
  });

  it("una nota marcada por moderación frena el envío entero", async () => {
    const stub = crearStub();
    guardOk(stub);
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      categories: ["harassment"],
      score: 1,
      skipped: false,
    });
    const resultado = await compartirEnChatAction({ ...ENTRADA_BASE, nota: "algo feo" });
    expect(resultado).toEqual({ ok: false, code: "flagged" });
    expect(stub.insertados).toHaveLength(0);
  });

  it("sin nota no se llama a moderación (la tarjeta ya se moderó al publicarse)", async () => {
    const stub = crearStub();
    guardOk(stub);
    await compartirEnChatAction(ENTRADA_BASE);
    expect(mocks.moderateText).not.toHaveBeenCalled();
  });
});

/* ---------------------------- la fila que se escribe ---------------------- */

describe("la fila cumple el contrato de la 0136", () => {
  it("a una persona: kind 'contenido', las dos columnas de compartido y body vacío", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await compartirEnChatAction(ENTRADA_BASE);

    expect(resultado).toEqual({ ok: true, enviados: 1, fallidos: 0 });
    expect(stub.rpc).toHaveBeenCalledWith("solicitar_contacto_directo", {
      p_profile_id: OTRA_PERSONA,
    });
    expect(stub.insertados).toEqual([
      {
        tabla: "messages",
        fila: {
          tenant_id: TENANT_ID,
          sender_id: USER_ID,
          conversation_id: CONVERSACION_ID,
          kind: "contenido",
          compartido_kind: "listing",
          compartido_id: AVISO_ID,
          body: "",
        },
      },
    ]);
  });

  it("a un grupo: la MISMA fila, cambiando sólo la columna de destino", async () => {
    const stub = crearStub();
    guardOk(stub);

    await compartirEnChatAction({
      ...ENTRADA_BASE,
      destinos: [{ tipo: "grupo", id: GRUPO_ID }],
    });

    expect(stub.insertados[0]).toEqual({
      tabla: "chat_group_messages",
      fila: {
        tenant_id: TENANT_ID,
        sender_id: USER_ID,
        group_id: GRUPO_ID,
        kind: "contenido",
        compartido_kind: "listing",
        compartido_id: AVISO_ID,
        body: "",
      },
    });
    // Compartir a un grupo NO abre una conversación 1-a-1.
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("un perfil viaja con kind 'perfil', que es lo que exige el CHECK", async () => {
    const stub = crearStub();
    guardOk(stub);

    await compartirEnChatAction({
      ...ENTRADA_BASE,
      compartidoKind: "profile",
      compartidoId: TERCERA_PERSONA,
    });

    expect(stub.insertados[0].fila).toMatchObject({
      kind: "perfil",
      compartido_kind: "profile",
      compartido_id: TERCERA_PERSONA,
    });
  });

  it("la nota se recorta y viaja como body", async () => {
    const stub = crearStub();
    guardOk(stub);

    await compartirEnChatAction({ ...ENTRADA_BASE, nota: "  mirá esto  " });

    expect(stub.insertados[0].fila.body).toBe("mirá esto");
  });
});

/* ------------------------- varios destinos a la vez ----------------------- */

describe("varios destinos", () => {
  it("manda a personas y grupos en el mismo envío", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await compartirEnChatAction({
      ...ENTRADA_BASE,
      destinos: [
        { tipo: "persona", id: OTRA_PERSONA },
        { tipo: "grupo", id: GRUPO_ID },
      ],
    });

    expect(resultado).toEqual({ ok: true, enviados: 2, fallidos: 0 });
    expect(stub.insertados.map((i) => i.tabla)).toEqual([
      "messages",
      "chat_group_messages",
    ]);
  });

  it("un destino repetido en la misma tanda se colapsa en uno", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await compartirEnChatAction({
      ...ENTRADA_BASE,
      destinos: [
        { tipo: "persona", id: OTRA_PERSONA },
        { tipo: "persona", id: OTRA_PERSONA },
      ],
    });

    expect(resultado).toEqual({ ok: true, enviados: 1, fallidos: 0 });
    expect(stub.insertados).toHaveLength(1);
  });

  it("un destino que la base rechaza NO cancela a los demás", async () => {
    // 42501: no soy miembro del grupo, o el grupo está cerrado.
    const stub = crearStub({ insertError: { chat_group_messages: { code: "42501" } } });
    guardOk(stub);

    const resultado = await compartirEnChatAction({
      ...ENTRADA_BASE,
      destinos: [
        { tipo: "persona", id: OTRA_PERSONA },
        { tipo: "grupo", id: GRUPO_ID },
      ],
    });

    expect(resultado).toEqual({ ok: true, enviados: 1, fallidos: 1 });
    // La persona SÍ lo recibió.
    expect(stub.insertados.map((i) => i.tabla)).toEqual(["messages"]);
  });

  it("la respuesta cuenta pero NO dice CUÁL destino falló", async () => {
    const stub = crearStub({ insertError: { chat_group_messages: { code: "42501" } } });
    guardOk(stub);

    const resultado = await compartirEnChatAction({
      ...ENTRADA_BASE,
      destinos: [
        { tipo: "persona", id: OTRA_PERSONA },
        { tipo: "grupo", id: GRUPO_ID },
      ],
    });

    // Nada en la respuesta permite deducir un bloqueo: sólo dos números.
    expect(Object.keys(resultado).sort()).toEqual(["enviados", "fallidos", "ok"]);
    expect(JSON.stringify(resultado)).not.toContain(GRUPO_ID);
    expect(JSON.stringify(resultado)).not.toContain(OTRA_PERSONA);
  });

  it("si NINGUNO sale, es un error y no un ok con cero", async () => {
    const stub = crearStub({ insertError: { messages: { code: "42501" } } });
    guardOk(stub);

    const resultado = await compartirEnChatAction(ENTRADA_BASE);
    expect(resultado).toEqual({ ok: false, code: "error" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("si el RPC no puede abrir la conversación, ese destino falla solo", async () => {
    const stub = crearStub({ rpc: { data: null, error: { code: "P0001" } } });
    guardOk(stub);

    const resultado = await compartirEnChatAction(ENTRADA_BASE);
    expect(resultado).toEqual({ ok: false, code: "error" });
    expect(stub.insertados).toHaveLength(0);
  });
});

/* ------------------------------ idempotencia ------------------------------ */

describe("idempotencia", () => {
  it("no vuelve a insertar lo mismo si ya está en el chat hace un minuto", async () => {
    const stub = crearStub({ idempotencia: [{ id: "ya-existe" }] });
    guardOk(stub);

    const resultado = await compartirEnChatAction(ENTRADA_BASE);

    // Cuenta como enviado —desde donde mira la persona, LO ESTÁ— pero no se
    // duplica la tarjeta en el hilo.
    expect(resultado).toEqual({ ok: true, enviados: 1, fallidos: 0 });
    expect(stub.insertados).toHaveLength(0);
  });
});

/* --------------------- respaldo sin la migración aplicada ----------------- */

describe("entorno sin la 0136 aplicada", () => {
  /**
   * El respaldo arma la URL con `NEXT_PUBLIC_SITE_URL`, que se lee al ejecutar.
   * Se setea acá y sólo acá para no filtrarla al resto del run.
   */
  const SITIO_PREVIO = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://comunidadlatina.com";
  });
  afterAll(() => {
    if (SITIO_PREVIO === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = SITIO_PREVIO;
  });

  function stubQueRebotaLaPrimeraVez() {
    let primerIntento = true;
    const insertados: Insertado[] = [];
    const from = vi.fn((tabla: string) => {
      const builder: Record<string, unknown> = {
        insert: vi.fn((fila: Record<string, unknown>) => {
          if (primerIntento) {
            primerIntento = false;
            return Promise.resolve({
              data: null,
              error: { code: "PGRST204", message: "column not found" },
            });
          }
          insertados.push({ tabla, fila });
          return Promise.resolve({ data: null, error: null });
        }),
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        gte: vi.fn(() => builder),
        limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
      };
      return builder;
    });
    const supabase = {
      from,
      rpc: vi.fn(async () => ({ data: CONVERSACION_ID, error: null })),
    };
    return { supabase, insertados };
  }

  it("PGRST204 no pierde el mensaje: reintenta con el enlace como cuerpo", async () => {
    const stub = stubQueRebotaLaPrimeraVez();
    guardOk(stub);

    const resultado = await compartirEnChatAction(ENTRADA_BASE);

    expect(resultado).toEqual({ ok: true, enviados: 1, fallidos: 0 });
    expect(stub.insertados).toHaveLength(1);
    const fila = stub.insertados[0].fila;
    // Sin columnas nuevas: nada de kind/compartido_*, y el cuerpo es el enlace —
    // que la otra punta pinta con LA MISMA tarjeta vía `enlaceInternoDelCuerpo`.
    expect(fila).not.toHaveProperty("compartido_kind");
    expect(fila).not.toHaveProperty("kind");
    expect(String(fila.body)).toContain(`/marketplace/${AVISO_ID}`);
  });

  it("la nota sobrevive al respaldo, arriba del enlace", async () => {
    const stub = stubQueRebotaLaPrimeraVez();
    guardOk(stub);

    await compartirEnChatAction({ ...ENTRADA_BASE, nota: "mirá esto" });

    expect(String(stub.insertados[0].fila.body)).toBe(
      `mirá esto\nhttps://comunidadlatina.com/marketplace/${AVISO_ID}`,
    );
  });

  it("sin NEXT_PUBLIC_SITE_URL el envío falla en vez de mandar una burbuja vacía", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const stub = stubQueRebotaLaPrimeraVez();
    guardOk(stub);

    const resultado = await compartirEnChatAction(ENTRADA_BASE);

    expect(resultado).toEqual({ ok: false, code: "error" });
    expect(stub.insertados).toHaveLength(0);
  });
});
