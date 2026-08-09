import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { ensureProfileForOAuthUser } from "@/lib/auth/provision";
import { safeInternalPath } from "@/lib/url/safe-href";

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
      return NextResponse.redirect(new URL("/entrar", url.origin));
    }
    console.error("[auth] callback: el proveedor devolvió un error", { reason });
    return NextResponse.redirect(new URL("/entrar?error=proveedor", url.origin));
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const user = data.user;

      /**
       * Sólo las sesiones que vienen de un proveedor externo necesitan
       * provisionarse: las de email ya pasaron por `registerAction`, y las de
       * recuperación de contraseña son de una cuenta que existe desde antes.
       * `app_metadata.provider` lo pone el propio Auth server.
       */
      const provider = user?.app_metadata?.provider;
      if (user && provider && provider !== "email") {
        const tenant = await getTenant();
        const provisioned = await ensureProfileForOAuthUser(user, tenant.id);

        if (!provisioned.ok) {
          // Una sesión que no se pudo dejar usable no se deja abierta: sería
          // exactamente el usuario huérfano que este paso existe para evitar.
          await supabase.auth.signOut();
          const reason =
            provisioned.reason === "otro_tenant" ? "otra_comunidad" : "alta";
          return NextResponse.redirect(new URL(`/entrar?error=${reason}`, url.origin));
        }

        /**
         * El JWT se emitió ANTES de que existiera `app_metadata.tenant_id`, así
         * que el token que la persona tiene en la mano todavía no lleva el
         * claim — y sin él, cada policy que use `app.current_tenant_id()` la
         * deja afuera. Refrescar la sesión mintea uno nuevo con el claim puesto.
         * Sin esta línea, la primera visita después de crear la cuenta muestra
         * una app vacía y la segunda funciona: el bug más difícil de reproducir
         * de todo el flujo.
         */
        if (provisioned.created) await supabase.auth.refreshSession();

        // Cuenta recién creada → al onboarding, no al feed. Es donde se
        // completan zona y necesidades, que es lo que hace que el feed tenga
        // algo que mostrar.
        if (provisioned.created) {
          return NextResponse.redirect(new URL("/bienvenida", url.origin));
        }
      }

      return NextResponse.redirect(new URL(next, url.origin));
    }

    console.error("[auth] callback: exchangeCodeForSession falló", {
      code: error.code,
    });
  }

  // Enlace vencido o ya usado → de vuelta a /entrar con aviso cálido.
  return NextResponse.redirect(new URL("/entrar?error=enlace", url.origin));
}
