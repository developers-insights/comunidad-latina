"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffContext, logAdminAction } from "../guard";
// Helpers puros en su propio módulo: un archivo "use server" solo puede
// exportar funciones async (ver el comentario de ./modules.ts).
import { MODULE_KEYS, moduleStateSchema, toModuleColumns, type ModuleState } from "./modules";

/**
 * Server actions del panel de Dominio (domain_admin+).
 *
 * Privilegios (verificados contra las migraciones):
 *  - listings: la policy de UPDATE tiene rama de staff → cliente del usuario.
 *  - scam_reports: UPDATE de staff del tenant → cliente del usuario.
 *  - tenants.modules: el UPDATE de tenants es SOLO global_admin por RLS → un
 *    domain_admin cambia módulos de SU tenant vía admin client, gateado por
 *    rol verificado (getUser) + tenant del JWT + audit_log. Path privilegiado
 *    documentado (ARQUITECTURA §6: acto administrativo server-side).
 */

const COPY = {
  notAllowed: "Tu sesión no tiene permisos de administración del dominio.",
  invalid: "No pudimos leer los datos — recargá la página e intentá de nuevo.",
  alreadyResolved: "Ese caso ya estaba resuelto — la lista se actualizó.",
  genericError: "No pudimos guardar el cambio — no es tu culpa. Probá otra vez en un momento.",
} as const;

export type DomainActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

/* ------------------------- Listings pending_review ------------------------ */

const listingSchema = z.object({
  listingId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
});

