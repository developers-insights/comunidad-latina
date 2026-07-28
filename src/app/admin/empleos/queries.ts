import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { labelJobAnswers, parseJobAttrs } from "@/components/empleos/helpers";
import { timeAgo } from "@/lib/utils";
import {
  discloseApplication,
  jobDisclosure,
  type ApplicationTally,
  type DisclosedApplication,
  type JobDisclosure,
} from "./policy";

/**
 * LECTURAS del panel de Empleos (/admin/empleos).
 *
 * Todo con el cliente del STAFF (el que devuelve `requireStaff`): la RLS es la
 * frontera real. `listings_select` deja a un staff ver todos los estados de SU
 * tenant; `job_applications_select`, desde la migración 0042, ya NO tiene rama
 * de staff: se accede a una postulación si sos el postulante, si sos el dueño
 * del aviso, o si el aviso no tiene dueño miembro (`created_by is null`) y sos
 * domain_admin/global_admin. Acá NO hay admin client: nada de lo que se muestra
 * necesita saltear RLS.
 *
 * O sea: la barrera de privacidad de ./policy.ts está hoy en los DOS lados. La
 * base ya no te deja leer lo que la política recorta, así que este módulo no es
 * la única defensa — pero sigue siendo el que decide QUÉ SE PIDE, y lo que no
 * se pide no puede filtrarse ni por error de render.
 *
 * El precio del fix: para un aviso de un miembro el staff tampoco ve las filas
 * para CONTARLAS. Por eso el conteo del listado va por la RPC
 * `job_application_tally` (ver fetchAdminJobs), que da el agregado sin el
 * contenido.
 */

const JOBS_LIMIT = 50;
const APPLICATIONS_LIMIT = 100;

export type JobStatus = "draft" | "pending_review" | "published" | "removed" | string;

/** Fila del listado: metadatos de moderación + conteos. Sin datos personales. */
export interface AdminJobRow {
  id: string;
  title: string;
  status: JobStatus;
  /** Quién publicó: nombre del perfil, o el `publisher_name` de un aviso sembrado. */
  publisherLabel: string;
  /** true cuando el aviso lo sembró/importó la plataforma (`created_by is null`). */
  isPlatformJob: boolean;
  createdAtLabel: string;
  applications: number;
  pending: number;
}

/** Aviso + sus postulaciones ya filtradas por la política de divulgación. */
export interface AdminJobDetail {
  id: string;
  title: string;
  status: JobStatus;
  publisherLabel: string;
  areaLabel: string | null;
  createdAtLabel: string;
  disclosure: JobDisclosure;
  /** Solo `submitted` se puede resolver — el resto ya está cerrado. */
  applications: DisclosedApplication[];
  totals: { total: number; pending: number };
}

/* -------------------------------------------------------------------------- */
/* Listado                                                                     */
/* -------------------------------------------------------------------------- */

