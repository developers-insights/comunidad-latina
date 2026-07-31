"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import { getStaffContext, logAdminAction } from "../guard";
import { canStaffResolve } from "./policy";

/**
 * Server actions del panel de Empleos (/admin/empleos) — domain_admin+.
 *
 * QUÉ NO HACE ESTA ACTION, a propósito:
 *  - No estrena un canal de contacto. Avisa por `notifications` (kind
 *    `job_application_update`, href `/empleos/[id]`), exactamente el mismo
 *    camino que usa la respuesta del dueño en (app)/empleos/actions.ts.
 *  - No se hace pasar por el empleador. El copy dice que respondió el equipo de
 *    la comunidad, y el audit_log guarda QUIÉN del staff lo hizo.
 *  - No estrena semántica. Reusa la del embudo de la migración 0047:
 *    `hired`/`rejected`, monótona desde 'submitted' (el `.eq('status',
 *    'submitted')` acá y el trigger `app.job_applications_freeze` en la DB
 *    dicen lo mismo).
 *
 * ALINEACIÓN DE VOCABULARIO (2026-07-30). 0047 migró los estados:
 * `accepted`→`hired` y `declined`→`rejected`, y el CHECK de la tabla dejó de
 * admitir los viejos. Este archivo seguía escribiendo `accepted`/`declined`, o
 * sea que el botón del panel fallaba con una violación de CHECK. Se cambian
 * SOLO las dos constantes de estado: la política de divulgación (./policy.ts)
 * y el gate `canStaffResolve` no se tocan — son otra cosa y están auditados.
 *
 * El panel del staff sigue teniendo DOS decisiones (contratar / no seleccionar)
 * y no el embudo completo del dueño: mover a "en revisión" o "entrevista" es
 * hablar por el empleador sobre un proceso que la plataforma no conduce.
 *
 * Y solo se habilita sobre avisos de la PLATAFORMA (sin dueño miembro, o
 * publicados por este mismo staff) — ver ./policy.ts para el porqué.
 *
 * Escritura con el cliente del STAFF, nunca con admin client (el único que
 * aparece es para notificar, que es sistema). Desde la migración 0042
 * `job_applications_update` YA NO tiene rama de staff: permite mover a
 * accepted/declined solo a quien publicó el aviso, o a un domain_admin/
 * global_admin cuando el aviso no tiene dueño miembro. Es decir: la regla que
 * este archivo verifica en `canStaffResolve` es la MISMA que aplica la base.
 * Si esta action tuviera un bug de autorización, el UPDATE devolvería cero
 * filas igual — pero se verifica acá igual, para dar un mensaje humano en vez
 * de un "no pasó nada".
 */

const COPY = {
  notAllowed: "Esta sección es para administradores del dominio.",
  invalid: "No pudimos leer los datos — recargá la página e intentá de nuevo.",
  notPlatformJob:
    "Este aviso es de un miembro de la comunidad: la respuesta le toca a esa persona, no a la plataforma.",
  gone: "Esta postulación ya no está disponible.",
  alreadyResolved: "Alguien ya respondió esta postulación — la lista se actualizó.",
  genericError: "No pudimos guardar la respuesta — no es tu culpa. Probá de nuevo en un momento.",
  accepted: "Listo. Le avisamos que avanzan con su postulación.",
  declined: "Listo. Le avisamos con un mensaje amable.",
} as const;

export type JobsActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

const resolveSchema = z.object({
  applicationId: z.uuid(),
  decision: z.enum(["accept", "decline"]),
});

/** Vocabulario del embudo de 0047 — el CHECK de la tabla ya no admite otro. */
const NEXT_STATUS = { accept: "hired", decline: "rejected" } as const;

/**
 * Aviso al postulante. Nombra al actor con todas las letras: quien se postuló
 * espera respuesta de quien publicó el aviso — si contesta la plataforma, tiene
 * derecho a saberlo.
 */
function applicantNotice(
  decision: "accept" | "decline",
  jobTitle: string,
): { title: string; body: string } {
  if (decision === "accept") {
    return {
      title: `Avanzan con tu postulación a «${jobTitle}»`,
      body: "El equipo de la comunidad revisó tu postulación y quiere seguir. Entrá al aviso para ver cómo sigue.",
    };
  }
  return {
    title: `Novedades de tu postulación a «${jobTitle}»`,
    body: "El equipo de la comunidad cerró esta búsqueda. Se publican avisos nuevos todo el tiempo — seguí mirando.",
  };
}

