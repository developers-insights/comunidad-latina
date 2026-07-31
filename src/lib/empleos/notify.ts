import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  createNotification,
  type CreateNotificationInput,
} from "@/lib/notifications/notify";
import type { JobApplicationStatus } from "./application-status";

/**
 * AVISOS DEL EMBUDO DE EMPLEOS — un solo lugar donde vive qué se le dice a cada
 * parte en cada transición.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE (y no se llama a notify() suelto) ───────────
 * 1. La categoría. Todas las notificaciones de este módulo son de "trabajos" y
 *    ninguna se olvida de decirlo si el dato se pone UNA vez, acá.
 * 2. El copy. Los textos de la spec del cliente están escritos en apuntes; lo
 *    que ve una persona que acaba de recibir un "no" tiene que estar escrito
 *    con criterio, no transcripto. Tenerlos juntos hace visible el TONO del
 *    conjunto: se lee la escalera entera de una.
 * 3. El acoplamiento. `src/lib/notifications/**` lo está tocando otro frente en
 *    paralelo (le sumó `category` y `priority`). Este wrapper absorbe ese
 *    cambio: hoy el campo extra viaja y el helper lo ignora; cuando el helper
 *    lo escriba, empieza a persistirse sin tocar una línea de acá.
 *
 * Es best-effort igual que el helper que envuelve: NUNCA lanza. Una
 * notificación perdida no puede voltear una postulación ya guardada.
 */

/**
 * Superconjunto de la entrada del helper. `category`/`priority` son el contrato
 * NUEVO de notificaciones (0045 ya tiene las columnas en la base); mientras el
 * helper no los lea, viajan y se descartan — nunca rompen el insert, porque
 * `createNotification` arma su fila campo por campo y no hace spread.
 */
type JobNotificationInput = CreateNotificationInput & {
  category?: string;
  priority?: string;
};

const CATEGORY = "trabajos";

type Notice = { title: string; body: string };

/**
 * Lo que ve QUIEN SE POSTULÓ en cada paso. Regla de tono: la noticia primero,
 * el próximo paso después, y nunca una promesa que la plataforma no controla
 * ("te van a llamar" no lo sabemos; "entrá a Mensajes" sí).
 */
const APPLICANT_NOTICE: Record<
  Exclude<JobApplicationStatus, "submitted" | "withdrawn">,
  (jobTitle: string) => Notice
> = {
  reviewing: (jobTitle) => ({
    title: `Están mirando tu postulación a «${jobTitle}»`,
    body: "Quien publicó el aviso abrió lo que enviaste. Te avisamos apenas haya una decisión.",
  }),
  interview: (jobTitle) => ({
    title: `Te invitan a una entrevista por «${jobTitle}»`,
    body: "Quieren conocerte. Entrá a Mensajes para acordar el día, la hora y el lugar.",
  }),
  hired: (jobTitle) => ({
    title: `¡Te eligieron para «${jobTitle}»!`,
    body: "Quien publicó el aviso quiere avanzar con vos. Escribile por Mensajes para arreglar los detalles.",
  }),
  rejected: (jobTitle) => ({
    title: `Novedades de tu postulación a «${jobTitle}»`,
    body: "Esta vez eligieron a otra persona. Seguí mirando: en la comunidad se publican trabajos nuevos todo el tiempo.",
  }),
  closed: (jobTitle) => ({
    title: `Se cerró la búsqueda de «${jobTitle}»`,
    body: "El aviso dejó de buscar gente. No hace falta que hagas nada; tu postulación queda cerrada.",
  }),
};

async function send(
  admin: SupabaseClient<Database>,
  input: Omit<JobNotificationInput, "category">,
): Promise<void> {
  const payload: JobNotificationInput = { ...input, category: CATEGORY };
  try {
    await createNotification(admin, payload);
  } catch (error) {
    // Sin PII: el título del aviso ya es público, el nombre de la persona no.
    console.warn("[empleos] no se pudo emitir la notificación:", {
      kind: input.kind,
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}

/** Al POSTULANTE: su postulación cambió de estado. */
export async function notifyApplicantStatus(
  admin: SupabaseClient<Database>,
  input: {
    tenantId: string;
    applicantId: string;
    jobId: string;
    jobTitle: string;
    status: JobApplicationStatus;
  },
): Promise<void> {
  if (input.status === "submitted" || input.status === "withdrawn") return;
  const notice = APPLICANT_NOTICE[input.status](input.jobTitle);
  await send(admin, {
    tenantId: input.tenantId,
    profileId: input.applicantId,
    kind: "job_application_update",
    title: notice.title,
    body: notice.body,
    // A "Mis aplicaciones", no al aviso: desde ahí ve el estado nuevo, el
    // historial completo y la salida (escribir, seguir mirando).
    href: "/empleos/mis-aplicaciones",
    priority: input.status === "hired" || input.status === "interview" ? "high" : "normal",
  });
}

/** Al POSTULANTE: confirmación de que su solicitud salió. */
export async function notifyApplicationSent(
  admin: SupabaseClient<Database>,
  input: { tenantId: string; applicantId: string; jobTitle: string },
): Promise<void> {
  await send(admin, {
    tenantId: input.tenantId,
    profileId: input.applicantId,
    kind: "job_application_sent",
    title: `Enviamos tu postulación a «${input.jobTitle}»`,
    body: "Quien publicó el aviso ya puede verla. Seguí su estado en Mis postulaciones.",
    href: "/empleos/mis-aplicaciones",
  });
}

/** Al DUEÑO del aviso: alguien se postuló. */
export async function notifyEmployerNewApplication(
  admin: SupabaseClient<Database>,
  input: { tenantId: string; employerId: string; jobId: string; jobTitle: string },
): Promise<void> {
  await send(admin, {
    tenantId: input.tenantId,
    profileId: input.employerId,
    kind: "job_application",
    title: `Nueva postulación para «${input.jobTitle}»`,
    body: "Entrá a ver quién se postuló, con sus respuestas y su currículum.",
    href: `/empleos/${input.jobId}/candidatos`,
    // Varias postulaciones sin leer al mismo aviso = UNA notificación.
    dedupeUnread: true,
  });
}

/** Al DUEÑO del aviso: alguien dio de baja su postulación. */
export async function notifyEmployerWithdrawal(
  admin: SupabaseClient<Database>,
  input: { tenantId: string; employerId: string; jobId: string; jobTitle: string },
): Promise<void> {
  await send(admin, {
    tenantId: input.tenantId,
    profileId: input.employerId,
    kind: "job_application_withdrawn",
    // Sin nombre a propósito: quien se retira está dando un paso atrás, y la
    // notificación no es el lugar para dejar su nombre asentado. El dueño lo
    // ve en la bandeja si entra, que es donde corresponde.
    title: `Retiraron una postulación de «${input.jobTitle}»`,
    body: "Una de las personas que se había postulado dio de baja su solicitud.",
    href: `/empleos/${input.jobId}/candidatos`,
    dedupeUnread: true,
  });
}
