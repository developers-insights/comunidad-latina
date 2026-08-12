import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * =============================================================================
 * ESPEJAR EN `profiles.email_verified` LO QUE SUPABASE AUTH YA CONFIRMÓ
 * =============================================================================
 *
 * EL AGUJERO QUE TAPA ESTE MÓDULO. `auth.users.email_confirmed_at` y
 * `public.profiles.email_verified` son dos verdades distintas sobre el mismo
 * hecho, y hasta acá solo se escribía la primera: la persona abría el correo,
 * Supabase Auth marcaba la confirmación… y la columna del perfil seguía en
 * `false` para siempre. Nadie en `src/` la escribía nunca (lo dice el comentario
 * de la 0058 y lo confirma un grep).
 *
 * No era un detalle cosmético. `app.creator_activation_eligible()` (0064) exige
 * `require_email_verified`, que viene en `true` por defecto y lee ESA columna.
 * O sea: el requisito de "correo verificado" era imposible de cumplir por
 * construcción, y con él se caía la activación de creador entera.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EL ADMIN CLIENT Y NO EL DE LA SESIÓN
 *
 * La guarda `protect_profile_privileges` (0030) levanta `PROTECTED_COLUMNS` si
 * un JWT de usuario toca `email_verified` — justamente para que nadie se
 * autoverifique. El único camino legítimo es `service_role`, o sea el admin
 * client. Es la misma doctrina de escritura privilegiada del resto del repo
 * (ARQUITECTURA §6): primero se verifica el hecho, después se escribe con
 * privilegio, y el id sale de la sesión ya verificada — nunca de un parámetro
 * del cliente.
 *
 * -----------------------------------------------------------------------------
 * NUNCA LANZA. NUNCA ROMPE LA CONFIRMACIÓN.
 *
 * Esta es una columna DERIVADA: la verdad la sigue teniendo Supabase Auth. Si
 * el update falla —falta la service key, se cayó la red— la persona igual
 * confirmó su correo y tiene que poder entrar. Por eso el fallo se loguea y se
 * sigue; jamás se convierte en un enlace de confirmación roto. Lo que NO hace
 * es tragarse el error en silencio: queda escrito en el log del servidor con su
 * causa, que es la diferencia entre "degradado" y "mudo".
 * =============================================================================
 */

/**
 * Lo mínimo que hace falta de un usuario de Supabase Auth. Se tipa estructural
 * (y no como el `User` completo) para que quien llame no tenga que fabricar un
 * usuario entero, y para que el contrato diga en voz alta cuáles son los dos
 * campos que deciden: el id y la marca de confirmación.
 */
export interface ConfirmedAuthUser {
  id: string;
  /** Lo que setea Supabase Auth al verificar el correo. Es la fuente de verdad. */
  email_confirmed_at?: string | null;
  /** Respaldo del SDK: confirmación general (correo o teléfono). */
  confirmed_at?: string | null;
}

/** ¿Auth dice que este correo está confirmado? Nada de suponerlo por contexto. */
export function isEmailConfirmed(user: ConfirmedAuthUser | null | undefined): boolean {
  if (!user?.id) return false;
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

/**
 * Pone `profiles.email_verified = true` para un usuario que Auth YA confirmó.
 *
 * Idempotente: el filtro `.eq("email_verified", false)` hace que la segunda
 * llamada no matchee ninguna fila. Llamarla mil veces cuesta mil no-ops, no mil
 * escrituras — y `email_verified` es `not null default false` (0030), así que
 * el filtro nunca se pierde una fila por un `null`.
 *
 * @returns `true` si el espejo quedó al día (se escribió o ya estaba), `false`
 *          si algo falló. Quien llama puede ignorarlo: confirmar el correo no
 *          depende de esto.
 */
export async function syncEmailVerified(
  user: ConfirmedAuthUser | null | undefined,
): Promise<boolean> {
  // Sin confirmación de Auth no se escribe NADA. Marcar el espejo por el solo
  // hecho de que alguien pasó por la ruta sería inventar una verificación.
  if (!isEmailConfirmed(user) || !user) return false;

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({ email_verified: true })
      .eq("id", user.id)
      .eq("email_verified", false);

    if (error) {
      console.error("[auth] no se pudo espejar email_verified:", error.message);
      return false;
    }
    return true;
  } catch (thrown) {
    console.error(
      "[auth] admin client no disponible para espejar email_verified:",
      thrown instanceof Error ? thrown.message : "error desconocido",
    );
    return false;
  }
}
