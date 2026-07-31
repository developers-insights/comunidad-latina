import { describe, expect, it } from "vitest";
import { isVisibleInRecommendedFeed, recommendedFeedListingFilter } from "./feed";

const VIEWER = "99999999-9999-4999-8999-999999999999";
const FOLLOWED = "44444444-4444-4444-8444-444444444444";

describe("recommendedFeedListingFilter", () => {
  it("sin sesión ni seguidos, sólo premium entra", () => {
    expect(
      recommendedFeedListingFilter({ followedListingIds: [], viewerId: null }),
    ).toBe("tier.eq.premium");
  });

  /**
   * El bug clásico de este tipo de filtro: un `in.()` vacío. PostgREST lo
   * contesta con 400 y se lleva puesto el feed entero, no sólo los listings.
   */
  it("NUNCA emite un in.() vacío", () => {
    const filter = recommendedFeedListingFilter({
      followedListingIds: [],
      viewerId: VIEWER,
    });
    expect(filter).not.toContain("in.()");
    expect(filter).toBe(`tier.eq.premium,created_by.eq.${VIEWER}`);
  });

  it("suma los seguidos y el propio dueño", () => {
    expect(
      recommendedFeedListingFilter({
        followedListingIds: [FOLLOWED],
        viewerId: VIEWER,
      }),
    ).toBe(`tier.eq.premium,id.in.(${FOLLOWED}),created_by.eq.${VIEWER}`);
  });
});

describe("isVisibleInRecommendedFeed — espeja el filtro", () => {
  const scope = { followedListingIds: [FOLLOWED], viewerId: VIEWER };

  it("premium entra siempre", () => {
    expect(isVisibleInRecommendedFeed({ id: "x", tier: "premium" }, scope)).toBe(true);
  });

  it("gratis de un desconocido NO entra", () => {
    expect(
      isVisibleInRecommendedFeed({ id: "x", tier: "free", created_by: "otro" }, scope),
    ).toBe(false);
  });

  it("gratis de alguien que sigo SÍ entra (seguir ya es pedirlo)", () => {
    expect(isVisibleInRecommendedFeed({ id: FOLLOWED, tier: "free" }, scope)).toBe(true);
  });

  it("mi propio aviso gratuito entra: si no, parece que no se publicó", () => {
    expect(
      isVisibleInRecommendedFeed({ id: "x", tier: "free", created_by: VIEWER }, scope),
    ).toBe(true);
  });

  it("un tier ausente se trata como gratis, no como premium", () => {
    expect(isVisibleInRecommendedFeed({ id: "x", created_by: "otro" }, scope)).toBe(false);
  });
});
