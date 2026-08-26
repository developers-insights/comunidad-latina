import { z } from "zod";
import { isFulfillmentMethod, isProductCategory } from "@/components/marketplace/helpers";

/**
 * Schema del borrador de producto.
 *
 * Vive fuera de `actions.ts` porque un módulo `"use server"` sólo puede exportar
 * funciones async: acá el schema queda importable desde los tests sin arrastrar
 * el runtime del server action.
 *
 * SPLIT TIENDAS/PARTICULARES (call con el cliente 2026-07-24): `storeListingId`
 * pasó a ser OPCIONAL. Con tienda, el producto cuelga de ese negocio
 * (`attrs.store_listing_id`); sin tienda, se publica a nombre de la persona y
 * `attrs` sale SIN esa clave — esa ausencia es, literalmente, "particular"
 * (ver parseProductAttrs + SellerChip).
 */

export const PRODUCT_CONDITION_VALUES = ["nuevo", "usado"] as const;

export const productDraftSchema = z.object({
  /** null | undefined = vende un particular. */
  storeListingId: z.uuid().nullish(),
  title: z.string().trim().min(8).max(120),
  description: z.string().trim().min(10).max(4000),
  priceAmount: z.number().positive().max(1_000_000),
  category: z.string().refine(isProductCategory, "categoría inválida"),
  condition: z.enum(PRODUCT_CONDITION_VALUES).nullish(),
  /**
   * Envío / entrega / recogida (§ spec cliente: "todos los vendedores deben
   * completar…"). Opcional al nivel del schema —igual que `condition`— para no
   * romper avisos ya publicados sin este campo; el formulario SÍ lo exige
   * antes de dejar enviar (ver publish-form.tsx). Hasta 3: son todos los
   * valores que existen en el catálogo, así que más que eso es basura.
   */
  fulfillment: z
    .array(z.string().refine(isFulfillmentMethod, "método de entrega inválido"))
    .max(3)
    .nullish(),
});

export type DraftInput = z.input<typeof productDraftSchema>;
