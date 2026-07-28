import { describe, expect, it } from "vitest";
import { safeExternalHref } from "./safe-href";

/**
 * Los dos primeros bloques son regresiones de agujeros REALES, confirmados en
 * vivo el 27/7 navegando a otro origen desde una tarjeta firmada como mensaje
 * oficial de la plataforma. No son casos teóricos.
 */

describe("safeExternalHref: lo que se escapaba del sitio", () => {
  it("`//evil.com` NO es interna (pasaba el startsWith('/') y se iba por router.push)", () => {
    const safe = safeExternalHref("//evil.example.com/entrar");
    expect(safe?.external).toBe(true);
    expect(safe?.href).toBe("https://evil.example.com/entrar");
  });

  it("`/\\evil.com` tampoco (el parser trata `\\` como `/`, y el guard sólo miraba `//`)", () => {
    const safe = safeExternalHref("/\\evil.example.com/entrar");
    expect(safe?.external).toBe(true);
    expect(safe?.href).toBe("https://evil.example.com/entrar");
  });

  it("`/\\\\evil.com` y `\\/evil.com`: las variantes de la misma idea", () => {
    expect(safeExternalHref("/\\\\evil.example.com")?.external).toBe(true);
    expect(safeExternalHref("\\/evil.example.com")?.external).toBe(true);
  });
});

describe("safeExternalHref: protocolos que no se ofrecen", () => {
  // zod .url() los acepta — la allowlist tiene que estar acá.
  it.each(["javascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:msgbox", "file:///etc/passwd"])(
    "rechaza %s",
    (url) => {
      expect(safeExternalHref(url)).toBeNull();
    },
  );

  it("rechaza texto suelto que no es una URL — un cta_url mal tipeado no puede volverse un botón a un 404", () => {
    expect(safeExternalHref("no es una url")).toBeNull();
    expect(safeExternalHref("pagina de donaciones")).toBeNull();
    // Ojo: `/\evil.com` SÍ empieza con "/" — lo frena la comparación de origen,
    // no esta regla. Esta sólo cubre el typo, no la seguridad.
    expect(safeExternalHref("/\\evil.example.com")?.external).toBe(true);
  });

  it("rechaza vacío, espacios y nulo — null significa 'no muestres el botón'", () => {
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref("   ")).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
  });
});

describe("safeExternalHref: lo que sí tiene que funcionar", () => {
  it("una ruta del propio sitio queda interna y relativa", () => {
    expect(safeExternalHref("/eventos/abc?x=1#y")).toEqual({
      href: "/eventos/abc?x=1#y",
      external: false,
    });
  });

  it("un sitio de donaciones real es externo y se abre como externo", () => {
    // El caso que el cliente describió: centro de acopio tras un terremoto.
    const safe = safeExternalHref("https://donaciones.example.org/venezuela");
    expect(safe).toEqual({
      href: "https://donaciones.example.org/venezuela",
      external: true,
    });
  });

  it("http plano también, aunque sea externo: no es tarea de esta función forzar TLS", () => {
    expect(safeExternalHref("http://ejemplo.org")?.external).toBe(true);
  });
});
