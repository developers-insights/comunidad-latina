import { cache } from "react";
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

/**
 * Usuario autenticado del request, cache()-eado: si varios Server Components de
 * un mismo árbol lo piden, se hace UNA sola llamada a Supabase Auth por request
 * (React dedupe). Sigue siendo el `getUser()` networked que VALIDA el JWT — no
 * se cambia la semántica de seguridad. El refresh del token lo hace el
 * middleware (patrón @supabase/ssr); acá solo se lee el usuario ya validado.
 *
 * Preferir este helper sobre `(await createClient()).auth.getUser()` en páginas
 * y layouts para no serializar dos veces la misma verificación de auth.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Identidad del request verificada LOCALMENTE (WebCrypto) vía getClaims() — sin
 * round-trip al Auth server cuando el proyecto usa signing keys asimétricas.
 * Devuelve los claims del JWT (sub, role, email…) o null si no hay sesión.
 * cache()-eado: una sola verificación por request.
 *
 * SEGURIDAD: solo valida firma + expiración localmente. NO detecta revocación
 * server-side hasta que el token expira (~1h). Usar para gating de LECTURA
 * respaldado por RLS (¿estás logueado? ¿cuál es tu user id?). Para autorización
 * SENSIBLE (admin, dinero, mutaciones) seguir usando getCurrentUser()/getUser().
 */
export const getCurrentClaims = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
});

/** user id del request (claims.sub), verificado local. null si no hay sesión. */
export const getAuthUserId = cache(async (): Promise<string | null> => {
  const claims = await getCurrentClaims();
  const sub = claims?.sub;
  return typeof sub === "string" ? sub : null;
});
