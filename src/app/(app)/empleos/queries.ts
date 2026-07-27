import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  allPhotoUrls,
  decodeCursor,
  encodeCursor,
  firstPhotoUrl,
  formatListingPrice,
  toTrustLevel,
} from "@/components/listings";
import {
  labelJobAnswers,
  parseJobAttrs,
  type EmploymentType,
  type JobQuestion,
} from "@/components/empleos/helpers";
import { timeAgo } from "@/lib/utils";

/**
 * LECTURAS de Empleos. Un empleo es un `listings` kind='job' (0004) — no hay
 * tabla de avisos propia; lo único nuevo es `job_applications` (0040).
 *
 * Todo con el cliente del USUARIO: la RLS decide qué se ve. El listado es
 * contenido `published` (lectura pública a propósito), mientras que las
 * postulaciones solo las ven las partes — `job_applications_select` filtra por
 * postulante o dueño del aviso, así que acá no hay que re-chequear el rol.
 */

const PAGE_SIZE = 12;

type ApplicationStatus = "submitted" | "accepted" | "declined" | "withdrawn";

const APPLICATION_STATUSES = new Set<string>([
  "submitted",
  "accepted",
  "declined",
  "withdrawn",
]);

/** `status` viene como text de la DB; si llegara algo raro degrada a submitted. */
function toApplicationStatus(raw: string | null | undefined): ApplicationStatus {
  return raw && APPLICATION_STATUSES.has(raw) ? (raw as ApplicationStatus) : "submitted";
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

export type JobCardModel = {
  id: string;
  title: string;
  /** Ej.: "US$ 18/hora" — armado con formatListingPrice (PERIOD_SUFFIX ya sabe /hora). */
  salaryLabel: string | null;
  employmentType: EmploymentType | null;
  areaLabel: string | null;
  photoUrl: string | null;
  /**
   * TODAS las fotos del aviso ya resueltas a URL pública. Tocar la foto de la
   * card abre el visor con la galería completa; al detalle se entra por la
   * píldora (feedback 2026-07-26). Vacío = aviso sin foto, el caso más común.
   */
  photos: string[];
  publisherName: string | null;
};

export type JobsPage = {
  items: JobCardModel[];
  nextCursor: string | null;
};

export async function fetchJobsPage(input: {
  tenantId: string;
  employmentType?: EmploymentType | null;
  cursor?: string | null;
}): Promise<JobsPage> {
  const supabase = await createClient();

  // Keyset pagination (created_at, id) — mismo patrón que /marketplace.
  let query = supabase
    .from("listings")
    .select(
      "id, title, price_amount, price_currency, price_period, area_label, attrs, photos, created_at, created_by, publisher_name",
    )
    .eq("tenant_id", input.tenantId)
    .eq("kind", "job")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (input.employmentType) {
    query = query.eq("attrs->>employment_type", input.employmentType);
  }

  const cursor = decodeCursor(input.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data: rows, error } = await query;
  if (error) {
    console.warn("[empleos] query de avisos falló", { code: error.code });
    return { items: [], nextCursor: null };
  }

  const pageRows = (rows ?? []).slice(0, PAGE_SIZE);
  const hasMore = (rows ?? []).length > PAGE_SIZE;

  // Nombre de quien publica: los avisos importados traen `publisher_name`; los
  // de la comunidad, el perfil de `created_by`. Una sola vuelta para todos.
  const memberIds = [
    ...new Set(
      pageRows
        .filter((row) => !row.publisher_name && row.created_by)
        .map((row) => row.created_by as string),
    ),
  ];
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", memberIds)
    : { data: [] as Array<{ id: string; display_name: string }> };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const items: JobCardModel[] = pageRows.map((row) => ({
    id: row.id,
    title: row.title,
    salaryLabel: formatListingPrice(row.price_amount, row.price_currency, row.price_period),
    employmentType: parseJobAttrs(row.attrs).employmentType,
    areaLabel: row.area_label,
    photoUrl: firstPhotoUrl(row.photos),
    photos: allPhotoUrls(row.photos),
    publisherName:
      row.publisher_name ?? (row.created_by ? (nameById.get(row.created_by) ?? null) : null),
  }));

  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Postulación del viewer
// ---------------------------------------------------------------------------

/** Estado de la postulación del viewer sobre un aviso (null = nunca postuló). */
export type ViewerApplication = {
  id: string;
  status: ApplicationStatus;
};

export async function fetchViewerApplication(
  jobId: string,
  viewerId: string,
): Promise<ViewerApplication | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("id, status")
    .eq("job_id", jobId)
    .eq("applicant_id", viewerId)
    .maybeSingle();

  if (error) {
    console.warn("[empleos] no se pudo leer la postulación propia", { code: error.code });
    return null;
  }
  return data ? { id: data.id, status: toApplicationStatus(data.status) } : null;
}

// ---------------------------------------------------------------------------
// Postulaciones recibidas (vista del dueño del aviso)
// ---------------------------------------------------------------------------

/** Fila lista-para-render de la vista del dueño (respuestas ya etiquetadas). */
export type JobApplicationView = {
  id: string;
  applicantId: string;
  displayName: string;
  avatarUrl: string | null;
  status: ApplicationStatus;
  message: string | null;
  /** Pregunta legible + respuesta legible ("Sí"/"No" u opción elegida). */
  answers: Array<{ question: string; answer: string }>;
  createdAtLabel: string;
  trust: { score: number; level: string } | null;
};

export async function fetchJobApplications(
  jobId: string,
  questions: JobQuestion[],
): Promise<JobApplicationView[]> {
  const supabase = await createClient();
  // Sin 'withdrawn': el copy le promete al postulante que al retirarse su
  // postulación deja de verse — la query cumple esa promesa. Y con tope: un
  // aviso viral no puede tumbar la página de su dueño trayendo todo.
  const { data: rows, error } = await supabase
    .from("job_applications")
    .select("id, applicant_id, status, message, answers, created_at")
    .eq("job_id", jobId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("[empleos] query de postulaciones falló", { code: error.code });
    return [];
  }

  const applications = rows ?? [];
  if (applications.length === 0) return [];

  // Batch de perfil + confianza (espejo de OwnerApplications en creadores).
  const applicantIds = [...new Set(applications.map((row) => row.applicant_id))];
  const [{ data: profiles }, { data: trusts }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, avatar_url").in("id", applicantIds),
    supabase.from("trust_scores").select("profile_id, score, level").in("profile_id", applicantIds),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const trustById = new Map((trusts ?? []).map((t) => [t.profile_id, t]));
  const now = new Date();

  return applications.map((row) => {
    const profile = profileById.get(row.applicant_id);
    const trust = trustById.get(row.applicant_id);
    return {
      id: row.id,
      applicantId: row.applicant_id,
      displayName: profile?.display_name ?? "Alguien de la comunidad",
      avatarUrl: profile?.avatar_url ?? null,
      status: toApplicationStatus(row.status),
      message: row.message,
      answers: labelJobAnswers(questions, row.answers),
      createdAtLabel: timeAgo(row.created_at, now),
      trust: trust ? { score: trust.score, level: toTrustLevel(trust.level) } : null,
    };
  });
}
