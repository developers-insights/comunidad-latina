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

export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL).replace(/\/+$/, "");
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
}): { subject: string; html: string } {
  const name = escapeHtml(params.displayName);
  const site = getSiteUrl();
  const content = `
    <h1 style="margin:0 0 12px;font-family:${T.fontStack};font-size:22px;line-height:29px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">
      Bienvenido a tu comunidad, ${name}
    </h1>
    <p style="margin:0 0 8px;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Ya sos parte de ${escapeHtml(params.tenantName)}: un lugar hecho para encontrar
      vivienda sin estafas, conectar con tu gente y moverte con confianza.
    </p>
    <p style="margin:0 0 20px;font-family:${T.fontStack};font-size:15px;line-height:23px;color:${T.inkSoft};">
      Por acá podés empezar:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${linkRow(`${site}/propiedades`, "Buscá vivienda verificada", "Avisos con Trust Score y protección anti-estafa.")}
      ${linkRow(`${site}/escudo`, "Escudo Anti-Estafa", "Verificá a quien te ofrece algo antes de mover un peso.")}
      ${linkRow(`${site}/feed`, "Pasá por el feed", "Lo que está pasando en tu comunidad, hoy.")}
    </table>
    ${ctaButton(`${site}/feed`, "Entrar a la comunidad", params.brandHex)}`;
  return {
    subject: `Bienvenido a ${params.tenantName} — tu comunidad te espera`,
    html: baseLayout(
      { tenantName: params.tenantName, brandHex: params.brandHex },
      "Ya sos parte. Vivienda verificada, Escudo Anti-Estafa y tu gente, en un solo lugar.",
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
}): { subject: string; html: string } {
  const title = escapeHtml(params.listingTitle);
  const requester = escapeHtml(params.requesterDisplayName);
  const site = getSiteUrl();
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
}): { subject: string; html: string } {
  const sender = escapeHtml(params.senderDisplayName);
  const site = getSiteUrl();
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
