"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmailInBackground } from "@/lib/email";
import { getRecipientEmail } from "@/lib/email/recipients";
import { applicationReceivedEmail } from "@/lib/email/templates";
import { limit, HOUR_MS } from "@/lib/rate-limit";
import {
  canAdvance,
  canApplicantWithdraw,
  isEmployerStatus,
  toJobApplicationStatus,
  type EmployerStatus,
} from "@/lib/empleos/application-status";
import {
  CV_BUCKET,
  MAX_PORTFOLIO_LINKS,
  isOwnCvPath,
  normalizePortfolioLinks,
  validateStoredCv,
} from "@/lib/empleos/cv";
import {
  notifyApplicantStatus,
  notifyApplicationSent,
  notifyEmployerNewApplication,
  notifyEmployerWithdrawal,
} from "@/lib/empleos/notify";
import {
  parseJobAttrs,
  validateJobAnswers,
  type JobAnswer,
} from "@/components/empleos/helpers";

/**
 * FLUJO DE RECLUTAMIENTO (tabla `job_applications`, migraciones 0040 + 0047).
 *
 * Reglas del archivo (§ server actions): zod PURO primero, `requireTenantMatch()`
 * después y ANTES de cualquier efecto colateral (rate limit, insert, aviso al
 * dueño), y la escritura SIEMPRE con el cliente del USUARIO — la RLS es la
 * frontera real. El admin client aparece solo para notificar/emails, que es
 * sistema, jamás para el insert principal.
 *
 * ── LO QUE ESTE ARCHIVO CUIDA, ADEMÁS DE LO OBVIO ──────────────────────────
 *
 * 1. EL CURRÍCULUM. El navegador lo sube DIRECTO al bucket privado `job-cvs`
 *    (la policy `job_cvs_insert` valida el prefijo {tenant}/{user} contra el
 *    JWT). Acá llega solo la RUTA, así que se re-verifica que sea del prefijo
 *    de quien firma el request — mismo patrón que `videoPaths` en el composer
 *    del feed. Y se leen los metadatos REALES del objeto (`storage.info`) para
 *    validar tipo y tamaño con lo que registró el servidor, no con lo que
 *    declaró el `File.type` del cliente.
 *
 * 2. EL EMBUDO. La base solo deja AVANZAR (trigger `job_applications_freeze`).
 *    La action consulta la misma máquina de estados que la UI antes de
 *    intentar el UPDATE: si la transición no es válida, se contesta con una
 *    frase en castellano en vez de dejar que Postgres tire PROTECTED_TRANSITION.
 *
 * 3. LA NOTA PRIVADA (`job_application_notes`). El candidato NO es sujeto de
 *    ninguna policy de esa tabla. Acá tampoco existe un camino que se la
 *    devuelva: no hay una sola lectura de notas fuera de la del propio autor.
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
  candidateHidden:
    "Esta persona eligió no compartir su perfil, así que no podés escribirle por chat. Podés responderle desde su postulación.",
  candidateWithdrew: "Esta persona retiró su postulación.",
  cvRejected:
    "Ese archivo no nos sirve como currículum. Tiene que ser PDF o Word y pesar menos de 5 MB.",
  cvNotYours: "Ese archivo no es tuyo. Volvé a adjuntar tu currículum.",
  portfolioTooMany: "Podés sumar hasta 5 enlaces de portafolio.",
  portfolioInvalid:
    "Revisá los enlaces: cada uno tiene que empezar con http:// o https://.",
  cannotAdvance:
    "Esta postulación ya se resolvió y no vuelve atrás. Actualizá la pantalla para ver cómo quedó.",
  cannotWithdraw: "Esta postulación ya se resolvió, así que no hay nada que retirar.",
  noteSaved: "Guardamos tu nota.",
  noteFailed: "No pudimos guardar la nota — probá de nuevo en un ratito.",
  savedCandidate: "Lo guardamos en tu lista para futuras vacantes.",
  saveFailed: "No pudimos guardarlo — probá de nuevo en un ratito.",
} as const;

/** Cliente Supabase tipado del guard (evita repetir el genérico en cada helper). */
type GuardedClient = Awaited<ReturnType<typeof requireTenantMatch>>["supabase"];

