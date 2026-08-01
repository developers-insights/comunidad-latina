#!/usr/bin/env node
/**
 * probe-email.mjs — Prueba real y repetible del pipeline de Resend (módulo EMAILS).
 *
 * POR QUÉ EXISTE: "la clave responde 200 en /domains" no es lo mismo que "un
 * correo llegó". Este script manda UN correo real y mínimo a la casilla del
 * DUEÑO de la cuenta (self-test — nunca a un tercero) y devuelve el ID que da
 * Resend. Ese ID es la prueba: sin ID no hay envío verificado.
 *
 * No importa nada de src/lib/email — esos módulos son TypeScript con paths
 * `@/...` pensados para el bundler de Next, y este script corre con Node
 * plano (mismo patrón que el resto de scripts/*.mjs: standalone, sin path
 * aliases). Lo que prueba es la cuenta/dominio/API key de Resend end-to-end,
 * que es exactamente la pieza que estaba bloqueada. El primer envío real de
 * `welcomeEmail()` (o el que sea) lo ejercita la app en cuanto un registro
 * real dispare `sendEmailInBackground()`.
 *
 * Uso:
 *   node scripts/probe-email.mjs
 *
 * Requiere en .env.local: RESEND_API_KEY. EMAIL_FROM es opcional — si falta,
 * usa el mismo fallback de marca que src/lib/email/index.ts (getEmailFrom()).
 *
 * NUNCA imprime RESEND_API_KEY. Solo el ID que devuelve la API.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Resend } from "resend";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, ".env.local") });

// Espejo del default de src/lib/email/index.ts (getEmailFrom) — si alguna vez
// se desalinean, que sea a propósito, no por copy-paste desactualizado.
const DEFAULT_FROM = "Comunidad Latina <hola@comunidadlatina.com>";

// Self-test SOLAMENTE. Nunca conviertas esto en un `--to` por CLI: el único
// objetivo de este script es que el dueño de la cuenta compruebe con sus
// propios ojos que el pipeline manda correos de verdad — no es una
// herramienta para mandarle mail a usuarios reales.
const TO = "manuelnavarro@insightsapps.tech";

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function buildProbeEmail() {
  const now = new Date();
  const timestamp = now.toISOString();
  const env = process.env.NEXT_PUBLIC_APP_ENV || "development (local)";
  const version = readPackageVersion();

  const subject = `[Comunidad Latina] Prueba del pipeline de correo — ${timestamp}`;
  const html = `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:32px;background-color:#FCFCFB;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#1C1917;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E7E5E1;border-radius:20px;padding:28px 26px;">
      <tr><td>
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;">Pipeline de correo: en línea</h1>
        <p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#57534E;">
          Si estás leyendo esto, <code>scripts/probe-email.mjs</code> mandó este correo
          real a través de Resend y llegó a tu casilla. La cuenta, el dominio
          verificado y la <code>RESEND_API_KEY</code> local funcionan de punta a punta.
        </p>
        <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#79716B;">
          Enviado: ${timestamp}<br/>
          Entorno (NEXT_PUBLIC_APP_ENV): ${env}<br/>
          Versión: ${version}
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html };
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("Falta RESEND_API_KEY en .env.local — no hay nada que probar.");
    process.exit(1);
  }

  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  const { subject, html } = buildProbeEmail();

  console.log("");
  console.log("  PROBE DE EMAIL · Resend");
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log(`  De:     ${from}`);
  console.log(`  Para:   ${TO}  (self-test — casilla del dueño de la cuenta)`);
  console.log(`  Asunto: ${subject}`);
  console.log("");

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({ from, to: TO, subject, html });

  if (error) {
    console.error(`  ❌ Resend devolvió error: ${error.name} — ${error.message}`);
    console.log("");
    process.exit(1);
  }

  console.log(`  ✅ Enviado — ID de Resend: ${data.id}`);
  console.log("");
  console.log(`  Verificá la entrega en https://resend.com/emails/${data.id}`);
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
