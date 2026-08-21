"use server";

import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  fetchApplicantProfilePreview,
  fetchViewerApplication,
  type ApplicantProfilePreview,
} from "./queries";
import { parseJobAttrs, type JobQuestion } from "@/components/empleos/helpers";

/**
 * CONTEXTO DE POSTULACIÓN, PEDIDO DESDE LA LISTA (cliente 2026-08-20: "mientras
 * menos pasos mejor").
 *
 * `JobApplySheet` nació en `/empleos/[id]`, donde la página ya había leído las
 * preguntas del aviso y el perfil de quien mira, y se las pasaba como props. La
 * card del listado no tiene ni una cosa ni la otra: `JobCardModel` trae lo que
 * se PINTA (pago, puesto, zona, publicador), no lo que hace falta para postular
 * — y engordarlo pagaría esa lectura en las 12 cards de cada página aunque nadie
 * toque el botón. Así que el mismo dato se busca UNA vez, cuando alguien toca
 * "Postularme", y recién ahí.
 *
 * ── POR QUÉ ARCHIVO PROPIO Y NO `actions.ts` ──────────────────────────────
 * Nació separado porque `actions.ts` de empleos lo estaba editando otro flujo
 * en paralelo y un dueño por archivo evita pisarse. Se quedó separado porque el
 * contrato es distinto al del resto: esto NO muta nada, es una LECTURA que
 * arma el contexto de una hoja. Si algún día se funde con `actions.ts`, que sea
 * por una razón mejor que la simetría.
 *
 * ── LO QUE ACÁ NO SE AFLOJA ───────────────────────────────────────────────
 * No devuelve NADA que no devolviera ya la página de detalle a la misma persona:
 * las preguntas del aviso (públicas, están en el aviso) y el perfil de QUIEN
 * PIDE (nunca el de un tercero — `user.id` sale del guard, jamás del cliente).
 * El aviso se lee con el cliente del USUARIO y filtrado por tenant: la RLS sigue
 * siendo la frontera, esto solo evita mostrar una hoja que el server va a
 * rechazar después.
 */

const jobIdSchema = z.string().uuid();

export type JobApplyContext =
  /** Hay con qué abrir la hoja: preguntas del aviso + perfil autocompletado. */
  | { state: "ready"; questions: JobQuestion[]; profile: ApplicantProfilePreview | null }
  /** Sin sesión. Quien llama decide el camino (hoy: ir a /entrar y volver). */
  | { state: "unauthenticated" }
  /** Ya se postuló antes: la card lo dice en vez de abrir un formulario inútil. */
  | { state: "already-applied" }
  /** Es su propio aviso. No es un error rojo: es un dato. */
  | { state: "own-job" }
  /** Se despublicó, se llenó o nunca fue de este tenant. */
  | { state: "unavailable" };

export async function loadJobApplyContextAction(jobId: string): Promise<JobApplyContext> {
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) return { state: "unavailable" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return guard.reason === "unauthenticated"
      ? { state: "unauthenticated" }
      : { state: "unavailable" };
  }
  const { tenant, supabase, user } = guard;

  const { data: job, error } = await supabase
    .from("listings")
    .select("id, attrs, created_by, tenant_id")
    .eq("id", parsed.data)
    .eq("kind", "job")
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    console.warn("[empleos] no se pudo leer el aviso para postular", { code: error.code });
    return { state: "unavailable" };
  }
  if (!job || job.tenant_id !== tenant.id) return { state: "unavailable" };
  if (job.created_by === user.id) return { state: "own-job" };

  // Las dos lecturas que faltan son independientes entre sí: van juntas para que
  // el botón espere UN viaje y no dos encadenados (quien busca trabajo está en
  // datos móviles).
  const [application, profile] = await Promise.all([
    fetchViewerApplication(job.id, user.id),
    fetchApplicantProfilePreview(user.id),
  ]);
  if (application) return { state: "already-applied" };

  return { state: "ready", questions: parseJobAttrs(job.attrs).questions, profile };
}