// ===========================================================================
// Subida del currículum: el navegador escribe DIRECTO en el bucket
// ===========================================================================

export type PrepareCvUploadResult =
  | { ok: true; tenantId: string; userId: string; bucket: string }
  | {
      ok: false;
      code: "unauthenticated" | "tenant-mismatch" | "error";
      message?: string;
    };

/**
 * Espejo de `prepareMediaUploadAction` del feed: el prefijo {tenant}/{user} del
 * path lo entrega el SERVIDOR, nunca lo compone el cliente con datos suyos.
 * (La policy de Storage lo valida igual contra el JWT — esto es para que el
 * navegador no arme una ruta que va a rebotar.)
 */
export async function prepareCvUploadAction(): Promise<PrepareCvUploadResult> {
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
  return {
    ok: true,
    tenantId: guard.tenant.id,
    userId: guard.user.id,
    bucket: CV_BUCKET,
  };
}

/**
 * Borra un objeto que quedó huérfano (se subió pero la postulación no salió).
 * Best-effort y SOLO sobre el prefijo propio: si el path fuera ajeno, la policy
 * `job_cvs_delete` lo rechazaría, pero ni siquiera se intenta.
 */
async function removeOrphanCv(
  supabase: GuardedClient,
  path: string,
  tenantId: string,
  userId: string,
): Promise<void> {
  if (!isOwnCvPath(path, tenantId, userId)) return;
  try {
    await supabase.storage.from(CV_BUCKET).remove([path]);
  } catch {
    // Sin drama: el archivo queda en el prefijo propio, no lo ve nadie más.
  }
}

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
  /** Ruta dentro de `job-cvs`, no una URL. La forma se re-valida más abajo. */
  cvPath: z.string().min(3).max(400).nullish(),
  portfolioLinks: z.array(z.string().max(400)).max(MAX_PORTFOLIO_LINKS + 1).optional(),
  /** Consentimiento de mostrarle el perfil a quien contrata. */
  shareProfile: z.boolean().optional(),
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
        | "cv"
        | "portfolio"
        | "error";
      message?: string;
    };

