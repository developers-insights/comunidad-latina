import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  resolveTenantSlug,
  TENANT_COOKIE,
  TENANT_SLUG_HEADER,
} from "@/lib/tenant/resolve";

// Nota Next 16: la convención `middleware.ts` está deprecada a favor de `proxy.ts`
// (mismo contenido, función renombrada). Sigue funcionando; la migración es un
// codemod de una línea cuando el enjambre lo decida en conjunto:
//   npx @next/codemod@canary middleware-to-proxy .

export async function middleware(request: NextRequest) {
  // 1. Resolver tenant: prod → dominio; dev → ?t= > cookie cl-tenant > default.
  const tParam = request.nextUrl.searchParams.get("t");
  const cookieTenant = request.cookies.get(TENANT_COOKIE)?.value ?? null;
  const slug = resolveTenantSlug(request.headers.get("host"), tParam, cookieTenant);

  // 2. Inyectar el slug como request header — getTenant() resuelve el id real
  //    contra la DB (con fallback), así el middleware nunca bloquea por DB caída.
  request.headers.set(TENANT_SLUG_HEADER, slug);

  // 3. Refrescar la sesión de Supabase (patrón @supabase/ssr) reenviando los
  //    headers ya mutados a los Server Components.
  const response = await updateSession(request);

  // 4. En dev, ?t= persiste a cookie para no tener que repetirlo en cada URL.
  if (tParam && tParam === slug && tParam !== cookieTenant) {
    response.cookies.set(TENANT_COOKIE, slug, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todo excepto:
     * - _next/static, _next/image (assets de Next)
     * - favicon, sw.js, manifest (PWA)
     * - archivos de imagen/fuente estáticos
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.webmanifest|images/|icons/|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
