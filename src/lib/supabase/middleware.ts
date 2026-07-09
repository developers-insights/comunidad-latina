import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca la sesión de Supabase en el middleware (patrón oficial @supabase/ssr).
 *
 * Recibe el request DESPUÉS de que el middleware raíz le inyectó los headers de
 * tenant (x-tenant-slug): `NextResponse.next({ request })` reenvía esos headers
 * a los Server Components.
 *
 * Si Supabase no está configurado (env vacías) degrada en silencio: la app
 * carga sin sesión en vez de romper — assertSupabaseConfigured() avisa al dev
 * en el primer uso real del cliente.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return supabaseResponse;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // NO remover: valida el JWT y refresca el token cuando está por expirar. Sin
  // esta llamada la sesión muere en silencio.
  //
  // getClaims() en vez de getUser(): con signing keys asimétricas (ECC/RSA) la
  // verificación de la firma es LOCAL (WebCrypto en el Edge, sin round-trip al
  // Auth server) → elimina el hop de red del TTFB de TODO request. El refresh se
  // preserva: getClaims() llama getSession() por dentro, que refresca cuando el
  // token está por expirar y persiste las cookies vía el mismo setAll de arriba.
  // Si el proyecto usa secreto simétrico (HS*) o no hay WebCrypto, getClaims()
  // cae solo a getUser() → mismo comportamiento que antes, sin romper la sesión.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
