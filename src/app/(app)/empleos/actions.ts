"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import { sendEmailInBackground } from "@/lib/email";
import { getRecipientEmail } from "@/lib/email/recipients";
import { applicationReceivedEmail } from "@/lib/email/templates";
import { limit, HOUR_MS } from "@/lib/rate-limit";
import {
  parseJobAttrs,
  validateJobAnswers,
  type JobAnswer,
} from "@/components/empleos/helpers";

/**
 * POSTULACIONES a empleos (tabla `job_applications`, migración 0040).
 *
 * Reglas del archivo (§ server actions): zod PURO primero, `requireTenantMatch()`
 * después y ANTES de cualquier efecto colateral (rate limit, insert, aviso al
 * dueño), y la escritura SIEMPRE con el cliente del USUARIO — la RLS es la
 * frontera real. El admin client aparece solo para notificar/emails, que es
 * sistema, jamás para el insert principal.
 *
 * Las respuestas se validan SERVER-SIDE contra las preguntas REALES del aviso
 * (`listings.attrs.questions`): lo que mande el cliente es una sugerencia, no
 * la verdad. Y una vez guardadas quedan congeladas por trigger de DB
 * (`app.job_applications_freeze`), así el dueño del aviso —que puede hacer
 * UPDATE para aceptar/rechazar— no puede reescribir lo que respondió otra
 * persona.
 */

const GENERIC_ERROR =
  "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.";

const COPY = {
  needLogin: "Entrá a tu cuenta para postularte a este empleo.",
  unavailable: "Este aviso ya no está disponible.",
  ownJob: "Este aviso es tuyo. Acá abajo vas a ver a quienes se postulen.",
  invalid: "Revisá las respuestas: falta completar algo.",
  tooMany:
    "Te postulaste a muchos avisos en poco tiempo. Esperá un rato y seguimos.",
  updateFailed:
    "No pudimos actualizar esta postulación. Puede que ya la haya resuelto alguien más.",
} as const;

// ===========================================================================
// Postularse
// ===========================================================================

/**
 * Cota de seguridad, no regla de negocio: el aviso admite hasta 5 preguntas
 * (MAX_JOB_QUESTIONS), pero aceptamos algunas de más para que las respuestas a
 * preguntas viejas —el dueño puede editar el aviso— se descarten en silencio
 * en `validateJobAnswers` en vez de romper el envío entero.
 */
const MAX_SUBMITTED_ANSWERS = 20;

const answerSchema = z.object({
  questionId: z.string().min(1).max(40),
  /** boolean para yes_no; el texto exacto de la opción para multiple_choice. */
  answer: z.union([z.boolean(), z.string().max(80)]),
});

const applySchema = z.object({
  jobId: z.uuid(),
  message: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(1000))
    .nullish(),
  answers: z.array(answerSchema).max(MAX_SUBMITTED_ANSWERS),
});

export type ApplyToJobResult =
  | { ok: true; alreadyApplied?: boolean }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "invalid"
        | "own-job"
        | "rate-limited"
        | "error";
      message?: string;
    };

export async function applyToJobAction(input: {
  jobId: string;
  message?: string | null;
  answers: JobAnswer[];
}): Promise<ApplyToJobResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: COPY.invalid };
  }
  const { jobId, answers } = parsed.data;
  // Nota vacía = sin nota: no guardamos strings de aire.
  const message = parsed.data.message ? parsed.data.message : null;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.needLogin };
    }
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Cuota global + cuota por aviso: la segunda corta el bombardeo de
  // notificaciones/emails a UN dueño aunque la global tenga resto.
  if (
    !limit(`job-apply:${user.id}`, 30, HOUR_MS).ok ||
    !limit(`job-apply:${user.id}:${jobId}`, 3, HOUR_MS * 24).ok
  ) {
    return { ok: false, code: "rate-limited", message: COPY.tooMany };
  }

  // El aviso REAL: de acá salen las preguntas contra las que se valida y el
  // dueño al que se avisa. Nada de esto viene del cliente.
  const { data: job, error: jobError } = await supabase
    .from("listings")
    .select("id, title, attrs, created_by, tenant_id")
    .eq("id", jobId)
    .eq("kind", "job")
    .eq("status", "published")
    .maybeSingle();

  if (jobError) {
    console.warn("[empleos] no se pudo leer el aviso", { jobId, code: jobError.code });
    return { ok: false, code: "error", message: GENERIC_ERROR };
  }
  if (!job || job.tenant_id !== tenant.id) {
    return { ok: false, code: "error", message: COPY.unavailable };
  }
  if (job.created_by === user.id) {
    // No es un error rojo: es su propio aviso y la UI lo dice en tono amable.
    return { ok: false, code: "own-job", message: COPY.ownJob };
  }

  const { questions } = parseJobAttrs(job.attrs);
  const validated = validateJobAnswers(questions, answers);
  if (!validated.ok) {
    return { ok: false, code: "invalid", message: validated.message };
  }

  const { error } = await supabase.from("job_applications").insert({
    tenant_id: tenant.id,
    job_id: jobId,
    applicant_id: user.id,
    message,
    answers: validated.clean,
  });

  if (error) {
    // 23505: ya se había postulado a este aviso (unique job_id+applicant_id).
    if (error.code === "23505") {
      return { ok: true, alreadyApplied: true };
    }
    console.warn("[empleos] insert de postulación falló", { jobId, code: error.code });
    return { ok: false, code: "error", message: GENERIC_ERROR };
  }

  // Aviso al dueño (best-effort, espejo de sendListingMessageAction): el insert
  // de notifications es solo del sistema (RLS with check false) → admin client.
  // Si esto falla, la postulación YA está guardada — jamás rompe el resultado.
  try {
    if (job.created_by) {
      const admin = createAdminClient();
      await createNotification(admin, {
        tenantId: job.tenant_id,
        profileId: job.created_by,
        kind: "job_application",
        title: `Nueva postulación para "${job.title}"`,
        body: "Entrá al aviso para leer sus respuestas y decidir.",
        href: `/empleos/${jobId}`,
        // Varias postulaciones sin leer al mismo aviso = UNA notificación.
        dedupeUnread: true,
      });

      // Email al dueño (fire-and-forget). Minimización §11: del postulante
      // viaja SOLO su display_name — ni respuestas ni nota van por mail.
      const [fullTenant, ownerEmail, { data: applicant }] = await Promise.all([
        getTenant(),
        getRecipientEmail(admin, job.created_by),
        supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      ]);
      if (ownerEmail) {
        const mail = applicationReceivedEmail({
          jobId,
          jobTitle: job.title,
          applicantDisplayName: applicant?.display_name ?? "Alguien de la comunidad",
          tenantName: fullTenant.name,
          brandHex: fullTenant.brandHex,
        });
        sendEmailInBackground({ to: ownerEmail, subject: mail.subject, html: mail.html });
      }
    }
  } catch (notifyError) {
    // Sin PII: solo el id del aviso y el error técnico.
    console.warn("[empleos] no se pudo avisar al dueño del aviso:", {
      jobId,
      message: notifyError instanceof Error ? notifyError.message : "error desconocido",
    });
  }

  revalidatePath(`/empleos/${jobId}`);
  return { ok: true };
}

