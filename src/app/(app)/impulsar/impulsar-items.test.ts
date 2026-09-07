import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RECIENTE_MS,
  esReciente,
  estadoDePromocion,
  puedePromocionarse,
  toListingImpulsarItem,
  toPostImpulsarItem,
} from "./impulsar-items";

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

describe("estadoDePromocion", () => {
  it("published sin promoción vigente está listo para promocionar", () => {
    expect(estadoDePromocion("published", false)).toBe("lista");
  });

  it("published con promoción vigente es 'activa'", () => {
    expect(estadoDePromocion("published", true)).toBe("activa");
  });

  it.each([
    ["pending_review", "en_revision"],
    ["draft", "sin_terminar"],
    ["paused", "pausada"],
    ["expired", "vencida"],
    ["closed", "cerrada"],
  ] as const)("%s NO se colapsa en 'en revisión': es %s", (status, esperado) => {
    expect(estadoDePromocion(status, false)).toBe(esperado);
  });

  it("un status desconocido nunca se declara promocionable", () => {
    expect(estadoDePromocion("removed", false)).toBe("no_disponible");
    expect(puedePromocionarse(estadoDePromocion("lo_que_venga", true))).toBe(false);
  });

  it("una promoción colgada no revive un aviso que ya no está publicado", () => {
    // El boost puede seguir 'active' unos minutos después de que el dueño pausó
    // el aviso: manda el estado de la FILA, que es lo que mira el destino.
    expect(estadoDePromocion("paused", true)).toBe("pausada");
  });
});

describe("puedePromocionarse", () => {
  it("sólo 'lista' y 'activa' llevan a algún lado", () => {
    expect(puedePromocionarse("lista")).toBe(true);
    expect(puedePromocionarse("activa")).toBe(true);
    expect(puedePromocionarse("en_revision")).toBe(false);
    expect(puedePromocionarse("sin_terminar")).toBe(false);
    expect(puedePromocionarse("pausada")).toBe(false);
    expect(puedePromocionarse("vencida")).toBe(false);
    expect(puedePromocionarse("cerrada")).toBe(false);
    expect(puedePromocionarse("no_disponible")).toBe(false);
  });
});

describe("esReciente", () => {
  const AHORA = Date.parse("2026-09-07T12:00:00Z");

  it("algo creado hace un minuto es reciente", () => {
    expect(esReciente(new Date(AHORA - 60_000).toISOString(), AHORA)).toBe(true);
  });

  it("justo en el borde de la ventana todavía cuenta", () => {
    expect(esReciente(new Date(AHORA - RECIENTE_MS).toISOString(), AHORA)).toBe(true);
  });

  it("un segundo más viejo que la ventana ya no", () => {
    expect(esReciente(new Date(AHORA - RECIENTE_MS - 1_000).toISOString(), AHORA)).toBe(false);
  });

  it("una fecha futura no enciende la etiqueta (reloj torcido)", () => {
    expect(esReciente(new Date(AHORA + 60_000).toISOString(), AHORA)).toBe(false);
  });

  it("una fecha ilegible no rompe la fila", () => {
    expect(esReciente("no soy una fecha", AHORA)).toBe(false);
  });
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
      estado: "lista",
      activePromotionEndsAt: null,
      href: "/impulsar/l1",
      thumbnailIsVideo: false,
    });
    expect(item.thumbnailUrl).toBe(
      `${SUPA}/storage/v1/object/public/listing-photos/tenant/user/frente.webp`,
    );
  });

  it("un boost vigente viaja como activePromotionEndsAt y deja el item en 'activa'", () => {
    const item = toListingImpulsarItem(BASE, "2026-09-01T00:00:00Z");
    expect(item.activePromotionEndsAt).toBe("2026-09-01T00:00:00Z");
    expect(item.estado).toBe("activa");
  });

  it("status distinto de published queda con su estado propio", () => {
    expect(toListingImpulsarItem({ ...BASE, status: "pending_review" }, null).estado).toBe(
      "en_revision",
    );
    expect(toListingImpulsarItem({ ...BASE, status: "expired" }, null).estado).toBe("vencida");
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
    body: "Vendo bici casi nueva",
    media: null,
    status: "published",
    created_at: "2026-08-01T00:00:00Z",
  };

  it("un post publicado se puede promocionar", () => {
    const item = toPostImpulsarItem(BASE, null);
    expect(item).toMatchObject({
      kind: "post",
      estado: "lista",
      href: "/impulsar-post/p1",
    });
  });

  it("un post en revisión no ofrece promoción", () => {
    const item = toPostImpulsarItem({ ...BASE, status: "pending_review" }, null);
    expect(item.estado).toBe("en_revision");
    expect(puedePromocionarse(item.estado)).toBe(false);
  });
});
