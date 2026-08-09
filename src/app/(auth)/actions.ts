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
import { safeInternalPath } from "@/lib/url/safe-href";
import {
  isUsernameTakenError,
  normalizeUsername,
  usernameProblem,
} from "@/lib/profile/username";
import { resolveOrigin } from "./recuperar/origin";

/** Versión del set legal (Términos/Privacidad/Normas) vigente al registrarse. */
const TERMS_VERSION = "v1-2026-07";

const COPY = {
  emailInvalid: "Ese email no parece completo — revisalo y probá de nuevo.",
  nameShort: "Contanos cómo te llamás (al menos 2 letras).",
  nameLong: "El nombre es muy largo — probá con una versión más corta.",
  lastNameShort: "Escribí tu apellido (al menos 2 letras).",
  lastNameLong: "El apellido es muy largo — probá con una versión más corta.",
  // Errores del nombre de usuario, uno por problema concreto. "Nombre de
  // usuario inválido" obliga a adivinar cuál de las cinco reglas se rompió.
  usernameEmpty: "Elegí tu nombre de usuario.",
  usernameShort: "Necesita al menos 3 caracteres.",
  usernameLong: "El máximo son 30 caracteres.",
  usernameFormat: "Solo letras sin acento, números, punto y guion bajo.",
  usernameEdges: "No puede empezar ni terminar con punto o guion bajo.",
  usernameTaken: "Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro.",
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

/**
 * El nombre de usuario, validado con las MISMAS reglas que la base (0062).
 *
 * La unicidad no se puede validar acá: es por tenant y sólo la resuelve el
 * índice `profiles_username_tenant_uniq`. El insert la descubre y devuelve
 * `23505`, que es el único momento en que la respuesta es verdad.
 */
const usernameSchema = z.string().superRefine((value, ctx) => {
  const problem = usernameProblem(value);
  if (!problem) return;
  const message = {
    vacio: COPY.usernameEmpty,
    corto: COPY.usernameShort,
    largo: COPY.usernameLong,
    formato: COPY.usernameFormat,
    bordes: COPY.usernameEdges,
  }[problem];
  ctx.addIssue({ code: "custom", message });
});

/**
 * ── QUÉ SE PIDE EN EL ALTA Y QUÉ NO (decisión, 2026-08-08) ───────────────────
 *
 * El pliego pide siete campos nuevos. El onboarding de hoy se completa en menos
 * de 60 segundos y ESO es un activo del producto: un formulario de doce campos
 * antes de ver nada convierte peor que cualquier campo que se pueda pedir
 * después. Así que el alta crece exactamente DOS campos, y sólo estos dos:
 *
 *   · APELLIDO — se escribe en el mismo gesto que el nombre, al lado, sin
 *     pensar nada nuevo. Y es privado por default (vive en `profiles_private`
 *     con `show_last_name: 'privado'`), así que pedirlo no expone a nadie.
 *   · NOMBRE DE USUARIO — es identidad pública y permanente. Es el ÚNICO campo
 *     que no se puede diferir: si no se elige en el alta, o se genera solo (y
 *     queda para siempre un handle que nadie eligió) o el perfil vive sin
 *     handle. Lo mismo hacen Instagram y Twitter, y por lo mismo.
 *
 * Lo que se completa DESPUÉS, desde el perfil:
 *   · FECHA DE NACIMIENTO — hoy el alta pide la atestación "18 años o más", que
 *     es el mínimo dato que resuelve el requisito legal. Pedir la fecha exacta
 *     en el alta sería recolectar el dato más sensible del perfil (§11 lo tenía
 *     escrito: «solo la atestación 18+, jamás la fecha de nacimiento») en el
 *     momento de menor confianza. Se pide cuando de verdad hace falta: al
 *     activarse como creador, que es donde el gate de edad de 0064 la usa.
 *   · PAÍS DE RESIDENCIA, CIUDAD, IDIOMAS — son datos de descubrimiento, no de
 *     identidad: sirven para que te encuentren, y nadie te encuentra el primer
 *     día. Piden pensar (tres desplegables) y no habilitan nada en el alta.
 *   · PAÍS DE ORIGEN — ya se hereda del país foco de la comunidad y es editable
 *     desde el perfil. Preguntarlo agregaría un paso al wizard para confirmar,
 *     nueve de cada diez veces, lo que la app ya sabía.
 *   · FOTO DE PORTADA — una subida de archivo en el alta es la fricción más
 *     cara que existe en un teléfono con datos móviles.
 *
 * El perfil muestra qué falta y lo pide ahí, con la cuenta ya creada y la
 * persona ya adentro (ver `<ProfileCompletion>`).
 */
const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, COPY.nameShort)
    .max(60, COPY.nameLong),
  lastName: z
    .string()
    .trim()
    .min(2, COPY.lastNameShort)
    .max(60, COPY.lastNameLong),
  username: usernameSchema,
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
  const { displayName, lastName, email, password, needs, area } = parsed.data;
  // Se normaliza acá con la MISMA función que espeja al trigger de la base, para
  // que lo que se compara contra el índice único sea lo mismo que se guarda.
  const username = normalizeUsername(parsed.data.username);
  // Open redirect: el `next` viaja en el correo, así que se sanitiza acá y no
  // en el cliente (misma función que el resto de los flujos de auth).
  const next = safeInternalPath(parsed.data.next, "/bienvenida");

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
    username,
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

    /**
     * EL HANDLE YA TOMADO NO ES UN ERROR DEL SISTEMA. La unicidad es POR TENANT
     * (`profiles_username_tenant_uniq`, 0062): el mismo handle puede existir en
     * otra comunidad sin problema, y acá lo único que pasó es que alguien de
     * ESTA llegó primero. Se devuelve como error DEL CAMPO para que el
     * formulario lo marque donde está el problema — un "algo salió mal" genérico
     * mandaría a la persona a reintentar el mismo handle para siempre.
     */
    if (isUsernameTakenError(profileError)) {
      return { ok: false, fieldErrors: { username: COPY.usernameTaken } };
    }

    console.error("[auth] registro: insert de profile falló", {
      code: profileError.code,
    });
    return { ok: false, formError: COPY.genericError };
  }

  /**
   * Datos sensibles (§11): viven en `profiles_private`, que sólo lee su dueño.
   * El apellido va acá y NO en `profiles` porque `profiles` es pública por
   * diseño y RLS filtra filas, no columnas: en `profiles` el apellido sería
   * legible por cualquier autenticado sin importar lo que la persona elija en
   * sus controles de privacidad (ver la nota de 0062).
   *
   * Sigue siendo best-effort a propósito: si esta escritura falla, la cuenta ya
   * existe y sirve. Tirar abajo un alta completa —usuario, perfil, consentimiento
   * y correo— porque no se pudo guardar el apellido sería cambiar una pérdida
   * chica y reparable desde «Editar perfil» por una pérdida total.
   */
  const { error: privateError } = await admin.from("profiles_private").upsert(
    {
      profile_id: created.user.id,
      tenant_id: tenant.id,
      last_name: lastName,
      ...(needs && needs.length > 0 ? { needs } : {}),
    },
    { onConflict: "profile_id" },
  );
  if (privateError) {
    console.error("[auth] registro: upsert de profiles_private falló", {
      code: privateError.code,
    });
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
    next: safeInternalPath(parsed.data.next, "/bienvenida"),
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