export async function applyToJobAction(input: {
  jobId: string;
  message?: string | null;
  answers: JobAnswer[];
  cvPath?: string | null;
  portfolioLinks?: string[];
  shareProfile?: boolean;
}): Promise<ApplyToJobResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: COPY.invalid };
  }
  const { jobId, answers } = parsed.data;
  // Nota vacía = sin nota: no guardamos strings de aire.
  const message = parsed.data.message ? parsed.data.message : null;
  const shareProfile = parsed.data.shareProfile ?? true;

  const portfolio = normalizePortfolioLinks(parsed.data.portfolioLinks ?? []);
  if (!portfolio.ok) {
    return {
      ok: false,
      code: "portfolio",
      message:
        portfolio.code === "too-many" ? COPY.portfolioTooMany : COPY.portfolioInvalid,
    };
  }

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

  // ---- Currículum: pertenencia del prefijo + metadatos REALES del objeto ----
  // El path llega del navegador. La policy de Storage ya impidió SUBIR a un
  // prefijo ajeno, pero nada impide MANDAR acá el path de otra persona: ese
  // objeto existe y lo subió su dueño. El CHECK job_applications_cv_path lo
  // frenaría en la base; esto lo frena antes y con un mensaje que se entiende.
  const cvPath = parsed.data.cvPath ? parsed.data.cvPath : null;
  if (cvPath) {
    if (!isOwnCvPath(cvPath, tenant.id, user.id)) {
      return { ok: false, code: "cv", message: COPY.cvNotYours };
    }
    const { data: info, error: infoError } = await supabase.storage
      .from(CV_BUCKET)
      .info(cvPath);
    // Tipo y tamaño contra lo que Storage REGISTRÓ, no contra lo que declaró el
    // cliente: `File.type` lo elige el navegador y se puede mentir sin esfuerzo.
    const stored = infoError || !info ? null : validateStoredCv(info);
    if (!stored || !stored.ok) {
      await removeOrphanCv(supabase, cvPath, tenant.id, user.id);
      return { ok: false, code: "cv", message: COPY.cvRejected };
    }
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
    if (cvPath) await removeOrphanCv(supabase, cvPath, tenant.id, user.id);
    return { ok: false, code: "error", message: GENERIC_ERROR };
  }
  if (!job || job.tenant_id !== tenant.id) {
    if (cvPath) await removeOrphanCv(supabase, cvPath, tenant.id, user.id);
    return { ok: false, code: "error", message: COPY.unavailable };
  }
  if (job.created_by === user.id) {
    // No es un error rojo: es su propio aviso y la UI lo dice en tono amable.
    if (cvPath) await removeOrphanCv(supabase, cvPath, tenant.id, user.id);
    return { ok: false, code: "own-job", message: COPY.ownJob };
  }

  const { questions } = parseJobAttrs(job.attrs);
  const validated = validateJobAnswers(questions, answers);
  if (!validated.ok) {
    if (cvPath) await removeOrphanCv(supabase, cvPath, tenant.id, user.id);
    return { ok: false, code: "invalid", message: validated.message };
  }

  const { error } = await supabase.from("job_applications").insert({
    tenant_id: tenant.id,
    job_id: jobId,
    applicant_id: user.id,
    message,
    answers: validated.clean,
    cv_url: cvPath,
    portfolio_links: portfolio.links,
    share_profile: shareProfile,
  });

  if (error) {
    // 23505: ya se había postulado a este aviso (unique job_id+applicant_id).
    if (error.code === "23505") {
      await removeOrphanCv(supabase, cvPath ?? "", tenant.id, user.id);
      return { ok: true, alreadyApplied: true };
    }
    console.warn("[empleos] insert de postulación falló", { jobId, code: error.code });
    if (cvPath) await removeOrphanCv(supabase, cvPath, tenant.id, user.id);
    return { ok: false, code: "error", message: GENERIC_ERROR };
  }

  // Aviso a las dos partes (best-effort, espejo de sendListingMessageAction):
  // el insert de notifications es solo del sistema (RLS with check false) →
  // admin client. Si esto falla, la postulación YA está guardada.
  try {
    const admin = createAdminClient();
    await notifyApplicationSent(admin, {
      tenantId: tenant.id,
      applicantId: user.id,
      jobTitle: job.title,
    });

    if (job.created_by) {
      await notifyEmployerNewApplication(admin, {
        tenantId: job.tenant_id,
        employerId: job.created_by,
        jobId,
        jobTitle: job.title,
      });

      // Email al dueño (fire-and-forget). Minimización §11: del postulante
      // viaja SOLO su display_name — ni respuestas, ni nota, ni currículum.
      //
      // Y SOLO SI ACEPTÓ COMPARTIR SU PERFIL. La app le promete, textual, que
      // "van a ver tus respuestas, tu mensaje y tu currículum, pero no tu foto,
      // tu nombre ni tu zona" (components/empleos/copy.ts). La notificación
      // in-app ya respetaba eso; el mail no, y salía con el nombre completo en
      // el asunto — o sea que el consentimiento se rompía antes de que el
      // empleador llegara siquiera a abrir la app, donde la tarjeta sí dice
      // "Candidato sin perfil compartido".
      const [fullTenant, ownerEmail, { data: applicant }] = await Promise.all([
        getTenant(),
        getRecipientEmail(admin, job.created_by),
        shareProfile
          ? supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (ownerEmail) {
        const mail = applicationReceivedEmail({
          jobId,
          jobTitle: job.title,
          applicantDisplayName:
            shareProfile && applicant?.display_name
              ? applicant.display_name
              : "Alguien de la comunidad",
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
  revalidatePath("/empleos/mis-aplicaciones");
  return { ok: true };
}

// ===========================================================================
// El embudo: quien publicó el aviso mueve la postulación hacia adelante
// ===========================================================================

const advanceSchema = z.object({
  applicationId: z.uuid(),
  next: z.enum(["reviewing", "interview", "hired", "rejected", "closed"]),
});

export type AdvanceApplicationResult =
  | { ok: true; status: EmployerStatus }
  | {
      ok: false;
      code: "unauthenticated" | "tenant-mismatch" | "invalid" | "conflict" | "error";
      message?: string;
    };

export async function advanceJobApplicationAction(input: {
  applicationId: string;
  next: EmployerStatus;
}): Promise<AdvanceApplicationResult> {
  const parsed = advanceSchema.safeParse(input);
  if (!parsed.success || !isEmployerStatus(input.next)) {
    return { ok: false, code: "invalid", message: GENERIC_ERROR };
  }
  const { applicationId, next } = parsed.data;

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

  // La RLS de SELECT ya limita esto a las partes (postulante y dueño del
  // aviso): si no hay fila acá, tampoco la va a haber en el UPDATE.
  const { data: application } = await supabase
    .from("job_applications")
    .select("id, job_id, applicant_id, status")
    .eq("id", applicationId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (!application) {
    return { ok: false, code: "error", message: COPY.updateFailed };
  }

  // El embudo, ANTES de tocar la base: si la transición no avanza, el trigger
  // levantaría PROTECTED_TRANSITION y el usuario vería un error técnico. La
  // misma función que decide qué botones se pintan decide acá.
  const current = toJobApplicationStatus(application.status);
  if (!canAdvance(current, next)) {
    return { ok: false, code: "conflict", message: COPY.cannotAdvance };
  }

  // La RLS de job_applications autoriza el ROL (dueño del aviso → los cinco
  // estados del empleador); acá no lo re-chequeamos. El `.eq('status', current)`
  // es control de concurrencia: si alguien la movió mientras tanto, no hay fila.
  const { data: updated, error } = await supabase
    .from("job_applications")
    .update({ status: next })
    .eq("id", applicationId)
    .eq("tenant_id", tenant.id)
    .eq("status", current)
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
    return { ok: false, code: "conflict", message: COPY.updateFailed };
  }

  // Aviso al POSTULANTE (best-effort): que se entere sin tener que volver a entrar.
  try {
    const { data: job } = await supabase
      .from("listings")
      .select("title")
      .eq("id", application.job_id)
      .maybeSingle();
    await notifyApplicantStatus(createAdminClient(), {
      tenantId: tenant.id,
      applicantId: application.applicant_id,
      jobId: application.job_id,
      jobTitle: job?.title ?? "el aviso",
      status: next,
    });
  } catch (notifyError) {
    console.warn("[empleos] no se pudo avisar al postulante:", {
      applicationId,
      message: notifyError instanceof Error ? notifyError.message : "error desconocido",
    });
  }

  revalidatePath(`/empleos/${application.job_id}/candidatos`);
  revalidatePath(`/empleos/${application.job_id}`);
  return { ok: true, status: next };
}

// ===========================================================================
// Retirar la postulación (solo el postulante)
// ===========================================================================

const withdrawSchema = z.object({ applicationId: z.uuid() });

export type WithdrawApplicationResult =
  | { ok: true }
  | {
      ok: false;
      code: "unauthenticated" | "tenant-mismatch" | "invalid" | "conflict" | "error";
      message?: string;
    };

export async function withdrawJobApplicationAction(input: {
  applicationId: string;
}): Promise<WithdrawApplicationResult> {
  const parsed = withdrawSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: GENERIC_ERROR };
  }
  const { applicationId } = parsed.data;

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

  const { data: application } = await supabase
    .from("job_applications")
    .select("id, job_id, applicant_id, status")
    .eq("id", applicationId)
    .eq("tenant_id", tenant.id)
    .eq("applicant_id", user.id)
    .maybeSingle();

  if (!application) {
    return { ok: false, code: "error", message: COPY.updateFailed };
  }
  if (!canApplicantWithdraw(toJobApplicationStatus(application.status))) {
    return { ok: false, code: "conflict", message: COPY.cannotWithdraw };
  }

  const { data: updated, error } = await supabase
    .from("job_applications")
    .update({ status: "withdrawn" })
    .eq("id", applicationId)
    .eq("tenant_id", tenant.id)
    .eq("applicant_id", user.id)
    .eq("status", application.status)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, code: "conflict", message: COPY.updateFailed };
  }

  // Al DUEÑO: alguien que estaba en su bandeja se dio de baja. Quien se retira
  // no se auto-notifica — acaba de hacerlo con el dedo.
  try {
    const { data: job } = await supabase
      .from("listings")
      .select("title, created_by")
      .eq("id", application.job_id)
      .maybeSingle();
    if (job?.created_by) {
      await notifyEmployerWithdrawal(createAdminClient(), {
        tenantId: tenant.id,
        employerId: job.created_by,
        jobId: application.job_id,
        jobTitle: job.title ?? "tu aviso",
      });
    }
  } catch (notifyError) {
    console.warn("[empleos] no se pudo avisar del retiro:", {
      applicationId,
      message: notifyError instanceof Error ? notifyError.message : "error desconocido",
    });
  }

  revalidatePath("/empleos/mis-aplicaciones");
  revalidatePath(`/empleos/${application.job_id}`);
  return { ok: true };
}

// ===========================================================================
// Consentimiento del perfil — lo mueve el postulante y NADIE más (0047)
// ===========================================================================

const shareSchema = z.object({
  applicationId: z.uuid(),
  share: z.boolean(),
});

export type ShareProfileResult =
  | { ok: true; share: boolean }
  | { ok: false; code: "unauthenticated" | "invalid" | "error"; message?: string };

export async function updateShareProfileAction(input: {
  applicationId: string;
  share: boolean;
}): Promise<ShareProfileResult> {
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: GENERIC_ERROR };
  const { applicationId, share } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.needLogin };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  // `tenant` y `user` ya no se desestructuran: el tenant y la identidad los
  // revalida la propia función de la 0053, que es donde tienen que vivir.
  const { supabase } = guard;

  // Por RPC y no por UPDATE directo: el `with check` de job_applications_update
  // (0047) limita la rama del postulante a los estados submitted/withdrawn, así
  // que apenas el empleador movía la postulación a "en revisión" este botón
  // empezaba a fallar con un error genérico. El trigger de congelado SÍ lo
  // permitía —share_profile es la única columna suya que queda editable— pero
  // la policy no lo dejaba llegar. Y no es un botón cualquiera: es retirar el
  // consentimiento sobre dato personal, que la app promete que se puede hacer
  // siempre. `set_application_share_profile` (0053) sólo toca esa columna y
  // sólo en filas propias.
  const { error } = await supabase.rpc("set_application_share_profile", {
    p_application_id: applicationId,
    p_share: share,
  });

  if (error) {
    return { ok: false, code: "error", message: COPY.updateFailed };
  }

  revalidatePath("/empleos/mis-aplicaciones");
  return { ok: true, share };
}

