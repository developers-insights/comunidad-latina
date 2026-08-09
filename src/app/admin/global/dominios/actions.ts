"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { getStaffContext, logAdminAction } from "../../guard";
import { canWriteTenant } from "../../scope";
import { DOMAIN_STATUSES } from "./domain-status";

/**
 * Server actions de GESTIÓN DE DOMINIOS (solo `global_admin`).
 *
 * QUIÉN AUTORIZA. Las policies de `tenant_domains` (0002) dan INSERT/UPDATE
 * únicamente a `app.is_global_admin()`, así que todo acá va con el CLIENTE DEL
 * USUARIO y la base es la que dice que sí o que no. `getStaffContext` +
 * `canWriteTenant` son la barrera de arriba: sirven para devolver un mensaje
 * humano en vez de un error de Postgres, y para que la auditoría se escriba
 * sólo cuando el actor ya está verificado. Nunca hay admin client acá.
 *
 * QUIÉN NORMALIZA EL HOST. La base (trigger `app.normalize_tenant_domain`,
 * migración 0060), no este archivo. El zod de acá valida FORMA para poder
 * explicar el error; el valor que se guarda lo decide el trigger. Es a
 * propósito: el host se compara después contra el header `Host`, que lo elige
 * el cliente, y una normalización que viviera sólo en TypeScript se esquivaría
 * mandando otro casing.
 */

const COPY = {
  notAllowed: "Esta acción es solo para el súper admin de la plataforma.",
  invalid: "Revisá los datos — hay algo incompleto o con un formato raro.",
  domainTaken: "Ese dominio ya está cargado, acá o en otra comunidad.",
  badFormat:
    "Ese no parece un dominio válido. Escribilo sin “https://” y sin barras — por ejemplo, micomunidad.com.",
  primaryConflict:
    "Esa comunidad ya tiene un dominio principal. Cambialo desde el dominio que querés que sea el nuevo principal.",
  notFound: "Ese dominio ya no está en la lista — se actualizó mientras mirabas.",
  genericError: "No pudimos guardar el cambio — no es tu culpa. Probá de nuevo en un momento.",
  added: (domain: string) => `Listo, ${domain} quedó cargado.`,
  primary: (domain: string) => `${domain} es ahora el dominio principal.`,
  statusChanged: {
    active: (domain: string) => `${domain} volvió a estar en el aire.`,
    suspended: (domain: string) =>
      `${domain} quedó suspendido. Quien lo visite ya no va a llegar a la comunidad.`,
    archived: (domain: string) => `${domain} quedó archivado. Sigue en la lista, pero apagado.`,
  } as Record<string, (domain: string) => string>,
} as const;

export type DomainActionState =
  | { status: "idle" }
  | { status: "invalid" | "error"; message: string }
  | { status: "success"; message: string };

/**
 * Forma de hostname. Se acepta `localhost` (dev) y cualquier host con puntos.
 * Deliberadamente MÁS PERMISIVO que el check de la base en un punto (largo) y
 * más estricto en otro (exige TLD salvo host sin puntos): lo que pase de acá y
 * no pase allá vuelve como `badFormat`, que es un mensaje entendible.
 */
const HOSTNAME_RE =
  /^(localhost|(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})$/;

