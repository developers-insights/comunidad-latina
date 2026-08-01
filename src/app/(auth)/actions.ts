"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { limit, HOUR_MS, clientIpFromHeaders } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/resolve";
import {
  sendConfirmationEmail,
  resendConfirmationForCredentials,
} from "@/lib/auth/confirmation";
import type { ActionResult } from "@/components/auth/action-result";
import { safeNextPath } from "@/components/auth/next-param";
import { resolveOrigin } from "./recuperar/origin";

/** Versión del set legal (Términos/Privacidad/Normas) vigente al registrarse. */
const TERMS_VERSION = "v1-2026-07";

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
  ageRequired: "Para sumarte, confirmá que tenés 18 años o más.",
  termsRequired:
    "Para sumarte, aceptá los Términos, la Política de Privacidad y las Normas de la Comunidad.",
  resetLinkExpired: "El enlace venció o ya se usó. Pedí uno nuevo desde acá.",
} as const;

// ---------------------------------------------------------------------------
// Registro (§4 de ARQUITECTURA.md): el admin client SOLO acá — crea el usuario
// con app_metadata { tenant_id, role } y la fila de profiles. El signup público
// jamás puede elegir su propio role/tenant desde el cliente.
// ---------------------------------------------------------------------------

/** Las 5 necesidades del onboarding — compartidas por registro y onboarding. */
const needsSchema = z
  .array(z.enum(["vivienda", "trabajo", "gente", "estafas", "tramites"]))
  .min(1, COPY.needsMin)
  .max(5);

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
  // Consentimiento (plan cliente semana 3). Defensa en profundidad: el cliente
  // ya deshabilita el botón hasta tildar ambos, pero el server no confía en eso.
  // Minimización de datos: solo la atestación 18+, jamás la fecha de nacimiento.
  ageConfirmed: z.literal(true, { error: COPY.ageRequired }),
  termsAccepted: z.literal(true, { error: COPY.termsRequired }),
  // Onboarding ya respondido (el wizard pregunta ANTES de crear la cuenta, para
  // que no quede nada a medias esperando la confirmación del correo). Opcional:
  // el registro suelto de /registro no los trae y completa después.
  needs: needsSchema.optional(),
  area: z.string().trim().min(2, COPY.areaShort).max(80).optional(),
  /** Ruta interna a la que aterriza al confirmar (se sanitiza server-side). */
  next: z.string().optional(),
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
  const { displayName, email, password, needs, area } = parsed.data;
  // Open redirect: el `next` viaja en el correo, así que se sanitiza acá y no
  // en el cliente (misma función que el resto de los flujos de auth).
  const next = safeNextPath(parsed.data.next, "/bienvenida");

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

  // `email_confirm: false` — la cuenta nace SIN confirmar y no hay sesión hasta
  // que la persona toca el enlace del correo (el proyecto rechaza el login con
  // `email_not_confirmed`, así que esto no es una convención nuestra: es la
  // regla del backend). El correo lo manda Resend, no el mailer de Supabase:
  // ver src/lib/auth/confirmation.ts.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
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

  // El onboarding (necesidades + zona) ahora se completa ANTES de crear la
  // cuenta, así que se persiste acá mismo con el admin client: sin sesión hasta
  // confirmar el correo, el usuario no puede escribir su propio perfil vía RLS.
  // El país de origen se hereda del país foco de la comunidad (nunca se pregunta).
  let countryOrigin: string | null = null;
  if (area) {
    const { data: tenantRow } = await admin
      .from("tenants")
      .select("country_focus")
      .eq("id", tenant.id)
      .maybeSingle();
    countryOrigin = tenantRow?.country_focus ?? null;
  }

  // Sello de consentimiento del registro: misma marca temporal para edad y
  // términos (se atestan juntos). No guardamos fecha de nacimiento, solo esto.
  const consentedAt = new Date().toISOString();
  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenant.id,
    display_name: displayName,
    role: "member",
    age_confirmed_at: consentedAt,
    terms_accepted_at: consentedAt,
    terms_version: TERMS_VERSION,
    ...(area ? { area_label: area } : {}),
    ...(countryOrigin ? { country_origin: countryOrigin } : {}),
  });

  if (profileError) {
    // Sin fila de perfil el usuario queda huérfano — limpiamos y avisamos.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    console.error("[auth] registro: insert de profile falló", {
      code: profileError.code,
    });
    return { ok: false, formError: COPY.genericError };
  }

  if (needs && needs.length > 0) {
    // Dato sensible (§11): vive en profiles_private, que solo lee su dueño.
    // Si falla, la cuenta igual sirve — se pierde la personalización, no el alta.
    const { error: privateError } = await admin.from("profiles_private").upsert(
      { profile_id: created.user.id, tenant_id: tenant.id, needs },
      { onConflict: "profile_id" },
    );
    if (privateError) {
      console.error("[auth] registro: upsert de profiles_private falló", {
        code: privateError.code,
      });
    }
  }

  // Correo de confirmación. Ya no hay login inmediato: la sesión la crea
  // /confirmar cuando la persona toca el enlace.
  //
  // Si el envío falla, la respuesta sigue siendo `ok: true` a propósito: la
  // cuenta YA existe, y devolver un error mandaría a la persona a registrarse
  // de nuevo contra un "ese email ya está en uso". La salida está en /entrar,
  // que reenvía el enlace al detectar una cuenta sin confirmar. La falla queda
  // en el log y en Sentry (ver sendConfirmationEmail).
  await sendConfirmationEmail({
    email,
    password,
    displayName,
    tenantName: tenant.name,
    brandHex: tenant.brandHex,
    origin: resolveOrigin(headerStore),
    next,
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reenvío del enlace de confirmación (lo dispara /entrar cuando Supabase
// responde `email_not_confirmed`). Devuelve SIEMPRE ok: quien lo llama ya sabe
// que la cuenta existe sin confirmar; el detalle de si el correo salió no
// agrega nada útil y sí filtraría información.
// ---------------------------------------------------------------------------

const resendConfirmationSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email(COPY.emailInvalid)),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type ResendConfirmationInput = z.infer<typeof resendConfirmationSchema>;

export async function resendConfirmationAction(
  input: ResendConfirmationInput,
): Promise<ActionResult> {
  const parsed = resendConfirmationSchema.safeParse(input);
  if (!parsed.success) return { ok: true };

  // Mismo límite que registro y recuperación: 5/hora por IP, en memoria.
  const headerStore = await headers();
  const ip = clientIpFromHeaders(headerStore);
  if (!limit(`confirmar:${ip}`, 5, HOUR_MS).ok) {
    return { ok: false, formError: COPY.tooManyAttempts };
  }

  const tenant = await getTenant();
  await resendConfirmationForCredentials({
    email: parsed.data.email,
    password: parsed.data.password,
    tenantName: tenant.name,
    brandHex: tenant.brandHex,
    origin: resolveOrigin(headerStore),
    next: safeNextPath(parsed.data.next, "/bienvenida"),
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Onboarding: la zona va a profiles; needs a profiles_private (solo-dueño).
// El país de origen ya no se pregunta — se hereda del país de la comunidad
// (tenants.country_focus). Corre con el cliente server (cookies del usuario) → RLS aplica.
//
// Este camino es el de quien YA tiene sesión y vuelve a /bienvenida a completar
// su perfil. Quien se registra desde el wizard responde antes de crear la cuenta
// y lo persiste `registerAction` (no hay sesión hasta confirmar el correo).
// ---------------------------------------------------------------------------

const onboardingSchema = z.object({
  needs: needsSchema,
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

// ---------------------------------------------------------------------------
// Recuperación de contraseña (Supabase Auth, SMTP propio de Supabase — no
// depende de Resend). Dos pasos:
//   1) requestPasswordResetAction: manda el correo con el enlace de reset.
//   2) updatePasswordAction: con la sesión de recuperación ya activa (tras el
//      /callback), fija la contraseña nueva.
// ---------------------------------------------------------------------------

const resetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email(COPY.emailInvalid)),
});

export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

export async function requestPasswordResetAction(
  input: ResetRequestInput,
): Promise<ActionResult> {
  const parsed = resetRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstIssuePerField(parsed.error.issues) };
  }
  const { email } = parsed.data;

  // Rate limit por IP (misma política que el registro). La IP vive SOLO como key
  // en memoria del limiter y expira con la ventana — nunca se persiste (§11).
  const headerStore = await headers();
  const ip = clientIpFromHeaders(headerStore);
  if (!limit(`recuperar:${ip}`, 5, HOUR_MS).ok) {
    return { ok: false, formError: COPY.tooManyAttempts };
  }

  const origin = resolveOrigin(headerStore);
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // El callback canjea el code por sesión y manda a fijar la contraseña nueva.
    redirectTo: `${origin}/callback?next=/recuperar/actualizar`,
  });

  if (error) {
    // Anti-enumeración: pase lo que pase (email inexistente, límite de Supabase,
    // etc.) devolvemos el MISMO éxito genérico. El detalle queda solo en el log.
    console.error("[auth] recuperar: resetPasswordForEmail falló", {
      code: error.code,
    });
  }

  return { ok: true };
}

const updatePasswordSchema = z.object({
  password: z.string().min(8, COPY.passwordShort).max(72, COPY.passwordLong),
});

export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

export async function updatePasswordAction(
  input: UpdatePasswordInput,
): Promise<ActionResult> {
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstIssuePerField(parsed.error.issues) };
  }
  const { password } = parsed.data;

  // Necesitamos la sesión de recuperación (la dejó el /callback). getUser()
  // valida el JWT contra el Auth server — si venció o ya se usó, no hay user.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, formError: COPY.resetLinkExpired };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[auth] recuperar: updateUser falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  return { ok: true };
}
