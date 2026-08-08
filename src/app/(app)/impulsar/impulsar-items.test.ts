import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toListingImpulsarItem, toPostImpulsarItem } from "./impulsar-items";

/**
 * Lógica pura de /impulsar (índice). Entorno node: sólo importa los helpers
 * puros del feed/listings (postMediaUrl/mediaKindOf/firstPhotoUrl), sin jsdom
 * y sin Supabase — mismo criterio que perfil/post-tiles.test.ts.
 */

const SUPA = "https://proj.supabase.co";
const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
});

describe("toListingImpulsarItem", () => {
  const BASE = {
    id: "l1",
    kind: "property",
    title: "Depto 2 ambientes en Flushing",
    status: "published",
    photos: ["tenant/user/frente.webp"],
    created_at: "2026-08-01T00:00:00Z",
  };

  it("mapea un aviso publicado sin promoción activa", () => {
    const item = toListingImpulsarItem(BASE, null);
    expect(item).toMatchObject({
      id: "l1",
      kind: "listing",
      subKind: "property",
      title: "Depto 2 ambientes en Flushing",
      isPublished: true,
      activePromotionEndsAt: null,
      href: "/impulsar/l1",
      thumbnailIsVideo: false,
    });
    expect(item.thumbnailUrl).toBe(
      `${SUPA}/storage/v1/object/public/listing-photos/tenant/user/frente.webp`,
    );
  });

  it("un boost vigente viaja como activePromotionEndsAt", () => {
    const item = toListingImpulsarItem(BASE, "2026-09-01T00:00:00Z");
    expect(item.activePromotionEndsAt).toBe("2026-09-01T00:00:00Z");
  });

  it("status distinto de published queda marcado isPublished=false", () => {
    const item = toListingImpulsarItem({ ...BASE, status: "pending_review" }, null);
    expect(item.isPublished).toBe(false);
  });

  it("sin fotos, thumbnailUrl es null (no rompe la fila)", () => {
    const item = toListingImpulsarItem({ ...BASE, photos: [] }, null);
    expect(item.thumbnailUrl).toBeNull();
  });
});

describe("toPostImpulsarItem", () => {
  const BASE = {
    id: "p1",
    kind: "post",
    body: "Se vendieron todos los tamales del sábado, gracias comunidad",
    media: ["tenant/user/tamales.webp"],
    status: "published",
    created_at: "2026-08-01T00:00:00Z",
  };

  it("mapea un post con foto y recorta el título al cuerpo", () => {
    const item = toPostImpulsarItem(BASE, null);
    expect(item.title).toBe(BASE.body);
    expect(item.href).toBe("/impulsar-post/p1");
    expect(item.thumbnailIsVideo).toBe(false);
    expect(item.thumbnailUrl).toBe(
      `${SUPA}/storage/v1/object/public/post-media/tenant/user/tamales.webp`,
    );
  });

  it("primer medio de video → thumbnailIsVideo true", () => {
    const item = toPostImpulsarItem({ ...BASE, media: ["tenant/user/clip.mp4"] }, null);
    expect(item.thumbnailIsVideo).toBe(true);
  });

  it("cuerpo largo se recorta con elipsis", () => {
    const long = "x".repeat(200);
    const item = toPostImpulsarItem({ ...BASE, body: long, media: [] }, null);
    expect(item.title.endsWith("…")).toBe(true);
    expect(item.title.length).toBeLessThan(long.length);
  });

  it("post sin cuerpo ni medios cae al respaldo, no queda vacío", () => {
    const item = toPostImpulsarItem({ ...BASE, body: "   ", media: [] }, null);
    expect(item.title).toBe("Publicación sin texto");
    expect(item.thumbnailUrl).toBeNull();
  });

  it("una campaña de post vigente viaja como activePromotionEndsAt", () => {
    const item = toPostImpulsarItem(BASE, "2026-09-15T00:00:00Z");
    expect(item.activePromotionEndsAt).toBe("2026-09-15T00:00:00Z");
  });

  it("media null (posts viejos) no explota", () => {
    const item = toPostImpulsarItem({ ...BASE, media: null }, null);
    expect(item.thumbnailUrl).toBeNull();
  });
});
