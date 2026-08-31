"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import { esReclamoCodigo, type ReclamoCodigo } from "@/lib/verificacion/identidades";
import { supabaseSinTiparVerificacion } from "@/lib/verificacion/types";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import {
  IDENTITY_SESSION_COOKIE,
  IDENTITY_SESSION_COOKIE_MAX_AGE,
} from "./identity-session";

/** Copy de errores del módulo — cálido, sin jerga técnica. */
const COPY = {
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  errorMuchosIntentos:
    "Hiciste varios intentos de verificación hoy. Esperá hasta mañana y probá de nuevo — tu cuenta queda como está mientras tanto.",
} as const;

/**
 * Rate limit (fiscal R3): cada verificación PROCESADA por Stripe Identity
 * factura (~USD 1.50) — sin tope, un usuario logueado podía crear sesiones y
 * someter documentos sin límite. 3/día alcanza de sobra para reintentos
 * legítimos (foto movida, etc.), y antes de crear una sesión nueva se REUSA
 * la pendiente si sigue esperando input.
 */
const IDENTITY_DAILY_LIMIT = 3;

export type CrearSesionIdentidadResult =
  /** Stripe no configurado (HOY): el cliente abre <ProximamentePremium />. */
  | { status: "no_configurado" }
  /** Sin sesión: el cliente redirige a /entrar. */
  | { status: "sin_sesion" }
  /** Ya tiene el escudo verde — no se crea otra sesión de Stripe. */
  | { status: "ya_verificado" }
  | { status: "error"; message: string }
  /** Sesión creada: el cliente navega a la URL hosteada por Stripe. */
  | { status: "redirect"; url: string };

/**
 * Crea la VerificationSession de Stripe Identity (PLAN §5.4).
 *
 * DISEÑO ANTI-HONEYPOT: el documento se sube y procesa EN STRIPE — jamás
 * pasa por nuestros servidores ni toca nuestra base. Lo único que vuelve
 * (vía webhook `identity.verification_session.verified`) es un sí/no que
 * enciende `profiles.identity_verified`. Sin imagen, sin número de
 * documento, sin nombre legal: no hay dossier que filtrar ni entregar.
 *
 * HOY (Stripe sin configurar): loguea el intento (sin PII) y devuelve
 * `no_configurado` para que la UI degrade elegante (§5.6).
 */
export async function crearSesionIdentidad(): Promise<CrearSesionIdentidadResult> {
  const tenant = await getTenant();

  if (!isStripeConfigured) {
    // Degradación elegante §5.6 — se registra el interés para medir demanda.
    console.info(
      `[identidad] Intento de verificación con Stripe sin configurar — tenant=${tenant.slug}`,
    );
    return { status: "no_configurado" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "sin_sesion" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("identity_verified")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.identity_verified) return { status: "ya_verificado" };

  try {
    const stripe = getStripe();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const cookieStore = await cookies();

    // Reuso (fiscal R3): si esta persona ya abrió una verificación y Stripe
    // sigue esperando su documento, se le devuelve la MISMA URL en vez de
    // crear otra VerificationSession. No consume el cupo diario.
    const existingId = cookieStore.get(IDENTITY_SESSION_COOKIE)?.value;
    if (existingId) {
      try {
        const existing = await stripe.identity.verificationSessions.retrieve(existingId);
        if (existing.status === "requires_input" && existing.url) {
          return { status: "redirect", url: existing.url };
        }
      } catch {
        // Sesión vieja/inválida: se sigue al flujo normal de creación.
      }
    }

    // Rate limit por usuario — recién acá: mirar el perfil o reusar la sesión
    // pendiente no debe quemar intentos.
    if (!limit(`identidad:${user.id}`, IDENTITY_DAILY_LIMIT, DAY_MS).ok) {
      return { status: "error", message: COPY.errorMuchosIntentos };
    }

    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      // user_id + tenant_id: lo ÚNICO que viaja — el webhook lo usa para
      // encender el flag del perfil correcto. Nada de nombre/email/documento.
      metadata: { user_id: user.id, tenant_id: tenant.id },
      return_url: `${siteUrl}/perfil/verificar/resultado`,
    });

    if (!session.url) {
      console.error(
        `[identidad] VerificationSession sin URL — tenant=${tenant.slug}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    // La página de resultado recupera el estado con este id (cookie efímera
    // httpOnly — el id vs_... no es PII ni da acceso al documento).
    cookieStore.set(IDENTITY_SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/perfil/verificar",
      maxAge: IDENTITY_SESSION_COOKIE_MAX_AGE,
    });

    return { status: "redirect", url: session.url };
  } catch (error) {
    // Nunca un error técnico crudo al usuario (§5.6). Log sin PII.
    console.error(
      `[identidad] Error creando VerificationSession — tenant=${tenant.slug}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.errorGenerico };
  }
}


