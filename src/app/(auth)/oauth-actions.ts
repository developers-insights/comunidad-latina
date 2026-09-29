"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isGoogleAuthConfigured, isAppleAuthConfigured } from "@/lib/config/services";
import { OAUTH_PROVIDERS, type OAuthProvider } from "@/lib/auth/oauth-providers";
import { finalizeOAuthSession, type FinalizeFailure } from "@/lib/auth/finalize-oauth";
import { safeInternalPath } from "@/lib/url/safe-href";
import { resolveOriginAsync } from "./recuperar/origin";

/**
 * Arranque del login con Google / Apple.
 *
 * ── POR QUÉ EN EL SERVIDOR Y NO CON `supabase.auth.signInWithOAuth()` DIRECTO ──
 * `signInWithOAuth` desde el cliente funciona, pero deja el *code verifier* de
 * PKCE en `localStorage` del navegador. Desde el servidor, el cliente de
 * `@supabase/ssr` lo guarda en una cookie httpOnly — el mismo lugar donde ya
 * vive la sesión, y donde un XSS no lo alcanza. Es exactamente la razón por la
 * que el resto de los flujos de auth de este repo pasan por el servidor.
 *
 * Además, acá se puede verificar que el proveedor esté configurado ANTES de
 * mandar a nadie a ninguna parte. Sin esa puerta, un botón contra un proveedor
 * apagado termina en una pantalla de error de Supabase, en inglés y con jerga,
 * que es justo lo que §7 prohíbe.
 *
 * ── EL CONSENTIMIENTO ────────────────────────────────────────────────────────
 * La pantalla declara, junto a los botones, que al continuar se aceptan los
 * Términos, la Privacidad y las Normas y se confirma tener 18 años o más. El
 * sello legal (`terms_accepted_at`, `age_confirmed_at`, `terms_version`) lo
 * escribe `ensureProfileForOAuthUser` al crear el perfil, con el mismo formato
 * que el alta por email — así el registro es idéntico por los dos caminos.
 */

const COPY = {
  unavailable:
    "Esa forma de entrar todavía no está disponible. Podés entrar con tu email y contraseña.",
  genericError:
    "No pudimos abrir la pantalla de ese servicio. Probá de nuevo, o entrá con tu email.",
  sessionMissing:
    "Google no llegó a confirmarnos quién sos. Probá de nuevo, o entrá con tu email y contraseña.",
} as const;

const FINALIZE_COPY: Record<FinalizeFailure, string> = {
  otra_comunidad:
    "Esa cuenta pertenece a otra comunidad. Entrá desde el sitio de esa comunidad, o creá una cuenta nueva acá con otro correo.",
  alta: "No pudimos terminar de crear tu cuenta. No se guardó nada — probá de nuevo en un momento, o sumate con tu email.",
};

const schema = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  /** A dónde aterriza después. Se sanitiza acá: viaja dentro del redirect. */
  next: z.string().optional(),
});

export type StartOAuthInput = z.infer<typeof schema>;

export type StartOAuthResult =
  /** La URL del proveedor. Quien llama tiene que navegar a ella. */
  | { ok: true; url: string }
  | { ok: false; message: string };

/** Qué proveedores tienen credenciales HOY. Lo consume la pantalla de entrada. */
export async function availableOAuthProviders(): Promise<OAuthProvider[]> {
  const available: OAuthProvider[] = [];
  if (isGoogleAuthConfigured) available.push("google");
  if (isAppleAuthConfigured) available.push("apple");
  return available;
}

function isConfigured(provider: OAuthProvider): boolean {
  return provider === "google" ? isGoogleAuthConfigured : isAppleAuthConfigured;
}

export async function startOAuthAction(input: StartOAuthInput): Promise<StartOAuthResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: COPY.genericError };

  const { provider } = parsed.data;

  // Defensa en profundidad: la pantalla ya no dibuja el botón de un proveedor
  // sin credenciales, pero la server action es una URL pública y no confía en
  // que el cliente haya respetado eso.
  if (!isConfigured(provider)) return { ok: false, message: COPY.unavailable };

  const headerStore = await headers();
  const origin = await resolveOriginAsync(headerStore);
  const next = safeInternalPath(parsed.data.next, "/feed");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // El callback ya existente canjea el code por sesión Y provisiona el
      // perfil (ver callback/route.ts). El `next` se re-sanea allá al volver.
      redirectTo: `${origin}/callback?next=${encodeURIComponent(next)}`,
      // `skipBrowserRedirect` no aplica en el servidor: `signInWithOAuth` acá
      // sólo ARMA la URL (no hay `window` que redirigir) y la devuelve. La
      // navegación la hace el cliente con la URL que sale de esta action.
      queryParams:
        provider === "google"
          ? {
              // `select_account` obliga a elegir cuenta en vez de reusar en
              // silencio la última: en un teléfono compartido —que en este
              // público es común— reusar la sesión de Google del hermano es
              // entrar a la comunidad como otra persona.
              prompt: "select_account",
            }
          : undefined,
    },
  });

  if (error || !data?.url) {
    console.error("[auth] oauth: signInWithOAuth falló", { provider, code: error?.code });
    return { ok: false, message: COPY.genericError };
  }

  return { ok: true, url: data.url };
}

/**
 * El client ID de Google para el botón de Google Identity Services. No es un
 * secreto (viaja en cada pedido a Google), pero vive en una env server-side:
 * sin credenciales devuelve `null` y el botón cae al flujo por redirect.
 */
export async function googleIdentityClientId(): Promise<string | null> {
  return isGoogleAuthConfigured ? (process.env.AUTH_GOOGLE_CLIENT_ID ?? null) : null;
}

const finalizeSchema = z.object({ next: z.string().optional() });

export type FinalizeGoogleSignInResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string };

/**
 * Segunda mitad del login con Google Identity Services: el navegador ya hizo
 * `signInWithIdToken` y la sesión está en las cookies. Acá corre EXACTAMENTE lo
 * mismo que en `/callback` (ver `lib/auth/finalize-oauth.ts`).
 */
export async function finalizeGoogleSignInAction(
  input: z.infer<typeof finalizeSchema>,
): Promise<FinalizeGoogleSignInResult> {
  const parsed = finalizeSchema.safeParse(input);
  const next = safeInternalPath(parsed.success ? parsed.data.next : undefined, "/feed");

  const supabase = await createClient();
  // `getUser` y no `getSession`: valida el JWT contra el Auth server en vez de
  // creerle a la cookie.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const { data: sessionData } = await supabase.auth.getSession();
  const user = userData?.user;
  const accessToken = sessionData?.session?.access_token;

  if (userError || !user || !accessToken) {
    console.error("[auth] google gis: no hay sesión para finalizar", { code: userError?.code });
    if (user) await supabase.auth.signOut();
    return { ok: false, message: COPY.sessionMissing };
  }

  const result = await finalizeOAuthSession({ supabase, user, accessToken, next });
  if (!result.ok) return { ok: false, message: FINALIZE_COPY[result.reason] };
  return { ok: true, redirectTo: result.redirectTo };
}
