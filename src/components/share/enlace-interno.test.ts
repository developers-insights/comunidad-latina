import { describe, expect, it } from "vitest";
import {
  enlaceInternoDelCuerpo,
  esCompartidoKind,
  hrefDeCompartido,
  parsearEnlaceInterno,
} from "./enlace-interno";

/**
 * El origin propio se pasa explícito en cada caso en vez de tocar
 * `process.env.NEXT_PUBLIC_SITE_URL`: la variable se lee en el módulo de
 * producción con un default, y un test que la pisa globalmente se filtra a los
 * demás archivos del run.
 */
const PROPIOS = ["https://comunidadlatina.com"] as const;
const parse = (url: string, origenes: readonly string[] = PROPIOS) =>
  parsearEnlaceInterno(url, { origenesPropios: origenes });

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("parsearEnlaceInterno", () => {
  it("reconoce las rutas de detalle de un solo segmento", () => {
    expect(parse(`https://comunidadlatina.com/feed/${UUID}`)).toEqual({
      kind: "post",
      id: UUID,
    });
    expect(parse(`https://comunidadlatina.com/propiedades/${UUID}`)).toEqual({
      kind: "listing",
      id: UUID,
    });
    expect(parse(`https://comunidadlatina.com/empleos/${UUID}`)).toEqual({
      kind: "job",
      id: UUID,
    });
    expect(parse(`https://comunidadlatina.com/negocios/${UUID}`)).toEqual({
      kind: "business",
      id: UUID,
    });
    expect(parse(`https://comunidadlatina.com/perfil/${UUID}`)).toEqual({
      kind: "profile",
      id: UUID,
    });
  });

  it("mapea los verticales de listings al MISMO kind", () => {
    for (const seccion of [
      "propiedades",
      "marketplace",
      "profesionales",
      "eventos",
      "creadores",
    ]) {
      expect(parse(`https://comunidadlatina.com/${seccion}/${UUID}`)).toEqual({
        kind: "listing",
        id: UUID,
      });
    }
  });

  it("reconoce las dos rutas anidadas (video largo y grupo)", () => {
    expect(parse(`https://comunidadlatina.com/videos/largos/${UUID}`)).toEqual({
      kind: "video",
      id: UUID,
    });
    expect(parse(`https://comunidadlatina.com/mensajes/grupos/${UUID}`)).toEqual({
      kind: "group",
      id: UUID,
    });
  });

  it("conserva query y hash sin que afecten al resultado", () => {
    expect(parse(`https://comunidadlatina.com/feed/${UUID}?antes=x#c1`)).toEqual({
      kind: "post",
      id: UUID,
    });
  });

  /* ---------------------------- lo que NO pasa ---------------------------- */

  it("rechaza un dominio ajeno aunque la ruta sea idéntica a la nuestra", () => {
    expect(parse(`https://no-somos-nosotros.com/feed/${UUID}`)).toBeNull();
    // Un subdominio tampoco alcanza: el origin se compara entero.
    expect(parse(`https://evil.comunidadlatina.com/feed/${UUID}`)).toBeNull();
    // Ni un prefijo que "contiene" nuestro dominio.
    expect(parse(`https://comunidadlatina.com.evil.io/feed/${UUID}`)).toBeNull();
  });

  it("rechaza esquemas que no son http(s)", () => {
    expect(parse(`javascript:alert(1)//comunidadlatina.com/feed/${UUID}`)).toBeNull();
    expect(parse(`data:text/html,<b>/feed/${UUID}`)).toBeNull();
  });

  it("rechaza un id que no tiene forma de uuid", () => {
    expect(parse("https://comunidadlatina.com/feed/12345")).toBeNull();
    expect(parse("https://comunidadlatina.com/feed/../../etc/passwd")).toBeNull();
  });

  it("rechaza rutas que no son un detalle", () => {
    expect(parse("https://comunidadlatina.com/feed")).toBeNull();
    expect(parse("https://comunidadlatina.com/")).toBeNull();
    expect(parse(`https://comunidadlatina.com/ayuda/${UUID}`)).toBeNull();
    // Anidada pero con el prefijo equivocado.
    expect(parse(`https://comunidadlatina.com/videos/cortos/${UUID}`)).toBeNull();
  });

  it("no explota con basura", () => {
    expect(parse("")).toBeNull();
    expect(parse("no soy una url")).toBeNull();
    expect(parse(`/feed/${UUID}`)).toBeNull();
  });

  it("acepta varios origins propios (dominio de la comunidad además del canónico)", () => {
    const origenes = ["https://comunidadlatina.com", "https://dominicanos.app"];
    expect(parse(`https://dominicanos.app/eventos/${UUID}`, origenes)).toEqual({
      kind: "listing",
      id: UUID,
    });
  });

  it("sin ningún origin propio configurado no reconoce nada", () => {
    expect(parsearEnlaceInterno(`https://comunidadlatina.com/feed/${UUID}`, {
      origenesPropios: [],
    })).toBeNull();
  });
});