// ===========================================================================
// Nota privada del empleador (`job_application_notes`)
// ===========================================================================

const noteSchema = z.object({
  applicationId: z.uuid(),
  note: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(2000)),
});

export type SaveNoteResult =
  | { ok: true; note: string | null }
  | { ok: false; code: "unauthenticated" | "invalid" | "error"; message?: string };

/**
 * Guarda (o borra, si queda vacía) la nota privada de quien evalúa.
 *
 * La tabla tiene PK (application_id, author_id), así que el upsert es
 * naturalmente "una nota por evaluador". Y el candidato no tiene policy de
 * lectura: esta nota no vuelve por ningún camino de la app.
 */
export async function saveApplicationNoteAction(input: {
  applicationId: string;
  note: string;
}): Promise<SaveNoteResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: GENERIC_ERROR };
  const { applicationId, note } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.needLogin };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`job-note:${user.id}`, 120, HOUR_MS).ok) {
    return { ok: false, code: "error", message: COPY.tooMany };
  }

  // Nota vacía = borrar. Guardar "" sería dejar una fila que no dice nada y
  // obligar a la UI a distinguir entre "sin nota" y "nota en blanco".
  if (note.length === 0) {
    const { error } = await supabase
      .from("job_application_notes")
      .delete()
      .eq("application_id", applicationId)
      .eq("author_id", user.id)
      .eq("tenant_id", tenant.id);
    if (error) {
      console.warn("[empleos] no se pudo borrar la nota", { code: error.code });
      return { ok: false, code: "error", message: COPY.noteFailed };
    }
    return { ok: true, note: null };
  }

  const { data, error } = await supabase
    .from("job_application_notes")
    .upsert(
      {
        tenant_id: tenant.id,
        application_id: applicationId,
        author_id: user.id,
        note,
      },
      { onConflict: "application_id,author_id" },
    )
    .select("note")
    .maybeSingle();

  if (error || !data) {
    console.warn("[empleos] no se pudo guardar la nota", { code: error?.code });
    return { ok: false, code: "error", message: COPY.noteFailed };
  }
  return { ok: true, note: data.note };
}

