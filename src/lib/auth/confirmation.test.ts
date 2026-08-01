import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de la confirmación de cuenta (lib/auth/confirmation.ts).
 *
 * Garantías cubiertas:
 *  - El enlace del correo apunta a NUESTRA ruta /confirmar con el `token_hash`
 *    minteado por la Admin API — nunca al `action_link` de Supabase, que
 *    redirige al Site URL del proyecto (hoy localhost) y rompería en producción.
 *  - El `next` viaja en el enlace, así que la persona aterriza donde estaba.
 *  - Sin Resend configurado no se manda nada (dev) y la cuenta no queda rota:
 *    el enlace se loguea en el server.
 *  - El reenvío SOLO manda correo cuando las credenciales son válidas y la
 *    cuenta está sin confirmar. Con contraseña incorrecta o cuenta ya
 *    confirmada no manda nada — si no, sería una forma de mandarle correos a
 *    direcciones ajenas escribiéndolas en un formulario.
 *
 * Bordes mockeados: el admin client de Supabase, el envío de Resend y el
 * cliente anónimo. Nunca se toca Supabase ni Resend de verdad.
 */

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  isResendConfigured: { value: true },
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/config/services", () => ({
  get isResendConfigured() {
    return mocks.isResendConfigured.value;
  },
  isSentryConfigured: false,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }),
}));

import {
  sendConfirmationEmail,
  resendConfirmationForCredentials,
} from "./confirmation";

const BASE = {
  email: "rosa@ejemplo.com",
  password: "una-contrasena",
  displayName: "Rosa",
  tenantName: "Dominicanos en Chile",
  brandHex: "#123456",
  origin: "https://comunidad-latina-sigma.vercel.app",
};

/** Saca el href de confirmación del HTML del correo (o del log en dev). */
function confirmUrlFromHtml(html: string): URL {
  const match = html.match(/https:\/\/[^"]*\/confirmar[^"]*/);
  if (!match) throw new Error("el correo no trae enlace a /confirmar");
  return new URL(match[0].replaceAll("&amp;", "&"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isResendConfigured.value = true;
  mocks.createAdminClient.mockReturnValue({
    auth: { admin: { generateLink: mocks.generateLink } },
  });
  mocks.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hash-123" }, user: { user_metadata: {} } },
    error: null,
  });
  mocks.sendEmail.mockResolvedValue({ ok: true });
});

describe("sendConfirmationEmail", () => {
  it("manda el enlace a nuestra ruta /confirmar, con el token y el next", async () => {
    const outcome = await sendConfirmationEmail({ ...BASE, next: "/propiedades?zona=Ñuñoa" });

    expect(outcome).toEqual({ ok: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);

    const [{ to, html }] = mocks.sendEmail.mock.calls[0];
    expect(to).toBe(BASE.email);

    const url = confirmUrlFromHtml(html);
    expect(url.origin).toBe(BASE.origin);
    expect(url.pathname).toBe("/confirmar");
    expect(url.searchParams.get("token_hash")).toBe("hash-123");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(url.searchParams.get("next")).toBe("/propiedades?zona=Ñuñoa");
  });

  it("mintea el token con type signup y la contraseña recién elegida", async () => {
    await sendConfirmationEmail(BASE);

    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "signup",
      email: BASE.email,
      password: BASE.password,
    });
  });

  it("sin Resend configurado no manda correo y avisa que se salteó", async () => {
    mocks.isResendConfigured.value = false;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const outcome = await sendConfirmationEmail(BASE);

    expect(outcome).toEqual({ ok: true, skipped: true });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    // En dev el enlace tiene que quedar a mano en el server, o la cuenta
    // recién creada sería inaccesible en local.
    expect(info.mock.calls[0][0]).toContain("/confirmar?token_hash=hash-123");
    info.mockRestore();
  });

  it("si el mint falla, lo dice y no manda correo", async () => {
    mocks.generateLink.mockResolvedValue({ data: null, error: { code: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await sendConfirmationEmail(BASE);

    expect(outcome).toEqual({ ok: false, reason: "mint" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("si Resend devuelve error, lo reporta como falla de correo", async () => {
    mocks.sendEmail.mockResolvedValue({ ok: false, error: "api caída" });

    expect(await sendConfirmationEmail(BASE)).toEqual({ ok: false, reason: "email" });
  });

  it("usa el display_name de Supabase cuando el caller no lo trae (reenvío)", async () => {
    mocks.generateLink.mockResolvedValue({
      data: {
        properties: { hashed_token: "hash-123" },
        user: { user_metadata: { display_name: "Rosa" } },
      },
      error: null,
    });

    await sendConfirmationEmail({ ...BASE, displayName: undefined });

    const [{ html }] = mocks.sendEmail.mock.calls[0];
    expect(html).toContain("Confirmá tu cuenta, Rosa");
  });
});

describe("resendConfirmationForCredentials", () => {
  const RESEND_BASE = {
    email: BASE.email,
    password: BASE.password,
    tenantName: BASE.tenantName,
    brandHex: BASE.brandHex,
    origin: BASE.origin,
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  it("reenvía cuando la cuenta existe sin confirmar", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { code: "email_not_confirmed" },
    });

    expect(await resendConfirmationForCredentials(RESEND_BASE)).toEqual({ sent: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("con la contraseña incorrecta no manda nada", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials" },
    });

    expect(await resendConfirmationForCredentials(RESEND_BASE)).toEqual({ sent: false });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("con la cuenta ya confirmada (login OK) no manda nada", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null });

    expect(await resendConfirmationForCredentials(RESEND_BASE)).toEqual({ sent: false });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
