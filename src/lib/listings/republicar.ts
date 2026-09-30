import type { SupabaseClient } from "@supabase/supabase-js";
import { TIER_HUMAN } from "@/lib/moderation";

export interface DecisionDeRepublicar {
  statusPrevio: string;
  textoMarcado: boolean;
  tier: number;
  /** Fotos o video nuevos sin revisar, o integridad que pidió humano. */
  mediaPendiente: boolean;
}

/**
 * Sólo vuelve a la vista lo que YA estaba a la vista. Un aviso pausado sigue
 * pausado, y uno que esperaba revisión no se publica porque su dueño lo tocó.
 */
export function vuelveAPublicarse(d: DecisionDeRepublicar): boolean {
  return (
    d.statusPrevio === "published" &&
    !d.textoMarcado &&
    d.tier !== TIER_HUMAN &&
    !d.mediaPendiente
  );
}

const FECHAS_DE_VENCIMIENTO = "expires_at, expiry_warn_at, expiry_warned_at";

type FechasDeVencimiento = {
  expires_at: string | null;
  expiry_warn_at: string | null;
  expiry_warned_at: string | null;
};

export type RepublicarResultado =
  | { ok: true }
  | { ok: false; motivo: "sin_fila" | "error"; code?: string };

/**
 * Devuelve a `published` un aviso que la edición del dueño bajó a
 * `pending_review`. Necesita el admin client: el WITH CHECK de `listings_update`
 * no deja al dueño escribir `published`.
 *
 * Dos cosas que NO puede hacer, y por eso no es un `update({status})` pelado:
 *  - Tocar `published_at`: editar no puede ser un boost gratis (misma doctrina
 *    que `renovar_publicacion`, 0098).
 *  - Reiniciar el vencimiento: `listings_set_expiry` recalcula el plazo en cada
 *    transición a `published`, así que editar sería una renovación gratis que
 *    esquiva el tope de la comunidad. Se leen las fechas antes y se reponen
 *    después; el segundo UPDATE ya no dispara el recálculo porque la fila llega
 *    publicada.
 */
export async function republicarAvisoEditado(
  admin: SupabaseClient,
  ids: { listingId: string; tenantId: string; userId: string },
): Promise<RepublicarResultado> {
  const { data: previo, error: readError } = await admin
    .from("listings")
    .select(FECHAS_DE_VENCIMIENTO)
    .eq("id", ids.listingId)
    .eq("tenant_id", ids.tenantId)
    .eq("created_by", ids.userId)
    .eq("status", "pending_review")
    .maybeSingle();
  if (readError) return { ok: false, motivo: "error", code: readError.code };
  if (!previo) return { ok: false, motivo: "sin_fila" };
  const fechas = previo as FechasDeVencimiento;

  // El candado `status = pending_review`: si moderación lo bajó entre la
  // edición y acá, no se resucita.
  const { data: publicado, error: publishError } = await admin
    .from("listings")
    .update({ status: "published" })
    .eq("id", ids.listingId)
    .eq("tenant_id", ids.tenantId)
    .eq("created_by", ids.userId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (publishError) return { ok: false, motivo: "error", code: publishError.code };
  if (!publicado) return { ok: false, motivo: "sin_fila" };

  const { error: restoreError } = await admin
    .from("listings")
    .update({
      expires_at: fechas.expires_at,
      expiry_warn_at: fechas.expiry_warn_at,
      expiry_warned_at: fechas.expiry_warned_at,
    })
    .eq("id", ids.listingId)
    .eq("tenant_id", ids.tenantId)
    .eq("created_by", ids.userId)
    .eq("status", "published");
  if (restoreError) {
    console.warn("[listings] el aviso volvió a publicarse pero no se repuso su vencimiento", {
      listingId: ids.listingId,
      code: restoreError.code,
    });
  }
  return { ok: true };
}