// ===========================================================================
// Candidatos guardados — unilateral y PRIVADO (0047)
// ===========================================================================

const savedSchema = z.object({ applicationId: z.uuid() });

export type SaveCandidateResult =
  | { ok: true; saved: boolean }
  | { ok: false; code: "unauthenticated" | "invalid" | "error"; message?: string };

/**
 * Guardar un candidato para futuras vacantes.
 *
 * Recibe el id de la POSTULACIÓN, no el de la persona: cuando alguien se
 * postuló sin compartir su perfil, su `applicant_id` nunca sale del servidor
 * (ver `fetchJobCandidates`). Resolverlo acá deja que las acciones funcionen
 * igual sin devolverle la identidad al navegador.
 *
 * NO emite notificación, y no es un olvido: la tabla es unilateral y privada a
 * propósito (comentario de 0047). Avisarle a alguien que "lo están mirando"
 * convertiría una lista de trabajo en una señal social.
 */
export async function saveCandidateAction(input: {
  applicationId: string;
}): Promise<SaveCandidateResult> {
  const parsed = savedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: GENERIC_ERROR };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.needLogin };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`job-save-candidate:${user.id}`, 100, HOUR_MS).ok) {
    return { ok: false, code: "error", message: COPY.tooMany };
  }

  // La RLS de SELECT solo devuelve esta fila al postulante o al dueño del
  // aviso; el `neq` corta el caso raro de que sea la propia (la tabla tiene su
  // CHECK saved_candidates_no_self, pero mejor un mensaje que una excepción).
  const { data: application } = await supabase
    .from("job_applications")
    .select("id, applicant_id")
    .eq("id", parsed.data.applicationId)
    .eq("tenant_id", tenant.id)
    .neq("applicant_id", user.id)
    .maybeSingle();

  if (!application) return { ok: false, code: "error", message: COPY.saveFailed };

  const { error } = await supabase.from("saved_candidates").upsert(
    {
      tenant_id: tenant.id,
      employer_id: user.id,
      candidate_id: application.applicant_id,
      source_application_id: application.id,
    },
    { onConflict: "employer_id,candidate_id" },
  );

  if (error) {
    console.warn("[empleos] no se pudo guardar el candidato", { code: error.code });
    return { ok: false, code: "error", message: COPY.saveFailed };
  }
  return { ok: true, saved: true };
}

