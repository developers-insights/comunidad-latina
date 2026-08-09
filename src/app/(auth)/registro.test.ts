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
  // `resolveOrigin()` lo consulta para decidir si el host del request es NUESTRO
  // antes de meterlo en la URL del correo (ver origin.ts). Acá se declara el
  // host que mockean los headers de arriba, así el alta corre por el camino
  // legítimo. El rechazo de un host ajeno se prueba en origin.test.ts.
  KNOWN_TENANT_DOMAINS: new Set(["comunidad.test"]),
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
  displayName: "Rosa",
  lastName: "Martínez",
  username: "rosa.martinez",
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
      // Percent-encoded: `safeInternalPath` devuelve la ruta ya normalizada por
      // el parser de URL, que es la forma correcta para viajar en un enlace.
      // Al volver, `searchParams.get("next")` la decodifica sola.
      expect.objectContaining({ next: "/propiedades?zona=%C3%91u%C3%B1oa" }),
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

/**
 * ── LOS CAMPOS QUE SUMÓ EL PLIEGO ───────────────────────────────────────────
 * El alta creció exactamente dos campos: apellido y nombre de usuario. El resto
 * (fecha de nacimiento, país de residencia, ciudad, idiomas, portada) se
 * completa después desde el perfil — la justificación está en el comentario de
 * `registerSchema`. Estos tests fijan las dos decisiones que importan:
 *
 *   · el APELLIDO va a `profiles_private` y NUNCA a `profiles` — si alguien lo
 *     mueve "para simplificar", queda legible por cualquier autenticado sin
 *     importar los controles de privacidad, porque RLS filtra filas y no
 *     columnas;
 *   · el HANDLE es único POR TENANT, no global.
 */
describe("registerAction — apellido y nombre de usuario", () => {
  it("el apellido va a profiles_private, nunca a profiles", async () => {
    await registerAction({ ...VALID });

    const [table, row] = mocks.insert.mock.calls[0];
    expect(table).toBe("profiles");
    expect(row).not.toHaveProperty("last_name");

    const [privateTable, privateRow] = mocks.upsert.mock.calls[0];
    expect(privateTable).toBe("profiles_private");
    expect(privateRow).toMatchObject({ profile_id: "user-1", last_name: "Martínez" });
  });

  it("el handle se guarda normalizado (minúsculas y sin espacios)", async () => {
    await registerAction({ ...VALID, username: "  Rosa.Martinez  " });

    const [, row] = mocks.insert.mock.calls[0];
    expect(row).toMatchObject({ username: "rosa.martinez" });
  });

  it("rechaza un handle con formato inválido sin tocar la base", async () => {
    const result = await registerAction({ ...VALID, username: "rosa martinez" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.username).toBeTruthy();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("rechaza un handle que empieza con punto", async () => {
    const result = await registerAction({ ...VALID, username: ".rosa" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.username).toContain("punto");
  });

  /**
   * EL CASO CENTRAL: handle duplicado DENTRO del tenant.
   *
   * La unicidad la aplica `profiles_username_tenant_uniq` (0062) y llega como
   * `23505` con el nombre del índice en el detalle. Tiene que volver como error
   * DEL CAMPO —no como "algo salió mal"— o la persona reintenta el mismo handle
   * para siempre. Y el usuario de auth se borra: sin fila de perfil quedaría
   * huérfano.
   */
  it("handle ya tomado en ESTE tenant → error en el campo, y no queda usuario huérfano", async () => {
    mocks.insert.mockResolvedValue({
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_username_tenant_uniq"',
        details: "Key (tenant_id, username)=(tenant-1, rosa.martinez) already exists.",
      },
    });

    const result = await registerAction({ ...VALID });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.username).toContain("ya está en uso");
    // No es un error de sistema: no se ensucia el log con algo que es de uso normal.
    expect(mocks.deleteUser).toHaveBeenCalledWith("user-1");
    expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  /**
   * EL MISMO handle en OTRO tenant SÍ se acepta. Con el índice global que tenía
   * 0030 esto era imposible y el producto white-label quedaba roto: la misma
   * persona no podía estar en dominicanos.com y en comunidadlatina.com.
   *
   * Acá se prueba lo que la APP hace con esa realidad: el insert del otro tenant
   * no choca (la base no devuelve 23505 porque el par (tenant_id, username) es
   * distinto) y el alta sale bien con el mismo handle.
   */
  it("el MISMO handle en otro tenant se acepta", async () => {
    // La base no devuelve conflicto: el índice es (tenant_id, username).
    mocks.insert.mockResolvedValue({ error: null });

    const result = await registerAction({ ...VALID });

    expect(result).toEqual({ ok: true });
    const [, row] = mocks.insert.mock.calls[0];
    expect(row).toMatchObject({ username: "rosa.martinez", tenant_id: "tenant-1" });
  });

  it("un 23505 que NO es del handle no se disfraza de handle tomado", async () => {
    mocks.insert.mockResolvedValue({
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_pkey"',
        details: "Key (id)=(user-1) already exists.",
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await registerAction({ ...VALID });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.username).toBeUndefined();
    expect(result.ok === false && result.formError).toBeTruthy();
  });
});
