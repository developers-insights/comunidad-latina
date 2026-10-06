import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sin Agora en `connect-src` las llamadas no fallan: se quedan en
 * "Conectando…" para siempre, sin error en la consola del servidor ni en los
 * tests de unidad. Ya pasó (2026-10-06). Este contrato existe para que sacar
 * una de estas entradas "porque nadie la usa" rompa algo visible.
 */
describe("CSP de las llamadas", () => {
  const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
  const connectSrc = config.match(/"connect-src [^"]+"/)?.[0] ?? "";

  it.each([
    "https://*.agora.io:*",
    "https://*.sd-rtn.com:*",
    "wss://*.agora.io:*",
    "wss://*.sd-rtn.com:*",
  ])("permite %s", (fuente) => {
    expect(connectSrc).toContain(fuente);
  });

  it("Permissions-Policy deja pedir cámara y micrófono al propio sitio", () => {
    const politica = config.match(/"camera=[^"]+"/)?.[0] ?? "";
    expect(politica).toContain("camera=(self)");
    expect(politica).toContain("microphone=(self)");
  });
});
