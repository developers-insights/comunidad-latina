import { formatMoney } from "@/lib/utils";
import { REVIEW_WINDOW_HOURS } from "./review-window";

// Cambiar CUALQUIER texto de buildContractText exige subir esta versión: la
// huella que firmó cada parte se calcula sobre el texto, y una firma vieja
// tiene que poder reconstruirse con la plantilla con la que se firmó.
export const CONTRACT_TEMPLATE_VERSION = "2026-09-27";

export const REVISIONS_MIN = 0;
export const REVISIONS_MAX = 5;
export const REVISIONS_DEFAULT = 1;
export const USAGE_RIGHTS_MAX = 120;
export const PROPOSAL_MESSAGE_MAX = 600;

export interface ContractTerms {
  code: string;
  termsVersion: number;
  communityName: string;
  clientName: string;
  creatorName: string;
  title: string;
  scope: string;
  deliveryDays: number;
  revisionsIncluded: number;
  usageRights: string;
  amountCents: number;
  currency: string;
  feePct: number;
  platformFeeCents: number;
  creatorNetCents: number;
}

function money(cents: number, currency: string): string {
  return formatMoney(cents / 100, { currency: currency.toUpperCase() });
}

export function cancellationClauses(): string[] {
  return [
    "Antes de que el negocio pague, cualquiera de las dos partes puede cancelar sin costo.",
    "Después del pago y antes de la primera entrega, el negocio puede cancelar y recibe el reembolso total.",
    "Una vez entregado el trabajo, el contrato ya no se cancela: si hay un problema, se abre una disputa.",
  ];
}

export function buildContractText(t: ContractTerms): string {
  const currency = t.currency.toUpperCase();
  const days = t.deliveryDays === 1 ? "1 día corrido" : `${t.deliveryDays} días corridos`;
  const revisions =
    t.revisionsIncluded === 0
      ? "Este contrato no incluye revisiones: la entrega se aprueba, o se abre una disputa."
      : `Incluye ${t.revisionsIncluded === 1 ? "1 revisión" : `${t.revisionsIncluded} revisiones`} sin costo adicional. Cada revisión se pide dentro del período de revisión de la entrega.`;

  return [
    `CONTRATO DE COLABORACIÓN ${t.code}`,
    `Versión de las condiciones: ${t.termsVersion} · Plantilla ${CONTRACT_TEMPLATE_VERSION}`,
    "",
    "PARTES",
    `Negocio (quien contrata): ${t.clientName}.`,
    `Creador (quien presta el servicio): ${t.creatorName}.`,
    `Se celebra a través de ${t.communityName}, que actúa como plataforma intermediaria y administra el pago protegido.`,
    "",
    "1. SERVICIO",
    t.title,
    t.scope,
    "",
    "2. ENTREGA",
    `El creador entrega el trabajo dentro de los ${days} contados desde que se confirma el pago.`,
    "",
    "3. REVISIONES",
    revisions,
    "",
    "4. DERECHOS DE USO",
    `El negocio puede usar el material entregado para: ${t.usageRights}. Cualquier otro uso requiere un acuerdo nuevo entre las partes.`,
    "",
    "5. PRECIO Y PAGO PROTEGIDO",
    `Monto del trabajo: ${money(t.amountCents, currency)} (${currency}).`,
    `Comisión de la plataforma (${t.feePct}%): ${money(t.platformFeeCents, currency)}.`,
    `El creador recibe: ${money(t.creatorNetCents, currency)}.`,
    "El negocio paga el monto total por adelantado con Stripe y no paga cargos adicionales: el costo de procesamiento sale de la comisión de la plataforma. El dinero queda retenido por la plataforma hasta que se libera al creador.",
    "",
    "6. REVISIÓN DE LA ENTREGA Y LIBERACIÓN DEL PAGO",
    `Después de cada entrega el negocio tiene ${REVIEW_WINDOW_HOURS} horas para aprobarla, pedir una revisión (si quedan disponibles) o abrir una disputa. Si no hace nada en ese plazo, la entrega se considera aprobada y el pago se libera automáticamente al creador.`,
    "",
    "7. CANCELACIÓN",
    ...cancellationClauses(),
    "",
    "8. DISPUTAS",
    `Mientras haya una disputa abierta, el pago queda retenido. El equipo de ${t.communityName} revisa lo registrado en esta colaboración (mensajes, entregas y este contrato) y decide.`,
    "",
    "9. REGISTRO",
    "Las conversaciones, los archivos y las entregas de esta colaboración quedan registrados en la plataforma.",
    "",
    "10. FIRMA ELECTRÓNICA",
    "Las partes aceptan firmar electrónicamente. Cada firma registra el nombre legal, la firma dibujada, la fecha y hora, la dirección IP, el navegador y la huella de este texto. El contrato rige cuando firman las dos partes, y desde ese momento sus condiciones no se pueden modificar.",
  ].join("\n");
}

export function normalizeRevisions(raw: unknown): number | null {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < REVISIONS_MIN || value > REVISIONS_MAX) return null;
  return value;
}

export function normalizeUsageRights(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length < 3 || value.length > USAGE_RIGHTS_MAX) return null;
  return value;
}

const PNG_PREFIX = "data:image/png;base64,";
// Un canvas vacío de 600x200 exportado a PNG pesa ~1–2 KB en base64; un trazo
// real, bastante más. El piso corta el "firmé sin dibujar nada" que el pad no
// haya atajado; el techo, que alguien nos use de almacenamiento.
const SIGNATURE_MIN_CHARS = 300;
export const SIGNATURE_MAX_CHARS = 200_000;

export type SignatureValidation =
  | { ok: true; legalName: string }
  | { ok: false; reason: "name" | "signature" | "consent" };

export function validateSignatureInput(input: {
  legalName: string;
  signaturePng: string;
  accepted: boolean;
}): SignatureValidation {
  const legalName = input.legalName.trim().replace(/\s+/g, " ");
  const words = legalName.split(" ").filter((w) => /\p{L}/u.test(w));
  if (legalName.length < 5 || legalName.length > 120 || words.length < 2) {
    return { ok: false, reason: "name" };
  }
  const png = input.signaturePng;
  if (
    !png.startsWith(PNG_PREFIX) ||
    png.length < SIGNATURE_MIN_CHARS ||
    png.length > SIGNATURE_MAX_CHARS ||
    !/^[A-Za-z0-9+/=]+$/.test(png.slice(PNG_PREFIX.length))
  ) {
    return { ok: false, reason: "signature" };
  }
  if (!input.accepted) return { ok: false, reason: "consent" };
  return { ok: true, legalName };
}
