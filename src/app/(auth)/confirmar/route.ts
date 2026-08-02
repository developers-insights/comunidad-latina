import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/url/safe-href";
import { getTenant } from "@/lib/tenant/resolve";
import { sendEmailInBackground } from "@/lib/email";
import { welcomeEmail } from "@/lib/email/templates";

/**
 * Confirmación de cuenta: el enlace del correo pega acá con `?token_hash=…`.
 *
 * Es hermana de /callback pero NO la misma cosa: /callback canjea un `?code=`
 * (PKCE, el flujo del magic link que arma el propio Supabase), y acá llega un
 * `token_hash` que minteamos nosotros con la Admin API para poder mandar el
 * correo por Resend (ver src/lib/auth/confirmation.ts). Los dos terminan igual:
 * sesión en cookies y redirect a una ruta interna sanitizada.
 *
 * `verifyOtp` confirma el email y devuelve la sesión de una, así que la persona
 * entra directo desde el correo — sin volver a escribir la contraseña.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  // Ver safe-href.ts: el filtro por string dejaba salir del sitio con un tab
  // embebido, y acá el redirect ocurre con la sesión RECIÉN abierta.
  const next = safeInternalPath(url.searchParams.get("next"), "/bienvenida");

  if (tokenHash) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type: "signup",
      token_hash: tokenHash,
    });

    if (!error && data.user) {
      // Bienvenida: recién acá, no en el registro. Quien nunca confirma no
      // recibe un "bienvenido" a una cuenta que no puede usar. Fire-and-forget:
      // el correo jamás puede frenar el aterrizaje.
      const tenant = await getTenant();
      const displayName = data.user.user_metadata?.display_name;
      const welcome = welcomeEmail({
        displayName: typeof displayName === "string" ? displayName : "",
        tenantName: tenant.name,
        brandHex: tenant.brandHex,
      });
      if (data.user.email) {
        sendEmailInBackground({
          to: data.user.email,
          subject: welcome.subject,
          html: welcome.html,
        });
      }

      return NextResponse.redirect(new URL(next, url.origin));
    }

    console.error("[auth] confirmar: verifyOtp falló", { code: error?.code });
  }

  // Enlace vencido o ya usado (el token es de un solo uso) → a /entrar, donde
  // un intento de ingreso con la cuenta sin confirmar reenvía el enlace solo.
  return NextResponse.redirect(new URL("/entrar?error=confirmacion", url.origin));
}