/* ===========================================================================
 * VERIFICAR UN PERFIL DE NEGOCIO — el reclamo (migración 0121)
 * ===========================================================================
 *
 * Pedido del cliente: «según cada perfil, debería de hacerse la verificación de
 * stripe si quieren abrir negocios/empleos/creador».
 *
 * ── ESTO NO ABRE UNA SESIÓN DE STRIPE, Y NO ES UN ATAJO ─────────────────────
 * Stripe Identity verifica el documento de UNA PERSONA; no existe el documento
 * de una panadería. La llave sigue siendo la misma —hay que tener el documento
 * validado— y lo que se evita es pedir la misma foto (y pagarla) diez veces.
 * El detalle está en el encabezado de `src/lib/verificacion/identidades.ts`.
 *
 * ── LA AUTORIZACIÓN NO ESTÁ ACÁ ─────────────────────────────────────────────
 * Está en `public.verificar_identidad_de_negocio()` (0121), que vuelve a exigir
 * rol propietario/administrador y documento validado, corriendo como
 * `security definer` del lado del servidor. Esta función traduce su código a
 * una frase en español y nada más. Si alguien llama a la RPC por PostgREST se
 * topa exactamente con las mismas dos condiciones.
 *
 * ── DEGRADACIÓN SIN STRIPE ──────────────────────────────────────────────────
 * Sin `STRIPE_SECRET_KEY` nadie tiene el documento validado, así que esto
 * devuelve siempre `identidad_personal_pendiente` — que es la verdad, dicha con
 * el camino a seguir. Nunca revienta ni promete lo que no puede dar: es el
 * mismo trato de §5.6 que ya usa `crearSesionIdentidad()` arriba.
 */

const RECLAMO_COPY: Record<ReclamoCodigo, string> = {
  ok: "",
  sin_sesion: "Entrá a tu cuenta para verificar este perfil.",
  sin_permiso:
    "Para verificar este perfil tenés que ser dueño o administrador del negocio.",
  identidad_personal_pendiente:
    "Primero verificá tu identidad personal. Con eso listo, verificás tus negocios en un toque.",
};

const reclamoSchema = z.object({ businessId: z.uuid() });

export type VerificarPerfilResult =
  | { ok: true }
  | { ok: false; mensaje: string; motivo: Exclude<ReclamoCodigo, "ok"> | "error" };

export async function verificarPerfilDeNegocio(
  input: unknown,
): Promise<VerificarPerfilResult> {
  const parsed = reclamoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, motivo: "error", mensaje: COPY.errorGenerico };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      motivo: guard.reason === "unauthenticated" ? "sin_sesion" : "error",
      mensaje:
        guard.reason === "unauthenticated" ? RECLAMO_COPY.sin_sesion : guard.message,
    };
  }

  const { data, error } = await supabaseSinTiparVerificacion(guard.supabase).rpc(
    "verificar_identidad_de_negocio",
    { p_business: parsed.data.businessId },
  );

  if (error) {
    // Log sin PII: ni el negocio ni la persona, sólo el código y la comunidad.
    console.error("[verificacion] no se pudo verificar el perfil de negocio", {
      code: error.code,
      tenant: guard.tenant.slug,
    });
    return { ok: false, motivo: "error", mensaje: COPY.errorGenerico };
  }

  // Un `null` es lo que devuelve PostgREST cuando la función todavía no existe
  // en esa base (0121 sin aplicar). No es permiso ni es éxito: es "no sé".
  if (!esReclamoCodigo(data)) {
    return { ok: false, motivo: "error", mensaje: COPY.errorGenerico };
  }
  if (data !== "ok") {
    return { ok: false, motivo: data, mensaje: RECLAMO_COPY[data] };
  }

  // El estado del perfil se pinta en el cambiador, que vive en el layout: como
  // en `cambiarIdentidad`, revalidar sólo esta pantalla dejaría el resto de la
  // app diciendo que el negocio sigue sin verificar.
  revalidatePath("/", "layout");
  return { ok: true };
}
