"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DISPUTAS_ADMIN_ERRORS,
  DISPUTE_DECISIONS,
  LIVE_DISPUTE_STATUSES,
  resolutionSchema,
  untypedSupabase,
} from "@/lib/integrity/disputes";
import { getStaffContext, logAdminAction } from "../../../guard";

/**
 * =============================================================================
 * RESOLVER UN RECLAMO DE CONTENIDO
 * =============================================================================
 *
 * DECISIÓN DE PRIVILEGIOS — el mismo reparto que `resolveIntegrityAlert`, y por
 * los mismos motivos verificados contra las policies:
 *
 *   · `content_disputes` tiene UPDATE con rama de staff (0086) → se resuelve con
 *     el CLIENTE DEL STAFF, firmando como uno mismo y con la RLS aplicando.
 *   · `content_assets` NO tiene rama de staff para UPDATE: sus policies de
 *     escritura están en `false` para TODOS los JWT (0061), porque las huellas
 *     las escribe el pipeline. Espejar `review_status` es por eso el único uso
 *     legítimo del admin client acá, y sólo DESPUÉS de haber verificado el rol y
 *     de que la disputa ya quedó resuelta.
 *   · Bajar la publicación que usa el archivo va con el cliente del staff:
 *     `posts` y `listings` sí tienen rama de staff (0007 / 0004).
 *
 * TRES REGLAS DE ESTADO QUE NO SON OBVIAS:
 *
 *  1. RESOLVER A FAVOR DEL RECLAMANTE BLOQUEA SIEMPRE. Es la única decisión con
 *     efecto punitivo, y tiene que morder: un archivo bloqueado cuyo post sigue
 *     arriba es una decisión que no pasó nada.
 *  2. DEVOLVER A `aprobado` ES CONDICIONAL. Sólo se levanta la pausa si el
 *     archivo sigue en `en_investigacion` — un archivo que un moderador bloqueó
 *     por otro motivo no se desbloquea porque un reclamo distinto se haya caído.
 *  3. Y SÓLO SI NO QUEDAN OTROS RECLAMOS VIVOS sobre el mismo archivo. Dos
 *     personas pueden reclamar el mismo contenido; cerrar uno no puede
 *     descongelar el que la otra todavía tiene abierto.
 *
 * UNA DISPUTA NO SE BORRA, SE RESUELVE — la policy de DELETE está en `false`.
 * Borrarla destruiría el rastro del reclamo y el de la decisión, para las dos
 * partes.
 */

