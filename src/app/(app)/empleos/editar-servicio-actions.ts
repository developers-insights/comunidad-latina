"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { supabaseSinTiparListings } from "@/lib/listings";
import {
  TIER_AUTO,
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
} from "@/lib/moderation";
import { fetchVideoDeAviso, type VideoGuardado } from "@/lib/media/listing-video-queries";
import {
  SIN_VIDEO,
  columnasDeVideo,
  errorDeVideoDeLaBase,
  listingVideoInputSchema,
  validarVideoDeAviso,
  type ListingVideoColumns,
} from "@/lib/media/listing-video-server";
import { JOB_PAY_PERIODS, type JobPayPeriod } from "@/components/empleos/helpers";
import { requiresArea, normalizeWorkMode, type WorkMode } from "@/lib/creators/work-mode";
import { SCHEDULE_ATTR, WORK_DAYS_ATTR, isWorkDay, normalizeWorkDays } from "@/lib/empleos/detalles";
import { readServiceDetails } from "@/lib/empleos/servicios";
import {
  EDICION_COPY,
  pausadoPorReportes,
  puedeEditarse,
  statusDespuesDeEditar,
} from "@/lib/listings/edicion";
import {
  SERVICE_USER_FACING_ISSUES,
  serviceDraftSchema,
} from "./publicar/service-schema";

const GENERICO = EDICION_COPY.errores.generico;
const EDITABLES_EN_QUERY = ["published", "paused", "pending_review"] as const;
const COLUMNAS =
  "id, kind, status, title, description, price_amount, price_period, area_label, work_mode, attrs";

type FilaDeServicio = {
  id: string;
  kind: string;
  status: string;
  title: string;
  description: string | null;
  price_amount: number | string | null;
  price_period: string | null;
  area_label: string | null;
  work_mode: string | null;
  attrs: unknown;
};

function attrsDe(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? { ...(valor as Record<string, unknown>) }
    : {};
}

function precioDe(valor: number | string | null): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = typeof valor === "string" ? Number(valor) : valor;
  return Number.isFinite(numero) ? numero : null;
}

function periodoDe(valor: string | null): JobPayPeriod {
  return (JOB_PAY_PERIODS as readonly string[]).includes(valor ?? "")
    ? (valor as JobPayPeriod)
    : "hour";
}

function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

export interface ServicioEditable {
  id: string;
  status: string;
  title: string;
  description: string;
  priceAmount: number | null;
  payPeriod: JobPayPeriod;
  workMode: WorkMode;
  areaLabel: string;
  days: string[];
  schedule: string;
  currency: string;
  bloqueadoPorModeracion: boolean;
  tier: string | null;
  video: VideoGuardado | null;
  videoDisponible: boolean;
}

export type CargarServicioResult =
  | { ok: true; servicio: ServicioEditable }
  | { ok: false; error: string; needsAuth?: boolean };

const cargarSchema = z.object({ listingId: z.uuid() });

export async function cargarServicioParaEditar(rawInput: {
  listingId: string;
}): Promise<CargarServicioResult> {
  const parsed = cargarSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: GENERICO };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: EDICION_COPY.errores.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  const { data, error } = await supabaseSinTiparListings(supabase)
    .from("listings")
    .select(COLUMNAS)
    .eq("id", parsed.data.listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "service")
    .maybeSingle();

  if (error || !data) return { ok: false, error: EDICION_COPY.errores.noEsTuya };
  const fila = data as FilaDeServicio;
  const detalles = readServiceDetails(fila.attrs);
  const extra = await fetchVideoDeAviso(supabase, fila.id);

  return {
    ok: true,
    servicio: {
      id: fila.id,
      status: fila.status,
      title: fila.title ?? "",
      description: fila.description ?? "",
      priceAmount: precioDe(fila.price_amount),
      payPeriod: periodoDe(fila.price_period),
      workMode: normalizeWorkMode(fila.work_mode) ?? "presencial",
      areaLabel: fila.area_label ?? "",
      days: detalles.days,
      schedule: detalles.schedule ?? "",
      currency: tenant.currency,
      bloqueadoPorModeracion: pausadoPorReportes(fila.status, fila.attrs),
      tier: extra?.tier ?? null,
      video: extra?.video ?? null,
      videoDisponible: extra !== null,
    },
  };
}

const idSchema = z.uuid();

export type EditarServicioResult =
  | { ok: true; status: "published" | "pending_review" | "paused"; sinCambios?: false }
  | { ok: true; status: string; sinCambios: true }
  | { ok: false; error: string; needsAuth?: boolean };

