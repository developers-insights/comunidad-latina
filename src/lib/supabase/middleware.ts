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

  // NO remover: getUser() valida el JWT contra Supabase y refresca el token
  // expirado. Sin esta llamada la sesión muere en silencio.
  await supabase.auth.getUser();

  return supabaseResponse;
}