export async function resolveJobApplication(
  _prev: JobsActionState,
  formData: FormData,
): Promise<JobsActionState> {
  // zod PURO primero: lo que no parsea no llega ni al guard.
  const parsed = resolveSchema.safeParse({
    applicationId: formData.get("applicationId"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { applicationId, decision } = parsed.data;

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;

  const { data: application, error: readError } = await supabase
    .from("job_applications")
    .select("id, job_id, applicant_id, tenant_id, status")
    .eq("id", applicationId)
    .maybeSingle();

  if (readError) {
    console.error("[admin/empleos] no se pudo leer la postulación:", readError.message);
    return { status: "error", message: COPY.genericError };
  }
  if (!application) return { status: "error", message: COPY.gone };

  /**
   * El tenant del JWT manda, para TODOS los roles.
   *
   * Antes acá había una excepción para global_admin, asumiendo que opera
   * cross-tenant. Con 0042 eso ya no es cierto: las policies exigen
   * `tenant_id = app.current_tenant_id()` sin rama de escape (se cayó el
   * `or app.is_global_admin()`), y ninguna pantalla del panel lee fuera del
   * tenant del JWT. Mantener la excepción sería describir un permiso que la
   * base no da.
   */
  if (!tenantId || application.tenant_id !== tenantId) {
    return { status: "error", message: COPY.notAllowed };
  }

  // El aviso REAL manda: la política de divulgación se re-evalúa server-side,
  // nunca se confía en que el botón haya estado habilitado en el cliente.
  // El `.eq(tenant_id)` es defensa en profundidad y no es decorativo: la rama
  // `status = 'published'` de `listings_select` (0004) es cross-tenant a
  // propósito (SEO), así que esta lectura NO queda acotada por la RLS sola.
  const { data: job, error: jobError } = await supabase
    .from("listings")
    .select("id, title, created_by, tenant_id")
    .eq("id", application.job_id)
    .eq("tenant_id", application.tenant_id)
    .eq("kind", "job")
    .maybeSingle();

  if (jobError) {
    console.error("[admin/empleos] no se pudo leer el aviso:", jobError.message);
    return { status: "error", message: COPY.genericError };
  }
  if (!job) return { status: "error", message: COPY.gone };

  if (!canStaffResolve({ createdBy: job.created_by, staffId: user.id })) {
    return { status: "error", message: COPY.notPlatformJob };
  }

  const { data: updated, error } = await supabase
    .from("job_applications")
    .update({ status: NEXT_STATUS[decision] })
    .eq("id", applicationId)
    // Monótona: una postulación resuelta no vuelve atrás ni se re-resuelve.
    .eq("status", "submitted")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[admin/empleos] update de postulación falló:", error.message);
    return { status: "error", message: COPY.genericError };
  }
  if (!updated) {
    // Cero filas tiene DOS causas y no dan el mismo mensaje: o alguien la
    // resolvió antes, o la RLS bloqueó la escritura. Decirle "ya la respondió
    // otra persona" a quien en realidad no tiene permiso lo manda a buscar un
    // problema que no existe. Se re-lee el status para saber cuál fue.
    const { data: current } = await supabase
      .from("job_applications")
      .select("status")
      .eq("id", applicationId)
      .maybeSingle();
    return {
      status: "error",
      message:
        current && current.status === "submitted" ? COPY.notAllowed : COPY.alreadyResolved,
    };
  }

  // Acceso administrativo con efecto sobre una persona → auditado. `meta` solo
  // ids (§5.4): jamás las respuestas ni el nombre de quien se postuló.
  await logAdminAction({
    actorId: user.id,
    action: decision === "accept" ? "job_application.accepted" : "job_application.declined",
    tenantId: application.tenant_id,
    subjectKind: "job_application",
    subjectId: applicationId,
    meta: { job_id: application.job_id, by: "staff" },
  });

  // Aviso al postulante (best-effort): notifications es insert de sistema (RLS
  // with check false) → admin client. Si falla, la decisión YA está guardada.
  try {
    const notice = applicantNotice(decision, job.title);
    await createNotification(createAdminClient(), {
      tenantId: application.tenant_id,
      profileId: application.applicant_id,
      kind: "job_application_update",
      category: "trabajos",
      priority: "high",
      title: notice.title,
      body: notice.body,
      href: `/empleos/${application.job_id}`,
    });
  } catch (notifyError) {
    console.warn("[admin/empleos] no se pudo avisar al postulante:", {
      applicationId,
      message: notifyError instanceof Error ? notifyError.message : "error desconocido",
    });
  }

  revalidatePath(`/admin/empleos/${application.job_id}`);
  revalidatePath("/admin/empleos");
  revalidatePath(`/empleos/${application.job_id}`);

  return {
    status: "success",
    message: decision === "accept" ? COPY.accepted : COPY.declined,
  };
}
