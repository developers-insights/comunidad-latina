import { describe, expect, it } from "vitest";
import { campanaAlcanzaZona, zonasDeCampana } from "./campanas";

/**
 * El alcance comprado, que la 0115 sacó del cajón. Lo que se fija acá es la
 * ASIMETRÍA: ante cualquier duda la campaña LLEGA. Achicarle el alcance a algo
 * que alguien pagó por una forma inesperada de un jsonb es cobrar y no
 * entregar, y eso no puede depender de que un dump viejo tenga la forma linda.
 */

describe("zonasDeCampana", () => {
  it("scope all ⇒ null (toda la comunidad)", () => {
    expect(zonasDeCampana({ scope: "all" })).toBeNull();
  });

  it("scope zones ⇒ las zonas, ya recortadas", () => {
    expect(zonasDeCampana({ scope: "zones", zones: [" Queens, NY ", "Bronx"] })).toEqual([
      "Queens, NY",
      "Bronx",
    ]);
  });

  it("zones vacío o basura ⇒ null, nunca 'no llega a nadie'", () => {
    expect(zonasDeCampana({ scope: "zones", zones: [] })).toBeNull();
    expect(zonasDeCampana({ scope: "zones", zones: ["", "  "] })).toBeNull();
    expect(zonasDeCampana({ scope: "zones" })).toBeNull();
    expect(zonasDeCampana({ scope: "zones", zones: [1, null] })).toBeNull();
  });

  it("audience ausente o con forma inesperada ⇒ null", () => {
    expect(zonasDeCampana(null)).toBeNull();
    expect(zonasDeCampana(undefined)).toBeNull();
    expect(zonasDeCampana("all")).toBeNull();
    expect(zonasDeCampana([{ scope: "zones" }])).toBeNull();
  });
});

describe("campanaAlcanzaZona", () => {
  it("alcance total: llega mire donde mire quien lee", () => {
    expect(campanaAlcanzaZona(null, ["Bronx"])).toBe(true);
    expect(campanaAlcanzaZona(null, [])).toBe(true);
  });

  it("campaña por zonas: llega sólo a las que compró", () => {
    expect(campanaAlcanzaZona(["Queens, NY"], ["Queens, NY", "Corona, Queens"])).toBe(true);
    expect(campanaAlcanzaZona(["Queens, NY"], ["Bronx"])).toBe(false);
  });

  /**
   * Quien mira toda la comunidad no declaró dónde está: no hay zona contra la
   * cual descartar. Misma duda-a-favor que `boostReachesViewer`.
   */
  it("visitante sin zona: la campaña por zonas igual llega", () => {
    expect(campanaAlcanzaZona(["Queens, NY"], [])).toBe(true);
  });
});
