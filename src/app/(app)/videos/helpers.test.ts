import { describe, expect, it } from "vitest";
import {
  VIDEO_SCOPES,
  firstParamValue,
  hasVideoMedia,
  parseStartId,
  parseVideosScope,
  scopeListingKind,
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
