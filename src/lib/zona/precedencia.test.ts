import { describe, expect, it } from "vitest";
import { encodeZonaCookie, ZONA_TODAS } from "./cookie";
import { resolverZona, zonaVieneDeLaUrl } from "./precedencia";

/**
 * LA PRECEDENCIA ES EL CONTRATO DE LA FEATURE: URL > cookie > perfil > todo.
 *
 * Si alguna de estas cuatro filas se invierte, se rompe una promesa distinta:
 * un enlace compartido deja de mostrar lo que dice, o la zona elegida no se
 * respeta, o alguien que nunca tocó nada empieza a ver cosas distintas.
 */
describe("resolverZona — URL > cookie > perfil > toda la comunidad", () => {
  it("sin nada, es toda la comunidad (cero regresión para quien no toca nada)", () => {
    expect(resolverZona({})).toEqual({ label: null, origen: "todas" });
  });

  it("sin cookie, el default es la zona del perfil", () => {
    expect(resolverZona({ perfilZona: "Corona, Queens" })).toEqual({
      label: "Corona, Queens",
      origen: "perfil",
    });
  });

  it("la cookie le gana al perfil: elegir una zona es elegirla de verdad", () => {
    expect(
      resolverZona({
        cookieRaw: encodeZonaCookie("Jackson Heights"),
        perfilZona: "Corona, Queens",
      }),
    ).toEqual({ label: "Jackson Heights", origen: "cookie" });
  });

  it("«toda la comunidad» le gana al perfil — la salida no puede ser una trampa", () => {
    // Sin este caso, quien vive en Corona y pide ver todo vuelve a Corona en el
    // próximo request, porque el perfil lo pisaría.
    expect(resolverZona({ cookieRaw: ZONA_TODAS, perfilZona: "Corona, Queens" })).toEqual({
      label: null,
      origen: "todas",
    });
  });

  it("la URL le gana a la cookie: un enlace compartido muestra lo que promete", () => {
    expect(
      resolverZona({
        urlZona: "Washington Heights",
        cookieRaw: encodeZonaCookie("Jackson Heights"),
        perfilZona: "Corona, Queens",
      }),
    ).toEqual({ label: "Washington Heights", origen: "url" });
  });

  it("la URL le gana incluso a «toda la comunidad»", () => {
    expect(resolverZona({ urlZona: "Corona", cookieRaw: ZONA_TODAS })).toEqual({
      label: "Corona",
      origen: "url",
    });
  });

  it("un `?zona=` vacío o basura NO cuenta como URL: se cae al escalón siguiente", () => {
    expect(resolverZona({ urlZona: "", cookieRaw: encodeZonaCookie("Corona") })).toEqual({
      label: "Corona",
      origen: "cookie",
    });
    expect(resolverZona({ urlZona: "   ", perfilZona: "Corona" })).toEqual({
      label: "Corona",
      origen: "perfil",
    });
  });

  it("una cookie ilegible cae al perfil, no a «toda la comunidad»", () => {
    // Basura no puede significar «no filtres»: sería una forma silenciosa de
    // apagarle la preferencia a alguien.
    expect(resolverZona({ cookieRaw: "%%%", perfilZona: "Corona" })).toEqual({
      label: "Corona",
      origen: "perfil",
    });
  });

  it("un perfil sin zona termina en toda la comunidad", () => {
    expect(resolverZona({ perfilZona: null })).toEqual({ label: null, origen: "todas" });
    expect(resolverZona({ perfilZona: "  " })).toEqual({ label: null, origen: "todas" });
  });
});

describe("zonaVieneDeLaUrl — quién puede cambiar la zona activa", () => {
  it("sólo la de la URL bloquea el cambio por preferencia", () => {
    expect(zonaVieneDeLaUrl(resolverZona({ urlZona: "Corona" }))).toBe(true);
    expect(zonaVieneDeLaUrl(resolverZona({ cookieRaw: encodeZonaCookie("Corona") }))).toBe(
      false,
    );
    expect(zonaVieneDeLaUrl(resolverZona({ perfilZona: "Corona" }))).toBe(false);
    expect(zonaVieneDeLaUrl(resolverZona({}))).toBe(false);
  });
});
