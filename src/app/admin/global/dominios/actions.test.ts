import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de la gestión de dominios.
 *
 * Lo que fijan, en orden de importancia:
 *  1. AUTORIZACIÓN — nadie que no sea `global_admin` toca un dominio, y el
 *     rechazo pasa ANTES de cualquier escritura (se verifica que la base ni se
 *     haya tocado, no solo que el mensaje sea de error).
 *  2. Que suspender/archivar sea un cambio de estado REAL y auditado con
 *     antes→después: sin eso, el registro no sirve para reconstruir qué pasó.
 *  3. Que el pegado típico ("https://midominio.com/") se limpie en vez de
 *     rebotar. La normalización canónica la hace el trigger de la base; esto
 *     solo evita el error evitable.
 */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(async (_input: { meta?: Record<string, unknown> }) => true),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("../../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
}));

import {
  addTenantDomain,
  setDomainStatus,
  setPrimaryDomain,
  type DomainActionState,
} from "./actions";

const IDLE: DomainActionState = { status: "idle" };

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const DOMAIN_ID = "33333333-3333-4333-8333-333333333333";

interface Write {
  table: string;
  kind: "insert" | "update";
  payload: unknown;
}

/**
 * Stub del cliente de Supabase con la forma exacta que usan estas actions:
 * `.select().eq().maybeSingle()` para leer, `.update().eq()` encadenable y
 * awaitable para escribir, y `.insert().select().single()` para el alta.
 */
function createSupabaseStub(options: {
  existingDomain?: {
    id: string;
    tenant_id: string;
    domain: string;
    status: string;
    is_primary: boolean;
  } | null;
  insertError?: { code: string; message: string };
} = {}) {
  const writes: Write[] = [];
  const existing = options.existingDomain ?? null;

  const updateChain = (table: string, payload: unknown) => {
    writes.push({ table, kind: "update", payload });
    const chain = {
      eq: () => chain,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return chain;
  };

  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: existing, error: null }),
      }),
    }),
    insert: (payload: unknown) => {
      writes.push({ table, kind: "insert", payload });
      return {
        select: () => ({
          single: async () =>
            options.insertError
              ? { data: null, error: options.insertError }
              : {
                  data: {
                    id: DOMAIN_ID,
                    domain: (payload as { domain: string }).domain,
                  },
                  error: null,
                },
        }),
      };
    },
    update: (payload: unknown) => updateChain(table, payload),
  }));

  return { client: { from }, writes };
}

function useGlobalAdmin(stub: { client: unknown }) {
  mocks.getStaffContext.mockImplementation(async (min: string) => {
    if (min !== "global_admin") return null;
    return {
      supabase: stub.client,
      user: { id: USER_ID },
      role: "global_admin",
      tenantId: TENANT_A,
    };
  });
}

/** Nadie: el gate de `global_admin` no devuelve contexto. */
function useNonGlobalAdmin() {
  mocks.getStaffContext.mockResolvedValue(null);
}

function addForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set("tenantId", TENANT_A);
  fd.set("domain", "micomunidad.com");
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("dominios · autorización", () => {
  it("un domain_admin no puede agregar un dominio, y no llega a escribir nada", () => {
    const stub = createSupabaseStub();
    useNonGlobalAdmin();

    return addTenantDomain(IDLE, addForm({})).then((state) => {
      expect(state.status).toBe("error");
      expect(stub.writes).toHaveLength(0);
    });
  });

  it("un domain_admin no puede suspender un dominio ajeno", async () => {
    const stub = createSupabaseStub({
      existingDomain: {
        id: DOMAIN_ID,
        tenant_id: TENANT_B,
        domain: "otracomunidad.com",
        status: "active",
        is_primary: true,
      },
    });
    useNonGlobalAdmin();

    const fd = new FormData();
    fd.set("domainId", DOMAIN_ID);
    fd.set("status", "suspended");

    const state = await setDomainStatus(IDLE, fd);

    expect(state.status).toBe("error");
    expect(stub.writes).toHaveLength(0);
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("un domain_admin no puede cambiar el dominio principal de otra comunidad", async () => {
    const stub = createSupabaseStub({
      existingDomain: {
        id: DOMAIN_ID,
        tenant_id: TENANT_B,
        domain: "otracomunidad.com",
        status: "active",
        is_primary: false,
      },
    });
    useNonGlobalAdmin();

    const fd = new FormData();
    fd.set("domainId", DOMAIN_ID);

    const state = await setPrimaryDomain(IDLE, fd);

    expect(state.status).toBe("error");
    expect(stub.writes).toHaveLength(0);
  });
});

describe("dominios · alta", () => {
  it("guarda el dominio y lo deja auditado", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    const state = await addTenantDomain(IDLE, addForm({}));

    expect(state.status).toBe("success");
    const insert = stub.writes.find((write) => write.kind === "insert");
    expect(insert?.payload).toMatchObject({
      tenant_id: TENANT_A,
      domain: "micomunidad.com",
      status: "active",
      is_primary: false,
    });
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tenant_domain.added", tenantId: TENANT_A }),
    );
  });

  it("limpia el “https://…/” que se pega sin querer", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    const state = await addTenantDomain(IDLE, addForm({ domain: "HTTPS://MiComunidad.com/inicio" }));

    expect(state.status).toBe("success");
    const insert = stub.writes.find((write) => write.kind === "insert");
    expect((insert?.payload as { domain: string }).domain).toBe("micomunidad.com");
  });

  it("un texto que no es un dominio se rechaza con un mensaje entendible", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    const state = await addTenantDomain(IDLE, addForm({ domain: "esto no es un dominio" }));

    expect(state.status).toBe("invalid");
    if (state.status !== "invalid") throw new Error("esperaba invalid");
    expect(state.message).toContain("micomunidad.com");
    expect(stub.writes).toHaveLength(0);
  });

  it("nacer como principal baja al principal anterior ANTES de insertar", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    await addTenantDomain(IDLE, addForm({ isPrimary: "on" }));

    // El orden importa: el índice único no admite dos principales a la vez.
    expect(stub.writes[0]).toMatchObject({ kind: "update", payload: { is_primary: false } });
    expect(stub.writes[1]?.kind).toBe("insert");
  });

  it("un dominio repetido no se disfraza de error técnico", async () => {
    const stub = createSupabaseStub({
      insertError: { code: "23505", message: "duplicate key value" },
    });
    useGlobalAdmin(stub);

    const state = await addTenantDomain(IDLE, addForm({}));

    expect(state.status).toBe("invalid");
    if (state.status !== "invalid") throw new Error("esperaba invalid");
    expect(state.message).toContain("ya está cargado");
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("dominios · activar, suspender y archivar", () => {
  const active = {
    id: DOMAIN_ID,
    tenant_id: TENANT_A,
    domain: "micomunidad.com",
    status: "active",
    is_primary: true,
  };

  it.each(["suspended", "archived", "active"] as const)(
    "acepta el estado %s y lo audita con antes → después",
    async (target) => {
      const stub = createSupabaseStub({ existingDomain: active });
      useGlobalAdmin(stub);

      const fd = new FormData();
      fd.set("domainId", DOMAIN_ID);
      fd.set("status", target);

      const state = await setDomainStatus(IDLE, fd);

      expect(state.status).toBe("success");
      expect(stub.writes).toContainEqual(
        expect.objectContaining({ kind: "update", payload: expect.objectContaining({ status: target }) }),
      );
      expect(mocks.logAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "tenant_domain.status_changed",
          meta: expect.objectContaining({ from: "active", to: target }),
        }),
      );
    },
  );

  it("un estado inventado muere en zod, sin tocar la base", async () => {
    const stub = createSupabaseStub({ existingDomain: active });
    useGlobalAdmin(stub);

    const fd = new FormData();
    fd.set("domainId", DOMAIN_ID);
    fd.set("status", "borrado_total");

    const state = await setDomainStatus(IDLE, fd);

    expect(state.status).toBe("invalid");
    expect(stub.writes).toHaveLength(0);
    expect(mocks.getStaffContext).not.toHaveBeenCalled();
  });

  it("el mensaje de suspender dice que el sitio deja de responder", async () => {
    const stub = createSupabaseStub({ existingDomain: active });
    useGlobalAdmin(stub);

    const fd = new FormData();
    fd.set("domainId", DOMAIN_ID);
    fd.set("status", "suspended");

    const state = await setDomainStatus(IDLE, fd);

    if (state.status !== "success") throw new Error("esperaba éxito");
    expect(state.message).toContain("no va a llegar a la comunidad");
  });

  it("la nota del admin NO viaja al registro de auditoría", async () => {
    // §5.4: el audit_log guarda ids y estados, nunca prosa escrita a mano.
    const stub = createSupabaseStub({ existingDomain: active });
    useGlobalAdmin(stub);

    const fd = new FormData();
    fd.set("domainId", DOMAIN_ID);
    fd.set("status", "suspended");
    fd.set("notes", "lo suspendo porque Fulano no pagó");

    await setDomainStatus(IDLE, fd);

    const call = mocks.logAdminAction.mock.calls[0]?.[0];
    expect(JSON.stringify(call?.meta ?? {})).not.toContain("Fulano");
  });
});
