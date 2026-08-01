import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del alta de cuenta (registerAction).
 *
 * Garantía central de la confirmación de cuenta: la cuenta YA NO nace
 * confirmada. Antes se creaba con `email_confirm: true` y se iniciaba sesión en
 * el acto, así que el correo de verificación no existía como paso.
 *
 * También cubre que el onboarding se persista en el alta: como no hay sesión
 * hasta confirmar, las respuestas del wizard (necesidades + zona) no pueden
 * escribirse después por RLS — o se guardan acá con el admin client, o se
 * pierden.
 *
 * Bordes mockeados: headers, rate limit, tenant, admin client y el envío del
 * correo. No se toca Supabase ni Resend.
 */

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  insert: vi.fn(),
  upsert: vi.fn(),
  maybeSingle: vi.fn(),
  sendConfirmationEmail: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "comunidad.test", "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  limit: mocks.limit,
  HOUR_MS: 3_600_000,
  clientIpFromHeaders: () => "1.2.3.4",
}));
vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({
    id: "tenant-1",
    name: "Dominicanos en Chile",
    brandHex: "#123456",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
    from: (table: string) => ({
      insert: (row: unknown) => mocks.insert(table, row),
      upsert: (row: unknown, opts: unknown) => mocks.upsert(table, row, opts),
      select: () => ({
        eq: () => ({ maybeSingle: () => mocks.maybeSingle(table) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth/confirmation", () => ({
  sendConfirmationEmail: mocks.sendConfirmationEmail,
  resendConfirmationForCredentials: vi.fn(),
}));

import { registerAction } from "./actions";

const VALID = {
  displayName: "Rosa Martínez",
  email: "Rosa@Ejemplo.com ",
  password: "una-contrasena",
  ageConfirmed: true,
  termsAccepted: true,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  mocks.createUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.maybeSingle.mockResolvedValue({ data: { country_focus: "DO" }, error: null });
  mocks.sendConfirmationEmail.mockResolvedValue({ ok: true });
});

describe("registerAction", () => {
  it("crea la cuenta SIN confirmar y manda el correo de confirmación", async () => {
    const result = await registerAction({ ...VALID });

    expect(result).toEqual({ ok: true });
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "rosa@ejemplo.com",
        email_confirm: false,
        app_metadata: { tenant_id: "tenant-1", role: "member" },
      }),
    );
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "rosa@ejemplo.com",
        origin: "https://comunidad.test",
        next: "/bienvenida",
      }),
    );
  });

  it("guarda las respuestas del onboarding en el alta", async () => {
    await registerAction({
      ...VALID,
      needs: ["vivienda", "trabajo"],
      area: "  Ñuñoa  ",
      next: "/propiedades?zona=Ñuñoa",
    });

    const [table, row] = mocks.insert.mock.calls[0];
    expect(table).toBe("profiles");
    expect(row).toMatchObject({
      id: "user-1",
      area_label: "Ñuñoa",
      // El país de origen se hereda del país foco de la comunidad.
      country_origin: "DO",
    });

    const [privateTable, privateRow] = mocks.upsert.mock.calls[0];
    expect(privateTable).toBe("profiles_private");
    expect(privateRow).toMatchObject({
      profile_id: "user-1",
      needs: ["vivienda", "trabajo"],
    });

    expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ next: "/propiedades?zona=Ñuñoa" }),
    );
  });

  it("sanea el next del correo (nada de open redirect)", async () => {
    await registerAction({ ...VALID, next: "https://malo.com" });

    expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ next: "/bienvenida" }),
    );
  });

  it("sin zona no toca country_origin ni consulta el país de la comunidad", async () => {
    await registerAction({ ...VALID });

    expect(mocks.maybeSingle).not.toHaveBeenCalled();
    const [, row] = mocks.insert.mock.calls[0];
    expect(row).not.toHaveProperty("area_label");
    expect(row).not.toHaveProperty("country_origin");
  });

  it("si el perfil no se puede escribir, borra el usuario huérfano", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "23505" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await registerAction({ ...VALID });

    expect(result.ok).toBe(false);
    expect(mocks.deleteUser).toHaveBeenCalledWith("user-1");
    expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it("el correo caído NO invalida el alta (la cuenta ya existe)", async () => {
    mocks.sendConfirmationEmail.mockResolvedValue({ ok: false, reason: "email" });

    expect(await registerAction({ ...VALID })).toEqual({ ok: true });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
