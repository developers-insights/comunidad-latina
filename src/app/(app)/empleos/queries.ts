import "server-only";

import {
  recordBoostImpressions,
  resolveViewerGeo,
  selectOwnBoosts,
} from "@/lib/boosts/select";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import {
  allPhotoUrls,
  buildTrustSignals,
  decodeCursor,
  encodeCursor,
  firstPhotoUrl,
  formatListingPrice,
  toTrustLevel,
  type PublisherView,
} from "@/components/listings";
import { COPY } from "@/components/empleos/copy";
import { readJobDetails } from "@/lib/empleos/detalles";
import { etiquetaDeSalario } from "@/lib/empleos/salario";
import {
  labelJobAnswers,
  parseJobAttrs,
  type EmploymentType,
  type JobQuestion,
} from "@/components/empleos/helpers";
import {
  isVisibleToEmployer,
  toJobApplicationStatus,
  type JobApplicationStatus,
} from "@/lib/empleos/application-status";
import type { Tables } from "@/lib/types/database.types";
import { timeAgo } from "@/lib/utils";

/**
 * LECTURAS de Empleos. Un empleo es un `listings` kind='job' (0004) — no hay
 * tabla de avisos propia; lo nuevo son `job_applications` (0040/0047),
 * `job_application_notes` y `saved_candidates`.
 *
 * Todo con el cliente del USUARIO: la RLS decide qué se ve. El listado es
 * contenido `published` (lectura pública a propósito); las postulaciones solo
 * las ven las partes — `job_applications_select` (0042) filtra por postulante
 * o por DUEÑO DEL AVISO, así que acá no hay que re-chequear el rol.
 *
 * ── LO QUE ESTE ARCHIVO NO HACE, Y ES DELIBERADO ───────────────────────────
 * · No devuelve NUNCA `cv_url` al componente. El path del archivo se queda en
 *   el servidor; la pantalla recibe un booleano ("tiene currículum") y pide la
 *   URL firmada por action cuando alguien la toca. Un path en el HTML es un
 *   path que se puede probar contra el endpoint público.
 * · No lee `job_application_notes` de nadie más que su propio autor — que es
 *   además lo único que la policy permite.
 */

const PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

export type JobCardModel = {
  id: string;
  title: string;
  /** Ej.: "US$ 18/hora" — armado con formatListingPrice (PERIOD_SUFFIX ya sabe /hora). */
  salaryLabel: string | null;
  /**
   * El salario con RANGO cuando lo hay ("US$ 18 a US$ 22/hora"). El piso vive
   * en `price_amount` y sólo el techo en `attrs.salary_max` (0107). Sin techo,
   * `etiquetaDeSalario` devuelve lo mismo que `salaryLabel`.
   */
  salaryRangeLabel: string | null;
  /** `listings.work_mode` cruda (0087). La etiqueta la resuelve `workModeLabel`. */
  workMode: string | null;
  employmentType: EmploymentType | null;
  areaLabel: string | null;
  photoUrl: string | null;
  /**
   * TODAS las fotos del aviso ya resueltas a URL pública. Tocar la foto de la
   * card abre el visor con la galería completa; al detalle se entra por la
   * píldora (feedback 2026-07-26). Vacío = aviso sin foto, el caso más común.
   */
  photos: string[];
  /**
   * Miembro con Trust Score resuelto en batch, publicador externo (seed sin
   * cuenta) o null. Mismo contrato que /propiedades y /profesionales — la
   * card decide sola qué señal de confianza mostrar (§ producto anti-estafa).
   */
  publisher: PublisherView;
  /** Impulso activo (`boosts`, §7): contorno dorado + chip "Patrocinado" en la página. */
  boosted: boolean;
};

export type JobsPage = {
  items: JobCardModel[];
  nextCursor: string | null;
};

// ---------------------------------------------------------------------------
// Fila cruda de `listings` (kind='job') → JobCardModel
// ---------------------------------------------------------------------------

type JobListingRow = Pick<
  Tables<"listings">,
  | "id"
  | "title"
  | "price_amount"
  | "price_currency"
  | "price_period"
  | "area_label"
  | "attrs"
  | "photos"
  | "created_at"
  | "created_by"
  | "publisher_name"
  | "work_mode"
>;

/** Solo las columnas que alimentan el badge (over-fetch §perf, mismo criterio que /negocios). */
type PublisherProfileRow = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "avatar_url" | "identity_verified"
>;
type PublisherTrustRow = Pick<Tables<"trust_scores">, "profile_id" | "score" | "level" | "signals">;

