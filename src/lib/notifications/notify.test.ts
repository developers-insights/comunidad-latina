import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { createNotification } from "./notify";

/**
 * El emisor, contra un doble de PostgREST.
 *
 * No es un test de integración: lo que se verifica es el CONTRATO que la base no
 * puede hacer cumplir sola — a quién se le consulta preferencias, cuándo se
 * actualiza la fila viva de un `group_key` en vez de insertar otra, y que la
 * categoría nunca viaje vacía.
 */

type QueryCall = {
  table: string;
  op: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: [string, unknown][];
};

type Responses = {
  prefs?: { data: unknown; error: unknown };
  liveGroup?: { data: unknown; error: unknown };
  dedupe?: { data: unknown; error: unknown };
  update?: { error: unknown };
  insert?: { error: unknown };
};

function makeAdmin(responses: Responses = {}) {
  const calls: QueryCall[] = [];

  const client = {
    from(table: string) {
      const call: QueryCall = { table, op: "select", filters: [] };

      const result = () => {
        if (table === "notification_prefs") return responses.prefs ?? { data: null, error: null };
        const grouped = call.filters.some(([column]) => column === "group_key");
        if (grouped) return responses.liveGroup ?? { data: null, error: null };
        return responses.dedupe ?? { data: null, error: null };
      };

      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        is: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        gt: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          calls.push(call);
          return Promise.resolve(result());
        },
        insert: (row: Record<string, unknown>) => {
          call.op = "insert";
          call.payload = row;
          calls.push(call);
          return Promise.resolve(responses.insert ?? { error: null });
        },
        update: (patch: Record<string, unknown>) => {
          call.op = "update";
          call.payload = patch;
          return chain;
        },
        // La cadena es "thenable": `await admin.from(x).update(y).eq(...)`.
        then: (resolve: (value: unknown) => unknown) => {
          calls.push(call);
          return Promise.resolve(responses.update ?? { error: null }).then(resolve);
        },
      };

      return chain;
    },
  };

  return { admin: client as unknown as SupabaseClient<Database>, calls };
}

const BASE = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  profileId: "22222222-2222-4222-8222-222222222222",
  title: "Algo pasó",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("categoría y prioridad", () => {
  it("las deduce del kind cuando el caller no las manda", async () => {
    const { admin, calls } = makeAdmin();
    await createNotification(admin, { ...BASE, kind: "message" });

    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.payload?.category).toBe("mensajes");
    expect(insert?.payload?.priority).toBe("normal");
  });

  it("la explícita gana sobre el mapa", async () => {
    const { admin, calls } = makeAdmin();
    await createNotification(admin, {
      ...BASE,
      kind: "message",
      category: "plataforma",
      priority: "high",
    });

    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.payload?.category).toBe("plataforma");
    expect(insert?.payload?.priority).toBe("high");
  });

  it("un kind sin mapear NUNCA inserta la categoría vacía", async () => {
    const { admin, calls } = makeAdmin();
    await createNotification(admin, { ...BASE, kind: "kind_nuevo_sin_mapear" });

    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.payload?.category).toBe("social");
  });
});

describe("preferencias", () => {
  it("no emite si la persona apagó la categoría", async () => {
    const { admin, calls } = makeAdmin({
      prefs: {
        data: {
          category: "social",
          in_app: true,
          email: true,
          push: false,
          frequency: "off",
        },
        error: null,
      },
    });

    const outcome = await createNotification(admin, { ...BASE, kind: "follow" });

    expect(outcome).toEqual({ ok: true, muted: true });
    expect(calls.some((call) => call.op === "insert")).toBe(false);
  });

  it("con 'sólo importantes' deja pasar una high y frena una normal", async () => {
    const prefs = {
      data: { category: "trabajos", in_app: true, email: true, push: false, frequency: "important" },
      error: null,
    };

    const frenada = makeAdmin({ prefs });
    await createNotification(frenada.admin, {
      ...BASE,
      kind: "algo_normal",
      category: "trabajos",
      priority: "normal",
    });
    expect(frenada.calls.some((call) => call.op === "insert")).toBe(false);

    const pasa = makeAdmin({ prefs });
    await createNotification(pasa.admin, {
      ...BASE,
      kind: "job_application",
      category: "trabajos",
    });
    expect(pasa.calls.some((call) => call.op === "insert")).toBe(true);
  });

  it("las tres categorías críticas NI SIQUIERA consultan preferencias", async () => {
    for (const category of ["seguridad", "pagos", "cuenta"] as const) {
      const { admin, calls } = makeAdmin({
        prefs: {
          data: { category, in_app: false, email: false, push: false, frequency: "off" },
          error: null,
        },
      });

      await createNotification(admin, { ...BASE, kind: "security_alert", category });

      expect(calls.some((call) => call.table === "notification_prefs")).toBe(false);
      expect(calls.some((call) => call.op === "insert")).toBe(true);
    }
  });

  it("si la lectura de preferencias falla, entrega igual", async () => {
    const { admin, calls } = makeAdmin({
      prefs: { data: null, error: { message: "timeout" } },
    });

    await createNotification(admin, { ...BASE, kind: "follow" });
    expect(calls.some((call) => call.op === "insert")).toBe(true);
  });

  it("`ignorePrefs` saltea la consulta entera", async () => {
    const { admin, calls } = makeAdmin({
      prefs: {
        data: { category: "publicidad", in_app: true, email: true, push: false, frequency: "off" },
        error: null,
      },
    });

    await createNotification(admin, {
      ...BASE,
      kind: "boost",
      category: "publicidad",
      ignorePrefs: true,
    });

    expect(calls.some((call) => call.table === "notification_prefs")).toBe(false);
    expect(calls.some((call) => call.op === "insert")).toBe(true);
  });
});

