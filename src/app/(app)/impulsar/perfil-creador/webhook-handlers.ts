import type Stripe from "stripe";
import {
  diagnosticoDeCobro,
  metadataString,
  motivoDeDiscrepancia,
  pactadoFromRow,
} from "@/lib/monetization/pactado";
import { createNotification } from "@/lib/notifications/notify";
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";

type AdminClient = ReturnType<typeof createAdminClient>;

export const METADATA_IMPULSO_DE_PERFIL = "creator_profile_boost_id";

export function idDeImpulsoDePerfil(session: Stripe.Checkout.Session): string | null {
  return metadataString(session.metadata, METADATA_IMPULSO_DE_PERFIL);
}

/**
 * Misma disciplina que `activateBoost` / `activatePostPromotion` del webhook:
 * sólo activa si sigue pending_payment, si la sesión es la vinculada y si monto
 * y moneda coinciden con la fila. Discrepancia → log y NO activar (sin throw:
 * reintentar no lo arregla). El `status = pending_payment` va también en el
 * WHERE porque `completed` y `async_payment_succeeded` pueden llegar a la vez.
 */
export async function activarImpulsoDePerfil(
  admin: AdminClient,
  impulsoId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const { data: fila, error: selectError } = await admin
    .from("creator_profile_boosts")
    .select(
      "id, tenant_id, creator_id, duration_days, status, amount_cents, currency, stripe_checkout_session_id",
    )
    .eq("id", impulsoId)
    .maybeSingle();
  if (selectError) throw new Error(`select creator_profile_boosts: ${selectError.code}`);
  if (!fila) {
    console.warn(`[pagos:webhook] impulso de perfil ${impulsoId} no existe — se ignora.`);
    return;
  }
  if (fila.status === "active") return;
  if (fila.status !== "pending_payment") {
    console.error(
      `[pagos:webhook] ALERTA impulso de perfil ${impulsoId}: pago confirmado (${session.id}) pero está "${fila.status}" — NO se activa. Revisar refund en el Dashboard.`,
    );
    return;
  }
  if (!fila.stripe_checkout_session_id || fila.stripe_checkout_session_id !== session.id) {
    console.error(
      `[pagos:webhook] ALERTA impulso de perfil ${impulsoId}: la sesión ${session.id} no coincide con la vinculada (${fila.stripe_checkout_session_id ?? "ninguna"}) — NO se activa.`,
    );
    return;
  }

  const pactado = pactadoFromRow(fila);
  if (!pactado) {
    console.error(
      `[pagos:webhook] ALERTA impulso de perfil ${impulsoId}: la fila no tiene un precio legible — NO se activa. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }
  if (typeof session.amount_total !== "number" || typeof session.currency !== "string") {
    console.error(
      `[pagos:webhook] ALERTA impulso de perfil ${impulsoId}: la sesión ${session.id} no trae monto y moneda verificables — NO se activa. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }
  const discrepancia = motivoDeDiscrepancia(session, pactado);
  if (discrepancia) {
    console.error(
      `[pagos:webhook] ALERTA impulso de perfil ${impulsoId}: ${discrepancia} — NO se activa. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + fila.duration_days * 86_400_000);

  const { data: activadas, error: updateError } = await admin
    .from("creator_profile_boosts")
    .update({
      status: "active",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      updated_at: startsAt.toISOString(),
    })
    .eq("id", fila.id)
    .eq("status", "pending_payment")
    .select("id");
  if (updateError) throw new Error(`update creator_profile_boosts: ${updateError.code}`);
  if ((activadas ?? []).length === 0) {
    console.warn(
      `[pagos:webhook] impulso de perfil ${fila.id}: otra entrega del pago (${session.id}) lo activó primero.`,
    );
    return;
  }

  await createNotification(admin, {
    tenantId: fila.tenant_id,
    profileId: fila.creator_id,
    kind: "creator_profile_boost",
    category: "publicidad",
    ignorePrefs: true,
    title: "¡Tu perfil ya está promocionado!",
    body: `Aparecés primero en el directorio de creadores, marcado como "Patrocinado", hasta el ${formatDate(endsAt, { style: "long" })}.`,
    href: "/creadores/buscar",
  });
  const { error: auditError } = await admin.from("audit_log").insert({
    tenant_id: fila.tenant_id,
    actor_id: fila.creator_id,
    action: "creator_profile_boost_activated",
    subject_kind: "creator_profile_boost",
    subject_id: fila.id,
    meta: { duration_days: fila.duration_days },
  });
  if (auditError) {
    console.error(
      `[pagos:webhook] impulso de perfil ${fila.id} quedó ACTIVO pero no se pudo auditar — code=${auditError.code}.`,
    );
  }
}
