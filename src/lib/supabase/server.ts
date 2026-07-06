import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database.types";

/**
 * Cliente Supabase para Server Components, Server Actions y Route Handlers.
 * Usa la anon key + cookies del usuario → RLS aplica siempre.
 * Crear UNO por request (nunca módulo-global): en Next 16 `cookies()` es async y per-request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Llamado desde un Server Component (no puede escribir cookies).
            // Se ignora: el middleware refresca la sesión en cada request.
          }
        },
      },
    },
  );
}