const JOB_LISTING_COLUMNS =
  "id, title, price_amount, price_currency, price_period, area_label, attrs, photos, created_at, created_by, publisher_name, work_mode";

/**
 * Mapeo puro fila → card. Publicador: perfil + Trust Score si el aviso es de
 * un miembro (`created_by`); `publisher_name` crudo si es de fuente externa
 * (seed/API, sin cuenta detrás) — mismo patrón que /propiedades y /profesionales.
 */
export function toJobCardModel(
  row: JobListingRow,
  profileById: ReadonlyMap<string, PublisherProfileRow>,
  trustById: ReadonlyMap<string, PublisherTrustRow>,
  boostedIds: ReadonlySet<string>,
): JobCardModel {
  let publisher: PublisherView = null;
  if (row.created_by) {
    const profile = profileById.get(row.created_by);
    const trust = trustById.get(row.created_by);
    publisher = {
      type: "member",
      profileId: row.created_by,
      displayName: profile?.display_name ?? row.publisher_name ?? COPY.list.communityMember,
      avatarUrl: profile?.avatar_url ?? null,
      score: trust?.score ?? 0,
      level: toTrustLevel(trust?.level),
      signals: buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false),
    };
  } else if (row.publisher_name) {
    publisher = { type: "external", name: row.publisher_name };
  }

  return {
    id: row.id,
    title: row.title,
    salaryLabel: formatListingPrice(row.price_amount, row.price_currency, row.price_period),
    // El PISO vive en `price_amount` (es lo que ordena y filtra toda la app) y
    // sólo el TECHO en `attrs.salary_max` — ver `lib/empleos/salario.ts`.
    // `salaryLabel` queda como respaldo: si no hay techo, `etiquetaDeSalario`
    // devuelve exactamente lo mismo.
    salaryRangeLabel: etiquetaDeSalario(
      row.price_amount,
      row.price_currency,
      row.price_period,
      readJobDetails(row.attrs).salaryMax,
    ),
    workMode: row.work_mode,
    employmentType: parseJobAttrs(row.attrs).employmentType,
    areaLabel: row.area_label,
    photoUrl: firstPhotoUrl(row.photos),
    photos: allPhotoUrls(row.photos),
    publisher,
    boosted: boostedIds.has(row.id),
  };
}

