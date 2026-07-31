import { describe, expect, it } from "vitest";
import {
  FEED_PREVIEW_MAX_SECONDS,
  PREMIUM_DETAIL_MAX_SECONDS,
} from "@/lib/media/video-policy";
import {
  CTA_COLUMN,
  CTA_KINDS,
  EXTERNAL_CTA_KINDS,
  FREE_MAX_PHOTOS,
  MODULE_CTAS,
  PREMIUM_MAX_PHOTOS,
  canUseActionButtons,
  checkListingVideo,
  checkPhotoCount,
  externalCtasFor,
  isRecommendedFeedEligible,
  maxPhotosFor,
  maxVideoSecondsFor,
  parseCtaKind,
  parseListingTier,
  visibleCtasFor,
} from "./tier";

/**
 * Tests del contrato que se COBRA. Cada uno ancla un número o una regla que, si
 * se mueve sola, cambia lo que la persona recibe por su dinero.
 */

describe("parseListingTier", () => {
  it("sólo 'premium' es premium", () => {
    expect(parseListingTier("premium")).toBe("premium");
  });

  it.each([null, undefined, "", "free", "PREMIUM", 1, {}, "premium "])(
    "cae del lado restrictivo con %p",
    (raw) => {
      expect(parseListingTier(raw)).toBe("free");
    },
  );
});

describe("topes de fotos", () => {
  it("gratis son 5 y premium 20 (spec nº3)", () => {
    expect(FREE_MAX_PHOTOS).toBe(5);
    expect(PREMIUM_MAX_PHOTOS).toBe(20);
    expect(maxPhotosFor("free")).toBe(5);
    expect(maxPhotosFor("premium")).toBe(20);
  });

  it("acepta exactamente 5 fotos en gratis", () => {
    expect(checkPhotoCount("free", 5)).toEqual({ ok: true, count: 5 });
  });

  // EL TEST QUE PIDE EL CONTRATO: la sexta foto de un aviso gratuito se rechaza.
  it("RECHAZA la sexta foto de un aviso gratuito", () => {
    expect(checkPhotoCount("free", 6)).toEqual({
      ok: false,
      reason: "too-many",
      max: 5,
      count: 6,
    });
  });

  it("premium acepta 20 y rechaza 21", () => {
    expect(checkPhotoCount("premium", 20).ok).toBe(true);
    expect(checkPhotoCount("premium", 21).ok).toBe(false);
  });

  it("publicar sin fotos siempre fue válido", () => {
    expect(checkPhotoCount("free", 0)).toEqual({ ok: true, count: 0 });
  });

  it("un tier desconocido usa el tope de gratis, no el de premium", () => {
    expect(checkPhotoCount(undefined, 6).ok).toBe(false);
    expect(checkPhotoCount("Premium", 6).ok).toBe(false);
  });
});

describe("tope de video", () => {
  it("consume los segundos de video-policy en vez de re-declararlos", () => {
    expect(maxVideoSecondsFor("free")).toBe(FEED_PREVIEW_MAX_SECONDS);
    expect(maxVideoSecondsFor("premium")).toBe(PREMIUM_DETAIL_MAX_SECONDS);
  });

  it("gratis acepta 59 s y rechaza 60 s", () => {
    expect(checkListingVideo("free", 59)).toEqual({ ok: true, seconds: 59 });
    expect(checkListingVideo("free", 60)).toEqual({
      ok: false,
      reason: "too-long",
      max: 59,
    });
  });

  it("premium acepta los 5 minutos y rechaza el segundo siguiente", () => {
    expect(checkListingVideo("premium", 300).ok).toBe(true);
    expect(checkListingVideo("premium", 301).ok).toBe(false);
  });

  it("redondea HACIA ARRIBA: 59,4 s no entra en el tope gratuito", () => {
    // Heredado de normalizeDeclaredDuration — si redondeara hacia abajo, el
    // redondeo sería la forma barata de esquivar el tope.
    expect(checkListingVideo("free", 59.4)).toEqual({
      ok: false,
      reason: "too-long",
      max: 59,
    });
  });

  it("duración desconocida NO se trata como corta", () => {
    for (const raw of [null, undefined, 0, -3, Number.NaN, Infinity, "hola"]) {
      expect(checkListingVideo("free", raw)).toEqual({
        ok: false,
        reason: "unknown",
        max: 59,
      });
    }
  });
});

