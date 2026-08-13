"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { COUNTRY_CODES } from "@/components/auth/countries";
import type { ActionResult } from "@/components/auth/action-result";
import {
  isUsernameTakenError,
  normalizeUsername,
  usernameProblem,
} from "@/lib/profile/username";
import { isWithinOwnStoragePrefix } from "@/lib/profile/storage-path";
import {
  LANGUAGE_CODES,
  LANGUAGES_MAX,
  RESIDENCE_COUNTRY_CODES,
} from "@/lib/profile/catalogs";
import { PRIVACY_LEVELS, normalizePrivacy } from "@/lib/profile/privacy";
import { MIN_AGE, ageFromBirthdate } from "@/lib/profile/age";
import { isKnownTimeZone } from "@/lib/time/timezone";

const COPY = {
  nameShort: "Contanos cómo te llamás (al menos 2 letras).",
  nameLong: "El nombre es muy largo — probá con una versión más corta.",
  lastNameLong: "El apellido es muy largo — probá con una versión más corta.",
  bioLong: "La bio es muy larga — el máximo son 500 caracteres.",
  areaLong: "La zona es muy larga — con el barrio alcanza.",
  countryInvalid: "Ese país no está en la lista — elegí uno de las opciones.",
  usernameEmpty: "Elegí tu nombre de usuario.",
  usernameShort: "Necesita al menos 3 caracteres.",
  usernameLong: "El máximo son 30 caracteres.",
  usernameFormat: "Solo letras sin acento, números, punto y guion bajo.",
  usernameEdges: "No puede empezar ni terminar con punto o guion bajo.",
  usernameTaken: "Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro.",
  cityLong: "El nombre de la ciudad es muy largo.",
  birthdateInvalid: "Revisá tu fecha de nacimiento.",
  birthdateFuture: "Esa fecha todavía no llegó.",
  birthdateTooYoung: "Para tener cuenta hay que tener 18 años o más.",
  languagesTooMany: `Elegí hasta ${LANGUAGES_MAX} idiomas.`,
  languageInvalid: "Ese idioma no está en la lista.",
  timeZoneInvalid: "Elegí una zona de la lista.",
  coverInvalid: "Esa imagen no se pudo usar. Probá con otra foto.",
  avatarInvalid: "Esa foto no se pudo usar. Probá con otra.",
  privacySaved: "Listo, tus controles de privacidad quedaron guardados.",
  noSession: "Tu sesión se cerró — entrá de nuevo para continuar.",
  genericError:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  reportDetailsLong: "El detalle es muy largo — el máximo son 500 caracteres.",
  tooManyReports:
    "Hiciste varios reportes hoy y ya los estamos mirando. Volvé mañana si necesitás sumar otro — así el equipo llega a revisarlos bien.",
  businessAccountBlocked:
    "Tenés un negocio activo en la plataforma — antes de eliminar tu cuenta hay que dar de baja esa suscripción. Escribinos a hola@comunidadlatina.com y te ayudamos a resolverlo.",
} as const;

function firstIssuePerField(issues: z.core.$ZodIssue[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

// ---------------------------------------------------------------------------
// Editar perfil propio (RLS: solo el dueño puede tocar su fila).
// ---------------------------------------------------------------------------

/**
 * ⚠️ `ageFromBirthdate` y `MIN_AGE` viven en `@/lib/profile/age` y NO acá.
 * Este módulo es `"use server"`: todo lo que exporte tiene que ser una función
 * async, y un helper puro exportado desde acá rompe la build entera con
 * "Server Actions must be async functions" — un error que `tsc` no ve.
 * Lo cuida `src/app/admin/use-server-exports.test.ts`.
 */
const birthdateSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), COPY.birthdateInvalid)
  .superRefine((value, ctx) => {
    if (value === "") return;
    const age = ageFromBirthdate(value);
    if (age === null) {
      ctx.addIssue({ code: "custom", message: COPY.birthdateInvalid });
      return;
    }
    if (age < 0) {
      ctx.addIssue({ code: "custom", message: COPY.birthdateFuture });
      return;
    }
    /**
     * El CHECK de la base (`profiles_private_birthdate_sane`) sólo ataja el
     * dedazo grosero: no puede evaluar `current_date` porque un CHECK tiene que
     * ser inmutable. La edad mínima se valida ACÁ, y con la misma regla que el
     * checkbox del alta — una cuenta que atestiguó tener 18 y después carga una
     * fecha que dice 15 no puede quedar en ese estado inconsistente.
     */
    if (age < MIN_AGE) ctx.addIssue({ code: "custom", message: COPY.birthdateTooYoung });
    if (age > 120) ctx.addIssue({ code: "custom", message: COPY.birthdateInvalid });
  });

