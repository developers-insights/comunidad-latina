"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { limit, HOUR_MS, clientIpFromHeaders } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/resolve";
import { sendEmailInBackground } from "@/lib/email";
import { welcomeEmail } from "@/lib/email/templates";
import type { ActionResult } from "@/components/auth/action-result";

const COPY = {
  emailInvalid: "Ese email no parece completo — revisalo y probá de nuevo.",
  nameShort: "Contanos cómo te llamás (al menos 2 letras).",
  nameLong: "El nombre es muy largo — probá con una versión más corta.",
  passwordShort: "La contraseña necesita al menos 8 caracteres.",
  passwordLong: "La contraseña es demasiado larga.",
  emailTaken: "Ya existe una cuenta con este email. Probá entrar directamente.",
  genericError:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  needsMin: "Elegí al menos una opción.",
  areaShort: "Contanos tu zona o barrio (solo la zona, nunca tu dirección).",
  noSession: "Tu sesión se cerró — entrá de nuevo para continuar.",
  tooManyAttempts:
    "Hiciste varios intentos seguidos. Esperá un rato y probá de nuevo — tu cuenta va a estar acá.",
} as const;

// ---------------------------------------------------------------------------
// Registro (§4 de ARQUITECTURA.md): el admin client SOLO acá — crea el usuario
// con app_metadata { tenant_id, role } y la fila de profiles. El signup público
// jamás puede elegir su propio role/tenant desde el cliente.
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, COPY.nameShort)
    .max(60, COPY.nameLong),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email(COPY.emailInvalid)),
  password: z.string().min(8, COPY.passwordShort).max(72, COPY.passwordLong),
});

export type RegisterInput = z.infer<typeof registerSchema>;

function firstIssuePerField(issues: z.core.$ZodIssue[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function registerAction(input: RegisterInput): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstIssuePerField(parsed.error.issues) };
  }
  const { displayName, email, password } = parsed.data;

  // Rate limit: 5 registros/hora por IP. La IP se usa SOLO como key en memoria
  // del limiter (expira con la ventana) — jamás se persiste ni se loguea (§11).
  //
  // ⚠️ LIMITACIÓN CONOCIDA (aceptada para lanzar en Vercel): la fuente de IP
  // (x-real-ip / primer hop de x-forwarded-for, ver clientIpFromHeaders) asume
  // que la plataforma normaliza esos headers — cierto en Vercel, NO garantizado
  // self-hosted o detrás de otro proxy (ahí el primer hop es spoofeable y hay
  // que revisar la cadena). Además el limiter es in-memory por instancia
  // (límite efectivo = max × instancias) — plan de migración a Upstash ya
  // documentado en lib/rate-limit.
  const headerStore = await headers();
  const ip = clientIpFromHeaders(headerStore);
  if (!limit(`registro:${ip}`, 5, HOUR_MS).ok) {
    return { ok: false, formError: COPY.tooManyAttempts };
  }

  const tenant = await getTenant();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Admin client sin configurar (env incompleto) — degradación elegante.
    return { ok: false, formError: COPY.genericError };
  }

  // email_confirm: true — en dev no hay verificación por email (Resend degradado);
  // cuando el módulo de emails esté activo, esto pasa a un flujo de confirmación real.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
    app_metadata: { tenant_id: tenant.id, role: "member" },
  });

  if (createError || !created?.user) {
    const message = createError?.message ?? "";
    if (/already|registered|exists/i.test(message)) {
      return { ok: false, fieldErrors: { email: COPY.emailTaken } };
    }
    console.error("[auth] registro: createUser falló", { code: createError?.code });
    return { ok: false, formError: COPY.genericError };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenant.id,
    display_name: displayName,
    role: "member",
  });

  if (profileError) {
    // Sin fila de perfil el usuario queda huérfano — limpiamos y avisamos.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    console.error("[auth] registro: insert de profile falló", {
      code: profileError.code,
    });
    return { ok: false, formError: COPY.genericError };
  }

  // Login inmediato desde el server (cookies @supabase/ssr).
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    console.error("[auth] registro: signIn post-registro falló", {
      code: signInError.code,
    });
    return { ok: false, formError: COPY.genericError };
  }

  // Email de bienvenida (módulo EMAILS): fire-and-forget — si Resend no está
  // configurado se saltea con log; jamás afecta el registro.
  const welcome = welcomeEmail({
    displayName,
    tenantName: tenant.name,
    brandHex: tenant.brandHex,
  });
  sendEmailInBackground({ to: email, subject: welcome.subject, html: welcome.html });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Onboarding: la zona va a profiles; needs a profiles_private (solo-dueño).
// El país de origen ya no se pregunta — se hereda del país de la comunidad
// (tenants.country_focus). Corre con el cliente server (cookies del usuario) → RLS aplica.
// ---------------------------------------------------------------------------

const onboardingSchema = z.object({
  needs: z
    .array(z.enum(["vivienda", "trabajo", "gente", "estafas", "tramites"]))
    .min(1, COPY.needsMin)
    .max(5),
  area: z.string().trim().min(2, COPY.areaShort).max(80),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export async function completeOnboardingAction(
  input: OnboardingInput,
): Promise<ActionResult> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstIssuePerField(parsed.error.issues) };
  }
  const { needs, area } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, formError: COPY.noSession };
  }

  // country_origin ya no se pregunta: se hereda del país de la comunidad
  // (tenants.country_focus). Resolvemos el tenant del perfil y su país foco.
  const { data: prof } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  let countryOrigin: string | null = null;
  if (prof?.tenant_id) {
    const { data: t } = await supabase
      .from("tenants")
      .select("country_focus")
      .eq("id", prof.tenant_id)
      .maybeSingle();
    countryOrigin = t?.country_focus ?? null;
  }

  // Solo tocamos country_origin cuando lo pudimos derivar — nunca lo pisamos con null.
  const profileUpdate: { area_label: string; country_origin?: string } = {
    area_label: area,
  };
  if (countryOrigin) profileUpdate.country_origin = countryOrigin;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .update(profileUpdate)
    .eq("id", user.id)
    .select("tenant_id")
    .single();

  if (profileError || !profile) {
    console.error("[auth] onboarding: update de profile falló", {
      code: profileError?.code,
    });
    return { ok: false, formError: COPY.genericError };
  }

  const { error: privateError } = await supabase.from("profiles_private").upsert(
    {
      profile_id: user.id,
      tenant_id: profile.tenant_id,
      needs,
    },
    { onConflict: "profile_id" },
  );

  if (privateError) {
    console.error("[auth] onboarding: upsert de profiles_private falló", {
      code: privateError.code,
    });
    return { ok: false, formError: COPY.genericError };
  }

  return { ok: true };
}
