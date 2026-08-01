import "server-only";

/**
 * =============================================================================
 * TEMPLATES DE EMAIL — HTML inline-styles premium (sin react-email)
 * =============================================================================
 *
 * Cada template es una función pura que devuelve un string HTML completo,
 * con los tokens de marca del design system (§5 de ARQUITECTURA.md):
 * neutros cálidos, radios generosos, CTA con el brand color del tenant,
 * targets ≥44px, tipografía system-safe (los email clients no cargan fuentes).
 *
 * Privacidad / minimización (§11 anti-honeypot):
 *   - lead-recibido: SOLO el display_name del interesado, nada más.
 *   - mensaje-nuevo: JAMÁS el contenido del mensaje — solo quién escribió + CTA.
 * Todo string que venga de usuarios pasa por escapeHtml().
 */

// --- Tokens (espejo de globals.css para contexto email) ----------------------
const T = {
  bgPage: "#FCFCFB", // neutro cálido más claro
  bgCard: "#FFFFFF",
  ink: "#1C1917", // texto principal cálido
  inkSoft: "#57534E", // texto secundario
  inkFaint: "#79716B", // footer / disclaimers
  border: "#E7E5E1",
  radiusCard: "20px",
  radiusButton: "12px",
  fontStack:
    "'Plus Jakarta Sans', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif",
} as const;

const DEFAULT_SITE_URL = "http://localhost:3000";

/**
 * Resuelve la URL base para los links del correo — dev / preview / producción
 * SIN pisar nada a mano por entorno.
 *
 * Bug real que esto arregla: `NEXT_PUBLIC_SITE_URL` puede quedar en
 * `http://localhost:3000` incluso en un deploy real de Vercel (se copió el
 * default de `.env.local` sin pisarlo, o preview nunca lo tuvo) — confiar
 * ciegamente en esa env var manda un link muerto dentro del correo.
 *
 * Orden:
 *  1. En Vercel (`VERCEL_ENV` existe): SIEMPRE la URL que calcula la
 *     plataforma sola — `VERCEL_PROJECT_PRODUCTION_URL` en producción (seguí
 *     el dominio custom más corto en cuanto haya uno atado, sin tocar
 *     código) o `VERCEL_URL` (el host único de ESTE deploy) en
 *     preview/development-on-Vercel. Nunca depende de que alguien haya
 *     seteado bien `NEXT_PUBLIC_SITE_URL` a mano en el dashboard.
 *  2. Fuera de Vercel: `NEXT_PUBLIC_SITE_URL` si está seteada (dev local con
 *     un valor propio, o cualquier host que no sea Vercel).
 *  3. Nada de lo anterior: localhost (dev local puro, sin `.env.local`).
 *
 * ⚠️ Multi-tenant: esto es un fallback GLOBAL por deploy — no distingue
 * dominicanos.com de comunidadlatina.com si el día de mañana ambos son
 * dominios de producción del mismo proyecto Vercel (`VERCEL_PROJECT_PRODUCTION_URL`
 * solo puede reflejar uno). Para ese caso cada template acepta `siteUrl`
 * explícito — el caller debería pasar el origin exacto de la request (ver
 * `resolveOrigin()` en `src/app/(auth)/recuperar/origin.ts`, que ya arma el
 * origin correcto a partir de `x-forwarded-host`) en vez de confiar en este
 * default global.
 */
function computeSiteUrl(): string {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (vercelEnv && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  return DEFAULT_SITE_URL;
}

export function getSiteUrl(): string {
  return computeSiteUrl();
}

/** Escapa contenido user-generated antes de interpolarlo en HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type BrandContext = {
  /** Nombre del tenant (ej. "Dominicanos"). */
  tenantName: string;
  /** Color de marca del tenant — SOLO para el CTA primario y acentos. */
  brandHex: string;
};