const addSchema = z.object({
  tenantId: z.uuid(),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    // Un pegado de "https://midominio.com/" es el error más común del mundo:
    // se limpia antes de validar en vez de rebotarlo.
    .transform((value) => value.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, ""))
    .refine((value) => HOSTNAME_RE.test(value), COPY.badFormat),
  isPrimary: z.enum(["on", "off"]).catch("off"),
  notes: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function addTenantDomain(
  _prev: DomainActionState,
  formData: FormData,
): Promise<DomainActionState> {
  const parsed = addSchema.safeParse({
    tenantId: formData.get("tenantId"),
    domain: formData.get("domain"),
    isPrimary: formData.get("isPrimary") ?? "off",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    return { status: "invalid", message: issue === COPY.badFormat ? COPY.badFormat : COPY.invalid };
  }
  const input = parsed.data;

  const ctx = await getStaffContext("global_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  if (!canWriteTenant(ctx, input.tenantId)) {
    return { status: "error", message: COPY.notAllowed };
  }
  const { supabase, user } = ctx;

  const wantsPrimary = input.isPrimary === "on";

  // Si nace como principal hay que bajar al anterior ANTES: el índice parcial
  // único `tenant_domains_primary_uniq` no admite dos principales a la vez.
  if (wantsPrimary) {
    const { error: demoteError } = await supabase
      .from("tenant_domains")
      .update({ is_primary: false })
      .eq("tenant_id", input.tenantId)
      .eq("is_primary", true);
    if (demoteError) {
      console.error("[admin] no se pudo liberar el dominio principal:", demoteError.message);
      return { status: "error", message: COPY.genericError };
    }
  }

  const { data: created, error } = await supabase
    .from("tenant_domains")
    .insert({
      tenant_id: input.tenantId,
      domain: input.domain,
      is_primary: wantsPrimary,
      status: "active",
      notes: input.notes ?? null,
    })
    .select("id, domain")
    .single();

  if (error || !created) {
    if (error?.code === "23505") {
      return {
        status: "invalid",
        message: error.message.includes("primary") ? COPY.primaryConflict : COPY.domainTaken,
      };
    }
    if (error?.code === "23514") return { status: "invalid", message: COPY.badFormat };
    console.error("[admin] alta de dominio falló:", error?.message);
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "tenant_domain.added",
    tenantId: input.tenantId,
    subjectKind: "tenant_domain",
    subjectId: created.id,
    meta: { domain: created.domain, is_primary: wantsPrimary },
  });

  revalidateDomainSurfaces();
  return { status: "success", message: COPY.added(created.domain) };
}

/* ----------------------------- Marcar principal --------------------------- */

const primarySchema = z.object({ domainId: z.uuid() });

export async function setPrimaryDomain(
  _prev: DomainActionState,
  formData: FormData,
): Promise<DomainActionState> {
  const parsed = primarySchema.safeParse({ domainId: formData.get("domainId") });
  if (!parsed.success) return { status: "invalid", message: COPY.invalid };

  const ctx = await getStaffContext("global_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user } = ctx;

  const { data: row } = await supabase
    .from("tenant_domains")
    .select("id, tenant_id, domain, status")
    .eq("id", parsed.data.domainId)
    .maybeSingle();

  if (!row) return { status: "error", message: COPY.notFound };
  if (!canWriteTenant(ctx, row.tenant_id)) {
    return { status: "error", message: COPY.notAllowed };
  }

  /**
   * Dos updates sin transacción, en este orden a propósito: primero se baja al
   * principal anterior, después se sube al nuevo. Si el segundo fallara, la
   * comunidad queda un rato SIN principal — que es un estado tolerable (el
   * lookup del host sigue resolviendo por dominio, sólo se pierde el canónico
   * para armar URLs). Al revés, el índice único rechazaría el update y no
   * pasaría nada, pero el orden inverso deja abierta la ventana de DOS
   * principales si algún día se relaja ese índice.
   */
  const { error: demoteError } = await supabase
    .from("tenant_domains")
    .update({ is_primary: false })
    .eq("tenant_id", row.tenant_id)
    .eq("is_primary", true);

  if (demoteError) {
    console.error("[admin] no se pudo liberar el principal anterior:", demoteError.message);
    return { status: "error", message: COPY.genericError };
  }

  const { error } = await supabase
    .from("tenant_domains")
    .update({ is_primary: true })
    .eq("id", row.id);

  if (error) {
    console.error("[admin] marcar principal falló:", error.message);
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "tenant_domain.primary_changed",
    tenantId: row.tenant_id,
    subjectKind: "tenant_domain",
    subjectId: row.id,
    meta: { domain: row.domain },
  });

  revalidateDomainSurfaces();
  return { status: "success", message: COPY.primary(row.domain) };
}

/* ------------------------- Activar / suspender / archivar ------------------ */

const statusSchema = z.object({
  domainId: z.uuid(),
  status: z.enum(DOMAIN_STATUSES),
  notes: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function setDomainStatus(
  _prev: DomainActionState,
  formData: FormData,
): Promise<DomainActionState> {
  const parsed = statusSchema.safeParse({
    domainId: formData.get("domainId"),
    status: formData.get("status"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { status: "invalid", message: COPY.invalid };
  const input = parsed.data;

  const ctx = await getStaffContext("global_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user } = ctx;

  const { data: row } = await supabase
    .from("tenant_domains")
    .select("id, tenant_id, domain, status, is_primary")
    .eq("id", input.domainId)
    .maybeSingle();

  if (!row) return { status: "error", message: COPY.notFound };
  if (!canWriteTenant(ctx, row.tenant_id)) {
    return { status: "error", message: COPY.notAllowed };
  }

  const { error } = await supabase
    .from("tenant_domains")
    .update({
      status: input.status,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    })
    .eq("id", row.id);

  if (error) {
    console.error("[admin] cambio de estado del dominio falló:", error.message);
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "tenant_domain.status_changed",
    tenantId: row.tenant_id,
    subjectKind: "tenant_domain",
    subjectId: row.id,
    // Sin la nota: es texto libre del admin y el audit_log no guarda prosa
    // (§5.4). El antes/después es lo que hace falta para reconstruir qué pasó.
    meta: { domain: row.domain, from: row.status, to: input.status },
  });

  revalidateDomainSurfaces();
  return {
    status: "success",
    message: (COPY.statusChanged[input.status] ?? COPY.statusChanged.active)(row.domain),
  };
}

/**
 * Un cambio de dominio toca dos superficies: el panel (que lo lista) y la
 * resolución Host→tenant del sitio público, que lee la fila del tenant desde
 * un cache etiquetado `tenants` (`lib/tenant/resolve.ts`).
 *
 * OJO CON LO QUE ESTO **NO** GARANTIZA: la resolución del host vive fuera de
 * este panel y puede tener su propio cache en memoria por instancia. Suspender
 * un dominio queda asentado en la base al instante —y `get_tenant_by_domain`
 * ya exige `status = 'active'` desde 0060—, pero el momento exacto en que el
 * sitio deja de responder depende de esa capa, no de acá. El copy de la
 * confirmación lo dice con esas palabras: no promete "inmediato".
 */
function revalidateDomainSurfaces(): void {
  revalidatePath("/admin/global/dominios");
  revalidatePath("/admin/global");
  // Next 16: revalidateTag exige perfil de cacheLife como 2º argumento.
  revalidateTag("tenants", "max");
}