/**
 * Editar el perfil propio.
 *
 * ── DOS TABLAS, UNA PANTALLA ─────────────────────────────────────────────────
 * Lo público (`profiles`: nombre, handle, bio, zona, país de origen, portada) y
 * lo privado (`profiles_private`: apellido, fecha de nacimiento, país de
 * residencia, ciudad, idiomas). El reparto no es de comodidad: `profiles` es
 * pública por diseño y RLS filtra FILAS, no columnas — cualquier cosa que se
 * ponga ahí queda legible por cualquier autenticado, elija lo que elija la
 * persona en sus controles de privacidad (ver la nota larga de 0062).
 *
 * Las dos escrituras corren con el cliente de SERVIDOR (cookies del usuario), o
 * sea con RLS puesta: nadie puede editar el perfil de otro aunque mande otro id,
 * porque no hay id que mandar — se toma de la sesión.
 */
const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2, COPY.nameShort).max(60, COPY.nameLong),
  lastName: z.string().trim().max(60, COPY.lastNameLong).optional(),
  username: z.string().superRefine((value, ctx) => {
    const problem = usernameProblem(value);
    if (!problem) return;
    ctx.addIssue({
      code: "custom",
      message: {
        vacio: COPY.usernameEmpty,
        corto: COPY.usernameShort,
        largo: COPY.usernameLong,
        formato: COPY.usernameFormat,
        bordes: COPY.usernameEdges,
      }[problem],
    });
  }),
  bio: z.string().trim().max(500, COPY.bioLong),
  area: z.string().trim().max(80, COPY.areaLong),
  // País de origen (pedido cliente: editar de dónde es la persona). Opcional
  // — el perfil ya lo mostraba (ProfileInfoPanel) pero no se podía tocar
  // desde acá. Vacío = "prefiere no decirlo"; si no está vacío, tiene que ser
  // uno de los códigos reales de countries.ts (nunca lo que mande el cliente).
  country: z
    .string()
    .trim()
    .refine((value) => value === "" || COUNTRY_CODES.includes(value), COPY.countryInvalid)
    .optional(),
  countryResidence: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || RESIDENCE_COUNTRY_CODES.includes(value),
      COPY.countryInvalid,
    )
    .optional(),
  city: z.string().trim().max(80, COPY.cityLong).optional(),
  birthdate: birthdateSchema.optional(),
  languages: z
    .array(z.string())
    .max(LANGUAGES_MAX, COPY.languagesTooMany)
    .refine((list) => list.every((code) => LANGUAGE_CODES.includes(code)), COPY.languageInvalid)
    .optional(),
  /**
   * Ruta de la portada DENTRO del bucket `avatars` — la sube el navegador
   * directo (mismo patrón que el CV y el video del composer). Acá sólo se
   * guarda la referencia, y se valida que el prefijo sea el de esta persona:
   * la policy `avatars_insert` (0012) ya impide escribir en la carpeta de otro,
   * pero nada impediría GUARDAR en el perfil propio la ruta de la foto ajena.
   */
  coverPath: z.string().trim().max(300).optional(),
  /**
   * Ruta de la FOTO DE PERFIL, mismo bucket y misma validación que
   * `coverPath` de arriba (`isWithinOwnStoragePrefix`, en `@/lib/profile/
   * storage-path`) — es la misma regla de seguridad aplicada dos veces, no
   * dos reglas distintas. `avatar_url` deja de ser de sólo lectura (antes se
   * fijaba una única vez al entrar por Google/Apple, `provision.ts`) recién
   * acá: mientras no se mande este campo, el valor existente no se toca.
   */
  avatarPath: z.string().trim().max(300).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstIssuePerField(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, formError: COPY.noSession };

  const {
    displayName,
    lastName,
    bio,
    area,
    country,
    countryResidence,
    city,
    birthdate,
    languages,
    coverPath,
    avatarPath,
  } = parsed.data;
  const username = normalizeUsername(parsed.data.username);

  // Hace falta el tenant para la fila de `profiles_private` y para validar el
  // prefijo de la portada. Sale del propio perfil, no de nada que mande el cliente.
  const { data: current, error: currentError } = await supabase
    .from("profiles")
    .select("tenant_id, cover_url")
    .eq("id", user.id)
    .maybeSingle();

  if (currentError || !current) {
    console.error("[perfil] no se pudo leer el perfil propio", { code: currentError?.code });
    return { ok: false, formError: COPY.genericError };
  }

  let coverUrl: string | null | undefined;
  if (coverPath !== undefined) {
    if (coverPath === "") {
      coverUrl = null; // Quitar la portada.
    } else {
      // La ruta canónica del bucket es `{tenant_id}/{user_id}/…` (0012). Una
      // ruta que no arranque así es la carpeta de otra persona.
      if (!isWithinOwnStoragePrefix(coverPath, current.tenant_id, user.id)) {
        return { ok: false, fieldErrors: { coverPath: COPY.coverInvalid } };
      }
      coverUrl = supabase.storage.from("avatars").getPublicUrl(coverPath).data.publicUrl;
    }
  }

  // Misma validación que la portada — ver el comentario de `avatarPath` en el
  // schema. `avatar_url` deja de fijarse sólo en el alta (`provision.ts`) y
  // pasa a poder actualizarse acá, con la misma regla de "nunca la carpeta
  // de otra persona" que ya protege la portada.
  let avatarUrl: string | null | undefined;
  if (avatarPath !== undefined) {
    if (avatarPath === "") {
      avatarUrl = null; // Quitar la foto de perfil, volver al avatar por defecto.
    } else {
      if (!isWithinOwnStoragePrefix(avatarPath, current.tenant_id, user.id)) {
        return { ok: false, fieldErrors: { avatarPath: COPY.avatarInvalid } };
      }
      avatarUrl = supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl;
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      username,
      bio: bio || null,
      area_label: area || null,
      country_origin: country || null,
      ...(coverUrl !== undefined ? { cover_url: coverUrl } : {}),
      ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
    })
    .eq("id", user.id);

  if (error) {
    if (isUsernameTakenError(error)) {
      return { ok: false, fieldErrors: { username: COPY.usernameTaken } };
    }
    console.error("[perfil] update falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  /**
   * Lo privado va en su propia tabla y su propio upsert. Se escribe SIEMPRE que
   * el formulario haya mandado alguno de estos campos, aunque vengan vacíos:
   * vaciar la ciudad tiene que borrarla, no dejarla como estaba. Por eso el
   * `?? null` y no un `if (city)`.
   */
  const touchesPrivate =
    lastName !== undefined ||
    countryResidence !== undefined ||
    city !== undefined ||
    birthdate !== undefined ||
    languages !== undefined;

  if (touchesPrivate) {
    const { error: privateError } = await supabase.from("profiles_private").upsert(
      {
        profile_id: user.id,
        tenant_id: current.tenant_id,
        ...(lastName !== undefined ? { last_name: lastName || null } : {}),
        ...(countryResidence !== undefined
          ? { country_residence: countryResidence || null }
          : {}),
        ...(city !== undefined ? { city: city || null } : {}),
        ...(birthdate !== undefined ? { birthdate: birthdate || null } : {}),
        ...(languages !== undefined ? { languages } : {}),
      },
      { onConflict: "profile_id" },
    );

    if (privateError) {
      console.error("[perfil] update de profiles_private falló", {
        code: privateError.code,
      });
      return { ok: false, formError: COPY.genericError };
    }
  }

  revalidatePath("/perfil");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Portada: el navegador la sube DIRECTO al bucket, igual que el CV (0047) y el
// video del composer. Esta action sólo entrega el prefijo que la policy va a
// exigir — el archivo nunca pasa por la server action, que serializaría 3 MB en
// memoria del server y no daría progreso a quien sube desde datos móviles.
// ---------------------------------------------------------------------------

export type PrepareCoverUploadResult =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; code: "unauthenticated" | "error" };

export async function prepareCoverUploadAction(): Promise<PrepareCoverUploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return { ok: false, code: "error" };

  // El prefijo lo entrega el SERVIDOR y la policy `avatars_insert` (0012) lo
  // vuelve a validar contra el JWT: el navegador no puede escribir en la carpeta
  // de otra persona aunque arme el path a mano.
  return { ok: true, tenantId: data.tenant_id, userId: user.id };
}

