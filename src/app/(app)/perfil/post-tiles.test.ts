import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toPostTile } from "./post-tiles";

/**
 * Lógica pura del grid de publicaciones del perfil. Entorno node: `post-tiles`
 * solo importa los helpers PUROS del feed (postMediaUrl/mediaKindOf), sin jsdom.
 */

const SUPA = "https://proj.supabase.co";
const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
});

describe("toPostTile", () => {
  it("post con foto → tile image con la URL pública de la primera foto", () => {
    const tile = toPostTile({
      id: "p1",
      body: "Mi mudanza",
      kind: "post",
      media: ["tenant/user/foto.webp", "tenant/user/otra.webp"],
    });
    expect(tile.tileKind).toBe("image");
    expect(tile.mediaUrl).toBe(
      `${SUPA}/storage/v1/object/public/post-media/tenant/user/foto.webp`,
    );
    expect(tile.isQuestion).toBe(false);
  });

  it("primer medio de video → tile video (aunque después haya fotos)", () => {
    const tile = toPostTile({
      id: "p2",
      body: "Miren esto",
      kind: "post",
      media: ["tenant/user/clip.mp4", "tenant/user/foto.webp"],
    });
    expect(tile.tileKind).toBe("video");
    expect(tile.mediaUrl).toBe(
      `${SUPA}/storage/v1/object/public/post-media/tenant/user/clip.mp4`,
    );
  });

  it("post sin medios → tile de texto (no rompe la grilla), conserva el cuerpo", () => {
    const tile = toPostTile({
      id: "p3",
      body: "Solo texto, sin foto",
      kind: "post",
      media: [],
    });
    expect(tile.tileKind).toBe("text");
    expect(tile.mediaUrl).toBeNull();
    expect(tile.text).toBe("Solo texto, sin foto");
  });

  it("media null (posts viejos) → tile de texto sin explotar", () => {
    const tile = toPostTile({ id: "p4", body: "Antiguo", kind: "post", media: null });
    expect(tile.tileKind).toBe("text");
    expect(tile.mediaUrl).toBeNull();
  });

  it("ignora paths vacíos/espacios al elegir el primer medio", () => {
    const tile = toPostTile({
      id: "p5",
      body: "",
      kind: "post",
      media: ["   ", "", "tenant/user/real.webp"],
    });
    expect(tile.tileKind).toBe("image");
    expect(tile.mediaUrl).toContain("real.webp");
  });

  it("kind='question' se marca como pregunta", () => {
    const tile = toPostTile({ id: "p6", body: "¿Alguien sabe?", kind: "question", media: [] });
    expect(tile.isQuestion).toBe(true);
    expect(tile.tileKind).toBe("text");
  });

  it("URL absoluta (seed/API) se respeta tal cual", () => {
    const tile = toPostTile({
      id: "p7",
      body: "Seed",
      kind: "post",
      media: ["https://cdn.example.com/x.jpg"],
    });
    expect(tile.mediaUrl).toBe("https://cdn.example.com/x.jpg");
    expect(tile.tileKind).toBe("image");
  });
});
