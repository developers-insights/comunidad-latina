import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent } from "./sentry.scrub";

/**
 * Lo que NUNCA puede llegar a Sentry.
 *
 * El bloque de credenciales es una regresión de un agujero real (auditoría
 * 2026-08-02): el scrub sólo tapaba emails y teléfonos, así que
 * `/confirmar?token_hash=…` y `/callback?code=…` —las dos URLs de auth que
 * LLEVAN el secreto adentro— viajaban enteras. Con `tracesSampleRate: 0.1`, una
 * de cada diez confirmaciones de cuenta dejaba en un dashboard de terceros un
 * token de un solo uso que abre sesión sin contraseña.
 */

const base = (): ErrorEvent => ({}) as ErrorEvent;

describe("scrubEvent: credenciales en la URL", () => {
  it("tapa el token_hash de /confirmar y conserva el nombre del parámetro", () => {
    const event = base();
    event.request = {
      url: "https://app.example/confirmar?token_hash=abc123DEF456&type=signup",
    };
    const out = scrubEvent(event);
    expect(out?.request?.url).toBe(
      "https://app.example/confirmar?token_hash=[redactado]&type=signup",
    );
  });

  it("tapa el code PKCE de /callback en query_string", () => {
    const event = base();
    event.request = { query_string: "code=pkce-abc-123&next=/feed" };
    const out = scrubEvent(event);
    expect(out?.request?.query_string).toBe("code=[redactado]&next=/feed");
  });

  it("tapa tokens dentro del mensaje de una excepción", () => {
    const event = base();
    event.exception = {
      values: [{ value: "falló GET /confirmar?token_hash=zzz999 (403)" }],
    };
    const out = scrubEvent(event);
    expect(out?.exception?.values?.[0]?.value).toContain("token_hash=[redactado]");
    expect(out?.exception?.values?.[0]?.value).not.toContain("zzz999");
  });

  it("tapa access_token / refresh_token", () => {
    const event = base();
    event.message = "sesión: access_token=eyJhb.CDE refresh_token=r-999-xyz";
    const out = scrubEvent(event);
    expect(out?.message).not.toContain("eyJhb.CDE");
    expect(out?.message).not.toContain("r-999-xyz");
  });

  it("tapa tokens en los breadcrumbs de navegación", () => {
    const out = scrubBreadcrumb({
      category: "navigation",
      data: { to: "/confirmar?token_hash=secreto123" },
    });
    expect(out?.data?.to).toBe("/confirmar?token_hash=[redactado]");
  });
});

describe("scrubEvent: lo que ya cubría (regresión)", () => {
  it("sigue tapando emails y teléfonos", () => {
    const event = base();
    event.message = "no se pudo escribir a maria.perez@example.com (+1 917 555 0132)";
    const out = scrubEvent(event);
    expect(out?.message).not.toContain("maria.perez@example.com");
    expect(out?.message).not.toContain("555 0132");
  });

  it("deja sólo el id del usuario, nunca su email", () => {
    const event = base();
    event.user = { id: "uuid-1", email: "quien@example.com", ip_address: "1.2.3.4" };
    expect(scrubEvent(event)?.user).toEqual({ id: "uuid-1" });
  });

  it("borra cookies, body y headers sensibles del request", () => {
    const event = base();
    event.request = {
      cookies: { "sb-access-token": "x" },
      data: { password: "x" },
      headers: { cookie: "a=b", authorization: "Bearer x", "x-forwarded-for": "1.2.3.4" },
    };
    const out = scrubEvent(event);
    expect(out?.request?.cookies).toBeUndefined();
    expect(out?.request?.data).toBeUndefined();
    expect(out?.request?.headers?.cookie).toBeUndefined();
    expect(out?.request?.headers?.authorization).toBeUndefined();
    expect(out?.request?.headers?.["x-forwarded-for"]).toBeUndefined();
  });
});