export async function fetchJobsPage(input: {
  tenantId: string;
  employmentType?: EmploymentType | null;
  /** Término de búsqueda (?q=) ya sanitizado por el caller (sanitizeSearchQuery). */
  q?: string | null;
  cursor?: string | null;
  /**
   * "Tu zona", ya resuelta a etiquetas EXACTAS de `area_label` por
   * `resolverVistaZona` (@/lib/zona/server). Vacío o ausente = sin recorte
   * geográfico.
   *
   * Llega resuelta y no como una etiqueta suelta a propósito: el match de zonas
   * es laxo y sin acentos (`sameZoneLabel`), algo que PostgREST no sabe hacer.
   * Traducirlo a un `.in()` ANTES de la query es lo que deja que el recorte lo
   * haga SQL y que la paginación por cursor siga trayendo páginas del tamaño
   * que promete.
   */
  areaLabels?: readonly string[] | null;
  /** La zona elegida, cruda, para el alcance geográfico de los impulsos (0092). */
  zoneFilter?: string | null;
}): Promise<JobsPage> {
  const supabase = await createClient();

  // Keyset pagination (created_at, id) — mismo patrón que /marketplace.
  let query = supabase
    .from("listings")
    .select(JOB_LISTING_COLUMNS)
    .eq("tenant_id", input.tenantId)
    .eq("kind", "job")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (input.employmentType) {
    query = query.eq("attrs->>employment_type", input.employmentType);
  }
  if (input.q) {
    // Mismo índice FTS que /propiedades y /negocios (listings.search, 0004) —
    // kind='job' está indexado (confirmado contra 0044_global_search.sql).
    query = query.textSearch("search", input.q, { type: "websearch", config: "spanish" });
  }
  const zonaLabels = input.areaLabels ?? [];
  if (zonaLabels.length > 0) {
    query = query.in("area_label", [...zonaLabels]);
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

  const pageRows = (rows ?? []) as JobListingRow[];
  const trimmedRows = pageRows.slice(0, PAGE_SIZE);
  const hasMore = pageRows.length > PAGE_SIZE;

  // ---------------------------------------------------------------------
  // Patrocinado (§7): mismo patrón boosted-first que /propiedades — SOLO en
  // la primera página (sin cursor) y SOLO cuando no hay filtro activo (un
  // resultado boosteado que no matchea jornada/búsqueda no se inyecta).
  // ---------------------------------------------------------------------
  //
  // ALCANCE GEOGRÁFICO (0092): un impulso `local` sólo ocupa lugar para quien
  // está en su zona; `nacional` y `global`, para toda la comunidad. La regla
  // vive UNA vez en `src/lib/boosts`, no copiada en cada listado.
  let boostedIds = new Set<string>();
  let boostedExtra: JobListingRow[] = [];
  // "Tu zona" cuenta como filtro para la inyección de impulsados: un aviso
  // patrocinado de otro barrio no se cuela en una pantalla recortada a un barrio.
  const sinFiltros = !input.employmentType && !input.q && zonaLabels.length === 0;
  if (!cursor) {
    const viewer = await resolveViewerGeo(supabase, {
      tenantId: input.tenantId,
      userId: await getAuthUserId(),
      // La zona elegida en el header pesa más que la del perfil (0092).
      zoneFilter: input.zoneFilter ?? null,
    });
    const placement = await selectOwnBoosts(supabase, { tenantId: input.tenantId, viewer });
    boostedIds = placement.listingIds;
    // Se sirvieron: se cuentan (0092). Best-effort y ruidoso ante la falla.
    await recordBoostImpressions(placement.boostIds);

    // Destacados que no entraron por fecha: solo en la vista sin filtros (con
    // filtros activos jamás se inyecta un resultado que no matchea).
    const missingIds = [...boostedIds].filter(
      (id) => !trimmedRows.some((row) => row.id === id),
    );
    if (sinFiltros && missingIds.length > 0) {
      const { data: extra } = await supabase
        .from("listings")
        .select(JOB_LISTING_COLUMNS)
        .eq("tenant_id", input.tenantId)
        .eq("kind", "job")
        .eq("status", "published")
        .in("id", missingIds);
      boostedExtra = (extra ?? []) as JobListingRow[];
    }
  }

  // Boosted-first estable: destacados arriba, el resto en su orden natural.
  const orderedRows: JobListingRow[] = [
    ...boostedExtra,
    ...trimmedRows.filter((row) => boostedIds.has(row.id)),
    ...trimmedRows.filter((row) => !boostedIds.has(row.id)),
  ];

  // Publicador: perfil + Trust Score en batch — mismo patrón que /profesionales
  // (una query para todos los perfiles, una para todos los trust_scores, nunca
  // por ítem).
  const memberIds = [
    ...new Set(
      orderedRows.map((row) => row.created_by).filter((id): id is string => Boolean(id)),
    ),
  ];
  const [{ data: profiles }, { data: trusts }] = await Promise.all([
    memberIds.length
      ? supabase
          .from("profiles")
          .select("id, display_name, avatar_url, identity_verified")
          .in("id", memberIds)
      : Promise.resolve({ data: [] as PublisherProfileRow[] }),
    memberIds.length
      ? supabase
          .from("trust_scores")
          .select("profile_id, score, level, signals")
          .in("profile_id", memberIds)
      : Promise.resolve({ data: [] as PublisherTrustRow[] }),
  ]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const trustById = new Map((trusts ?? []).map((t) => [t.profile_id, t]));

  const items: JobCardModel[] = orderedRows.map((row) =>
    toJobCardModel(row, profileById, trustById, boostedIds),
  );

  const last = trimmedRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Postulación del viewer sobre UN aviso
// ---------------------------------------------------------------------------

/** Estado de la postulación del viewer sobre un aviso (null = nunca postuló). */
export type ViewerApplication = {
  id: string;
  status: JobApplicationStatus;
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
  return data ? { id: data.id, status: toJobApplicationStatus(data.status) } : null;
}

// ---------------------------------------------------------------------------
// "Mis postulaciones" (vista del candidato)
// ---------------------------------------------------------------------------

export type MyApplication = {
  id: string;
  jobId: string;
  jobTitle: string;
  salaryLabel: string | null;
  areaLabel: string | null;
  /** El aviso puede haberse despublicado: lo decimos en vez de ocultar la fila. */
  jobIsOpen: boolean;
  status: JobApplicationStatus;
  createdAtLabel: string;
  updatedAtLabel: string;
  hasCv: boolean;
  portfolioLinks: string[];
  shareProfile: boolean;
  message: string | null;
};

/**
 * Todas las postulaciones de una persona, la más reciente arriba.
 *
 * Incluye las retiradas: para el CANDIDATO su propio historial es información
 * legítima ("¿me postulé a este aviso o me lo imaginé?"). Lo que desaparece al
 * retirarse es la fila en la bandeja del DUEÑO, que es la promesa real.
 */
export async function fetchMyApplications(input: {
  tenantId: string;
  viewerId: string;
}): Promise<MyApplication[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("job_applications")
    .select(
      "id, job_id, status, message, cv_url, portfolio_links, share_profile, created_at, updated_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("applicant_id", input.viewerId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.warn("[empleos] query de mis postulaciones falló", { code: error.code });
    return [];
  }
  const applications = rows ?? [];
  if (applications.length === 0) return [];

  const jobIds = [...new Set(applications.map((row) => row.job_id))];
  const { data: jobs } = await supabase
    .from("listings")
    .select("id, title, status, area_label, price_amount, price_currency, price_period")
    .in("id", jobIds);
  const jobById = new Map((jobs ?? []).map((job) => [job.id, job]));
  const now = new Date();

  return applications.map((row) => {
    const job = jobById.get(row.job_id);
    return {
      id: row.id,
      jobId: row.job_id,
      jobTitle: job?.title ?? "Aviso no disponible",
      salaryLabel: job
        ? formatListingPrice(job.price_amount, job.price_currency, job.price_period)
        : null,
      areaLabel: job?.area_label ?? null,
      jobIsOpen: job?.status === "published",
      status: toJobApplicationStatus(row.status),
      createdAtLabel: timeAgo(row.created_at, now),
      updatedAtLabel: timeAgo(row.updated_at, now),
      // Booleano, nunca el path: ver la nota de arriba.
      hasCv: Boolean(row.cv_url),
      portfolioLinks: row.portfolio_links ?? [],
      shareProfile: row.share_profile,
      message: row.message,
    };
  });
}

// ---------------------------------------------------------------------------
// "Candidatos" (vista de quien PUBLICÓ el aviso)
// ---------------------------------------------------------------------------

/**
 * Una candidatura lista para render.
 *
 * `profile` viene en null cuando la persona NO compartió su perfil
 * (`share_profile = false`): el consentimiento se respeta acá, en la lectura,
 * no en el render — así el dato ni siquiera entra al payload RSC que viaja al
 * navegador. Mismo criterio que `discloseApplication` en /admin/empleos.
 */
export type JobCandidateView = {
  id: string;
  /**
   * SOLO cuando la persona compartió su perfil. Sin consentimiento, su id ni
   * siquiera viaja al navegador: con el id, "no comparto mi perfil" duraría lo
   * que tarda alguien en escribir /perfil/{id} a mano.
   */
  applicantId: string | null;
  status: JobApplicationStatus;
  createdAtLabel: string;
  message: string | null;
  answers: Array<{ question: string; answer: string }>;
  hasCv: boolean;
  portfolioLinks: string[];
  /** null = la persona eligió no compartir su perfil con quien contrata. */
  profile: {
    displayName: string;
    avatarUrl: string | null;
    areaLabel: string | null;
    identityVerified: boolean;
    trust: { score: number; level: string; signals: unknown } | null;
  } | null;
  /** Nota privada de quien mira. El candidato jamás la recibe. */
  note: string | null;
  saved: boolean;
};

export type JobCandidatesResult = {
  candidates: JobCandidateView[];
  /** Postulaciones todavía sin resolver — el número que le importa al dueño. */
  openCount: number;
};

export async function fetchJobCandidates(input: {
  jobId: string;
  tenantId: string;
  viewerId: string;
  questions: JobQuestion[];
}): Promise<JobCandidatesResult> {
  const supabase = await createClient();

  // Sin 'withdrawn': el copy le promete al postulante que al retirarse su
  // postulación deja de verse. Y con tope: un aviso viral no puede tumbar la
  // página de su dueño trayendo todo.
  const { data: rows, error } = await supabase
    .from("job_applications")
    .select(
      "id, applicant_id, status, message, answers, cv_url, portfolio_links, share_profile, created_at",
    )
    .eq("job_id", input.jobId)
    .eq("tenant_id", input.tenantId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.warn("[empleos] query de candidatos falló", { code: error.code });
    return { candidates: [], openCount: 0 };
  }

  const applications = (rows ?? []).filter((row) =>
    isVisibleToEmployer(toJobApplicationStatus(row.status)),
  );
  if (applications.length === 0) return { candidates: [], openCount: 0 };

  // Perfil + confianza solo de quienes SÍ compartieron su perfil: pedirle a la
  // base los datos de los demás sería traerlos al servidor para descartarlos.
  const sharedIds = [
    ...new Set(
      applications.filter((row) => row.share_profile).map((row) => row.applicant_id),
    ),
  ];
  const applicationIds = applications.map((row) => row.id);
  const candidateIds = [...new Set(applications.map((row) => row.applicant_id))];

  const [{ data: profiles }, { data: trusts }, { data: notes }, { data: saved }] =
    await Promise.all([
      sharedIds.length
        ? supabase
            .from("profiles")
            .select("id, display_name, avatar_url, area_label, identity_verified")
            .in("id", sharedIds)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              display_name: string;
              avatar_url: string | null;
              area_label: string | null;
              identity_verified: boolean;
            }>,
          }),
      sharedIds.length
        ? supabase
            .from("trust_scores")
            .select("profile_id, score, level, signals")
            .in("profile_id", sharedIds)
        : Promise.resolve({
            data: [] as Array<{
              profile_id: string;
              score: number;
              level: string;
              signals: unknown;
            }>,
          }),
      // Solo LAS PROPIAS: la policy no devolvería otras, y el filtro explícito
      // deja escrito que acá no se leen notas de terceros ni por accidente.
      supabase
        .from("job_application_notes")
        .select("application_id, note")
        .eq("author_id", input.viewerId)
        .in("application_id", applicationIds),
      supabase
        .from("saved_candidates")
        .select("candidate_id")
        .eq("employer_id", input.viewerId)
        .in("candidate_id", candidateIds),
    ]);

  const profileById = new Map((profiles ?? []).map((row) => [row.id, row]));
  const trustById = new Map((trusts ?? []).map((row) => [row.profile_id, row]));
  const noteByApplication = new Map((notes ?? []).map((row) => [row.application_id, row.note]));
  const savedIds = new Set((saved ?? []).map((row) => row.candidate_id));
  const now = new Date();

  const candidates: JobCandidateView[] = applications.map((row) => {
    const status = toJobApplicationStatus(row.status);
    const profile = row.share_profile ? profileById.get(row.applicant_id) : undefined;
    const trust = profile ? trustById.get(row.applicant_id) : undefined;

    return {
      id: row.id,
      applicantId: profile ? row.applicant_id : null,
      status,
      createdAtLabel: timeAgo(row.created_at, now),
      message: row.message,
      answers: labelJobAnswers(input.questions, row.answers),
      hasCv: Boolean(row.cv_url),
      portfolioLinks: row.portfolio_links ?? [],
      profile: profile
        ? {
            displayName: profile.display_name,
            avatarUrl: profile.avatar_url,
            areaLabel: profile.area_label,
            identityVerified: profile.identity_verified,
            trust: trust
              ? { score: trust.score, level: toTrustLevel(trust.level), signals: trust.signals }
              : null,
          }
        : null,
      note: noteByApplication.get(row.id) ?? null,
      saved: savedIds.has(row.applicant_id),
    };
  });

  return {
    candidates,
    openCount: candidates.filter(
      (candidate) => candidate.status === "submitted" || candidate.status === "reviewing",
    ).length,
  };
}