describe("agrupación por group_key", () => {
  it("con fila viva ACTUALIZA y no inserta otra", async () => {
    const { admin, calls } = makeAdmin({
      liveGroup: { data: { id: "abc" }, error: null },
    });

    const outcome = await createNotification(admin, {
      ...BASE,
      kind: "follow",
      title: "María, José y 18 personas más te empezaron a seguir",
      group: { subjectKind: "profile", subjectId: BASE.profileId },
    });

    expect(outcome).toEqual({ ok: true, grouped: true });
    expect(calls.some((call) => call.op === "insert")).toBe(false);

    const update = calls.find((call) => call.op === "update");
    expect(update?.payload?.title).toContain("18 personas más");
    // `created_at` se mueve para que la fila vuelva arriba de la bandeja…
    expect(update?.payload?.created_at).toBeTypeOf("string");
    // …y `expires_at` NO se toca: el TTL de 60 días no se renueva por actividad.
    expect(update?.payload).not.toHaveProperty("expires_at");
  });

  it("busca la fila viva con los cuatro filtros del contrato", async () => {
    const { admin, calls } = makeAdmin({ liveGroup: { data: { id: "abc" }, error: null } });

    await createNotification(admin, {
      ...BASE,
      kind: "follow",
      group: { subjectKind: "profile", subjectId: BASE.profileId },
    });

    const lookup = calls.find((call) => call.filters.some(([column]) => column === "group_key"));
    const filters = Object.fromEntries(lookup?.filters ?? []);
    expect(filters.group_key).toBe(`follow:profile:${BASE.profileId}`);
    expect(filters.read_at).toBeNull();
    expect(filters.dismissed_at).toBeNull();
    expect(filters.profile_id).toBe(BASE.profileId);
  });

  it("sin fila viva inserta una nueva CON su group_key", async () => {
    const { admin, calls } = makeAdmin({ liveGroup: { data: null, error: null } });

    await createNotification(admin, {
      ...BASE,
      kind: "follow",
      group: { subjectKind: "profile", subjectId: BASE.profileId },
    });

    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.payload?.group_key).toBe(`follow:profile:${BASE.profileId}`);
  });

  it("una notificación común guarda group_key en null", async () => {
    const { admin, calls } = makeAdmin();
    await createNotification(admin, { ...BASE, kind: "message" });

    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.payload?.group_key).toBeNull();
  });
});

describe("dedupe", () => {
  it("no repite una notificación del mismo kind+href que sigue sin leer", async () => {
    const { admin, calls } = makeAdmin({ dedupe: { data: { id: "ya-existe" }, error: null } });

    const outcome = await createNotification(admin, {
      ...BASE,
      kind: "message",
      href: "/mensajes/1",
      dedupeUnread: true,
    });

    expect(outcome).toEqual({ ok: true, deduped: true });
    expect(calls.some((call) => call.op === "insert")).toBe(false);
  });

  it("una descartada NO bloquea la siguiente (se filtra dismissed_at)", async () => {
    const { admin, calls } = makeAdmin({ dedupe: { data: null, error: null } });

    await createNotification(admin, {
      ...BASE,
      kind: "message",
      href: "/mensajes/1",
      dedupeUnread: true,
    });

    const lookup = calls.find((call) => call.op === "select" && call.table === "notifications");
    const filters = Object.fromEntries(lookup?.filters ?? []);
    expect(filters.dismissed_at).toBeNull();
    expect(calls.some((call) => call.op === "insert")).toBe(true);
  });
});

describe("nunca rompe el flujo principal", () => {
  it("un insert fallido devuelve ok:false en vez de lanzar", async () => {
    const { admin } = makeAdmin({ insert: { error: { message: "boom" } } });

    const outcome = await createNotification(admin, { ...BASE, kind: "message" });
    expect(outcome).toEqual({ ok: false, error: "boom" });
  });

  it("una excepción inesperada también se devuelve como resultado", async () => {
    const explota = {
      from() {
        throw new Error("la red se cayó");
      },
    } as unknown as SupabaseClient<Database>;

    const outcome = await createNotification(explota, { ...BASE, kind: "message" });
    expect(outcome.ok).toBe(false);
  });
});
