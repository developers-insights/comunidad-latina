import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHOTO_FILTER_ID,
  MIN_PHOTO_FILTER_INTENSITY,
  PHOTO_FILTERS,
  clampFilterIntensity,
  getPhotoFilter,
  mediaFilterCssByPath,
  parseMediaFilterRef,
  resolvePhotoFilterCss,
  scaleFilterCss,
  type PhotoFilterFamily,
} from "./photo-filters";

/**
 * Datos puros — sin DOM, sin React (por eso el test corre en el entorno
 * `node`, no hace falta `@vitest-environment jsdom`).
 */

describe("PHOTO_FILTERS", () => {
  it("trae entre 14 y 16 presets, como pide el contrato", () => {
    expect(PHOTO_FILTERS.length).toBeGreaterThanOrEqual(14);
    expect(PHOTO_FILTERS.length).toBeLessThanOrEqual(16);
  });

  it("el primero es 'Original', sin filtro (css vacío)", () => {
    expect(PHOTO_FILTERS[0].id).toBe(DEFAULT_PHOTO_FILTER_ID);
    expect(PHOTO_FILTERS[0].label).toBe("Original");
    expect(PHOTO_FILTERS[0].css).toBe("");
  });

  it("todos los ids son únicos", () => {
    const ids = PHOTO_FILTERS.map((filter) => filter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todos los nombres visibles son únicos", () => {
    const labels = PHOTO_FILTERS.map((filter) => filter.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("ningún filtro (salvo Original) tiene el css vacío", () => {
    for (const filter of PHOTO_FILTERS.slice(1)) {
      expect(filter.css.length).toBeGreaterThan(0);
    }
  });

  it("los nombres son español natural, no jerga de editor de fotos", () => {
    const bannedJargon = /curves|hsl|clarity|vibrance|saturation|lut/i;
    for (const filter of PHOTO_FILTERS) {
      expect(filter.label).not.toMatch(bannedJargon);
    }
  });

  it("ningún nombre es un número sin identidad ('Filtro 3')", () => {
    for (const filter of PHOTO_FILTERS) {
      expect(filter.label).not.toMatch(/^filtro\s*\d+$/i);
    }
  });

  /**
   * El pedido del cliente es "buena variedad": seis familias distintas, cada
   * una con al menos dos presets, para que deslizar el carrusel muestre
   * caminos diferentes y no quince versiones del mismo.
   */
  it("cubre las seis familias, con al menos dos presets cada una", () => {
    const families: PhotoFilterFamily[] = ["calidos", "frios", "vivos", "suaves", "byn", "film"];
    for (const family of families) {
      const members = PHOTO_FILTERS.filter((filter) => filter.family === family);
      expect(members.length, `familia ${family}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("van agrupados: nunca se vuelve a una familia ya cerrada", () => {
    const seen: PhotoFilterFamily[] = [];
    for (const filter of PHOTO_FILTERS) {
      const last = seen[seen.length - 1];
      if (filter.family !== last) {
        expect(seen).not.toContain(filter.family);
        seen.push(filter.family);
      }
    }
  });

  /**
   * No son variaciones de saturación: entre todos usan al menos cinco
   * funciones distintas de `filter`.
   */
  it("combina de verdad — cinco o más funciones distintas en el catálogo", () => {
    const functions = new Set<string>();
    for (const filter of PHOTO_FILTERS) {
      for (const match of filter.css.matchAll(/([a-z-]+)\(/g)) functions.add(match[1]);
    }
    expect(functions.size).toBeGreaterThanOrEqual(5);
  });

  /**
   * `ctx.filter` (bake-photo.ts) sólo dibuja estas funciones. Un preset con
   * `drop-shadow` o con una viñeta se vería en la vista previa y NO en lo
   * publicado: el contrato de este módulo es que eso no puede pasar.
   */
  it("sólo usa funciones que el canvas sabe dibujar", () => {
    const allowed = new Set([
      "brightness",
      "contrast",
      "saturate",
      "sepia",
      "grayscale",
      "hue-rotate",
      "blur",
      "invert",
      "opacity",
    ]);
    for (const filter of PHOTO_FILTERS) {
      for (const match of filter.css.matchAll(/([a-z-]+)\(/g)) {
        expect(allowed.has(match[1]), `${filter.id} usa ${match[1]}`).toBe(true);
      }
    }
  });
});

describe("getPhotoFilter", () => {
  it("devuelve el preset por id", () => {
    expect(getPhotoFilter("byn").label).toBe("Blanco y negro");
  });

  it("cae a 'Original' con un id que no existe", () => {
    expect(getPhotoFilter("no-existe").id).toBe(DEFAULT_PHOTO_FILTER_ID);
  });

  it("cae a 'Original' con undefined o null", () => {
    expect(getPhotoFilter(undefined).id).toBe(DEFAULT_PHOTO_FILTER_ID);
    expect(getPhotoFilter(null).id).toBe(DEFAULT_PHOTO_FILTER_ID);
  });
});

describe("clampFilterIntensity", () => {
  it("deja pasar lo que está entre 0 y 1", () => {
    expect(clampFilterIntensity(0.42)).toBe(0.42);
  });

  it("recorta lo que se sale por arriba o por abajo", () => {
    expect(clampFilterIntensity(4)).toBe(1);
    expect(clampFilterIntensity(-2)).toBe(0);
  });

  it("un valor roto vuelve al 100%, nunca a NaN", () => {
    expect(clampFilterIntensity(Number.NaN)).toBe(1);
    expect(clampFilterIntensity(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("scaleFilterCss", () => {
  it("al 100% devuelve el string TAL CUAL, sin reescribir números", () => {
    const css = "saturate(1.3) sepia(0.14) contrast(1.05) brightness(1.03)";
    expect(scaleFilterCss(css, 1)).toBe(css);
  });

  it("al 0% no queda filtro", () => {
    expect(scaleFilterCss("saturate(1.5) contrast(1.1)", 0)).toBe("");
  });

  it("interpola cada función hacia su valor neutro", () => {
    // saturate: neutro 1 → 1 + (1.5 - 1) × 0.5 = 1.25
    // contrast: neutro 1 → 1 + (1.1 - 1) × 0.5 = 1.05
    expect(scaleFilterCss("saturate(1.5) contrast(1.1)", 0.5)).toBe(
      "saturate(1.25) contrast(1.05)",
    );
  });

  it("respeta el neutro 0 de sepia y grayscale", () => {
    expect(scaleFilterCss("sepia(0.4) grayscale(1)", 0.5)).toBe("sepia(0.2) grayscale(0.5)");
  });

  it("conserva la unidad de hue-rotate y su signo", () => {
    expect(scaleFilterCss("hue-rotate(-18deg)", 0.5)).toBe("hue-rotate(-9deg)");
  });

  it("no toca una función que no sabe atenuar", () => {
    expect(scaleFilterCss("drop-shadow(0 0 2px red) saturate(1.5)", 0.5)).toBe(
      "drop-shadow(0 0 2px red) saturate(1.25)",
    );
  });

  it("sin filtro de entrada no inventa uno", () => {
    expect(scaleFilterCss("", 0.5)).toBe("");
  });

  it("redondea a tres decimales — nada de 1.0500000000000003", () => {
    expect(scaleFilterCss("brightness(1.03)", 0.37)).toBe("brightness(1.011)");
  });

  it("todos los presets siguen siendo un filtro válido al mínimo", () => {
    for (const filter of PHOTO_FILTERS.slice(1)) {
      const scaled = scaleFilterCss(filter.css, MIN_PHOTO_FILTER_INTENSITY);
      expect(scaled.length).toBeGreaterThan(0);
      expect(scaled).not.toMatch(/NaN|undefined/);
    }
  });
});

describe("resolvePhotoFilterCss", () => {
  it("por default aplica el preset entero", () => {
    expect(resolvePhotoFilterCss("vivido")).toBe(getPhotoFilter("vivido").css);
  });

  it("un id desconocido no aplica nada, sea cual sea la intensidad", () => {
    expect(resolvePhotoFilterCss("no-existe", 0.5)).toBe("");
  });

  it("baja la intensidad del preset elegido", () => {
    expect(resolvePhotoFilterCss("vivido", 0.5)).toBe("saturate(1.25) contrast(1.05)");
  });
});

/* ---------------- El filtro como METADATO de un video (0104) -------------- */

/**
 * En una foto el filtro se hornea y el archivo publicado ES la foto filtrada.
 * En un video se guarda la DECISIÓN —un id y un número— y se aplica al pintar.
 * Eso convierte a estas dos funciones en la frontera: `parseMediaFilterRef` es
 * lo único que decide qué se GUARDA, y `mediaFilterCssByPath` lo único por lo
 * que lo guardado llega a un `style`.
 */
describe("parseMediaFilterRef — sólo entra lo que existe en el catálogo", () => {
  it("acepta un preset real con su intensidad", () => {
    expect(parseMediaFilterRef({ id: "vintage", intensity: 0.6 })).toEqual({
      ok: true,
      value: { id: "vintage", intensity: 0.6 },
    });
  });

  it("sin intensidad, el preset entra entero", () => {
    expect(parseMediaFilterRef({ id: "carbon" })).toEqual({
      ok: true,
      value: { id: "carbon", intensity: 1 },
    });
  });

  it("'sin filtro' es una respuesta válida y no guarda nada", () => {
    for (const raw of [null, undefined, { id: DEFAULT_PHOTO_FILTER_ID }]) {
      expect(parseMediaFilterRef(raw)).toEqual({ ok: true, value: null });
    }
  });

  it("rechaza un id que no está en el catálogo", () => {
    expect(parseMediaFilterRef({ id: "no-existe", intensity: 1 }).ok).toBe(false);
  });

  it("rechaza CSS crudo, venga como id o al lado del id", () => {
    // Es LA razón por la que esta función existe: lo guardado termina en el
    // `style` de todo el que abra la publicación.
    expect(parseMediaFilterRef({ id: "blur(40px)" }).ok).toBe(false);
    expect(parseMediaFilterRef({ id: "url(javascript:alert(1))" }).ok).toBe(false);
    expect(parseMediaFilterRef("grayscale(1)").ok).toBe(false);
  });

  it("rechaza intensidades fuera del rango del control real", () => {
    for (const intensity of [8, -1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseMediaFilterRef({ id: "byn", intensity }).ok).toBe(false);
    }
    // El piso del deslizador sí entra: es un valor que la UI puede producir.
    expect(parseMediaFilterRef({ id: "byn", intensity: MIN_PHOTO_FILTER_INTENSITY }).ok).toBe(
      true,
    );
  });

  it("rechaza formas que no son un objeto de filtro", () => {
    for (const raw of [[], ["vintage"], 3, true]) {
      expect(parseMediaFilterRef(raw).ok).toBe(false);
    }
  });
});

describe("mediaFilterCssByPath — lo guardado nunca llega crudo a un style", () => {
  it("devuelve el CSS del CATÁLOGO, no lo que diga la fila", () => {
    const css = mediaFilterCssByPath({
      "t/u/video.mp4": { id: "byn", intensity: 1 },
    });
    expect(css.get("t/u/video.mp4")).toBe(resolvePhotoFilterCss("byn", 1));
  });

  it("descarta en silencio lo que no pasa el catálogo, sin tumbar el resto", () => {
    // Una fila vieja o tocada a mano puede costar SU filtro; nunca el feed.
    const css = mediaFilterCssByPath({
      "t/u/malo.mp4": { id: "inventado", intensity: 1 },
      "t/u/inyeccion.mp4": { id: "grayscale(1)", css: "blur(40px)" },
      "t/u/bueno.mp4": { id: "calido", intensity: 1 },
    });
    expect(css.has("t/u/malo.mp4")).toBe(false);
    expect(css.has("t/u/inyeccion.mp4")).toBe(false);
    expect(css.get("t/u/bueno.mp4")).toBe(resolvePhotoFilterCss("calido", 1));
  });

  it("un jsonb que no es un objeto se lee como 'sin filtros'", () => {
    for (const raw of [null, undefined, [], "vintage", 7]) {
      expect(mediaFilterCssByPath(raw).size).toBe(0);
    }
  });
});
