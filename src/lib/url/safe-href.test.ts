import { describe, expect, it } from "vitest";
import { safeExternalHref, safeInternalPath } from "./safe-href";

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

/**
 * `safeInternalPath` — el `?next=` de los flujos de auth.
 *
 * Los tres primeros casos son el agujero REAL confirmado en vivo el 2/8: el
 * filtro anterior (`startsWith("/")` + rechazar `//` y `\`) dejaba pasar un tab
 * o un salto de línea, y `new URL()` los borra ANTES de parsear, así que
 * `/<TAB>/evil.com` terminaba siendo `https://evil.com/` en el `Location:` de
 * /callback, /confirmar y del push posterior al login.
 */
describe("safeInternalPath: lo que se escapaba del sitio por ?next=", () => {
  const origin = "https://comunidad-latina-sigma.vercel.app";
  const TAB = String.fromCharCode(9);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);

  for (const [nombre, control] of [
    ["tab", TAB],
    ["salto de línea", LF],
    ["retorno de carro", CR],
  ] as const) {
    it(`un ${nombre} embebido no logra sacar el redirect del sitio`, () => {
      const next = safeInternalPath(`/${control}/evil.example.com`, "/feed");
      expect(next).toBe("/feed");
      expect(new URL(next, origin).origin).toBe(origin);
    });
  }

  it("`//evil.com` vuelve al fallback", () => {
    expect(safeInternalPath("//evil.example.com/entrar", "/feed")).toBe("/feed");
  });

  it("una barra invertida vuelve al fallback (el parser la trata como `/`)", () => {
    const BS = String.fromCharCode(92); // se arma así para que el escape no se lea mal
    expect(safeInternalPath(`/${BS}evil.example.com`, "/feed")).toBe("/feed");
  });

  it("una URL absoluta vuelve al fallback aunque sea https", () => {
    expect(safeInternalPath("https://evil.example.com", "/feed")).toBe("/feed");
  });

  it("`javascript:` vuelve al fallback", () => {
    expect(safeInternalPath("javascript:alert(1)", "/feed")).toBe("/feed");
  });

  it("null / vacío / sin barra inicial → fallback", () => {
    expect(safeInternalPath(null, "/bienvenida")).toBe("/bienvenida");
    expect(safeInternalPath("", "/bienvenida")).toBe("/bienvenida");
    expect(safeInternalPath("feed", "/bienvenida")).toBe("/bienvenida");
  });

  it("una ruta interna legítima pasa y conserva query y hash", () => {
    expect(safeInternalPath("/propiedades?zona=Bronx#lista", "/feed")).toBe(
      "/propiedades?zona=Bronx#lista",
    );
  });

  it("devuelve la ruta NORMALIZADA, no el string original", () => {
    // Que el caller no pueda reintroducir el problema concatenando lo que entró.
    expect(safeInternalPath("/a/../b", "/feed")).toBe("/b");
  });

  // Revisión 2026-08-02: la normalización de dot-segments PRODUCE el `//`. El
  // origen del primer parseo sigue siendo interno, así que un chequeo de una
  // sola pasada los deja salir. Cada uno de estos, sin la segunda pasada,
  // devolvía `//evil.com` y terminaba en `https://evil.com`.
  it.each([
    "/.//evil.com",
    "/..//evil.com",
    "/x/..//evil.com",
    "/x/../..//evil.com",
    "/..//evil.com?a=1",
    "/..//evil.com/entrar",
  ])("dot-segments que colapsan a protocol-relative → fallback: %s", (vector) => {
    const salida = safeInternalPath(vector, "/feed");
    expect(salida).toBe("/feed");
    // La prueba que importa de verdad: resolverlo como lo hace el caller real
    // (`new URL(next, url.origin)` en /callback y /confirmar) no sale del sitio.
    expect(new URL(salida, "https://comunidad-latina.test").origin).toBe(
      "https://comunidad-latina.test",
    );
  });
});
