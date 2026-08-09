"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PRICE_SLOTS, parseAmountToCents, slotKey, AMOUNT_ERROR_COPY } from "@/lib/pricing";
import { normalizeCurrency } from "@/lib/pricing/money";
import { getStaffContext, logAdminAction } from "../../guard";
import { canWriteTenant } from "../../scope";

/**
 * Server actions del EDITOR DE PRECIOS (solo `global_admin` desde esta ruta).
 *
 * ES DINERO: todo acá está escrito para fallar antes que cobrar mal.
 *
 *  · El monto NUNCA se convierte con `Number()`. Pasa por
 *    `parseAmountToCents`, que trabaja con strings y aritmética de enteros
 *    (ver la cabecera de `src/lib/pricing/money.ts`). Lo que se guarda es un
 *    entero de centavos, la misma unidad con la que Stripe cobra.
 *  · La casilla (producto + variante + intervalo) se valida contra el catálogo
 *    `PRICE_SLOTS`, no contra lo que vino del formulario. Un producto inventado
 *    no llega a la base: la rebota el `if`, no el CHECK.
 *  · La moneda es obligatoria y explícita. Un monto sin moneda no es un precio.
 *
 * QUIÉN AUTORIZA. Las policies de `tenant_prices` (0072) dejan escribir al
 * `domain_admin` de su propia comunidad y al `global_admin` en cualquiera. Esta
 * pantalla vive en `/admin/global`, que ya es sólo del súper admin, así que acá
 * se exige `global_admin` — y la base vuelve a decidir igual. Se escribe con el
 * CLIENTE DEL USUARIO, nunca con el admin client (§6 de ARQUITECTURA).
 *
 * EL HISTORIAL NO SE ESCRIBE DESDE ACÁ. Lo escribe el trigger
 * `app.record_tenant_price_change` (0072). Un historial que dependiera de que
 * una server action se acuerde de anotarlo dejaría de ser un historial el día
 * que alguien escriba desde otro lado.
 */

const COPY = {
  notAllowed: "Esta acción es solo para el súper admin de la plataforma.",
  unknownSlot: "Ese producto no existe en el catálogo de precios.",
  badCurrency: "La moneda va con tres letras — por ejemplo, USD.",
  genericError: "No pudimos guardar el precio — no es tu culpa. Probá de nuevo en un momento.",
  saved: (label: string, shown: string) => `Listo: ${label} pasa a costar ${shown}.`,
} as const;

export type PriceActionState =
  | { status: "idle" }
  | { status: "invalid" | "error"; message: string }
  | { status: "success"; message: string };

const schema = z.object({
  tenantId: z.uuid(),
  product: z.string().trim().min(1).max(40),
  variant: z.string().trim().min(1).max(40),
  interval: z.string().trim().min(1).max(20),
  amount: z.string().min(1).max(24),
  currency: z.string().trim().min(3).max(3),
});

export async function saveTenantPrice(
  _prev: PriceActionState,
  formData: FormData,
): Promise<PriceActionState> {
  const parsed = schema.safeParse({
    tenantId: formData.get("tenantId"),
    product: formData.get("product"),
    variant: formData.get("variant"),
    interval: formData.get("interval"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) return { status: "invalid", message: COPY.unknownSlot };
  const input = parsed.data;

  // La casilla tiene que existir en el catálogo. Se busca la definición real
  // en vez de confiar en los tres strings que llegaron: así el `label` del
  // mensaje de éxito también sale del catálogo y no del formulario.
  const slot = PRICE_SLOTS.find(
    (candidate) =>
      slotKey(candidate) ===
      slotKey({ product: input.product, variant: input.variant, interval: input.interval }),
  );
  if (!slot) return { status: "invalid", message: COPY.unknownSlot };

  const amount = parseAmountToCents(input.amount);
  if (!amount.ok) return { status: "invalid", message: AMOUNT_ERROR_COPY[amount.reason] };

  const currency = normalizeCurrency(input.currency);
  if (!currency) return { status: "invalid", message: COPY.badCurrency };

  const ctx = await getStaffContext("global_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  if (!canWriteTenant(ctx, input.tenantId)) {
    return { status: "error", message: COPY.notAllowed };
  }

  const { error } = await ctx.supabase.from("tenant_prices").upsert(
    {
      tenant_id: input.tenantId,
      product: slot.product,
      variant: slot.variant,
      billing_interval: slot.interval,
      amount_cents: amount.cents,
      currency,
      active: true,
      updated_by: ctx.user.id,
    },
    { onConflict: "tenant_id,product,variant,billing_interval" },
  );

  if (error) {
    console.error("[admin] guardar precio falló:", error.message);
    return { status: "error", message: COPY.genericError };
  }

  // Auditoría: el monto va en `meta` a propósito. `meta` no lleva contenido de
  // personas (§5.4) y un cambio de precio SIN el número no sirve para nada el
  // día que alguien pregunte por qué le cobraron distinto.
  await logAdminAction({
    actorId: ctx.user.id,
    action: "price.updated",
    tenantId: input.tenantId,
    subjectKind: "price",
    subjectId: null,
    meta: {
      producto: slot.product,
      variante: slot.variant,
      intervalo: slot.interval,
      centavos: amount.cents,
      moneda: currency,
    },
  });

  revalidatePath("/admin/global/precios");

  const shown = `${currency} ${(amount.cents / 100).toFixed(2)}`;
  return { status: "success", message: COPY.saved(slot.label, shown) };
}