// ---------------------------------------------------------------------------
// Foto de perfil (avatar): MISMO patrón que la portada de arriba — mismo
// bucket (`avatars`), misma policy `avatars_insert` (0012), mismo motivo para
// no recibir el archivo acá (evitar serializar la foto entera en memoria del
// server y perder el progreso de subida). Se deja como una action separada
// —en vez de que `avatar-upload-field.tsx` reuse `prepareCoverUploadAction`—
// por el mismo criterio que ya aplica el resto de este archivo: cada
// funcionalidad es un módulo chico y autocontenido, no una que otra depende
// para funcionar. `avatar_url` deja de ser de sólo lectura acá: hasta ahora
// sólo se fijaba una vez al entrar por Google/Apple (`src/lib/auth/
// provision.ts`) y nunca más se podía tocar.
// ---------------------------------------------------------------------------

export type PrepareAvatarUploadResult =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; code: "unauthenticated" | "error" };

export async function prepareAvatarUploadAction(): Promise<PrepareAvatarUploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return { ok: false, code: "error" };

  return { ok: true, tenantId: data.tenant_id, userId: user.id };
}

// ---------------------------------------------------------------------------
// Controles de privacidad del perfil (0063). Upsert sobre `profile_privacy`,
// cuya RLS es solo-dueño: el `profile_id` sale de la sesión, nunca del cliente.
// ---------------------------------------------------------------------------

