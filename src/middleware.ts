import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  clientTenantHintsAllowed,
  resolveTenantSlug,
  tenantHintFromSearchParams,
  TENANT_COOKIE,
  TENANT_SLUG_HEADER,
} from "@/lib/tenant/resolve";
import {
  isPlatformHost,
  lookupTenantDomain,
  normalizeHost,
} from "@/lib/tenant/domain-lookup";
import { lookupTenantSlug } from "@/lib/tenant/slug-lookup";
import {
  decideTenantRouting,
  DOMAIN_UNAVAILABLE_PAGE,
  UNKNOWN_DOMAIN_PAGE,
  unknownTenantHintPage,
  type ProxyErrorPage,
} from "@/lib/tenant/domain-routing";

// Nota Next 16: la convención `middleware.ts` está deprecada a favor de `proxy.ts`
// (mismo contenido, función renombrada). Sigue funcionando; la migración es un
// codemod de una línea cuando el enjambre lo decida en conjunto:
//   npx @next/codemod@canary middleware-to-proxy .
//
// Lo que SÍ cambió con Next 16 y este archivo aprovecha: el proxy corre en el
// runtime de Node.js por defecto (antes Edge). Por eso `lookupTenantDomain`
// puede sostener un caché de módulo entre requests — ver el bloque de decisión
// de caché en src/lib/tenant/domain-lookup.ts.

function errorResponse(page: ProxyErrorPage): NextResponse {
  return new NextResponse(page.html, { status: page.status, headers: page.headers });
}

export async function middleware(request: NextRequest) {
  // 1. Resolver el tenant. La FUENTE es `public.tenant_domains` vía el RPC
  //    `resolve_tenant_domain` (migración 0060), cacheado en memoria; el mapa
  //    hardcodeado y las pistas de dev quedan como respaldo dentro de
  //    `decideTenantRouting`. Ese cambio es lo que permite dar de alta un
  //    dominio sin commit ni deploy.
  const hostname = normalizeHost(request.headers.get("host"));
  // OJO: `TENANT_QUERY_PARAM` es `cl-tenant`, NO `t`. Hasta el 2026-08-24 esto
  // leía `?t=`, que es el parámetro de las PESTAÑAS de Perfil, Negocios,
  // Profesionales y Marketplace: abrir `/negocios?t=ofertas` le decía al proxy
  // "servime la comunidad `ofertas`" y dejaba la app entera vacía por 30 días
  // (la cookie de abajo). El porqué completo del rename está en el docblock de
  // `TENANT_QUERY_PARAM`.
  const hintParam = tenantHintFromSearchParams(request.nextUrl.searchParams);
  const cookieTenant = request.cookies.get(TENANT_COOKIE)?.value ?? null;

  const routing = decideTenantRouting({
    hostname,
    isPlatform: isPlatformHost(hostname),
    lookup: await lookupTenantDomain(hostname),
    hintSlug: resolveTenantSlug(hostname, hintParam, cookieTenant),
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });

  // 2. Un alias resuelve igual que su canónico, pero el canónico es uno solo:
  //    se redirige preservando path y query. 308 y no 302 porque el mapeo es
  //    permanente y porque conserva el método (aunque acá sólo llegan GET/HEAD:
  //    ver `shouldRedirectToCanonical`).
  if (routing.kind === "redirect") {
    return NextResponse.redirect(routing.location, 308);
  }

  // 3. Dominio desconocido / suspendido / archivado → 404 propio. Nunca un 500,
  //    y nunca la comunidad por defecto.
  if (routing.kind === "unknown-domain") {
    return errorResponse(UNKNOWN_DOMAIN_PAGE);
  }

  // 4. Base caída Y ningún respaldo sabe qué es este host → 503 honesto y
  //    reintentable, en vez de servir la comunidad equivocada.
  if (routing.kind === "unavailable-domain") {
    return errorResponse(DOMAIN_UNAVAILABLE_PAGE);
  }

  // 4 bis. LA PISTA DE DEV APUNTA A UNA COMUNIDAD QUE NO EXISTE → decilo.
  //
  //    Esto no es un chequeo de seguridad: es el antídoto contra el modo de
  //    falla que más caro salió en este repo. `resolveTenantSlug` acepta
  //    cualquier slug no reservado A PROPÓSITO (así nace una comunidad sin
  //    deploy), así que un slug inventado pasa, `getTenant()` degrada al
  //    fallback y la app se ve ENTERA VACÍA, sin un solo error. Con la cookie
  //    de 30 días del paso 7 encima, el destrozo sobrevive a cerrar la pestaña.
  //
  //    Tres cortafuegos para que esto nunca moleste donde no corresponde:
  //      · sólo si las pistas del cliente están habilitadas, o sea sólo en
  //        local — en producción y previews el tenant sale del Host y ese
  //        camino ya tiene su 404 propio;
  //      · sólo si el slug que se va a servir VINO de una pista. Si es el mismo
  //        que sale del host/entorno, no hay nada que avisar (y avisar sería
  //        un round-trip en cada request);
  //      · sólo si la base CONTESTÓ que no hay fila. Con la base caída
  //        (`unavailable`) se sigue de largo: la degradación elegante manda, y
  //        estrenar una página de error durante una caída sería mentir.
  //
  //    Se borra además la cookie, porque el 90% de las veces la pista culpable
  //    ES la cookie y quien mira no tiene forma de saberlo. La página lo dice.
  if (clientTenantHintsAllowed() && routing.kind === "serve") {
    const slugSinPistas = resolveTenantSlug(hostname, null, null, false);
    if (routing.slug !== slugSinPistas && (await lookupTenantSlug(routing.slug)) === "unknown") {
      const respuesta = errorResponse(unknownTenantHintPage(routing.slug));
      // `set(..., maxAge: 0)` y no `delete(name)`: la cookie se escribió con
      // `path: "/"` y hay que borrarla con el MISMO path o el navegador la deja
      // viva — que es justo el bug que esta pantalla viene a cerrar.
      respuesta.cookies.set(TENANT_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
      return respuesta;
    }
  }

  // 5. Inyectar el slug como request header — getTenant() resuelve el id real
  //    contra la DB (con fallback), así el middleware nunca bloquea por DB caída.
  request.headers.set(TENANT_SLUG_HEADER, routing.slug);

  // 6. Refrescar la sesión de Supabase (patrón @supabase/ssr) reenviando los
  //    headers ya mutados a los Server Components.
  const response = await updateSession(request);

  // 7. En dev, la pista persiste a cookie para no tener que repetirla en cada
  //    URL. En producción NO se escribe: `resolveTenantSlug` ya la ignora ahí,
  //    así que sería una cookie de 30 días que no hace nada — y la política de
  //    cookies la declara "estrictamente necesaria" por su función. Una cookie
  //    inerte no califica para esa exención, así que no ponerla es tanto lo
  //    correcto técnicamente como lo que sostiene lo que decimos en /legal/cookies.
  //
  //    Se compara contra `routing.slug` (el que de verdad se va a servir): si el
  //    host mandó y ganó la base, la pista no se persiste, porque no se honró.
  if (
    clientTenantHintsAllowed() &&
    hintParam &&
    hintParam === routing.slug &&
    hintParam !== cookieTenant
  ) {
    response.cookies.set(TENANT_COOKIE, routing.slug, {
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
