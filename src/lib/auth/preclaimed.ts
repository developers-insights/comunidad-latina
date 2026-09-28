import "server-only";

import { randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// Cuenta nacida por email cuya identidad email ya no existe: Supabase la borra al
// vincular Google SOLO si el correo nunca se confirmó. Es la huella exacta de que
// alguien registró este email sin ser su dueño y el dueño real acaba de entrar.
export function wasPreclaimedUnconfirmed(user: User): boolean {
  if (user.app_metadata?.provider !== "email") return false;
  const identities = user.identities ?? [];
  const hasExternal = identities.some((i) => i.provider !== "email" && i.provider !== "phone");
  const hasEmail = identities.some((i) => i.provider === "email");
  return hasExternal && !hasEmail;
}

// No se confía en que GoTrue haya borrado la contraseña del registro previo: se
// reemplaza por una aleatoria y se cierran las demás sesiones. Fail-closed.
export async function neutralizePreclaimedAccount(
  user: User,
  accessToken: string,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error: pwError } = await admin.auth.admin.updateUserById(user.id, {
      password: randomBytes(32).toString("base64url"),
    });
    if (pwError) {
      console.error("[auth] preclaimed: no se pudo rotar la contraseña", { code: pwError.code });
      return false;
    }
    const { error: outError } = await admin.auth.admin.signOut(accessToken, "others");
    if (outError) {
      console.error("[auth] preclaimed: no se pudieron cerrar otras sesiones", {
        code: outError.code,
      });
      return false;
    }
    return true;
  } catch (thrown) {
    console.error("[auth] preclaimed: admin client no disponible", {
      message: thrown instanceof Error ? thrown.message : "desconocido",
    });
    return false;
  }
}