export type ResolveDisputeState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function resolveDispute(
  _prev: ResolveDisputeState,
  formData: FormData,
): Promise<ResolveDisputeState> {
  try {
    const parsed = resolutionSchema.safeParse({
      disputeId: formData.get("disputeId"),
      decision: formData.get("decision"),
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { status: "error", message: DISPUTAS_ADMIN_ERRORS.invalid };

    const { disputeId, decision, note } = parsed.data;
    const spec = DISPUTE_DECISIONS[decision];

    if (spec.requiresNote && !note) {
      return { status: "error", message: DISPUTAS_ADMIN_ERRORS.noteRequired };
    }

    // Authz del lado servidor, SIEMPRE: una server action es un endpoint POST al
    // que se le puede pegar sin pasar por el panel.
    const ctx = await getStaffContext("moderator");
    if (!ctx) return { status: "error", message: DISPUTAS_ADMIN_ERRORS.notStaff };
    const { supabase, user } = ctx;

    // ---- 1. Leer la disputa con el cliente del staff (RLS: sólo su tenant) ---
    const { data: dispute, error: readError } = await untypedSupabase(supabase)
      .from("content_disputes")
      .select("id, tenant_id, asset_id, claim_kind, status, respondent_id")
      .eq("id", disputeId)
      .maybeSingle();

    if (readError) {
      console.error("[disputas] no se pudo leer el reclamo:", readError.message);
      return { status: "error", message: DISPUTAS_ADMIN_ERRORS.generic };
    }
    if (!dispute) return { status: "error", message: DISPUTAS_ADMIN_ERRORS.generic };

    const row = dispute as {
      id: string;
      tenant_id: string;
      asset_id: string;
      claim_kind: string;
      status: string;
      respondent_id: string | null;
    };

    if (!LIVE_DISPUTE_STATUSES.includes(row.status as (typeof LIVE_DISPUTE_STATUSES)[number])) {
      return { status: "error", message: DISPUTAS_ADMIN_ERRORS.alreadyResolved };
    }

    const nowIso = new Date().toISOString();
    const resolving = spec.disputeStatus !== "en_revision";

    // ---- 2. Resolver. El `.in(status, …)` evita pisar la decisión de otro ----
    const { data: updated, error: updateError } = await untypedSupabase(supabase)
      .from("content_disputes")
      .update({
        status: spec.disputeStatus,
        resolution_note: note ?? null,
        // "Tomar el caso" no es resolver: no firma ni sella fecha de resolución.
        resolved_by: resolving ? user.id : null,
        resolved_at: resolving ? nowIso : null,
      })
      .eq("id", row.id)
      .in("status", [...LIVE_DISPUTE_STATUSES])
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("[disputas] no se pudo resolver el reclamo:", updateError.message);
      return { status: "error", message: DISPUTAS_ADMIN_ERRORS.generic };
    }
    if (!updated) return { status: "error", message: DISPUTAS_ADMIN_ERRORS.alreadyResolved };

    // ---- 3. Efecto sobre el archivo -----------------------------------------
    // Si algo de acá falla, la disputa YA quedó resuelta y auditada: se loguea y
    // se sigue. Nunca se le devuelve un error a quien ya decidió.
    let subject: { kind: string; id: string | null } | null = null;

    if (spec.assetStatus) {
      let apply = true;

      // Levantar la pausa exige que no quede ningún otro reclamo vivo sobre el
      // mismo archivo (regla 3 de la cabecera).
      if (spec.restoreOnlyFromFrozen) {
        const { data: otherLive, error: otherError } = await untypedSupabase(supabase)
          .from("content_disputes")
          .select("id")
          .eq("asset_id", row.asset_id)
          .neq("id", row.id)
          .in("status", [...LIVE_DISPUTE_STATUSES])
          .limit(1);

        if (otherError) {
          console.error("[disputas] no se pudo verificar otros reclamos:", otherError.message);
          apply = false;
        } else if (Array.isArray(otherLive) && otherLive.length > 0) {
          apply = false;
        }
      }

      if (apply) {
        try {
          const admin = createAdminClient();
          let query = admin
            .from("content_assets")
            .update({
              review_status: spec.assetStatus,
              reviewed_by: user.id,
              reviewed_at: nowIso,
              review_note: note ?? null,
            })
            .eq("id", row.asset_id)
            .eq("tenant_id", row.tenant_id);

          // Sólo se descongela lo que esta revisión congeló (regla 2).
          if (spec.restoreOnlyFromFrozen) query = query.eq("review_status", "en_investigacion");

          const { data: asset, error: assetError } = await query
            .select("subject_kind, subject_id")
            .maybeSingle();

          if (assetError) {
            console.error("[disputas] no se pudo espejar el estado del asset:", assetError.message);
          } else if (asset) {
            subject = { kind: asset.subject_kind, id: asset.subject_id };
          }
        } catch (error) {
          console.error(
            "[disputas] admin client no disponible para espejar el asset:",
            error instanceof Error ? error.message : "error desconocido",
          );
        }
      }
    }

    // ---- 4. Bloquear tiene que morder ---------------------------------------
    if (spec.takesDownSubject && subject?.id) {
      try {
        if (subject.kind === "post") {
          await supabase.from("posts").update({ status: "removed" }).eq("id", subject.id);
        } else if (subject.kind === "listing") {
          await supabase.from("listings").update({ status: "removed" }).eq("id", subject.id);
        }
        // portfolio / avatar / cover / guide no tienen hoy un estado moderable.
        // La decisión queda asentada en el asset y en la disputa, que es el rastro.
      } catch (error) {
        console.error(
          "[disputas] no se pudo bajar el contenido bloqueado:",
          error instanceof Error ? error.message : "error desconocido",
        );
      }
    }

    // ---- 5. Auditoría (§5.4: sólo ids, jamás contenido) ----------------------
    await logAdminAction({
      actorId: user.id,
      action: `dispute.${spec.auditAction}`,
      tenantId: row.tenant_id,
      subjectKind: "content_dispute",
      subjectId: row.id,
      meta: {
        asset_id: row.asset_id,
        claim_kind: row.claim_kind,
        dispute_status: spec.disputeStatus,
        respondent_id: row.respondent_id,
      },
    });

    revalidatePath("/admin/moderacion/integridad/disputas");
    revalidatePath("/admin/moderacion/integridad");
    revalidatePath("/admin", "layout");
    return { status: "success" };
  } catch (error) {
    console.error(
      "[disputas] error inesperado al resolver:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return { status: "error", message: DISPUTAS_ADMIN_ERRORS.generic };
  }
}
