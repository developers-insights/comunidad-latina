"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildBrandScale } from "@/lib/tenant/brand-pipeline";
import type { Json } from "@/lib/types/database.types";
import { getStaffContext, logAdminAction } from "../guard";

/**
 * Server actions del panel Global (SOLO global_admin).
 *
 * DECISIÓN DE PRIVILEGIOS: tenants, tenant_domains, broadcasts y
 * broadcast_targets ya tienen policies de INSERT para global_admin → las
 * escrituras van con el CLIENTE DEL USUARIO (RLS aplica, superficie admin
 * mínima). El admin client queda solo para audit_log (append-only por diseño).
 * El brief pedía "admin client gateado" — RLS-con-JWT es estrictamente más
 * seguro y el gate por rol verificado se mantiene igual.
 */

const COPY = {
  notAllowed: "Esta acción es solo para el súper admin de la plataforma.",
  invalid: "Revisá los datos del formulario — hay algo incompleto o inválido.",
  slugTaken: "Ese slug ya existe. Probá con otro identificador.",
  domainTaken: "Ese dominio ya está asignado a otra comunidad.",
  genericError: "No pudimos completar la acción — no es tu culpa. Probá de nuevo en un momento.",
} as const;

export type GlobalActionState =
  | { status: "idle" }
  | { status: "invalid" | "error"; message: string }
  | { status: "success"; message: string };

/* -------------------------------- Crear tenant ---------------------------- */

const HOSTNAME_RE =
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const tenantSchema = z.object({
  name: z.string().trim().min(3).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  brandHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HOSTNAME_RE)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  citySeed: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function createTenant(
  _prev: GlobalActionState,
  formData: FormData,
): Promise<GlobalActionState> {
  const parsed = tenantSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    brandHex: formData.get("brandHex"),
    domain: formData.get("domain") ?? "",
    citySeed: formData.get("citySeed") ?? "",
  });
  if (!parsed.success) return { status: "invalid", message: COPY.invalid };
  const input = parsed.data;

  const ctx = await getStaffContext("global_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user } = ctx;

  // theme lo escribe el pipeline, no un humano (contrato de tenants.theme).
  const theme = buildBrandScale(input.brandHex);

  const { data: created, error } = await supabase
    .from("tenants")
    .insert({
      name: input.name,
      slug: input.slug,
      brand_hex: input.brandHex.toUpperCase(),
      city_seed: input.citySeed ?? null,
      theme: theme as unknown as Json,
      modules: {
        feed: true,
        propiedades: true,
        negocios: true,
        profesionales: true,
        eventos: true,
        mensajes: true,
        escudo: true,
      } as Json,
    })
    .select("id, slug")
    .single();

  if (error || !created) {
    if (error?.code === "23505") return { status: "invalid", message: COPY.slugTaken };
    console.error("[admin] crear tenant falló:", error?.message);
    return { status: "error", message: COPY.genericError };
  }

  if (input.domain) {
    const { error: domainError } = await supabase.from("tenant_domains").insert({
      tenant_id: created.id,
      domain: input.domain,
      is_primary: true,
    });
    if (domainError) {
      // El tenant ya existe; el dominio se puede reintentar después.
      console.error("[admin] dominio del tenant falló:", domainError.message);
      await logAdminAction({
        actorId: user.id,
        action: "tenant.created_without_domain",
        tenantId: created.id,
        subjectKind: "tenant",
        subjectId: created.id,
        meta: { slug: created.slug },
      });
      revalidatePath("/admin/global");
      return {
        status: "invalid",
        message:
          domainError.code === "23505"
            ? COPY.domainTaken
            : "La comunidad se creó, pero el dominio no se pudo guardar — cargalo de nuevo desde el panel.",
      };
    }
  }

  await logAdminAction({
    actorId: user.id,
    action: "tenant.created",
    tenantId: created.id,
    subjectKind: "tenant",
    subjectId: created.id,
    meta: { slug: created.slug, domain: input.domain ?? null },
  });

  revalidatePath("/admin/global");
  return {
    status: "success",
    message: `"${input.name}" ya está viva. Entrá con ?t=${created.slug} para verla.`,
  };
}

/* ----------------------------- Broadcast global --------------------------- */

const broadcastSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(10).max(2000),
    ctaUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    startsAt: z
      .string()
      .trim()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    endsAt: z
      .string()
      .trim()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    targetIds: z.array(z.uuid()).min(1).max(100),
  })
  .superRefine((value, ctx) => {
    const starts = value.startsAt ? new Date(value.startsAt) : null;
    const ends = value.endsAt ? new Date(value.endsAt) : null;
    if (starts && Number.isNaN(starts.getTime())) {
      ctx.addIssue({ code: "custom", path: ["startsAt"], message: "fecha inválida" });
    }
    if (ends && Number.isNaN(ends.getTime())) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "fecha inválida" });
    }
    if (starts && ends && !Number.isNaN(starts.getTime()) && ends <= starts) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "fin antes del inicio" });
    }
  });

export async function createBroadcast(
  _prev: GlobalActionState,
  formData: FormData,
): Promise<GlobalActionState> {
  const parsed = broadcastSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    ctaUrl: formData.get("ctaUrl") ?? "",
    startsAt: formData.get("startsAt") ?? "",
    endsAt: formData.get("endsAt") ?? "",
    targetIds: formData.getAll("targetIds").filter((v) => typeof v === "string"),
  });
  if (!parsed.success) return { status: "invalid", message: COPY.invalid };
  const input = parsed.data;

  const ctx = await getStaffContext("global_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user } = ctx;

  // La policy exige created_by = auth.uid() — firmamos como uno mismo.
  const { data: broadcast, error } = await supabase
    .from("broadcasts")
    .insert({
      created_by: user.id,
      title: input.title,
      body: input.body,
      cta_url: input.ctaUrl ?? null,
      ...(input.startsAt ? { starts_at: new Date(input.startsAt).toISOString() } : {}),
      ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
    })
    .select("id")
    .single();

  if (error || !broadcast) {
    console.error("[admin] crear broadcast falló:", error?.message);
    return { status: "error", message: COPY.genericError };
  }

  const { error: targetsError } = await supabase.from("broadcast_targets").insert(
    input.targetIds.map((tenantId) => ({
      broadcast_id: broadcast.id,
      tenant_id: tenantId,
    })),
  );

  if (targetsError) {
    // Sin targets el broadcast no llega a nadie (modelo pull) → rollback.
    console.error("[admin] targets del broadcast fallaron:", targetsError.message);
    await supabase.from("broadcasts").delete().eq("id", broadcast.id);
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "broadcast.created",
    subjectKind: "broadcast",
    subjectId: broadcast.id,
    meta: { targets: input.targetIds.length },
  });

  revalidatePath("/admin/global");
  return {
    status: "success",
    message:
      input.targetIds.length === 1
        ? "Broadcast enviado a 1 comunidad."
        : `Broadcast enviado a ${input.targetIds.length} comunidades.`,
  };
}