export async function fetchAdminJobs(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<AdminJobRow[]> {
  const { data: jobs, error } = await supabase
    .from("listings")
    .select("id, title, status, created_at, created_by, publisher_name")
    .eq("tenant_id", tenantId)
    .eq("kind", "job")
    .order("created_at", { ascending: false })
    .limit(JOBS_LIMIT);

  if (error) {
    // Error VISIBLE para quien opera: el caller pinta el estado de error.
    console.error("[admin/empleos] no se pudieron leer los avisos:", error.message);
    throw new Error("jobs-unavailable");
  }

  const rows = jobs ?? [];
  if (rows.length === 0) return [];

  const jobIds = rows.map((row) => row.id);
  const memberIds = [
    ...new Set(rows.filter((row) => row.created_by).map((row) => row.created_by as string)),
  ];

  /**
   * El conteo va por RPC, NO leyendo `job_applications`.
   *
   * Desde 0042 el token del staff no ve ni una fila de las postulaciones a un
   * aviso de un MIEMBRO — que es exactamente lo que queremos. Pero el panel
   * igual promete un dato sobre esos avisos: cuántas postulaciones entraron y
   * cuántas siguen sin respuesta. `job_application_tally` devuelve ese agregado
   * (job_id, total, pending) sin divulgar nada: ni applicant_id, ni message, ni
   * answers. Es `security definer` con gate explícito a domain_admin/global_admin
   * y al tenant del JWT en las dos tablas.
   */
  const [{ data: tallyRows, error: tallyError }, { data: profiles }] = await Promise.all([
    // La RPC es de 0042 y todavía no está en los tipos generados — cast acotado
    // a la llamada, no al cliente.
    (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => PromiseLike<{
        data: Array<{ job_id: string; total: number; pending: number }> | null;
        error: { message: string } | null;
      }>
    )("job_application_tally", { p_job_ids: jobIds }),
    memberIds.length
      ? supabase.from("profiles").select("id, display_name").in("id", memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> }),
  ]);

  // Un conteo caído NO puede degradar a cero: la pantalla diría "Sin
  // postulaciones" y "todas respondidas" cuando en realidad hay gente
  // esperando. Esa es exactamente la mentira que el panel existe para evitar.
  // (El nombre de quien publica sí puede degradar: es cosmético.)
  if (tallyError) {
    console.error(
      "[admin/empleos] no se pudieron contar las postulaciones:",
      tallyError.message,
    );
    throw new Error("jobs-unavailable");
  }

  // La RPC agrupa: un aviso sin postulaciones simplemente no viene en la lista.
  const tally = new Map<string, ApplicationTally>(
    (tallyRows ?? []).map((row) => [row.job_id, { total: row.total, pending: row.pending }]),
  );
  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
  const now = new Date();

  return rows.map((row) => {
    const counts = tally.get(row.id) ?? { total: 0, pending: 0 };
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      publisherLabel:
        (row.created_by ? nameById.get(row.created_by) : null) ??
        row.publisher_name ??
        "Publicado por la plataforma",
      isPlatformJob: row.created_by === null,
      createdAtLabel: timeAgo(row.created_at, now),
      applications: counts.total,
      pending: counts.pending,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Detalle                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Nombre de quien publicó el aviso. Es dato PÚBLICO (ya aparece en el aviso),
 * así que se resuelve igual en los dos niveles de divulgación.
 */
async function publisherLabelFor(
  supabase: SupabaseClient<Database>,
  job: { created_by: string | null; publisher_name: string | null },
): Promise<string> {
  if (job.created_by) {
    const { data } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", job.created_by)
      .maybeSingle();
    if (data?.display_name) return data.display_name;
  }
  return job.publisher_name ?? "Publicado por la plataforma";
}

export async function fetchAdminJobDetail(
  supabase: SupabaseClient<Database>,
  input: { jobId: string; tenantId: string; staffId: string },
): Promise<AdminJobDetail | null> {
  const { data: job, error } = await supabase
    .from("listings")
    .select("id, title, status, area_label, attrs, created_at, created_by, publisher_name")
    .eq("id", input.jobId)
    .eq("tenant_id", input.tenantId)
    .eq("kind", "job")
    .maybeSingle();

  if (error) {
    console.error("[admin/empleos] no se pudo leer el aviso:", error.message);
    throw new Error("job-unavailable");
  }
  if (!job) return null;

  const disclosure = jobDisclosure({ createdBy: job.created_by, staffId: input.staffId });
  const now = new Date();

  /**
   * AVISO DE UN MIEMBRO: ni se intenta leer las filas.
   *
   * Desde 0042 la query devolvería CERO postulaciones — y una lista vacía diría
   * "todavía nadie se postuló" en un aviso que tiene cinco. Es la misma mentira
   * que el listado, y peor acá, porque esta es la pantalla a la que se entra
   * justamente a ver si alguien está esperando respuesta. Se pide el agregado
   * por RPC (sin contenido) y la pantalla muestra números, no tarjetas.
   */
  if (disclosure === "member") {
    const { data: tallyRows, error: tallyError } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => PromiseLike<{
        data: Array<{ job_id: string; total: number; pending: number }> | null;
        error: { message: string } | null;
      }>
    )("job_application_tally", { p_job_ids: [input.jobId] });

    if (tallyError) {
      console.error(
        "[admin/empleos] no se pudieron contar las postulaciones del aviso:",
        tallyError.message,
      );
      throw new Error("applications-unavailable");
    }

    const counts = (tallyRows ?? [])[0] ?? { total: 0, pending: 0 };
    return {
      id: job.id,
      title: job.title,
      status: job.status,
      publisherLabel: await publisherLabelFor(supabase, job),
      areaLabel: job.area_label,
      createdAtLabel: timeAgo(job.created_at, now),
      disclosure,
      applications: [],
      totals: { total: counts.total, pending: counts.pending },
    };
  }

  /**
   * MINIMIZACIÓN EN LA QUERY, no en el render: solo en un aviso de la
   * plataforma se piden `message` y `answers`. La política podría recortarlos
   * después igual, pero entonces el contenido privado habría pasado por la
   * memoria del server y por los logs de una query lenta. Lo que no se lee no
   * se puede filtrar — y así el comentario es verdad, no una intención.
   */
  const columns = "id, applicant_id, status, message, answers, created_at";

  // `withdrawn` afuera: quien se retira deja de verse, también acá.
  // `count: "exact"` además del límite: sin eso, un aviso con más de
  // APPLICATIONS_LIMIT postulaciones mostraría —y AUDITARÍA— un total corto.
  const {
    data: rows,
    error: applicationsError,
    count,
  } = await supabase
    .from("job_applications")
    .select(columns, { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .eq("job_id", input.jobId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(APPLICATIONS_LIMIT)
    .overrideTypes<
      Array<{
        id: string;
        applicant_id: string;
        status: string;
        message?: string | null;
        answers?: unknown;
        created_at: string;
      }>
    >();

  if (applicationsError) {
    console.error(
      "[admin/empleos] no se pudieron leer las postulaciones:",
      applicationsError.message,
    );
    throw new Error("applications-unavailable");
  }

  const applications = rows ?? [];

  // Perfiles de quienes se postulan + el de quien publicó (su nombre ya es
  // público en el aviso). Este camino es SOLO el de un aviso de la plataforma:
  // el de un miembro salió antes, sin tocar postulaciones.
  const applicantIds = [...new Set(applications.map((row) => row.applicant_id))];
  const wantedProfiles = [...new Set([...applicantIds, ...(job.created_by ? [job.created_by] : [])])];

  const nameById = new Map<string, { display_name: string; avatar_url: string | null }>();
  if (wantedProfiles.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", wantedProfiles);
    for (const profile of profiles ?? []) {
      nameById.set(profile.id, {
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      });
    }
  }

  const { questions } = parseJobAttrs(job.attrs);

  const disclosed = applications.map((row) => {
    const profile = nameById.get(row.applicant_id);
    return discloseApplication(
      disclosure,
      {
        id: row.id,
        applicantId: row.applicant_id,
        status: row.status,
        message: row.message ?? null,
        createdAtLabel: timeAgo(row.created_at, now),
      },
      {
        displayName: profile?.display_name ?? "Alguien de la comunidad",
        avatarUrl: profile?.avatar_url ?? null,
        answers: labelJobAnswers(questions, row.answers ?? null),
      },
    );
  });

  return {
    id: job.id,
    title: job.title,
    status: job.status,
    publisherLabel:
      (job.created_by ? nameById.get(job.created_by)?.display_name : null) ??
      job.publisher_name ??
      "Publicado por la plataforma",
    areaLabel: job.area_label,
    createdAtLabel: timeAgo(job.created_at, now),
    disclosure,
    applications: disclosed,
    totals: {
      // El total REAL (sin el tope de la página); los pendientes se cuentan
      // sobre lo traído, que es lo que efectivamente se puede resolver acá.
      total: count ?? disclosed.length,
      pending: disclosed.filter((application) => application.status === "submitted").length,
    },
  };
}