/**
 * Conteo para la tarjeta de la página de detalle: cuántas postulaciones tiene
 * el aviso y cuántas siguen sin resolver. Es una lectura barata (head+count),
 * no una versión reducida de la de arriba.
 */
export async function fetchJobApplicationCounts(input: {
  jobId: string;
  tenantId: string;
}): Promise<{ total: number; open: number }> {
  const supabase = await createClient();
  const [{ count: total }, { count: open }] = await Promise.all([
    supabase
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("job_id", input.jobId)
      .eq("tenant_id", input.tenantId)
      .neq("status", "withdrawn"),
    supabase
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("job_id", input.jobId)
      .eq("tenant_id", input.tenantId)
      .in("status", ["submitted", "reviewing"]),
  ]);
  return { total: total ?? 0, open: open ?? 0 };
}

/**
 * Datos del perfil que se le ofrecen a quien va a postularse, para que no
 * vuelva a escribir lo mismo en cada aviso. Se muestran ANTES de enviar, con
 * el interruptor para no compartirlos.
 */
export type ApplicantProfilePreview = {
  displayName: string;
  avatarUrl: string | null;
  areaLabel: string | null;
  identityVerified: boolean;
  trust: { score: number; level: string } | null;
};

export async function fetchApplicantProfilePreview(
  viewerId: string,
): Promise<ApplicantProfilePreview | null> {
  const supabase = await createClient();
  const [{ data: profile }, { data: trust }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, avatar_url, area_label, identity_verified")
      .eq("id", viewerId)
      .maybeSingle(),
    supabase
      .from("trust_scores")
      .select("score, level")
      .eq("profile_id", viewerId)
      .maybeSingle(),
  ]);

  if (!profile) return null;
  return {
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    areaLabel: profile.area_label,
    identityVerified: profile.identity_verified,
    trust: trust ? { score: trust.score, level: toTrustLevel(trust.level) } : null,
  };
}
