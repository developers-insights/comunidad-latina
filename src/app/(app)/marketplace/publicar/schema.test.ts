import { describe, expect, it } from "vitest";
import { productDraftSchema } from "./schema";

/**
 * SPLIT TIENDAS/PARTICULARES (call con el cliente 2026-07-24): publicar dejó de
 * exigir tienda. El schema es la frontera donde eso se decide — el resto del
 * action (ownership de la tienda, rate limit, moderación) queda igual.
 */

const VALID = {
  title: "Zapatillas deportivas talla 9",
  description: "Poco uso, sin roturas, con caja original.",
  priceAmount: 45,
  category: "ropa_accesorios",
  condition: "usado",
} as const;

const STORE_ID = "11111111-1111-4111-8111-111111111111";

describe("productDraftSchema", () => {
  it("acepta un producto de particular con storeListingId null", () => {
    const parsed = productDraftSchema.safeParse({ ...VALID, storeListingId: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.storeListingId).toBeNull();
  });

  it("acepta un producto de particular sin la clave storeListingId", () => {
    const parsed = productDraftSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.storeListingId ?? null).toBeNull();
  });

  it("sigue aceptando el camino con tienda", () => {
    const parsed = productDraftSchema.safeParse({ ...VALID, storeListingId: STORE_ID });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.storeListingId).toBe(STORE_ID);
  });

  it("un storeListingId presente pero inválido NO pasa como particular", () => {
    // Opcional no significa "cualquier cosa": si mandás una tienda, es un uuid.
    const parsed = productDraftSchema.safeParse({ ...VALID, storeListingId: "no-soy-un-uuid" });
    expect(parsed.success).toBe(false);
  });

  it("el string vacío tampoco pasa: el form manda null explícito", () => {
    const parsed = productDraftSchema.safeParse({ ...VALID, storeListingId: "" });
    expect(parsed.success).toBe(false);
  });

  it("el resto de las reglas del borrador no se aflojan", () => {
    expect(productDraftSchema.safeParse({ ...VALID, title: "corto" }).success).toBe(false);
    expect(productDraftSchema.safeParse({ ...VALID, priceAmount: 0 }).success).toBe(false);
    expect(productDraftSchema.safeParse({ ...VALID, category: "inventada" }).success).toBe(false);
    expect(productDraftSchema.safeParse({ ...VALID, condition: "roto" }).success).toBe(false);
  });

  describe("fulfillment (envío/entrega/recogida)", () => {
    it("acepta uno o varios métodos del catálogo", () => {
      const parsed = productDraftSchema.safeParse({ ...VALID, fulfillment: ["envio", "recogida"] });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.fulfillment).toEqual(["envio", "recogida"]);
    });

    it("sin la clave (avisos viejos) sigue siendo válido — opcional a nivel schema", () => {
      expect(productDraftSchema.safeParse(VALID).success).toBe(true);
    });

    it("rechaza un método fuera del catálogo", () => {
      expect(
        productDraftSchema.safeParse({ ...VALID, fulfillment: ["teletransporte"] }).success,
      ).toBe(false);
    });

    it("rechaza más de 3 métodos", () => {
      expect(
        productDraftSchema.safeParse({
          ...VALID,
          fulfillment: ["envio", "entrega", "recogida", "envio"],
        }).success,
      ).toBe(false);
    });
  });
});
