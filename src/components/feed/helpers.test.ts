import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canPromotePost,
  entityAccentVar,
  entityHref,
  entityKindLabel,
  feedPostVisibilityFilter,
  postMediaUrl,
} from "./helpers";

/**
 * Lógica pura del alcance del feed (feedback cliente 2026-07-19). Node env: el
 * módulo no tiene imports de runtime (solo `import type`), así que se testea
 * directo sin jsdom.
 */

describe("feedPostVisibilityFilter", () => {
  it("sin follows ni promos: solo posts personales (entity null)", () => {
    expect(feedPostVisibilityFilter([], [])).toBe("entity_listing_id.is.null");
  });

  it("con entidades seguidas: personal + esas entidades", () => {
    expect(feedPostVisibilityFilter(["a", "b"], [])).toBe(
      "entity_listing_id.is.null,entity_listing_id.in.(a,b)",
    );
  });

  it("con promociones activas: personal + esos post ids", () => {
    expect(feedPostVisibilityFilter([], ["p1", "p2"])).toBe(
      "entity_listing_id.is.null,id.in.(p1,p2)",
    );
  });

  it("combina las tres fuentes de alcance en un solo grupo OR", () => {
    expect(feedPostVisibilityFilter(["e1"], ["p1"])).toBe(
      "entity_listing_id.is.null,entity_listing_id.in.(e1),id.in.(p1)",
    );
  });

  it("el personal SIEMPRE es la primera condición (nunca se pierde)", () => {
    const parts = feedPostVisibilityFilter(["e1"], ["p1"]).split(",");
    expect(parts[0]).toBe("entity_listing_id.is.null");
  });
});

describe("canPromotePost", () => {
  it("el autor puede promocionar su propio post", () => {
    expect(canPromotePost("user-1", "user-1")).toBe(true);
  });

  it("otra persona no puede", () => {
    expect(canPromotePost("user-1", "user-2")).toBe(false);
  });

  it("anónimo (viewer null) no puede", () => {
    expect(canPromotePost("user-1", null)).toBe(false);
  });

  it("post de autor anónimo (author null) no es promocionable", () => {
    expect(canPromotePost(null, null)).toBe(false);
    expect(canPromotePost(null, "user-1")).toBe(false);
  });
});

describe("entityHref", () => {
  it("verticales con detalle por id linkean a su página", () => {
    expect(entityHref("property", "id-1")).toBe("/propiedades/id-1");
    expect(entityHref("professional", "id-1")).toBe("/profesionales/id-1");
    expect(entityHref("event", "id-1")).toBe("/eventos/id-1");
  });

  it("negocio cae al directorio (no hay página por-negocio aún)", () => {
    expect(entityHref("business", "id-1")).toBe("/negocios");
  });

  it("kind sin página no linkea (nombre sin link antes que link roto)", () => {
    expect(entityHref("job", "id-1")).toBeNull();
    expect(entityHref("desconocido", "id-1")).toBeNull();
  });
});

describe("entityKindLabel / entityAccentVar", () => {
  it("etiqueta legible por vertical, con respaldo", () => {
    expect(entityKindLabel("business")).toBe("Negocio");
    expect(entityKindLabel("event")).toBe("Evento");
    expect(entityKindLabel("otro")).toBe("Comunidad");
  });

  it("acento del módulo por vertical, con respaldo al del feed", () => {
    expect(entityAccentVar("negocios" as string)).toBe("var(--accent-feed)"); // kind desconocido
    expect(entityAccentVar("business")).toBe("var(--accent-negocios)");
    expect(entityAccentVar("event")).toBe("var(--accent-eventos)");
    expect(entityAccentVar("property")).toBe("var(--accent-vivienda)");
  });
});

describe("postMediaUrl", () => {
  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
  });

  it("path de storage → URL pública del bucket post-media", () => {
    expect(postMediaUrl("tenant/user/post-1.webp")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/post-media/tenant/user/post-1.webp",
    );
  });

  it("URL absoluta (seed/API) se respeta tal cual", () => {
    expect(postMediaUrl("https://cdn.example.com/x.jpg")).toBe(
      "https://cdn.example.com/x.jpg",
    );
  });
});