export async function removeSavedCandidateAction(input: {
  applicationId: string;
}): Promise<SaveCandidateResult> {
  const parsed = savedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: GENERIC_ERROR };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.needLogin };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  const { data: application } = await supabase
    .from("job_applications")
    .select("applicant_id")
    .eq("id", parsed.data.applicationId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (!application) return { ok: false, code: "error", message: COPY.saveFailed };

  const { error } = await supabase
    .from("saved_candidates")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("employer_id", user.id)
    .eq("candidate_id", application.applicant_id);

  if (error) {
    console.warn("[empleos] no se pudo quitar el candidato guardado", { code: error.code });
    return { ok: false, code: "error", message: COPY.saveFailed };
  }
  return { ok: true, saved: false };
}

// ===========================================================================
// Escribirle a un candidato
// ===========================================================================

export type StartConversationResult =
  | { ok: true; conversationId: string }
  | { ok: false; code: "unauthenticated" | "invalid" | "blocked" | "error"; message?: string };

/**
 * Abre (o recupera) el chat con quien se postuló.
 *
 * `request_contact()` NO sirve acá: esa RPC es del interesado hacia el dueño
 * del aviso, y desde el dueño levantaría CANNOT_CONTACT_SELF. El camino
 * correcto es la conversación DIRECTA que `conversations_insert` (0006)
 * contempla explícitamente ("esta policy cubre conversaciones directas"), con
 * su trigger de bloqueo (0022) intacto.
 *
 * Va sin `listing_id` a propósito: el índice único (listing_id, created_by)
 * permite UNA conversación por aviso y por creador, así que atarla al aviso
 * dejaría al empleador escribirle a un solo candidato de la vacante.
 */
