import { describe, expect, it } from "vitest";
import { vieneDeOtroSitio } from "./enlace-correo";

function pedido(headers: Record<string, string>) {
  return new Request("https://interno.vercel.app/confirmar", { method: "POST", headers });
}

describe("vieneDeOtroSitio", () => {
  it.each([
    ["cross-site", true],
    ["same-origin", false],
    ["same-site", false],
    ["none", false],
  ])("con Sec-Fetch-Site %s manda ese header", (valor, esperado) => {
    const request = pedido({
      "sec-fetch-site": valor,
      host: "dominicanos.com",
      origin: "https://otro.com",
    });
    expect(vieneDeOtroSitio(request)).toBe(esperado);
  });

  describe("sin Sec-Fetch-Site, como Safari anterior a 16.4", () => {
    it("deja pasar el Origin del mismo host", () => {
      const request = pedido({ host: "dominicanos.com", origin: "https://dominicanos.com" });
      expect(vieneDeOtroSitio(request)).toBe(false);
    });

    it("compara contra el host público y no contra el interno", () => {
      const request = pedido({
        host: "interno.vercel.app",
        "x-forwarded-host": "dominicanos.com",
        origin: "https://dominicanos.com",
      });
      expect(vieneDeOtroSitio(request)).toBe(false);
    });

    it("respeta el puerto en desarrollo", () => {
      const mismo = pedido({ host: "localhost:3000", origin: "http://localhost:3000" });
      const otro = pedido({ host: "localhost:3000", origin: "http://localhost:4000" });
      expect(vieneDeOtroSitio(mismo)).toBe(false);
      expect(vieneDeOtroSitio(otro)).toBe(true);
    });

    it("no distingue mayúsculas en el host", () => {
      const request = pedido({ host: "Dominicanos.com", origin: "https://dominicanos.com" });
      expect(vieneDeOtroSitio(request)).toBe(false);
    });

    it.each([
      ["otro dominio", "https://evil.com"],
      ["un dominio que empieza igual", "https://dominicanos.com.evil.com"],
      ["un iframe sandbox", "null"],
      ["basura", "no es una url"],
    ])("rechaza %s", (_caso, origin) => {
      expect(vieneDeOtroSitio(pedido({ host: "dominicanos.com", origin }))).toBe(true);
    });

    it("rechaza si tampoco viene Origin", () => {
      expect(vieneDeOtroSitio(pedido({ host: "dominicanos.com" }))).toBe(true);
    });
  });
});
