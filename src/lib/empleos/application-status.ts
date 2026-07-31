/**
 * EL EMBUDO DE RECLUTAMIENTO — máquina de estados de `job_applications.status`.
 *
 * Módulo PURO (sin I/O) a propósito: es la MISMA regla en tres lugares que
 * tienen que coincidir — la UI (qué botones ofrece), la server action (qué
 * escribe) y la base (qué acepta). Si divergen, el usuario toca un botón y la
 * base le contesta con una excepción en inglés.
 *
 * ── LA REGLA, TAL COMO LA IMPONE LA BASE (0047) ────────────────────────────
 *   submitted(1) → reviewing(2) → interview(3) → terminal(4)
 *   terminal = hired | rejected | withdrawn | closed, TODOS con el mismo rango.
 *
 * El trigger `app.job_applications_freeze` levanta `PROTECTED_TRANSITION` si el
 * rango de destino no es ESTRICTAMENTE mayor que el de origen. Consecuencias
 * que la UI tiene que respetar sin discutir:
 *
 *   · No hay "deshacer". Contratado no vuelve a "en revisión".
 *   · No hay cambio de opinión entre terminales: contratado no pasa a
 *     rechazado, y una postulación retirada no se "reactiva".
 *   · Sí se puede SALTAR: de `submitted` derecho a `interview` o a `hired`. Es
 *     legítimo (alguien lee la postulación y llama a la persona en el acto) y
 *     la base lo permite, así que la UI no lo esconde.
 *
 * Este archivo NO tiene copy: las etiquetas visibles viven en
 * `src/components/empleos/copy.ts`. Acá solo está la mecánica.
 */

export const JOB_APPLICATION_STATUSES = [
  "submitted",
  "reviewing",
  "interview",
  "hired",
  "rejected",
  "withdrawn",
  "closed",
] as const;

export type JobApplicationStatus = (typeof JOB_APPLICATION_STATUSES)[number];

/**
 * Espejo EXACTO de `v_rank` en app.job_applications_freeze (0047). Si esto se
 * desincroniza de la migración, la UI ofrece transiciones que la base rechaza
 * — que es precisamente el bug que este módulo existe para evitar.
 */
const RANK: Record<JobApplicationStatus, number> = {
  submitted: 1,
  reviewing: 2,
  interview: 3,
  hired: 4,
  rejected: 4,
  withdrawn: 4,
  closed: 4,
};

/** Estados que puede escribir QUIEN PUBLICÓ el aviso (policy 0047, with check). */
export const EMPLOYER_STATUSES = [
  "reviewing",
  "interview",
  "hired",
  "rejected",
  "closed",
] as const satisfies readonly JobApplicationStatus[];

export type EmployerStatus = (typeof EMPLOYER_STATUSES)[number];

const STATUS_SET = new Set<string>(JOB_APPLICATION_STATUSES);
const EMPLOYER_SET = new Set<string>(EMPLOYER_STATUSES);

/**
 * `status` llega como `text` desde PostgREST. Si apareciera un valor que esta
 * build no conoce (una migración más nueva contra un deploy viejo), degradamos
 * a `submitted`: mostrar "Solicitud enviada" de más es infinitamente menos
 * grave que pintar la palabra cruda de la base en la pantalla de una persona.
 */
export function toJobApplicationStatus(raw: string | null | undefined): JobApplicationStatus {
  return raw && STATUS_SET.has(raw) ? (raw as JobApplicationStatus) : "submitted";
}

export function isEmployerStatus(raw: string): raw is EmployerStatus {
  return EMPLOYER_SET.has(raw);
}

export function statusRank(status: JobApplicationStatus): number {
  return RANK[status];
}

/** Terminal = el embudo terminó. No sale ninguna flecha de acá. */
export function isTerminalStatus(status: JobApplicationStatus): boolean {
  return RANK[status] === 4;
}

/** ¿La base va a aceptar este movimiento? Misma comparación que el trigger. */
export function canAdvance(from: JobApplicationStatus, to: JobApplicationStatus): boolean {
  return RANK[to] > RANK[from];
}

/**
 * Las transiciones que la pantalla del DUEÑO puede ofrecer desde `current`,
 * en el orden en que se muestran (avanzar primero, resolver después).
 *
 * Devolver [] es la respuesta correcta y esperada para una postulación ya
 * resuelta: la fila muestra su estado y ningún botón.
 */
export function employerTransitions(current: JobApplicationStatus): EmployerStatus[] {
  return EMPLOYER_STATUSES.filter((next) => canAdvance(current, next));
}

/**
 * Retirarse es del postulante y solo desde un estado vivo. Una postulación ya
 * resuelta (contratado, no seleccionado, vacante cerrada) no se retira: no
 * queda nada de qué retirarse, y la base lo rechazaría igual.
 */
export function canApplicantWithdraw(current: JobApplicationStatus): boolean {
  return !isTerminalStatus(current);
}

/**
 * Estados que se le muestran al DUEÑO en su bandeja. `withdrawn` queda afuera:
 * el producto le promete a quien se postula que al retirarse su postulación
 * deja de verse (misma promesa que cumple `fetchJobCandidates`).
 */
export function isVisibleToEmployer(status: JobApplicationStatus): boolean {
  return status !== "withdrawn";
}

/**
 * Postulación "abierta" = todavía puede moverse. Sirve para el contador de
 * pendientes y para el estado vacío de la bandeja.
 */
export function isOpenStatus(status: JobApplicationStatus): boolean {
  return !isTerminalStatus(status);
}
