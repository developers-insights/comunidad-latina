import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { suggestUsername } from "@/lib/profile/username";

/**
 * Alta de la cuenta que llega por Google o por Apple.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EL PROBLEMA QUE ESTE ARCHIVO EXISTE PARA EVITAR: EL USUARIO HUÉRFANO
 * ═══════════════════════════════════════════════════════════════════════════
 * El alta por email pasa por `registerAction`, que hace DOS cosas con el cliente
 * admin: setea `app_metadata: { tenant_id, role }` e inserta la fila de
 * `profiles`. El alta por OAuth no pasa por ahí — el usuario lo crea el Auth
 * server de Supabase cuando vuelve del proveedor, y nace SIN las dos cosas.
 *
 * Un usuario así puede iniciar sesión y no existe para la app: sin `tenant_id`
 * en el JWT, `app.current_tenant_id()` no resuelve y TODA policy de RLS que lo
 * use lo deja afuera; sin fila en `profiles` no hay nombre, ni Trust Score, ni
 * perfil. La persona ve una app vacía y rota, con sesión iniciada.
 *
 * Por eso el callback llama a esto SIEMPRE antes de dejar entrar a nadie.
 *
 * ── ES IDEMPOTENTE ───────────────────────────────────────────────────────────
 * Corre en cada vuelta del callback, incluida la de quien ya tiene cuenta desde
 * hace meses. Con perfil existente no toca nada y sale.
 */

/** Versión del set legal vigente. Igual que la de `(auth)/actions.ts`. */
const TERMS_VERSION = "v1-2026-07";

export type ProvisionResult =
  /** Ya existía o se creó bien. */
  | { ok: true; created: boolean }
  /** No se pudo dejar la cuenta usable. Quien llama TIENE que cerrar la sesión. */
  | { ok: false; reason: "otro_tenant" | "error" };

/**
 * El nombre visible que trae el proveedor.
 *
 * Google manda `full_name`/`name`, Apple manda `name` sólo la PRIMERA vez que la
 * persona autoriza (después nunca más — es una particularidad conocida de Sign
 * in with Apple). Cuando no viene nada usable se cae a la parte local del
 * correo, que es feo pero es un nombre; dejar el perfil sin `display_name`
 * rompería el NOT NULL de la columna y, peor, dejaría a la persona sin nombre en
 * la comunidad.
 */
function displayNameFrom(user: User): string {
  const meta = user.user_metadata ?? {};
  const candidates = [meta.full_name, meta.name, meta.preferred_username];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length >= 2) {
      return candidate.trim().slice(0, 60);
    }
  }
  const local = (user.email ?? "").split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return local && local.length >= 2 ? local.slice(0, 60) : "Vecino";
}

/** La foto del proveedor, si vino. Es una URL pública suya, no un archivo nuestro. */
function avatarFrom(user: User): string | null {
  const meta = user.user_metadata ?? {};
  for (const key of ["avatar_url", "picture"] as const) {
    const value = meta[key];
    if (typeof value === "string" && value.startsWith("https://")) return value;
  }
  return null;
}

export async function ensureProfileForOAuthUser(
  user: User,
  tenantId: string,
): Promise<ProvisionResult> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    console.error("[auth] oauth: admin client sin configurar — no se puede provisionar");
    return { ok: false, reason: "error" };
  }

  const { data: existing, error: readError } = await admin
    .from("profiles")
    .select("id, tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (readError) {
    console.error("[auth] oauth: no se pudo leer el perfil", { code: readError.code });
    return { ok: false, reason: "error" };
  }

  if (existing) {
    /**
     * Una cuenta pertenece a UN dominio. La misma persona puede tener cuenta en
     * dominicanos.com y en comunidadlatina.com, pero son dos cuentas distintas —
     * Supabase Auth es compartido entre tenants y `auth.users` es único por
     * email, así que quien creó la cuenta en un dominio y entra por OAuth en
     * otro NO puede ser admitido: entraría con el `tenant_id` de la otra
     * comunidad y vería (o no vería) datos que no le corresponden.
     *
     * Se rechaza en vez de mover el perfil: mudar una cuenta de tenant es una
     * operación de soporte, no algo que dispare un botón de login.
     */
    if (existing.tenant_id !== tenantId) return { ok: false, reason: "otro_tenant" };

    // El perfil está, pero el JWT puede no tener el claim (cuenta vieja, o un
    // usuario creado a mano). Se repara sin ruido.
    await ensureAppMetadata(admin, user, tenantId);
    return { ok: true, created: false };
  }

  // ── Alta nueva ────────────────────────────────────────────────────────────
  if (!(await ensureAppMetadata(admin, user, tenantId))) {
    return { ok: false, reason: "error" };
  }

  /**
   * CONSENTIMIENTO. La pantalla de entrada declara, junto a los botones, que al
   * continuar con Google o Apple se aceptan los Términos, la Privacidad y las
   * Normas y se confirma tener 18 años o más. Es el patrón estándar de
   * consentimiento por acción, y acá se SELLA con la misma marca temporal que
   * usa el alta por email para que el registro legal sea idéntico por los dos
   * caminos. Sin este sello la cuenta quedaría sin constancia de aceptación.
   */
  const consentedAt = new Date().toISOString();
  const displayName = displayNameFrom(user);

  const { error: insertError } = await admin.from("profiles").insert({
    id: user.id,
    tenant_id: tenantId,
    display_name: displayName,
    role: "member",
    avatar_url: avatarFrom(user),
    age_confirmed_at: consentedAt,
    terms_accepted_at: consentedAt,
    terms_version: TERMS_VERSION,
  });

  if (insertError) {
    console.error("[auth] oauth: insert de profile falló", { code: insertError.code });
    return { ok: false, reason: "error" };
  }

  /**
   * El HANDLE no se asigna solo. `suggestUsername` existe y podría escribirse
   * acá, pero un nombre de usuario es identidad pública permanente: dárselo a
   * alguien sin que lo vea es la forma más rápida de que quede para siempre un
   * `maria.gonzalez.4` que nadie eligió. El perfil arranca sin handle y la
   * pantalla de perfil lo pide con la sugerencia ya escrita en el campo.
   */
  void suggestUsername;

  return { ok: true, created: true };
}

/** Setea `app_metadata: { tenant_id, role }` si falta. Nunca pisa un rol existente. */
async function ensureAppMetadata(
  admin: ReturnType<typeof createAdminClient>,
  user: User,
  tenantId: string,
): Promise<boolean> {
  const meta = user.app_metadata ?? {};
  if (meta.tenant_id === tenantId && typeof meta.role === "string") return true;

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...meta,
      tenant_id: tenantId,
      // Un rol ya existente manda: reescribir `role: "member"` sobre un
      // moderador lo degradaría en cada login.
      role: typeof meta.role === "string" ? meta.role : "member",
    },
  });

  if (error) {
    console.error("[auth] oauth: no se pudo setear app_metadata", { code: error.code });
    return false;
  }
  return true;
}
