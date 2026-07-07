import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/components/auth/next-param";

/**
 * Callback del magic link (PKCE, patrón @supabase/ssr):
 * el email de Supabase redirige acá con ?code=… → lo canjeamos por sesión
 * (cookies) y mandamos al usuario a `next` (sanitizado, solo rutas internas).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    console.error("[auth] callback: exchangeCodeForSession falló", {
      code: error.code,
    });
  }

  // Enlace vencido o ya usado → de vuelta a /entrar con aviso cálido.
  return NextResponse.redirect(new URL("/entrar?error=enlace", url.origin));
}