function ctaButton(href: string, label: string, brandHex: string): string {
  // Altura ≥44px vía padding — target táctil premium también en email.
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
      <tr>
        <td style="border-radius:${T.radiusButton};background-color:${brandHex};">
          <a href="${href}"
             style="display:inline-block;padding:14px 28px;min-height:16px;font-family:${T.fontStack};font-size:15px;font-weight:600;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:${T.radiusButton};">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

function linkRow(href: string, title: string, description: string): string {
  return `
    <tr>
      <td style="padding:14px 18px;border:1px solid ${T.border};border-radius:14px;background-color:${T.bgCard};">
        <a href="${href}" style="text-decoration:none;display:block;">
          <span style="display:block;font-family:${T.fontStack};font-size:15px;font-weight:600;color:${T.ink};">${title}</span>
          <span style="display:block;margin-top:2px;font-family:${T.fontStack};font-size:13px;line-height:19px;color:${T.inkSoft};">${description}</span>
        </a>
      </td>
    </tr>
    <tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>`;
}

/**
 * Layout base: página cálida + tarjeta central estilo BezelCard (doble borde
 * suave), header con el nombre del tenant, footer con disclaimer de privacidad.
 */
function baseLayout(brand: BrandContext, preheader: string, content: string): string {
  const tenantName = escapeHtml(brand.tenantName);
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${tenantName}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${T.bgPage};">
    <!-- preheader oculto -->
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${T.bgPage};">
      <tr>
        <td align="center" style="padding:32px 16px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
            <!-- header -->
            <tr>
              <td style="padding:0 6px 18px;">
                <span style="font-family:${T.fontStack};font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">${tenantName}</span>
              </td>
            </tr>
            <!-- tarjeta (double-bezel suave) -->
            <tr>
              <td style="background-color:${T.bgCard};border:1px solid ${T.border};border-radius:${T.radiusCard};padding:6px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:16px;padding:28px 26px 26px;">
                      ${content}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- footer -->
            <tr>
              <td style="padding:20px 6px 0;">
                <p style="margin:0;font-family:${T.fontStack};font-size:12px;line-height:18px;color:${T.inkFaint};">
                  Recibiste este email porque tenés una cuenta en ${tenantName}.
                  Por tu seguridad, nunca compartimos tu email, tu teléfono ni tu dirección con nadie —
                  y nunca te vamos a pedir dinero por email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// -----------------------------------------------------------------------------
// (a) Bienvenida — tras el registro
// -----------------------------------------------------------------------------

export function welcomeEmail(params: {
  displayName: string;
  tenantName: string;
  brandHex: string;
  /** Origin exacto ya resuelto por el caller (ver resolveOrigin en
   * recuperar/origin.ts) — precisión multi-tenant. Si se omite, cae al
   * fallback de getSiteUrl(). */
  siteUrl?: string;
}): { subject: string; html: string } {
  const name = escapeHtml(params.displayName);
  const site = params.siteUrl?.trim().replace(/\/+$/, "") || getSiteUrl();
  const content = `
    <h1 style="margin:0 0 12px;font-family:${T.fontStack};font-size:22px;line-height:29px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">
      Bienvenido a tu comunidad, ${name}
    </h1>
    <p style="margin:0 0 8px;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Ya sos parte de ${escapeHtml(params.tenantName)}: un lugar hecho para encontrar
      vivienda verificada, conectar con tu gente y moverte con confianza.
    </p>
    <p style="margin:0 0 20px;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Por acá podés empezar:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${linkRow(`${site}/propiedades`, "Buscá vivienda verificada", "Avisos con Trust Score y verificación de la comunidad.")}
      ${linkRow(`${site}/feed`, "Pasá por el feed", "Lo que está pasando en tu comunidad, hoy.")}
    </table>
    ${ctaButton(`${site}/feed`, "Entrar a la comunidad", params.brandHex)}`;
  return {
    subject: `Bienvenido a ${params.tenantName} — tu comunidad te espera`,
    html: baseLayout(
      { tenantName: params.tenantName, brandHex: params.brandHex },
      "Ya sos parte. Vivienda verificada y tu gente, en un solo lugar.",
      content,
    ),
  };
}

// -----------------------------------------------------------------------------
// (b) Lead recibido — al dueño del listing cuando alguien pide contacto.
// Minimización: del interesado va SOLO su display_name. Nada más.
// -----------------------------------------------------------------------------

export function leadReceivedEmail(params: {
  listingTitle: string;
  requesterDisplayName: string;
  tenantName: string;
  brandHex: string;
  /** Ver nota en welcomeEmail(). */
  siteUrl?: string;
}): { subject: string; html: string } {
  const title = escapeHtml(params.listingTitle);
  const requester = escapeHtml(params.requesterDisplayName);
  const site = params.siteUrl?.trim().replace(/\/+$/, "") || getSiteUrl();
  const content = `
    <h1 style="margin:0 0 12px;font-family:${T.fontStack};font-size:22px;line-height:29px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">
      ${requester} quiere contactarte
    </h1>
    <p style="margin:0 0 8px;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Alguien está interesado en tu aviso:
    </p>
    <p style="margin:0 0 16px;padding:14px 18px;border:1px solid ${T.border};border-radius:14px;font-family:${T.fontStack};font-size:15px;font-weight:600;line-height:22px;color:${T.ink};background-color:${T.bgPage};">
      ${title}
    </p>
    <p style="margin:0;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Entrá a Mensajes para aceptar o ignorar la solicitud. La conversación queda
      dentro de la plataforma, protegida para los dos.
    </p>
    ${ctaButton(`${site}/mensajes`, "Ver la solicitud", params.brandHex)}`;
  return {
    subject: `${params.requesterDisplayName} quiere contactarte por tu aviso`,
    html: baseLayout(
      { tenantName: params.tenantName, brandHex: params.brandHex },
      "Tenés una solicitud de contacto nueva por tu aviso.",
      content,
    ),
  };
}

// -----------------------------------------------------------------------------
// (c) Mensaje nuevo — SIN el contenido del mensaje (privacidad).
// -----------------------------------------------------------------------------

export function newMessageEmail(params: {
  senderDisplayName: string;
  conversationId: string;
  tenantName: string;
  brandHex: string;
  /** Ver nota en welcomeEmail(). */
  siteUrl?: string;
}): { subject: string; html: string } {
  const sender = escapeHtml(params.senderDisplayName);
  const site = params.siteUrl?.trim().replace(/\/+$/, "") || getSiteUrl();
  const href = `${site}/mensajes/${encodeURIComponent(params.conversationId)}`;
  const content = `
    <h1 style="margin:0 0 12px;font-family:${T.fontStack};font-size:22px;line-height:29px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">
      Tenés un mensaje nuevo de ${sender}
    </h1>
    <p style="margin:0;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Por tu privacidad no incluimos el contenido acá — abrí la conversación
      para leerlo y responder cuando quieras.
    </p>
    ${ctaButton(href, "Abrir la conversación", params.brandHex)}`;
  return {
    subject: `${params.senderDisplayName} te escribió en ${params.tenantName}`,
    html: baseLayout(
      { tenantName: params.tenantName, brandHex: params.brandHex },
      "Tenés un mensaje nuevo esperándote.",
      content,
    ),
  };
}

// -----------------------------------------------------------------------------
// (d) Postulación recibida — a quien publicó el aviso de empleo.
// Minimización (espejo de leadReceivedEmail): del postulante va SOLO su
// display_name. Ni las respuestas del formulario ni su nota viajan por mail.
// -----------------------------------------------------------------------------

export function applicationReceivedEmail(params: {
  jobId: string;
  jobTitle: string;
  applicantDisplayName: string;
  tenantName: string;
  brandHex: string;
  /** Ver nota en welcomeEmail(). */
  siteUrl?: string;
}): { subject: string; html: string } {
  const title = escapeHtml(params.jobTitle);
  const applicant = escapeHtml(params.applicantDisplayName);
  const site = params.siteUrl?.trim().replace(/\/+$/, "") || getSiteUrl();
  const href = `${site}/empleos/${encodeURIComponent(params.jobId)}`;
  const content = `
    <h1 style="margin:0 0 12px;font-family:${T.fontStack};font-size:22px;line-height:29px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">
      ${applicant} se postuló a tu aviso
    </h1>
    <p style="margin:0 0 8px;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Alguien de la comunidad quiere el puesto:
    </p>
    <p style="margin:0 0 16px;padding:14px 18px;border:1px solid ${T.border};border-radius:14px;font-family:${T.fontStack};font-size:15px;font-weight:600;line-height:22px;color:${T.ink};background-color:${T.bgPage};">
      ${title}
    </p>
    <p style="margin:0;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Entrá al aviso para leer sus respuestas y decidir si la aceptás. Todo
      queda dentro de la plataforma, protegido para los dos.
    </p>
    ${ctaButton(href, "Ver la postulación", params.brandHex)}`;
  return {
    subject: `${params.applicantDisplayName} se postuló a "${params.jobTitle}"`,
    html: baseLayout(
      { tenantName: params.tenantName, brandHex: params.brandHex },
      "Tenés una postulación nueva en tu aviso de empleo.",
      content,
    ),
  };
}

// -----------------------------------------------------------------------------
// (e) Confirmación de cuenta — envuelve un link de verificación YA armado y
// firmado por Supabase Auth Admin API (`generateLink({ type: "signup", ... })`).
//
// Este template NO arma ni firma tokens — eso es responsabilidad de auth, no
// de emails. Es del caller resolver `confirmUrl` antes de llamar acá: hoy lo
// hace `sendConfirmationEmail` (src/lib/auth/confirmation.ts), que mintea el
// `hashed_token` con la Admin API y lo apunta a la ruta /confirmar.
// -----------------------------------------------------------------------------

export function confirmAccountEmail(params: {
  displayName: string;
  /** Link de confirmación absoluto, ya armado (admin.generateLink → action_link
   * o un token_hash propio servido por una ruta /auth/confirm). */
  confirmUrl: string;
  tenantName: string;
  brandHex: string;
}): { subject: string; html: string } {
  // El nombre puede faltar (reenvío desde /entrar, donde solo hay email): sin
  // él el saludo va sin coma, jamás "Confirmá tu cuenta, " colgando.
  const name = escapeHtml(params.displayName.trim());
  const content = `
    <h1 style="margin:0 0 12px;font-family:${T.fontStack};font-size:22px;line-height:29px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">
      ${name ? `Confirmá tu cuenta, ${name}` : "Confirmá tu cuenta"}
    </h1>
    <p style="margin:0 0 20px;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Ya casi estás. Tocá el botón para confirmar tu email y activar tu cuenta
      en ${escapeHtml(params.tenantName)}.
    </p>
    ${ctaButton(params.confirmUrl, "Confirmar mi cuenta", params.brandHex)}
    <p style="margin:20px 0 0;font-family:${T.fontStack};font-size:13px;line-height:20px;color:${T.inkFaint};">
      Si vos no pediste esto, ignorá este correo — no se activa ninguna cuenta
      sin que toques el botón.
    </p>`;
  return {
    subject: `Confirmá tu cuenta en ${params.tenantName}`,
    html: baseLayout(
      { tenantName: params.tenantName, brandHex: params.brandHex },
      "Un paso más: confirmá tu email para activar tu cuenta.",
      content,
    ),
  };
}