describe("enlaceInternoDelCuerpo", () => {
  it("desenvuelve un cuerpo que es SÓLO el enlace", () => {
    expect(
      enlaceInternoDelCuerpo(`  https://comunidadlatina.com/feed/${UUID}  `, {
        origenesPropios: PROPIOS,
      }),
    ).toEqual({ kind: "post", id: UUID });
  });

  it("deja en paz un cuerpo con texto alrededor del enlace", () => {
    expect(
      enlaceInternoDelCuerpo(
        `mirá esto https://comunidadlatina.com/feed/${UUID} ¿te sirve?`,
        { origenesPropios: PROPIOS },
      ),
    ).toBeNull();
  });

  it("tolera cuerpo vacío o ausente", () => {
    expect(enlaceInternoDelCuerpo("", { origenesPropios: PROPIOS })).toBeNull();
    expect(enlaceInternoDelCuerpo(null, { origenesPropios: PROPIOS })).toBeNull();
    expect(enlaceInternoDelCuerpo(undefined, { origenesPropios: PROPIOS })).toBeNull();
  });
});

describe("hrefDeCompartido", () => {
  it("arma la ruta directa de los kinds de una sola sección", () => {
    expect(hrefDeCompartido("post", UUID)).toBe(`/feed/${UUID}`);
    expect(hrefDeCompartido("video", UUID)).toBe(`/videos/largos/${UUID}`);
    expect(hrefDeCompartido("group", UUID)).toBe(`/mensajes/grupos/${UUID}`);
    expect(hrefDeCompartido("profile", UUID)).toBe(`/perfil/${UUID}`);
  });

  it("usa el vertical de la base para elegir la sección de un listing", () => {
    expect(hrefDeCompartido("listing", UUID, "property")).toBe(`/propiedades/${UUID}`);
    expect(hrefDeCompartido("listing", UUID, "event")).toBe(`/eventos/${UUID}`);
    expect(hrefDeCompartido("listing", UUID, "professional")).toBe(
      `/profesionales/${UUID}`,
    );
    expect(hrefDeCompartido("listing", UUID, "creator_gig")).toBe(
      `/creadores/${UUID}`,
    );
  });

  it("cae a una pantalla que existe cuando el vertical falta o es desconocido", () => {
    expect(hrefDeCompartido("listing", UUID, null)).toBe(`/marketplace/${UUID}`);
    expect(hrefDeCompartido("listing", UUID, "inventado")).toBe(`/marketplace/${UUID}`);
  });

  it("da la vuelta completa: parsear su propio href devuelve el mismo par", () => {
    for (const kind of ["post", "video", "group", "profile", "job", "business"] as const) {
      const href = hrefDeCompartido(kind, UUID);
      expect(parse(`https://comunidadlatina.com${href}`)).toEqual({ kind, id: UUID });
    }
  });
});

describe("esCompartidoKind", () => {
  it("acepta los siete del contrato y rechaza el resto", () => {
    expect(esCompartidoKind("post")).toBe(true);
    expect(esCompartidoKind("group")).toBe(true);
    expect(esCompartidoKind("texto")).toBe(false);
    expect(esCompartidoKind(null)).toBe(false);
    expect(esCompartidoKind(7)).toBe(false);
  });
});
