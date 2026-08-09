"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffContext, logAdminAction } from "../../guard";

/**
 * =============================================================================
 * ACCIONES DEL MODERADOR SOBRE UNA ALERTA DE INTEGRIDAD
 * =============================================================================
 *
 * Las tres del pliego —aprobar, bloquear, investigar— más `descartar` para el
 * falso positivo, que es el caso más frecuente de todos y merece un botón
 * propio en vez de esconderse dentro de "aprobar".
 *
 * DECISIÓN DE PRIVILEGIOS (verificada contra 0061):
 *   · `content_integrity_alerts` tiene UPDATE con rama de staff → se resuelve
 *     con el CLIENTE DEL STAFF, firmando como uno mismo, RLS aplicando.
 *   · `content_assets` NO tiene rama de staff para UPDATE: sus policies de
 *     escritura están en `false` para TODOS los JWT, staff incluido, porque las
 *     huellas las escribe el pipeline. Espejar el estado en `review_status` es
 *     entonces el único uso legítimo del admin client acá — y sólo DESPUÉS de
 *     haber verificado el rol y de que la alerta ya se resolvió.
 *   · El efecto sobre el CONTENIDO (bajar el post o el aviso bloqueado) va con
 *     el cliente del staff: `posts` y `listings` sí tienen rama de staff (0007 /
 *     0004), igual que en la cola de moderación general.
 *
 * UNA ALERTA NO SE BORRA, SE RESUELVE. No hay acción de delete y la policy
 * tampoco la permite: borrarla sería borrar el rastro de que alguien decidió.
 */

const COPY = {
  notStaff: "Tu sesión no tiene permisos de moderación. Entrá de nuevo e intentá otra vez.",
  invalid: "No pudimos leer la decisión — recargá la página e intentá de nuevo.",
  alreadyResolved: "Este caso ya lo resolvió otra persona del equipo — la lista se actualizó.",
  genericError:
    "No pudimos guardar la resolución — no es tu culpa. Probá de nuevo en un momento.",
} as const;

const schema = z.object({
  alertId: z.uuid(),
  decision: z.enum(["aprobar", "bloquear", "investigar", "descartar"]),
  note: z.string().trim().max(500).optional(),
});

/** Estado de la alerta según la decisión. Espeja el CHECK de la 0061. */
const ALERT_STATUS = {
  aprobar: "aprobado",
  bloquear: "bloqueado",
  investigar: "en_investigacion",
  descartar: "descartada",
} as const;

/**
 * Estado del ASSET según la decisión. Ojo con `descartar`: descartar la alerta
 * significa "esto era un falso positivo", así que el archivo queda APROBADO —
 * no en un limbo. Es la diferencia entre archivar el caso y archivar el archivo.
 */
const ASSET_STATUS = {
  aprobar: "aprobado",
  bloquear: "bloqueado",
  investigar: "en_investigacion",
  descartar: "aprobado",
} as const;

/** Estados desde los que una alerta todavía se puede resolver. */
const OPEN_STATUSES = ["abierta", "en_investigacion"] as const;

export type ResolveIntegrityState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function resolveIntegrityAlert(
  _prev: ResolveIntegrityState,
  formData: FormData,
): Promise<ResolveIntegrityState> {
  const parsed = schema.safeParse({
    alertId: formData.get("alertId"),
    decision: formData.get("decision"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { alertId, decision, note } = parsed.data;

  const ctx = await getStaffContext("moderator");
  if (!ctx) return { status: "error", message: COPY.notStaff };
  const { supabase, user } = ctx;

  // 1. Leer la alerta con el cliente del staff (RLS: sólo su tenant).
  const { data: alert, error: alertError } = await supabase
    .from("content_integrity_alerts")
    .select("id, tenant_id, asset_id, kind, status")
    .eq("id", alertId)
    .maybeSingle();

  if (alertError || !alert) return { status: "error", message: COPY.genericError };
  if (!OPEN_STATUSES.includes(alert.status as (typeof OPEN_STATUSES)[number])) {
    return { status: "error", message: COPY.alreadyResolved };
  }

  const nowIso = new Date().toISOString();

  // 2. Resolver la alerta. El `.in(status, …)` evita pisar la decisión de otro
  //    moderador que llegó primero: si ya no está abierta, no matchea fila.
  const { data: resolved, error: resolveError } = await supabase
    .from("content_integrity_alerts")
    .update({
      status: ALERT_STATUS[decision],
      resolved_by: user.id,
      resolved_at: nowIso,
      resolution_note: note ?? null,
    })
    .eq("id", alert.id)
    .in("status", [...OPEN_STATUSES])
    .select("id")
    .maybeSingle();

  if (resolveError) return { status: "error", message: COPY.genericError };
  if (!resolved) return { status: "error", message: COPY.alreadyResolved };

  // 3. Espejar el estado en el asset (admin client — ver la nota del módulo).
  //    Si esto falla, la alerta YA quedó resuelta y auditada: se loguea y se
  //    sigue, nunca se le devuelve un error a quien ya decidió.
  let subject: { kind: string; id: string | null } | null = null;
  try {
    const admin = createAdminClient();
    const { data: asset, error: assetError } = await admin
      .from("content_assets")
      .update({
        review_status: ASSET_STATUS[decision],
        reviewed_by: user.id,
        reviewed_at: nowIso,
        review_note: note ?? null,
      })
      .eq("id", alert.asset_id)
      .eq("tenant_id", alert.tenant_id)
      .select("subject_kind, subject_id")
      .maybeSingle();

    if (assetError) {
      console.error("[admin] no se pudo espejar el estado del asset:", assetError.message);
    } else if (asset) {
      subject = { kind: asset.subject_kind, id: asset.subject_id };
    }
  } catch (error) {
    console.error(
      "[admin] admin client no disponible para espejar el asset:",
      error instanceof Error ? error.message : "error desconocido",
    );
  }

  // 4. Bloquear tiene que MORDER. Un archivo bloqueado cuyo post sigue arriba
  //    es una decisión que no pasó nada: se baja el contenido que lo usa, con
  //    el cliente del staff (posts/listings sí tienen rama de staff en su RLS).
  if (decision === "bloquear" && subject?.id) {
    try {
      if (subject.kind === "post") {
        await supabase.from("posts").update({ status: "removed" }).eq("id", subject.id);
      } else if (subject.kind === "listing") {
        await supabase.from("listings").update({ status: "removed" }).eq("id", subject.id);
      }
      // portfolio / avatar / cover / guide: no tienen hoy un estado moderable.
      // La decisión queda asentada en el asset y en la alerta, que es el rastro.
    } catch (error) {
      console.error(
        "[admin] no se pudo bajar el contenido bloqueado:",
        error instanceof Error ? error.message : "error desconocido",
      );
    }
  }

  // 5. Auditoría (§5.4: sólo ids, jamás contenido).
  await logAdminAction({
    actorId: user.id,
    action: `integrity.${decision}`,
    tenantId: alert.tenant_id,
    subjectKind: "content_asset",
    subjectId: alert.asset_id,
    meta: { alert_id: alert.id, alert_kind: alert.kind },
  });

  revalidatePath("/admin/moderacion/integridad");
  revalidatePath("/admin", "layout");
  return { status: "success" };
}