export async function editarServicioAction(rawInput: {
  listingId: string;
  title: string;
  description: string;
  priceAmount: number | null;
  payPeriod: JobPayPeriod;
  workMode: WorkMode;
  areaLabel: string | null;
  days: string[];
  schedule: string | null;
  video?: z.input<typeof listingVideoInputSchema>;
}): Promise<EditarServicioResult> {
  const id = idSchema.safeParse(rawInput.listingId);
  const parsed = serviceDraftSchema.safeParse({
    title: rawInput.title,
    description: rawInput.description,
    priceAmount: rawInput.priceAmount,
    payPeriod: rawInput.payPeriod,
    workMode: rawInput.workMode,
    areaLabel: rawInput.areaLabel,
    days: rawInput.days,
    schedule: rawInput.schedule,
  });
  const videoParsed = listingVideoInputSchema.safeParse(rawInput.video);
  if (!id.success || !videoParsed.success) return { ok: false, error: GENERICO };
  if (!parsed.success) {
    const explicit = parsed.error.issues.find((issue) =>
      SERVICE_USER_FACING_ISSUES.has(issue.message),
    );
    return { ok: false, error: explicit?.message ?? GENERICO };
  }
  const listingId = id.data;
  const entrada = parsed.data;
  const videoEntrada = videoParsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: EDICION_COPY.errores.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`editar-aviso:${user.id}`, 40, DAY_MS).ok) {
    return { ok: false, error: EDICION_COPY.errores.demasiado };
  }

  const sinTipar = supabaseSinTiparListings(supabase);

  const { data, error: readError } = await sinTipar
    .from("listings")
    .select(COLUMNAS)
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "service")
    .maybeSingle();

  if (readError || !data) return { ok: false, error: EDICION_COPY.errores.noEsTuya };
  const fila = data as FilaDeServicio;

  if (!puedeEditarse(fila.status, pausadoPorReportes(fila.status, fila.attrs))) {
    return { ok: false, error: EDICION_COPY.errores.noSeEdita };
  }

  const workMode = entrada.workMode ?? null;
  const areaLabel = requiresArea(workMode) ? (entrada.areaLabel ?? "").trim() || null : null;
  const priceAmount = entrada.priceAmount ?? null;
  const days = normalizeWorkDays((entrada.days ?? []).filter(isWorkDay));
  const schedule = entrada.schedule || null;

  const actual = readServiceDetails(fila.attrs);
  const cambioTexto =
    (fila.title ?? "").trim() !== entrada.title ||
    (fila.description ?? "").trim() !== entrada.description ||
    precioDe(fila.price_amount) !== priceAmount ||
    (priceAmount !== null && periodoDe(fila.price_period) !== entrada.payPeriod) ||
    (fila.work_mode ?? null) !== workMode ||
    (fila.area_label ?? null) !== areaLabel ||
    actual.days.join(",") !== days.join(",") ||
    (actual.schedule ?? null) !== schedule;

  let videoColumns: ListingVideoColumns | null = null;
  if (videoEntrada !== undefined) {
    const guardado = await fetchVideoDeAviso(supabase, listingId);
    if ((videoEntrada?.path ?? null) !== (guardado?.video?.path ?? null)) {
      if (videoEntrada === null) {
        videoColumns = SIN_VIDEO;
      } else {
        const videoCheck = await validarVideoDeAviso({
          input: videoEntrada,
          tenantId: tenant.id,
          userId: user.id,
          tier: guardado?.tier,
        });
        if (!videoCheck.ok) return { ok: false, error: videoCheck.error };
        videoColumns = videoCheck.columns;
      }
    }
  }

  if (!cambioTexto && videoColumns === null) {
    return { ok: true, status: fila.status, sinCambios: true };
  }

  const attrs = attrsDe(fila.attrs);
  if (days.length > 0) attrs[WORK_DAYS_ATTR] = days;
  else delete attrs[WORK_DAYS_ATTR];
  if (schedule) attrs[SCHEDULE_ATTR] = schedule;
  else delete attrs[SCHEDULE_ATTR];

  const moderation = await moderateText(`${entrada.title}\n${entrada.description}`);
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  const videoNeedsAsyncReview =
    videoColumns !== null && videoColumns.video_path !== null && !devAutoApprove();

  const eraPublicado = fila.status === "published";
  const statusInicial = statusDespuesDeEditar(fila.status);

  const { data: updated, error: updateError } = await sinTipar
    .from("listings")
    .update({
      title: entrada.title,
      description: entrada.description,
      price_amount: priceAmount,
      price_period: priceAmount === null ? null : entrada.payPeriod,
      work_mode: workMode,
      area_label: areaLabel,
      attrs,
      status: statusInicial,
      ...columnasDeVideo(videoColumns),
    })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "service")
    .in("status", [...EDITABLES_EN_QUERY])
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[empleos] no se pudo guardar la edición del servicio", {
      listingId,
      code: updateError?.code,
    });
    return { ok: false, error: errorDeVideoDeLaBase(updateError) ?? GENERICO };
  }

  let status: "published" | "pending_review" | "paused" = statusInicial;

  // La RLS del dueño no deja escribir `published`: el regreso a publicado, como
  // en el alta, lo hace el admin client y sólo si el texto pasó la moderación y
  // el aviso ya estaba a la vista. Uno que esperaba revisión humana no se
  // publica solo porque se lo editó.
  if (eraPublicado && !moderation.flagged && tier !== TIER_HUMAN) {
    try {
      const { error: publishError } = await createAdminClient()
        .from("listings")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", listingId)
        .eq("tenant_id", tenant.id)
        .eq("created_by", user.id)
        .eq("status", "pending_review");
      if (!publishError) status = "published";
    } catch {
      console.warn("[empleos] admin client no disponible, el servicio queda en revisión");
    }
  }

  const debeEncolar =
    moderation.flagged ||
    moderation.skipped ||
    tier > TIER_AUTO ||
    videoNeedsAsyncReview;
  if (debeEncolar && fila.status !== "paused") {
    try {
      const outcome = await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "listing",
        subjectId: listingId,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons: [
          ...(moderation.skipped ? ["moderation_skipped"] : moderation.categories),
          ...(videoNeedsAsyncReview ? ["video_async_review"] : []),
        ],
        tier:
          status === "pending_review" || videoNeedsAsyncReview ? TIER_HUMAN : TIER_REVIEW,
      });
      if (!outcome.ok) {
        console.warn("[empleos] no se pudo encolar la revisión de la edición", { listingId });
      }
    } catch {
      console.warn("[empleos] admin client no disponible para encolar moderación");
    }
  }

  revalidatePath("/empleos");
  revalidatePath(`/empleos/${listingId}`);
  revalidatePath("/publicaciones");
  return { ok: true, status };
}