// ===========================================================================
// Resolver una postulación (aceptar / rechazar / retirar)
// ===========================================================================

const updateSchema = z.object({
  applicationId: z.uuid(),
  action: z.enum(["accept", "decline", "withdraw"]),
});

const NEXT_STATUS = {
  accept: "accepted",
  decline: "declined",
  withdraw: "withdrawn",
} as const;

export type UpdateJobApplicationResult =
  | { ok: true; status: "accepted" | "declined" | "withdrawn" }
  | {
      ok: false;
      code: "unauthenticated" | "tenant-mismatch" | "invalid" | "error";
      message?: string;
    };

/** Copy cálido para quien se postuló: aceptar y rechazar no se anuncian igual. */
function applicantNotice(
  action: "accept" | "decline",
  jobTitle: string,
): { title: string; body: string } {
  if (action === "accept") {
    return {
      title: `¡Buenas noticias! Te aceptaron para «${jobTitle}»`,
      body: "Quien publicó el aviso quiere avanzar con vos. Entrá para ver los próximos pasos.",
    };
  }
  return {
    title: `Novedades de tu postulación a «${jobTitle}»`,
    body: "Esta vez eligieron a otra persona. Seguí mirando: en la comunidad se publican avisos nuevos todo el tiempo.",
  };
}

export async function updateJobApplicationAction(input: {
  applicationId: string;
  action: "accept" | "decline" | "withdraw";
}): Promise<UpdateJobApplicationResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: GENERIC_ERROR };
  }
  const { applicationId, action } = parsed.data;
  const nextStatus = NEXT_STATUS[action];

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.needLogin };
    }
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase } = guard;

  // Quién y de qué aviso — para el aviso posterior y para revalidar la ruta.
  // La RLS de SELECT ya limita esto a las partes (postulante y dueño) + staff:
  // si no hay fila acá, tampoco la va a haber en el UPDATE.
  const { data: application } = await supabase
    .from("job_applications")
    .select("id, job_id, applicant_id")
    .eq("id", applicationId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (!application) {
    return { ok: false, code: "error", message: COPY.updateFailed };
  }

  // La RLS de job_applications autoriza el ROL (postulante→withdrawn, dueño→
  // accepted/declined); acá no lo re-chequeamos. El `.eq('status','submitted')`
  // evita reprocesar una ya resuelta: si nadie matchea, no hay fila.
  const { data: updated, error } = await supabase
    .from("job_applications")
    .update({ status: nextStatus })
    .eq("id", applicationId)
    .eq("tenant_id", tenant.id)
    .eq("status", "submitted")
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[empleos] update de postulación falló", {
      applicationId,
      code: error.code,
    });
    return { ok: false, code: "error", message: COPY.updateFailed };
  }
  if (!updated) {
    return { ok: false, code: "error", message: COPY.updateFailed };
  }

  // Aviso al POSTULANTE (best-effort): que se entere sin tener que volver a
  // entrar. `withdraw` lo hace la propia persona — no se auto-notifica.
  if (action !== "withdraw") {
    try {
      const { data: job } = await supabase
        .from("listings")
        .select("title")
        .eq("id", application.job_id)
        .maybeSingle();
      const notice = applicantNotice(action, job?.title ?? "el aviso");
      await createNotification(createAdminClient(), {
        tenantId: tenant.id,
        profileId: application.applicant_id,
        kind: "job_application_update",
        title: notice.title,
        body: notice.body,
        href: `/empleos/${application.job_id}`,
      });
    } catch (notifyError) {
      console.warn("[empleos] no se pudo avisar al postulante:", {
        applicationId,
        message: notifyError instanceof Error ? notifyError.message : "error desconocido",
      });
    }
  }

  revalidatePath(`/empleos/${application.job_id}`);
  return { ok: true, status: nextStatus };
}
