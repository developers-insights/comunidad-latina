import "server-only";

import type { User } from "@supabase/supabase-js";
import { getTenant } from "@/lib/tenant/resolve";
import { ensureProfileForOAuthUser } from "@/lib/auth/provision";
import { syncEmailVerified } from "@/lib/auth/email-verified";
import { neutralizePreclaimedAccount, wasPreclaimedUnconfirmed } from "@/lib/auth/preclaimed";
import { importGoogleAvatarIfMissing } from "@/lib/auth/google-avatar";

/**
 * Lo que pasa DESPUÉS de que existe la sesión, venga del canje del code en
 * `/callback` (magic link, recuperación, Apple, Google por redirect) o del
 * `signInWithIdToken` del botón de Google Identity Services. Un solo lugar:
 * dos copias de esta lógica son dos lugares donde un arreglo de seguridad
 * llega a uno solo.
 */

export interface SessionAuthClient {
  auth: {
    signOut: () => Promise<unknown>;
    refreshSession: () => Promise<{ error: { code?: string } | null }>;
  };
}

export type FinalizeFailure = "otra_comunidad" | "alta";

export type FinalizeOAuthResult =
  | { ok: true; redirectTo: string; created: boolean }
  | { ok: false; reason: FinalizeFailure };

/**
 * No alcanza con `app_metadata.provider`: es el proveedor con el que NACIÓ la
 * cuenta. Quien se registró con email y después entra con Google queda
 * vinculado al mismo usuario y `provider` sigue diciendo "email" — decidir por
 * ese campo salteaba el chequeo de comunidad justo en ese caso.
 */
export function hasExternalIdentity(user: User): boolean {
  const meta = user.app_metadata ?? {};
  const providers: unknown[] = Array.isArray(meta.providers) ? meta.providers : [];
  return [meta.provider, ...providers].some(
    (p) => typeof p === "string" && p !== "email" && p !== "phone",
  );
}

function hasGoogleIdentity(user: User): boolean {
  const meta = user.app_metadata ?? {};
  const providers: unknown[] = Array.isArray(meta.providers) ? meta.providers : [];
  if (meta.provider === "google" || providers.includes("google")) return true;
  return (user.identities ?? []).some((i) => i.provider === "google");
}

export async function finalizeOAuthSession({
  supabase,
  user,
  accessToken,
  next,
}: {
  supabase: SessionAuthClient;
  user: User;
  accessToken: string;
  /** Ya saneado con `safeInternalPath`. */
  next: string;
}): Promise<FinalizeOAuthResult> {
  const fail = async (reason: FinalizeFailure): Promise<FinalizeOAuthResult> => {
    // Una sesión que no se pudo dejar usable no se deja abierta: sería el
    // usuario huérfano que `provision.ts` existe para evitar.
    await supabase.auth.signOut();
    return { ok: false, reason };
  };

  let created = false;

  // Las cuentas sólo-email ya pasaron por `registerAction`. `app_metadata` lo
  // escribe el Auth server, nunca el cliente.
  if (hasExternalIdentity(user)) {
    const tenant = await getTenant();
    const provisioned = await ensureProfileForOAuthUser(user, tenant.id);
    if (!provisioned.ok) {
      return fail(provisioned.reason === "otro_tenant" ? "otra_comunidad" : "alta");
    }
    created = provisioned.created;

    if (wasPreclaimedUnconfirmed(user)) {
      const neutralized = await neutralizePreclaimedAccount(user, accessToken);
      if (!neutralized) return fail("alta");
      // El perfil lo armó quien registró el email: que el dueño lo revise.
      created = true;
    }

    // El JWT se emitió ANTES de que existiera `app_metadata.tenant_id`: sin
    // refrescar, la primera visita ve la app vacía (cada policy usa
    // `app.current_tenant_id()`) y la segunda funciona.
    if (provisioned.claimsChanged) {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.error("[auth] finalize: refreshSession falló", { code: refreshError.code });
        return fail("alta");
      }
    }

    if (hasGoogleIdentity(user)) await importGoogleAvatarIfMissing(user);
  }

  // Google confirma el correo, y la vinculación con una cuenta de email sin
  // confirmar la deja confirmada: sin este espejo el gate de creador (0064)
  // era imposible de cumplir.
  await syncEmailVerified(user);

  // Cuenta nueva → onboarding (zona y necesidades), que es lo que hace que el
  // feed tenga algo que mostrar.
  return { ok: true, redirectTo: created ? "/bienvenida" : next, created };
}
