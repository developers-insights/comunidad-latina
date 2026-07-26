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
});