describe("botones externos", () => {
  it("gratis NO puede tener botones de acción", () => {
    expect(canUseActionButtons("free")).toBe(false);
    expect(canUseActionButtons(null)).toBe(false);
  });

  it("premium sí", () => {
    expect(canUseActionButtons("premium")).toBe(true);
  });

  // EL OTRO TEST QUE PIDE EL CONTRATO, en su forma pura: un aviso gratuito no
  // muestra NINGÚN botón externo, sólo el chat. (La imposibilidad de GUARDARLO
  // se prueba en actions.test.ts y la garantiza el CHECK de la 0048.)
  it("un aviso gratuito con los 7 valores cargados sólo ofrece el chat", () => {
    const values = {
      phone: "+1 305 555 0134",
      whatsapp: "+1 305 555 0134",
      website: "https://ejemplo.com",
      purchase: "https://ejemplo.com/comprar",
      tickets: "https://ejemplo.com/boletos",
      booking: "https://ejemplo.com/turnos",
      directions: "37-11 82nd St, Queens",
    };
    expect(visibleCtasFor({ kind: "business", tier: "free", values })).toEqual(["chat"]);
    expect(visibleCtasFor({ kind: "business", tier: "premium", values })).toEqual([
      "phone",
      "whatsapp",
      "website",
      "directions",
      "chat",
    ]);
  });

  it("el chat va SIEMPRE, incluso sin ningún valor cargado", () => {
    expect(visibleCtasFor({ kind: "property", tier: "premium" })).toEqual(["chat"]);
    expect(visibleCtasFor({ kind: "job", tier: "premium" })).toEqual(["chat"]);
  });

  it("un valor en blanco no pinta botón", () => {
    expect(
      visibleCtasFor({
        kind: "property",
        tier: "premium",
        values: { phone: "   ", whatsapp: null, directions: undefined },
      }),
    ).toEqual(["chat"]);
  });
});

describe("botones POR MÓDULO (los de la spec, no una lista genérica)", () => {
  it("Propiedades: Llamar · WhatsApp · Cómo llegar", () => {
    expect(MODULE_CTAS.property).toEqual(["phone", "whatsapp", "directions"]);
  });
  it("Eventos: Comprar boletos · Cómo llegar", () => {
    expect(MODULE_CTAS.event).toEqual(["tickets", "directions"]);
  });
  it("Marketplace: Comprar · Sitio web", () => {
    expect(MODULE_CTAS.product).toEqual(["purchase", "website"]);
  });
  it("Negocios: Llamar · WhatsApp · Sitio web · Cómo llegar", () => {
    expect(MODULE_CTAS.business).toEqual(["phone", "whatsapp", "website", "directions"]);
  });
  it("Profesionales: Reservar cita · Llamar · WhatsApp", () => {
    expect(MODULE_CTAS.professional).toEqual(["booking", "phone", "whatsapp"]);
  });
  it("un kind desconocido no inventa botones", () => {
    expect(externalCtasFor("marciano")).toEqual([]);
    expect(externalCtasFor(null)).toEqual([]);
  });
});

describe("contrato con la base (0048)", () => {
  it("los kinds de CTA espejan el CHECK de cta_clicks.cta_kind", () => {
    // Si esta lista se separa del CHECK, record_cta_click tira
    // INVALID_CTA_KIND y el clic se pierde en silencio.
    expect([...CTA_KINDS]).toEqual([
      "phone",
      "whatsapp",
      "website",
      "purchase",
      "tickets",
      "booking",
      "directions",
      "chat",
    ]);
  });

  it("los 7 externos mapean a las 7 columnas de listings", () => {
    expect(EXTERNAL_CTA_KINDS).toHaveLength(7);
    expect(EXTERNAL_CTA_KINDS.map((kind) => CTA_COLUMN[kind])).toEqual([
      "cta_phone",
      "cta_whatsapp",
      "cta_website",
      "cta_purchase_url",
      "cta_tickets_url",
      "cta_booking_url",
      "cta_address",
    ]);
  });

  it("parseCtaKind rechaza lo que la RPC rechazaría", () => {
    expect(parseCtaKind("whatsapp")).toBe("whatsapp");
    expect(parseCtaKind("email")).toBeNull();
    expect(parseCtaKind(null)).toBeNull();
  });
});

describe("distribución", () => {
  it("sólo premium entra al News Feed principal recomendado", () => {
    expect(isRecommendedFeedEligible("premium")).toBe(true);
    expect(isRecommendedFeedEligible("free")).toBe(false);
    expect(isRecommendedFeedEligible(undefined)).toBe(false);
  });
});
