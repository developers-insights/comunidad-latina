import { NextResponse } from "next/server";
import type { EmailOtpType, Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { finalizeOAuthSession } from "@/lib/auth/finalize-oauth";
import { safeInternalPath } from "@/lib/url/safe-href";
import { resolveRequestOrigin } from "../recuperar/origin";

/**
 * Callback del magic link Y de Google/Apple (PKCE, patrón @supabase/ssr):
 * el proveedor redirige acá con ?code=… → se canjea por sesión (cookies) y se
 * manda al usuario a `next` (sanitizado, solo rutas internas).
 *
 * ── POR QUÉ ACÁ SE PROVISIONA EL PERFIL ──────────────────────────────────────
 * Es el único punto por el que pasan TODOS los caminos de OAuth. El alta por
 * email crea el perfil y el `app_metadata` en `registerAction`; el alta por
 * Google o Apple no pasa por ninguna server action nuestra —el usuario lo crea
 * el Auth server de Supabase— y sin este paso quedaría un usuario con sesión,
 * sin `tenant_id` en el JWT y sin fila en `profiles`: una app vacía y rota.
 * Ver el comentario largo de `lib/auth/provision.ts`.
 */

/**
 * Magic link y recuperación llegan con `?token_hash=…&type=…` (las plantillas de
 * Supabase arman el link así) y no con `?code=`: el `code` de PKCE sólo se canjea
 * en el mismo navegador que pidió el correo, y la mayoría abre el mail en otra
 * app (Gmail en el celular). Eso daba `pkce_code_verifier_not_found` y "enlace
 * vencido" a todo el que quería recuperar la cuenta (04/11/2026).
 */
const EMAIL_OTP_TYPES = new Set<EmailOtpType>(["magiclink", "recovery", "email"]);

function emailOtpType(raw: string | null): EmailOtpType | null {
  return raw && EMAIL_OTP_TYPES.has(raw as EmailOtpType) ? (raw as EmailOtpType) : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = await resolveRequestOrigin(request);
  const code = url.searchParams.get("code");
  // `safeInternalPath` y no `safeNextPath`: el segundo clasificaba por string y
  // dejaba pasar `/<TAB>/evil.com`, que `new URL()` normaliza a `//evil.com` y
  // manda el Location FUERA del sitio. Ver el comentario largo en safe-href.ts.
  const next = safeInternalPath(url.searchParams.get("next"), "/feed");

  /**
   * El proveedor puede volver con un error en vez de un code: la persona tocó
   * "Cancelar" en la pantalla de Google, o revocó el permiso. No es una falla
   * nuestra y no merece el aviso de "enlace vencido" — vuelve a /entrar limpio.
   */
  if (url.searchParams.get("error")) {
    const reason = url.searchParams.get("error");
    if (reason === "access_denied") {
      return NextResponse.redirect(new URL("/entrar", origin));
    }
    console.error("[auth] callback: el proveedor devolvió un error", {
      reason: reason?.slice(0, 64),
    });
    return NextResponse.redirect(new URL("/entrar?error=proveedor", origin));
  }

  const tokenHash = url.searchParams.get("token_hash");
  const otpType = emailOtpType(url.searchParams.get("type"));

  if (code || (tokenHash && otpType)) {
    const supabase = await createClient();
    const { data, error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ type: otpType!, token_hash: tokenHash! });

    if (!error && data.user && data.session) {
      return finish(supabase, data.user, data.session, next, origin);
    }

    console.error("[auth] callback: canje del enlace falló", {
      via: code ? "code" : otpType,
      code: error?.code ?? "sin_usuario",
    });

    // El mismo enlace suele llegar dos veces en el mismo segundo (el cliente de
    // mail lo abre y el navegador lo repite): el primero ya abrió la sesión y
    // el segundo encuentra el token gastado. Si la sesión está, no es un error.
    const { data: current } = await supabase.auth.getUser();
    if (current.user) return NextResponse.redirect(new URL(next, origin));
  }

  // Enlace vencido o ya usado → de vuelta a /entrar con aviso cálido.
  return NextResponse.redirect(new URL("/entrar?error=enlace", origin));
}

async function finish(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: User,
  session: Session,
  next: string,
  origin: string,
) {
  // Provisión, chequeo de comunidad, cuentas pre-reclamadas, refresh del
  // JWT y foto de Google: lo mismo que el botón de Google Identity Services.
  const result = await finalizeOAuthSession({
    supabase,
    user,
    accessToken: session.access_token,
    next,
  });
  const target = result.ok ? result.redirectTo : `/entrar?error=${result.reason}`;
  return NextResponse.redirect(new URL(target, origin));
}