/**
 * Las ocho claves escritas a mano y no derivadas de `PRIVACY_KEYS` con un
 * `fromEntries`: derivarlas obliga a un `as` para recuperar el tipo, y un `as`
 * en el borde de validación anula justo lo que el borde existe para hacer. Que
 * la lista quede sincronizada con la tabla lo cuida `privacy.test.ts`.
 */
const level = z.enum(PRIVACY_LEVELS);
const privacySchema = z.object({
  show_last_name: level,
  show_birthdate: level,
  show_location: level,
  show_languages: level,
  show_country_origin: level,
  show_bio: level,
  show_followers: level,
  show_posts: level,
});

export type UpdatePrivacyInput = z.infer<typeof privacySchema>;

export async function updateProfilePrivacyAction(
  input: UpdatePrivacyInput,
): Promise<ActionResult> {
  const parsed = privacySchema.safeParse(input);
  if (!parsed.success) {
    // Un nivel fuera de los tres válidos no es algo que la UI pueda producir:
    // es un cliente manipulado. Se cierra sin dar pistas de qué campo falló.
    return { ok: false, formError: COPY.genericError };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, formError: COPY.noSession };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    console.error("[perfil] privacidad: no se pudo leer el tenant", {
      code: profileError?.code,
    });
    return { ok: false, formError: COPY.genericError };
  }

  // `normalizePrivacy` completa lo que falte con los defaults conservadores:
  // una fila a medias sería una fila con columnas en su DEFAULT de tabla, que
  // por suerte coinciden — pero depender de esa coincidencia es frágil.
  const settings = normalizePrivacy(parsed.data);

  const { error } = await supabase.from("profile_privacy").upsert(
    { profile_id: user.id, tenant_id: profile.tenant_id, ...settings },
    { onConflict: "profile_id" },
  );

  if (error) {
    console.error("[perfil] privacidad: upsert falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  // El perfil público se arma con `profile_card()`, que lee esta tabla: sin
  // revalidar, la persona guardaría el cambio y seguiría viendo el perfil viejo.
  revalidatePath("/perfil");
  revalidatePath("/ajustes/privacidad");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Zona horaria (0067). Escribe `profiles.timezone`; el valor se valida contra el
// catálogo ANTES de mandarlo, para que el trigger de la base nunca tenga que
// levantar `ZONA_HORARIA_INVALIDA` — que llegaría al cliente como error crudo.
// ---------------------------------------------------------------------------

const timeZoneSchema = z.object({
  timeZone: z
    .string()
    .trim()
    .refine((value) => value === "" || isKnownTimeZone(value), COPY.timeZoneInvalid),
});

export type UpdateTimeZoneInput = z.infer<typeof timeZoneSchema>;

export async function updateTimeZoneAction(
  input: UpdateTimeZoneInput,
): Promise<ActionResult> {
  const parsed = timeZoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstIssuePerField(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, formError: COPY.noSession };

  const { error } = await supabase
    .from("profiles")
    // Vacío = "volver a que la app la deduzca del navegador". Es un estado
    // legítimo y por eso la columna es nullable (0067), no un default disfrazado.
    .update({ timezone: parsed.data.timeZone || null })
    .eq("id", user.id);

  if (error) {
    console.error("[perfil] zona horaria: update falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  // Cambiar de zona cambia CÓMO SE LEE cada fecha de la app, no sólo la de esta
  // pantalla. Se invalida el layout entero.
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cerrar sesión.
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/entrar");
}

// ---------------------------------------------------------------------------
// Eliminar cuenta — minimización real (§ anti-honeypot): borra el auth user
// vía admin y el cascade de la DB (0015) se lleva todo lo demás en Postgres.
// El admin client acá es legítimo: solo actúa sobre el usuario autenticado de
// la sesión actual.
//
// Storage vive FUERA de Postgres: el cascade de 0015 borra las FILAS
// (listings, conversations, messages), pero no los archivos que esas filas
// referenciaban en Storage — sin limpieza explícita quedan huérfanos
// (avatar, fotos de avisos, currículums), y un archivo huérfano es una fuga
// de datos que sobrevive a la cuenta. Por eso: 1) recolectar QUÉ hay que
// borrar mientras todavía existe (solo lectura, no toca nada), 2) borrar el
// usuario (la acción irreversible real), 3) recién con éxito confirmado,
// limpiar Storage con lo recolectado — así un fallo en el paso 1 o 3 nunca
// deja una cuenta a medio borrar ni destruye archivos de una cuenta que
// sigue viva.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;
type StorageCleanupPlan = ReadonlyArray<{ bucket: string; prefix: string }>;

/** Buckets cuyo path empieza con `{tenant_id}/{user_id}/…` (0012, 0025, 0047). */
const OWN_PREFIX_BUCKETS = ["avatars", "post-media", "job-cvs"] as const;

/**
 * Recolecta, de solo lectura, qué archivos de Storage hay que borrar para
 * esta cuenta. Corre ANTES de deleteUser: si algo falla acá no se tocó nada.
 */
async function collectStorageCleanup(
  admin: AdminClient,
  userId: string,
): Promise<StorageCleanupPlan> {
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) return [];

    const plan: { bucket: string; prefix: string }[] = OWN_PREFIX_BUCKETS.map((bucket) => ({
      bucket,
      prefix: `${profile.tenant_id}/${userId}`,
    }));

    // listing-photos usa {tenant_id}/{listing_id}/… — hay que resolver los
    // avisos propios ANTES de que el cascade de listings se los lleve.
    const { data: listings } = await admin
      .from("listings")
      .select("id")
      .eq("created_by", userId);
    for (const listing of listings ?? []) {
      plan.push({ bucket: "listing-photos", prefix: `${profile.tenant_id}/${listing.id}` });
    }

    return plan;
  } catch (error) {
    console.error(
      "[perfil] deleteAccount: collectStorageCleanup falló (se sigue igual):",
      error instanceof Error ? error.message : "error desconocido",
    );
    return [];
  }
}

/**
 * Ejecuta la limpieza recolectada. Corre DESPUÉS de que deleteUser confirmó
 * éxito. Best-effort por diseño: un archivo que no se pudo borrar queda
 * logueado para reconciliar a mano, pero NUNCA revierte ni bloquea un
 * borrado de cuenta ya confirmado (§5.4: menos dato > archivo prolijo).
 */
async function runStorageCleanup(admin: AdminClient, plan: StorageCleanupPlan): Promise<void> {
  for (const { bucket, prefix } of plan) {
    try {
      const { data: files, error } = await admin.storage.from(bucket).list(prefix, {
        limit: 1000,
      });
      if (error || !files || files.length === 0) continue;
      const paths = files.map((file) => `${prefix}/${file.name}`);
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      if (removeError) {
        console.error(
          `[perfil] deleteAccount: no se pudo limpiar Storage (${bucket}/${prefix}) — reconciliar a mano:`,
          removeError.message,
        );
      }
    } catch (error) {
      console.error(
        `[perfil] deleteAccount: limpieza de Storage (${bucket}) falló — reconciliar a mano:`,
        error instanceof Error ? error.message : "error desconocido",
      );
    }
  }
}

export async function deleteAccountAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, formError: COPY.noSession };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, formError: COPY.genericError };
  }

  // Precondición (0015): business_accounts.owner_id es ON DELETE RESTRICT a
  // propósito — una cuenta con suscripción Stripe activa NO debe cascadear
  // billing en silencio. Sin este chequeo, deleteUser fallaba más abajo con
  // un foreign_key_violation opaco y la persona recibía "probá de nuevo",
  // un mensaje que reintentar jamás arregla. Se distingue por plan_status:
  // sin suscripción real (inactive/canceled) se da de baja sola, con
  // suscripción real (active/past_due) se bloquea con una acción concreta.
  const { data: business } = await admin
    .from("business_accounts")
    .select("id, plan_status")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (business) {
    if (business.plan_status === "active" || business.plan_status === "past_due") {
      return { ok: false, formError: COPY.businessAccountBlocked };
    }
    // Sin suscripción real detrás (nunca pagó o ya canceló): no hay billing
    // que proteger — se da de baja la fila para que el borrado pueda seguir.
    const { error: cleanupError } = await admin
      .from("business_accounts")
      .delete()
      .eq("id", business.id);
    if (cleanupError) {
      console.error("[perfil] deleteAccount: no se pudo dar de baja business_account inactivo", {
        code: cleanupError.code,
      });
      return { ok: false, formError: COPY.genericError };
    }
  }

  const storageCleanup = await collectStorageCleanup(admin, user.id);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[perfil] deleteUser falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  await runStorageCleanup(admin, storageCleanup);

  await supabase.auth.signOut();
  redirect("/");
}