export async function resolveListingReview(
  _prev: DomainActionState,
  formData: FormData,
): Promise<DomainActionState> {
  const parsed = listingSchema.safeParse({
    listingId: formData.get("listingId"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { listingId, decision } = parsed.data;

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;

  const patch =
    decision === "approve"
      ? { status: "published" as const, published_at: new Date().toISOString() }
      : { status: "removed" as const };

  // Cliente del staff: RLS acota al tenant del JWT. El filtro de status evita
  // pisar un aviso que otro admin ya movió.
  const { data: updated, error } = await supabase
    .from("listings")
    .update(patch)
    .eq("id", listingId)
    .eq("status", "pending_review")
    .select("id, tenant_id")
    .maybeSingle();

  if (error) return { status: "error", message: COPY.genericError };
  if (!updated) return { status: "error", message: COPY.alreadyResolved };

  // Si había un caso pendiente en la cola por este aviso, queda resuelto igual
  // (mejor una cola sin fantasmas). Best-effort, misma RLS de staff.
  await supabase
    .from("moderation_queue")
    .update({
      status: decision === "approve" ? "approved" : "rejected",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("subject_kind", "listing")
    .eq("subject_id", listingId)
    .eq("status", "pending");

  await logAdminAction({
    actorId: user.id,
    action: decision === "approve" ? "listing.approved" : "listing.rejected",
    tenantId: updated.tenant_id ?? tenantId,
    subjectKind: "listing",
    subjectId: listingId,
  });

  revalidatePath("/admin/dominio");
  revalidatePath("/admin", "layout");
  return { status: "success" };
}

/* ------------------------------ Scam reports ------------------------------ */

const reportSchema = z.object({
  reportId: z.uuid(),
  decision: z.enum(["upheld", "dismissed"]),
});

export async function resolveScamReport(
  _prev: DomainActionState,
  formData: FormData,
): Promise<DomainActionState> {
  const parsed = reportSchema.safeParse({
    reportId: formData.get("reportId"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { reportId, decision } = parsed.data;

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user } = ctx;

  const { data: report, error } = await supabase
    .from("scam_reports")
    .update({ status: decision })
    .eq("id", reportId)
    .in("status", ["open", "reviewing"])
    .select("id, tenant_id, target_kind, target_id")
    .maybeSingle();

  if (error) return { status: "error", message: COPY.genericError };
  if (!report) return { status: "error", message: COPY.alreadyResolved };

  // Reporte confirmado sobre un aviso → el aviso se baja (rama staff de RLS).
  if (decision === "upheld" && report.target_kind === "listing") {
    const { error: removeError } = await supabase
      .from("listings")
      .update({ status: "removed" })
      .eq("id", report.target_id);
    if (removeError) {
      console.error("[admin] no se pudo remover el listing reportado:", removeError.message);
    }
  }

  await logAdminAction({
    actorId: user.id,
    action: decision === "upheld" ? "scam_report.upheld" : "scam_report.dismissed",
    tenantId: report.tenant_id,
    subjectKind: report.target_kind,
    subjectId: report.target_id,
    meta: { report_id: report.id },
  });

  revalidatePath("/admin/dominio");
  return { status: "success" };
}

/* ------------------------------ Módulos on/off ---------------------------- */

export async function updateTenantModules(
  _prev: DomainActionState,
  formData: FormData,
): Promise<DomainActionState> {
  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { user, tenantId } = ctx;
  if (!tenantId) return { status: "error", message: COPY.notAllowed };

  // Se recorren las claves CANÓNICAS, no las del FormData: así un cliente no
  // puede inventar módulos ni omitir uno para dejarlo en un estado ambiguo.
  const states: Record<string, ModuleState> = {};
  for (const moduleKey of MODULE_KEYS) {
    states[moduleKey] = moduleStateSchema.parse(formData.get(`module:${moduleKey}`));
  }
  const { modules, modulesSoon } = toModuleColumns(states);

  // tenants.UPDATE es global_admin-only por RLS → admin client, gateado por el
  // rol recién verificado y SIEMPRE limitado al tenant del propio JWT.
  try {
    const admin = createAdminClient();

    /**
     * El UPDATE reemplaza el jsonb ENTERO, así que sin este merge cualquier
     * clave que no esté en MODULE_KEYS (una sección que agregue otro panel, o
     * una vieja que quedó dando vueltas) se borraría en cada guardado. Se lee lo
     * que hay y las canónicas pisan solo lo suyo — en las DOS columnas: mergear
     * `modules` y reemplazar `modules_soon` dejaría claves con on/off pero sin
     * su "muy pronto", que es un estado a medias que nadie eligió.
     *
     * Read-modify-write, sin transacción y a sabiendas. Dos admins guardando en
     * el mismo instante: gana el último, sin aviso. Se deja así porque este form
     * manda el estado COMPLETO de las 10 claves canónicas —"gana el último" es
     * la semántica normal de un Guardar de formulario, no una anomalía— y lo
     * único que el merge protege son las claves ajenas, que ningún admin edita
     * desde acá. Resolverlo de verdad pide `modules = modules || $patch` en SQL
     * (una RPC), y eso es una migración: si algún día hay varios operadores por
     * comunidad editando a la vez, ese es el camino, no un lock optimista sobre
     * el jsonb entero.
     */
    const { data: current } = await admin
      .from("tenants")
      .select("modules, modules_soon")
      .eq("id", tenantId)
      .maybeSingle();
    const asRecord = (value: unknown): Record<string, boolean> =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, boolean>)
        : {};
    const mergedModules = { ...asRecord(current?.modules), ...modules };
    const mergedModulesSoon = { ...asRecord(current?.modules_soon), ...modulesSoon };

    const { error } = await admin
      .from("tenants")
      .update({ modules: mergedModules, modules_soon: mergedModulesSoon })
      .eq("id", tenantId);

    if (error) {
      console.error("[admin] update de módulos falló:", error.message);
      return { status: "error", message: COPY.genericError };
    }
  } catch (thrown) {
    // Sin este log, un admin client mal configurado se ve igual que un error de
    // red y nadie sabe por dónde empezar a mirar.
    console.error(
      "[admin] update de módulos no se pudo ejecutar:",
      thrown instanceof Error ? thrown.message : "error desconocido",
    );
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "tenant.modules_updated",
    tenantId,
    subjectKind: "tenant",
    subjectId: tenantId,
    meta: { modules, modules_soon: modulesSoon },
  });

  revalidatePath("/admin/dominio");
  revalidatePath("/", "layout");
  // La fila del tenant está cacheada (unstable_cache tag "tenants" en
  // lib/tenant/resolve). Sin esta invalidación, un cambio de módulos tardaría
  // hasta 300s en verse en la app. Next 16: revalidateTag exige 2º arg (profile);
  // "max" = stale-while-revalidate (recomendado). Ref: docs/.../revalidateTag.md
  revalidateTag("tenants", "max");
  return { status: "success" };
}
