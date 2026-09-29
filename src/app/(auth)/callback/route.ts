import { NextResponse } from "next/server";
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

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Provisión, chequeo de comunidad, cuentas pre-reclamadas, refresh del
      // JWT y foto de Google: lo mismo que el botón de Google Identity Services.
      const result = await finalizeOAuthSession({
        supabase,
        user: data.user,
        accessToken: data.session.access_token,
        next,
      });
      const target = result.ok ? result.redirectTo : `/entrar?error=${result.reason}`;
      return NextResponse.redirect(new URL(target, origin));
    }

    console.error("[auth] callback: exchangeCodeForSession falló", {
      code: error?.code ?? "sin_usuario",
    });
  }

  // Enlace vencido o ya usado → de vuelta a /entrar con aviso cálido.
  return NextResponse.redirect(new URL("/entrar?error=enlace", origin));
}
