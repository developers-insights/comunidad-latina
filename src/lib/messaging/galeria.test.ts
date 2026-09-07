import { describe, expect, it } from "vitest";
import {
  ITEMS_POR_TANDA,
  SOLAPAS_DE_GALERIA,
  armarCursor,
  etiquetaDeEnlace,
  parsearCursor,
  parsearSolapa,
  pesoLegible,
  primerEnlaceDelCuerpo,
  tipoLegible,
} from "./galeria";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FECHA = "2026-09-07T12:34:56.789123+00:00";

describe("la solapa que llega de la URL", () => {
  it("acepta las tres", () => {
    for (const solapa of SOLAPAS_DE_GALERIA) {
      expect(parsearSolapa(solapa)).toBe(solapa);
    }
  });

  /**
   * Cae a Multimedia y no a un 404: `?solapa=cualquiera` en un enlace viejo o
   * mal copiado tiene que abrir la pantalla igual, no romperla.
   */
  it("cae a multimedia con cualquier otra cosa", () => {
    for (const basura of ["", "fotos", null, undefined, 3, ["archivos"]]) {
      expect(parsearSolapa(basura)).toBe("multimedia");
    }
  });
});

describe("el cursor keyset", () => {
  it("va y vuelve sin perder nada", () => {
    const cursor = { createdAt: FECHA, id: UUID };
    expect(parsearCursor(armarCursor(cursor))).toEqual(cursor);
  });

  /**
   * EL PUNTO DE ESTA VALIDACIÓN: el cursor viaja por la URL y por el cuerpo de
   * una server action, y su contenido se INTERPOLA en el `.or()` de PostgREST,
   * que es un lenguaje de filtros con su propia sintaxis. Una coma, un
   * paréntesis o una comilla ahí adentro no filtran: cambian la consulta.
   */
  it("rechaza un timestamp con sintaxis de PostgREST adentro", () => {
    for (const veneno of [
      `2026-09-07T00:00:00,id.gt.0~${UUID}`,
      `2026-09-07T00:00:00)~${UUID}`,
      `2026-09-07T00:00:00'~${UUID}`,
      `2026-09-07T00:00:00"~${UUID}`,
    ]) {
      expect(parsearCursor(veneno)).toBeNull();
    }
  });

  it("rechaza un id que no es uuid y una fecha que no es fecha", () => {
    expect(parsearCursor(`${FECHA}~no-soy-un-uuid`)).toBeNull();
    expect(parsearCursor(`ayer~${UUID}`)).toBeNull();
  });

  it("rechaza lo que no es una cadena, o no tiene separador", () => {
    for (const basura of [null, undefined, 7, {}, "", "~", UUID, `~${UUID}`]) {
      expect(parsearCursor(basura)).toBeNull();
    }
  });

  it("la tanda es múltiplo de 3 — la grilla de multimedia no cierra coja", () => {
    expect(ITEMS_POR_TANDA % 3).toBe(0);
  });
});

describe("el enlace de un mensaje de texto", () => {
  it("encuentra el primero", () => {
    expect(primerEnlaceDelCuerpo("mirá https://ejemplo.com/a y también http://otro.com")).toBe(
      "https://ejemplo.com/a",
    );
  });

  /** Escribir «mirá esto https://x.com/a.» es lo normal; el punto no es la URL. */
  it("recorta la puntuación pegada al final", () => {
    expect(primerEnlaceDelCuerpo("mirá esto https://x.com/a.")).toBe("https://x.com/a");
    expect(primerEnlaceDelCuerpo("(https://x.com/a)")).toBe("https://x.com/a");
    expect(primerEnlaceDelCuerpo("¿viste https://x.com/a?")).toBe("https://x.com/a");
  });

  /**
   * La consulta prefiltra con `ilike '%http%'`, que atrapa cosas que no son
   * enlaces. Quien decide de verdad es esta función, y por eso tiene que decir
   * que no.
   */
  it("dice que no cuando no hay enlace, aunque el texto diga http", () => {
    for (const texto of ["", "  ", "instalé httpd en el server", "www.ejemplo.com", null, undefined]) {
      expect(primerEnlaceDelCuerpo(texto)).toBeNull();
    }
  });

  it("no acepta esquemas que no son http ni https", () => {
    expect(primerEnlaceDelCuerpo("javascript:alert(1)")).toBeNull();
    expect(primerEnlaceDelCuerpo("data:text/html;base64,AAAA")).toBeNull();
  });
});

describe("cómo se lee un enlace en la lista", () => {
  it("muestra el dominio sin www", () => {
    expect(etiquetaDeEnlace("https://www.ejemplo.com/")).toBe("ejemplo.com");
    expect(etiquetaDeEnlace("https://ejemplo.com")).toBe("ejemplo.com");
  });

  it("suma la ruta cuando aporta, y la corta cuando es larga", () => {
    expect(etiquetaDeEnlace("https://ejemplo.com/notas/2026")).toBe("ejemplo.com/notas/2026");
    expect(etiquetaDeEnlace(`https://ejemplo.com/${"a".repeat(60)}`)).toContain("…");
  });

  it("una URL rota se muestra tal cual en vez de romper la fila", () => {
    expect(etiquetaDeEnlace("no soy una url")).toBe("no soy una url");
  });
});

describe("el peso de un archivo", () => {
  /** Un PDF de 300 KB mostrado como "0,3 MB" se lee como si no pesara nada. */
  it("salta a KB debajo del mega", () => {
    expect(pesoLegible(319_488)).toBe("312 KB");
    expect(pesoLegible(900)).toBe("900 B");
  });

  it("usa coma decimal — el público de esta app no escribe 2.5", () => {
    expect(pesoLegible(2_621_440)).toBe("2,5 MB");
    expect(pesoLegible(2_621_440)).not.toContain(".");
  });

  it("no inventa nada con un valor imposible", () => {
    expect(pesoLegible(-1)).toBe("");
    expect(pesoLegible(Number.NaN)).toBe("");
  });
});

describe("el tipo de un archivo", () => {
  it("sale del mismo mapa que valida la subida", () => {
    expect(tipoLegible("application/pdf")).toBe("PDF");
    expect(tipoLegible("image/jpeg")).toBe("JPG");
  });

  it("un tipo que la app no acepta no recibe nombre propio", () => {
    expect(tipoLegible("application/x-msdownload")).toBe("Archivo");
    expect(tipoLegible(null)).toBe("Archivo");
  });
});
