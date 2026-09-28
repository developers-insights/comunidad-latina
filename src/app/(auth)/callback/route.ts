import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { ensureProfileForOAuthUser } from "@/lib/auth/provision";
import { syncEmailVerified } from "@/lib/auth/email-verified";
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
 * ¿La cuenta tiene alguna identidad de un proveedor externo?
 *
 * No alcanza con `app_metadata.provider`: es el proveedor con el que NACIÓ la
 * cuenta. Quien se registró con email y después entra con Google queda
 * vinculado al mismo usuario (vinculación automática de Supabase) y `provider`
 * sigue diciendo "email" — decidir por ese campo salteaba el chequeo de
 * comunidad justo en ese caso.
 */
function hasExternalIdentity(user: User): boolean {
  const meta = user.app_metadata ?? {};
  const providers: unknown[] = Array.isArray(meta.providers) ? meta.providers : [];
  return [meta.provider, ...providers].some(
    (p) => typeof p === "string" && p !== "email" && p !== "phone",
  );
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

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const user = data.user;
      let provisionedNew = false;

      /**
       * Sólo las cuentas con una identidad externa necesitan provisionarse: las
       * de email ya pasaron por `registerAction`. `app_metadata` lo escribe el
       * Auth server, nunca el cliente.
       */
      if (user && hasExternalIdentity(user)) {
        const tenant = await getTenant();
        const provisioned = await ensureProfileForOAuthUser(user, tenant.id);

        if (!provisioned.ok) {
          // Una sesión que no se pudo dejar usable no se deja abierta: sería
          // exactamente el usuario huérfano que este paso existe para evitar.
          await supabase.auth.signOut();
          const reason =
            provisioned.reason === "otro_tenant" ? "otra_comunidad" : "alta";
          return NextResponse.redirect(new URL(`/entrar?error=${reason}`, origin));
        }
        provisionedNew = provisioned.created;

        /**
         * El JWT se emitió ANTES de que existiera `app_metadata.tenant_id`, así
         * que el token que la persona tiene en la mano todavía no lleva el
         * claim — y sin él, cada policy que use `app.current_tenant_id()` la
         * deja afuera. Refrescar la sesión mintea uno nuevo con el claim puesto.
         * Sin esta línea, la primera visita después de crear la cuenta muestra
         * una app vacía y la segunda funciona: el bug más difícil de reproducir
         * de todo el flujo.
         */
        if (provisioned.claimsChanged) {
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) {
            console.error("[auth] callback: refreshSession falló", {
              code: refreshError.code,
            });
          }
        }
      }

      // Google confirma el correo, y la vinculación con una cuenta de email sin
      // confirmar la deja confirmada: sin este espejo `profiles.email_verified`
      // quedaba en false y el gate de creador (0064) era imposible de cumplir.
      if (user) await syncEmailVerified(user);

      // Cuenta recién creada → al onboarding, no al feed. Es donde se
      // completan zona y necesidades, que es lo que hace que el feed tenga
      // algo que mostrar.
      if (provisionedNew) {
        return NextResponse.redirect(new URL("/bienvenida", origin));
      }

      return NextResponse.redirect(new URL(next, origin));
    }

    console.error("[auth] callback: exchangeCodeForSession falló", {
      code: error.code,
    });
  }

  // Enlace vencido o ya usado → de vuelta a /entrar con aviso cálido.
  return NextResponse.redirect(new URL("/entrar?error=enlace", origin));
}