export async function startCandidateConversationAction(input: {
  applicationId: string;
}): Promise<StartConversationResult> {
  const parsed = savedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: GENERIC_ERROR };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.needLogin };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`job-contact:${user.id}`, 60, HOUR_MS).ok) {
    return { ok: false, code: "error", message: COPY.tooMany };
  }

  const { data: application } = await supabase
    .from("job_applications")
    .select("id, applicant_id, job_id, share_profile, status")
    .eq("id", parsed.data.applicationId)
    .eq("tenant_id", tenant.id)
    .neq("applicant_id", user.id)
    .maybeSingle();

  if (!application) return { ok: false, code: "error", message: COPY.updateFailed };

  // Abrir el chat REVELA la identidad: /mensajes/[id] pinta nombre, foto,
  // verificación y Trust Score de la contraparte en el encabezado. Así que si
  // la persona pidió no compartir su perfil, acá no hay conversación que valga
  // — de lo contrario el botón de al lado deshace en un toque lo que la
  // tarjeta se esforzó en ocultar. Se eligió NO ofrecer el chat en vez de
  // enmascarar la identidad en el hilo: una máscara tiene que aguantar en cada
  // pantalla del hilo, y una sola que se olvide filtra igual.
  if (!application.share_profile) {
    return { ok: false, code: "error", message: COPY.candidateHidden };
  }

  // Retirarse tiene que significar algo. La lista ya filtra `withdrawn`, pero
  // la acción se puede invocar con una tarjeta vieja todavía en pantalla.
  if (application.status === "withdrawn") {
    return { ok: false, code: "error", message: COPY.candidateWithdrew };
  }

  // ¿Ya hay hilo entre los dos? Puede haberlo abierto la persona desde el aviso
  // (request_contact). Reusarlo evita dos conversaciones sobre lo mismo.
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, listing_id")
    .or(
      `and(created_by.eq.${user.id},counterpart_id.eq.${application.applicant_id}),and(created_by.eq.${application.applicant_id},counterpart_id.eq.${user.id})`,
    )
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const reusable =
    existing?.find((row) => row.listing_id === application.job_id) ?? existing?.[0] ?? null;
  if (reusable) return { ok: true, conversationId: reusable.id };

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      tenant_id: tenant.id,
      created_by: user.id,
      counterpart_id: application.applicant_id,
      listing_id: null,
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    // USER_BLOCKED lo levanta el trigger de 0022 y no dice quién bloqueó a quién.
    if (error?.message?.includes("USER_BLOCKED")) {
      return {
        ok: false,
        code: "blocked",
        message: "No podemos abrir el chat con esta persona.",
      };
    }
    console.warn("[empleos] no se pudo abrir el chat con el candidato", {
      code: error?.code,
    });
    return { ok: false, code: "error", message: GENERIC_ERROR };
  }

  return { ok: true, conversationId: created.id };
}

