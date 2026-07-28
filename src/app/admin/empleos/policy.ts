/**
 * POLÍTICA DE DIVULGACIÓN del panel de Empleos (/admin/empleos).
 *
 * Módulo PURO (sin I/O) a propósito: la barrera de privacidad se testea sola,
 * y la usan las tres superficies que tienen que coincidir — la query del
 * detalle (qué campos se traen), el render (qué se pinta) y la server action
 * (qué se puede resolver). Si divergen, se filtra dato ajeno.
 *
 * -----------------------------------------------------------------------------
 * LA TENSIÓN
 * -----------------------------------------------------------------------------
 * Una postulación es una conversación privada entre quien se postula y quien
 * publicó el aviso: las respuestas (`job_applications.answers`) y la nota
 * (`message`) las escribió una persona PARA ESE destinatario, no para la
 * plataforma. Un panel donde el staff lee eso de cualquiera es vigilancia, no
 * moderación — y este producto promete lo contrario (§5.4: minimización, el
 * audit_log jamás guarda contenido).
 *
 * Pero el cliente tiene una necesidad real y legítima: al lanzar, él mismo va a
 * sembrar avisos para que la sección tenga vida. Si alguien se postula a un
 * aviso de la plataforma y nadie contesta, la sección muere.
 *
 * -----------------------------------------------------------------------------
 * LA RESOLUCIÓN: dos niveles de divulgación, por DUEÑO del aviso (no por rol)
 * -----------------------------------------------------------------------------
 *   "platform"  → el aviso NO tiene dueño miembro (`created_by is null`: lo
 *                 sembró/importó la plataforma) o lo publicó ESTE MISMO staff.
 *                 En los dos casos el staff ya es el destinatario legítimo de
 *                 las respuestas (en el segundo ya las ve en /empleos/[id] como
 *                 dueño). Se muestra todo y se puede aceptar/rechazar.
 *
 *   "member"    → el aviso es de un miembro de la comunidad. El staff ve SOLO
 *                 metadatos: cuántas postulaciones hay, en qué estado y de
 *                 cuándo. Ni nombres, ni respuestas, ni la nota. Sin botones.
 *                 Alcanza para lo único que el staff necesita operar acá
 *                 ("¿está entrando gente y nadie contesta?") sin leer nada de
 *                 nadie.
 *
 * NO se sube por rol: un global_admin tampoco ve las respuestas de un aviso
 * ajeno. El rol decide quién ENTRA al panel (domain_admin+, ver page.tsx); el
 * dueño del aviso decide qué se VE. Si alguna vez hace falta el contenido de un
 * aviso ajeno (ej. una denuncia), el camino es el reporte de estafa —que ya
 * viaja con su contenido a la cola de moderación— no una puerta abierta acá.
 *
 * -----------------------------------------------------------------------------
 * LA BARRERA ES DE DB **Y** DE APP (migración 0042)
 * -----------------------------------------------------------------------------
 * Hasta 0041 esto era una promesa de aplicación: `job_applications_select` tenía
 * una rama `or app.is_staff()`, así que un token de staff pegándole derecho a
 * PostgREST leía `message` y `answers` de avisos ajenos salteando el panel
 * entero. 0042 reescribió las policies con ESTA MISMA REGLA (postulante · dueño
 * del aviso · admin del dominio solo si `created_by is null`) y congeló
 * `listings.created_by` con un trigger, porque de esa columna cuelga todo.
 *
 * Consecuencia práctica para quien toque este archivo: la app ya NO puede leer
 * postulaciones de avisos de miembros ni queriendo. Si cambiás la regla de acá,
 * la base te va a decir que no — y hay que cambiar las dos, a propósito.
 */

/** Nivel de divulgación permitido sobre las postulaciones de un aviso. */
export type JobDisclosure = "platform" | "member";

export interface JobOwnership {
  /** `listings.created_by` — null = aviso sembrado/importado por la plataforma. */
  createdBy: string | null;
  /** `user.id` del staff logueado (del JWT ya verificado por el guard). */
  staffId: string;
}

/**
 * Nivel de divulgación de un aviso. Es la ÚNICA función que decide si el staff
 * puede leer respuestas ajenas — todo lo demás la consulta.
 */
export function jobDisclosure({ createdBy, staffId }: JobOwnership): JobDisclosure {
  if (createdBy === null) return "platform";
  return createdBy === staffId ? "platform" : "member";
}

/**
 * ¿Puede este staff responder (aceptar/rechazar) postulaciones de este aviso?
 *
 * Solo sobre avisos de la plataforma. Sobre un aviso de un miembro, responder
 * sería hablar con la voz del empleador: quien se postuló espera una respuesta
 * de esa persona, no de la plataforma. (Y cuando el staff SÍ responde, la
 * notificación lo dice con todas las letras y queda en el audit_log a su
 * nombre — ver empleos/actions.ts.)
 */
export function canStaffResolve(ownership: JobOwnership): boolean {
  return jobDisclosure(ownership) === "platform";
}

/** Postulación cruda tal como sale de `job_applications`. */
export interface RawApplication {
  id: string;
  applicantId: string;
  status: string;
  message: string | null;
  createdAtLabel: string;
}

/** Postulación ya filtrada por la política — lo que llega al componente. */
export interface DisclosedApplication {
  id: string;
  status: string;
  createdAtLabel: string;
  /** null cuando el aviso es de un miembro: la identidad no se divulga. */
  displayName: string | null;
  avatarUrl: string | null;
  /** null cuando el aviso es de un miembro. */
  message: string | null;
  /** Vacío cuando el aviso es de un miembro. */
  answers: Array<{ question: string; answer: string }>;
}

/**
 * Aplica la política a una postulación. En "member" devuelve el esqueleto
 * mínimo — y lo hace ACÁ, no en el render: así ningún dato ajeno llega siquiera
 * al payload RSC que viaja al browser.
 */
export function discloseApplication(
  disclosure: JobDisclosure,
  raw: RawApplication,
  enrich: {
    displayName: string | null;
    avatarUrl: string | null;
    answers: Array<{ question: string; answer: string }>;
  },
): DisclosedApplication {
  const base = { id: raw.id, status: raw.status, createdAtLabel: raw.createdAtLabel };
  if (disclosure === "member") {
    return { ...base, displayName: null, avatarUrl: null, message: null, answers: [] };
  }
  return {
    ...base,
    displayName: enrich.displayName,
    avatarUrl: enrich.avatarUrl,
    message: raw.message,
    answers: enrich.answers,
  };
}

/**
 * Resumen de la bandeja de un aviso (metadato puro — no identifica a nadie).
 *
 * El conteo YA NO se calcula acá: desde 0042 la app no puede leer las filas de
 * un aviso ajeno, así que lo agrega la RPC `job_application_tally` (que devuelve
 * solo job_id/total/pending, sin applicant_id ni contenido). El tipo se queda
 * porque describe lo que esa RPC devuelve y lo que la UI pinta.
 *
 * `withdrawn` no cuenta, ni acá ni en la RPC: el producto le promete a quien se
 * postula que al retirarse su postulación deja de verse.
 */
export interface ApplicationTally {
  total: number;
  pending: number;
}