// ---------------------------------------------------------------------------
// Reportar un perfil como estafa — RPC report_scam (SECURITY DEFINER, RLS-safe).
// ---------------------------------------------------------------------------

const reportSchema = z.object({
  profileId: z.uuid(),
  reason: z.enum([
    "pidio_dinero_adelantado",
    "se_hace_pasar_por_otro",
    "publicacion_falsa",
    "otro",
  ]),
  details: z.string().trim().max(500, COPY.reportDetailsLong).optional(),
});

export type ReportProfileInput = z.infer<typeof reportSchema>;

export async function reportProfileAction(
  input: ReportProfileInput,
): Promise<ActionResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: COPY.genericError };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, formError: COPY.noSession };

  // Mismo presupuesto y MISMA key que /escudo/reportar y /reportes: 10 por día
  // y por persona, compartidos entre todas las superficies de reporte. Un tope
  // por pantalla sería un tope multiplicado por la cantidad de pantallas, y
  // quien quiere brigadear a alguien no elige el botón, elige la víctima.
  if (!limit(`reporte:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, formError: COPY.tooManyReports };
  }

  const { error } = await supabase.rpc("report_scam", {
    p_target_kind: "profile",
    p_target_id: parsed.data.profileId,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details || undefined,
  });

  if (error) {
    console.error("[perfil] report_scam falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bloquear/desbloquear a otra persona — RPCs block_user/unblock_user
// (SECURITY DEFINER, 0020_user_blocks.sql). El bloqueo es global: corta el
// contacto en ambas direcciones y cierra los hilos existentes entre ambos.
// ---------------------------------------------------------------------------

const blockProfileSchema = z.object({
  profileId: z.uuid(),
});

export type BlockActionResult =
  | { ok: true }
  | { ok: false; code: "unauthenticated" | "invalid" | "error" };

export async function blockUserAction(
  input: { profileId: string },
): Promise<BlockActionResult> {
  const parsed = blockProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase.rpc("block_user", {
    p_profile_id: parsed.data.profileId,
  });
  if (error) {
    console.error("[perfil] block_user falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  revalidatePath("/mensajes");
  revalidatePath("/perfil/bloqueados");
  return { ok: true };
}

export async function unblockUserAction(
  input: { profileId: string },
): Promise<BlockActionResult> {
  const parsed = blockProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase.rpc("unblock_user", {
    p_profile_id: parsed.data.profileId,
  });
  if (error) {
    console.error("[perfil] unblock_user falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  revalidatePath("/mensajes");
  revalidatePath("/perfil/bloqueados");
  return { ok: true };
}
