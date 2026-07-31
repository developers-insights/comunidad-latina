import { describe, expect, it } from "vitest";
import { VIDEO_CATEGORIES } from "@/lib/media/video-policy";
import {
  ALL_CATEGORIES,
  VIDEO_SCOPES,
  categoryFilterValue,
  firstParamValue,
  hasVideoMedia,
  parseStartId,
  parseVideoCategoryParam,
  parseVideosScope,
  scopeListingKind,
  shouldShowCategoryMenu,
} from "./helpers";

describe("parseVideosScope", () => {
  it("acepta los cinco scopes válidos", () => {
    for (const scope of VIDEO_SCOPES) {
      expect(parseVideosScope(scope.id)).toBe(scope.id);
    }
  });

  it("cae a para-ti ante basura, vacío o undefined", () => {
    expect(parseVideosScope(undefined)).toBe("para-ti");
    expect(parseVideosScope("")).toBe("para-ti");
    expect(parseVideosScope("marketplace")).toBe("para-ti");
    expect(parseVideosScope("PROPIEDADES")).toBe("para-ti");
  });
});

describe("scopeListingKind", () => {
  it("para-ti no filtra por vertical (null)", () => {
    expect(scopeListingKind("para-ti")).toBeNull();
  });

  it("cada scope de módulo mapea a su kind de listing", () => {
    expect(scopeListingKind("propiedades")).toBe("property");
    expect(scopeListingKind("negocios")).toBe("business");
    expect(scopeListingKind("profesionales")).toBe("professional");
    expect(scopeListingKind("eventos")).toBe("event");
  });
});

describe("hasVideoMedia", () => {
  it("detecta un video por extensión, incluso mezclado con fotos", () => {
    expect(hasVideoMedia(["t/u/foto.webp", "t/u/clip.mp4"])).toBe(true);
    expect(hasVideoMedia(["t/u/clip.webm"])).toBe(true);
    expect(hasVideoMedia(["https://cdn.x/video.MOV"])).toBe(true);
  });

  it("false para solo fotos, vacío, null o paths en blanco", () => {
    expect(hasVideoMedia(["t/u/a.jpg", "t/u/b.png"])).toBe(false);
    expect(hasVideoMedia([])).toBe(false);
    expect(hasVideoMedia(null)).toBe(false);
    expect(hasVideoMedia(undefined)).toBe(false);
    expect(hasVideoMedia(["", "   "])).toBe(false);
  });

  it("no confunde un nombre que contiene 'mp4' sin ser la extensión", () => {
    expect(hasVideoMedia(["t/u/mp4-tutorial.jpg"])).toBe(false);
  });
});

describe("parseStartId", () => {
  it("acepta solo uuids", () => {
    expect(parseStartId("0198c9a1-1111-7222-8333-444455556666")).toBe(
      "0198c9a1-1111-7222-8333-444455556666",
    );
    expect(parseStartId("no-es-uuid")).toBeNull();
    expect(parseStartId("")).toBeNull();
    expect(parseStartId(undefined)).toBeNull();
    // Sin traversal ni inyección posible: cualquier cosa no-uuid muere acá.
    expect(parseStartId("1;drop table posts")).toBeNull();
  });
});

describe("firstParamValue", () => {
  it("normaliza string, array y undefined", () => {
    expect(firstParamValue("a")).toBe("a");
    expect(firstParamValue(["b", "c"])).toBe("b");
    expect(firstParamValue(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Menú de categorías (call 29/7, 1:20)
// ---------------------------------------------------------------------------

describe("parseVideoCategoryParam", () => {
  it("acepta las nueve categorías del catálogo", () => {
    for (const category of VIDEO_CATEGORIES) {
      expect(parseVideoCategoryParam(category)).toBe(category);
    }
  });

  it("acepta 'todos', que NO es una categoría de la base", () => {
    expect(parseVideoCategoryParam(ALL_CATEGORIES)).toBe("todos");
    expect(VIDEO_CATEGORIES).not.toContain("todos");
  });

  it("ausente y basura son null — y null NO es 'todos'", () => {
    // De esta diferencia depende qué pantalla se ve: null = mostrar el menú.
    expect(parseVideoCategoryParam(undefined)).toBeNull();
    expect(parseVideoCategoryParam("")).toBeNull();
    expect(parseVideoCategoryParam("   ")).toBeNull();
    expect(parseVideoCategoryParam("recetas")).toBeNull();
    expect(parseVideoCategoryParam("COMIDA")).toBeNull();
    expect(parseVideoCategoryParam("comida'; drop table posts")).toBeNull();
  });
});

describe("categoryFilterValue", () => {
  it("'todos' y null no filtran; una categoría sí", () => {
    expect(categoryFilterValue(null)).toBeNull();
    expect(categoryFilterValue(ALL_CATEGORIES)).toBeNull();
    expect(categoryFilterValue("comida")).toBe("comida");
  });
});

describe("shouldShowCategoryMenu", () => {
  it("entrar a /videos pelado abre el MENÚ (antes arrancaba reproduciendo)", () => {
    expect(
      shouldShowCategoryMenu({ category: null, startId: null, rawScope: "" }),
    ).toBe(true);
  });

  it("un deep link con ?start= va DERECHO al video, sin menú de por medio", () => {
    // Es el link que se comparte y el que abre un video tocado en el feed:
    // interponer una pantalla de categorías lo rompería.
    expect(
      shouldShowCategoryMenu({
        category: null,
        startId: "0198c9a1-1111-7222-8333-444455556666",
        rawScope: "",
      }),
    ).toBe(false);
  });

  it("?scope= sigue abriendo el reel del módulo, sin menú", () => {
    expect(
      shouldShowCategoryMenu({ category: null, startId: null, rawScope: "negocios" }),
    ).toBe(false);
  });

  it("con categoría elegida (incluida 'todos') se ve el reel", () => {
    expect(
      shouldShowCategoryMenu({ category: "comida", startId: null, rawScope: "" }),
    ).toBe(false);
    expect(
      shouldShowCategoryMenu({ category: ALL_CATEGORIES, startId: null, rawScope: "" }),
    ).toBe(false);
  });
});