// ===========================================================================
// Abrir el currículum: signed URL de vida corta, NUNCA una URL pública
// ===========================================================================

const cvSchema = z.object({ applicationId: z.uuid() });

/** 60 s alcanzan para que el navegador arranque la descarga y no para más. */
const CV_SIGNED_URL_TTL_SECONDS = 60;

export type CvUrlResult =
  | { ok: true; url: string }
  | { ok: false; code: "unauthenticated" | "invalid" | "not-found" | "error"; message?: string };

/**
 * Devuelve una URL firmada para leer un currículum.
 *
 * DOS CANDADOS, a propósito:
 *   1. La fila. `job_applications_select` (0042) solo devuelve la postulación
 *      al postulante o al dueño del aviso. Si acá no hay fila, no hay URL — y
 *      no se distingue "no existe" de "no es tuya".
 *   2. El objeto. La signed URL se firma con el cliente del USUARIO, así que
 *      `job_cvs_select` (0047) vuelve a decidir: el dueño del archivo o el
 *      dueño del aviso al que ese CV se postuló. Si el candado 1 fallara, este
 *      igual devuelve 400.
 *
 * El path del archivo NUNCA sale de acá: viaja la URL firmada y nada más. Así
 * el HTML no lleva `{tenant}/{postulante}/cv-….pdf` para que alguien lo pruebe
 * contra el endpoint público.
 */
export async function createCvSignedUrlAction(input: {
  applicationId: string;
}): Promise<CvUrlResult> {
  const parsed = cvSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: GENERIC_ERROR };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, code: "unauthenticated", message: COPY.needLogin };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`job-cv-url:${user.id}`, 60, HOUR_MS).ok) {
    return { ok: false, code: "error", message: COPY.tooMany };
  }

  const { data: application } = await supabase
    .from("job_applications")
    .select("id, cv_url, applicant_id, status")
    .eq("id", parsed.data.applicationId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (!application?.cv_url) {
    return { ok: false, code: "not-found", message: "Esta postulación no tiene currículum." };
  }

  // Retirar la postulación tiene que APAGAR el acceso al currículum, no sólo
  // sacar la tarjeta de la lista. Hasta acá esa promesa vivía en un solo lugar
  // —el `.neq('status','withdrawn')` de la consulta que arma la bandeja— y ni
  // la RLS de la fila ni la policy del bucket miran el estado. O sea: con la
  // pantalla ya abierta, el empleador seguía firmando una URL nueva un minuto
  // (o un mes) después de que la persona se retirara, y bajaba un PDF con
  // nombre, teléfono y domicilio. Quien SÍ puede seguir viéndolo es su dueño.
  if (application.status === "withdrawn" && application.applicant_id !== user.id) {
    return { ok: false, code: "not-found", message: COPY.candidateWithdrew };
  }

  const extension = application.cv_url.split(".").pop()?.toLowerCase() ?? "pdf";
  const { data, error } = await supabase.storage
    .from(CV_BUCKET)
    .createSignedUrl(application.cv_url, CV_SIGNED_URL_TTL_SECONDS, {
      // Fuerza descarga con un nombre neutro: el archivo nunca se renderiza
      // inline y el nombre original —que suele traer datos de la persona— no
      // viaja en la URL.
      download: `curriculum.${extension}`,
    });

  if (error || !data?.signedUrl) {
    console.warn("[empleos] no se pudo firmar la URL del currículum", {
      code: error?.message,
    });
    return { ok: false, code: "error", message: GENERIC_ERROR };
  }

  return { ok: true, url: data.signedUrl };
}
