import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * EL ESPEJO DE `profiles.email_verified`
 * =============================================================================
 *
 * Lo que se fija acá es lo que hace que el requisito "correo verificado" del
 * gate de creador (0064) deje de ser imposible de cumplir:
 *
 *  1. Se escribe cuando —y SOLO cuando— Supabase Auth ya confirmó el correo.
 *     Un usuario sin `email_confirmed_at` no toca la base: marcar el espejo por
 *     el solo hecho de pasar por la ruta sería inventar una verificación.
 *  2. Un error de la base NO lanza. Confirmar el correo no puede romperse
 *     porque falló el update de una columna derivada — pero el fallo se loguea,
 *     no se traga en silencio.
 *  3. Es idempotente: el filtro `email_verified = false` hace que la segunda
 *     llamada no matchee ninguna fila.
 *  4. Se escribe con el ADMIN client. La guarda `protect_profile_privileges`
 *     (0030) rechaza esta columna desde cualquier JWT de usuario, así que el
 *     cliente de sesión no es una alternativa: es un fallo garantizado.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { isEmailConfirmed, syncEmailVerified } from "./email-verified";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface UpdateCall {
  payload: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

/** Stub encadenable: `.update(...).eq(...).eq(...)` termina en `{ error }`. */
function createAdminStub(options: { error?: { message: string } } = {}) {
  const updates: UpdateCall[] = [];
  const from = vi.fn((table: string) => ({
    update: (payload: Record<string, unknown>) => {
      const call: UpdateCall = { payload: { ...payload, __table: table }, filters: [] };
      updates.push(call);
      const chain = {
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return chain;
        },
        then(resolve: (value: { error: { message: string } | null }) => unknown) {
          return Promise.resolve({ error: options.error ?? null }).then(resolve);
        },
      };
      return chain;
    },
  }));
  return { client: { from }, updates, from };
}

function confirmedUser() {
  return { id: USER_ID, email_confirmed_at: "2026-08-12T10:00:00.000Z" };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isEmailConfirmed", () => {
  it("solo dice que sí cuando Auth dejó una marca de confirmación", () => {
    expect(isEmailConfirmed(confirmedUser())).toBe(true);
    expect(isEmailConfirmed({ id: USER_ID, confirmed_at: "2026-08-12T10:00:00.000Z" })).toBe(true);
    expect(isEmailConfirmed({ id: USER_ID })).toBe(false);
    expect(isEmailConfirmed({ id: USER_ID, email_confirmed_at: null })).toBe(false);
    expect(isEmailConfirmed(null)).toBe(false);
    expect(isEmailConfirmed(undefined)).toBe(false);
  });
});

describe("syncEmailVerified — cuándo escribe", () => {
  it("escribe cuando el correo está confirmado", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);

    await expect(syncEmailVerified(confirmedUser())).resolves.toBe(true);

    expect(stub.from).toHaveBeenCalledWith("profiles");
    expect(stub.updates).toHaveLength(1);
    expect(stub.updates[0].payload).toMatchObject({ email_verified: true });
    // El id sale del usuario ya verificado, y el update se acota a esa fila.
    expect(stub.updates[0].filters).toContainEqual(["id", USER_ID]);
  });

  it("NO escribe si Auth todavía no confirmó el correo", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);

    await expect(syncEmailVerified({ id: USER_ID })).resolves.toBe(false);
    await expect(syncEmailVerified({ id: USER_ID, email_confirmed_at: null })).resolves.toBe(false);

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(stub.updates).toHaveLength(0);
  });

  it("sin usuario no hace nada", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);

    await expect(syncEmailVerified(null)).resolves.toBe(false);
    await expect(syncEmailVerified(undefined)).resolves.toBe(false);

    expect(stub.updates).toHaveLength(0);
  });
});

describe("syncEmailVerified — robustez", () => {
  it("un error de la base no lanza: devuelve false y lo deja escrito en el log", async () => {
    const stub = createAdminStub({ error: { message: "connection reset" } });
    mocks.createAdminClient.mockReturnValue(stub.client);

    await expect(syncEmailVerified(confirmedUser())).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("si el admin client no está configurado tampoco lanza", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("Cliente admin de Supabase no configurado.");
    });

    await expect(syncEmailVerified(confirmedUser())).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("syncEmailVerified — idempotencia", () => {
  it("dos llamadas seguidas no lanzan y filtran siempre por email_verified = false", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);

    await expect(syncEmailVerified(confirmedUser())).resolves.toBe(true);
    await expect(syncEmailVerified(confirmedUser())).resolves.toBe(true);

    expect(stub.updates).toHaveLength(2);
    for (const call of stub.updates) {
      // Sin este filtro, cada visita al enlace reescribiría una fila que ya
      // estaba bien — y dispararía de nuevo el recálculo de score de la 0037.
      expect(call.filters).toContainEqual(["email_verified", false]);
    }
  });
});
