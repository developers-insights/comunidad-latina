export type OtpChannel = "sms" | "whatsapp";

/**
 * El número toll-free (+1 844 727-4049) está verificado para EE.UU. y Canadá, y
 * un toll-free de EE.UU. no entrega SMS fuera de esos dos países. Pero `+1` NO
 * es "EE.UU. o Canadá": el plan de numeración norteamericano incluye el Caribe,
 * y República Dominicana (809/829/849) es justamente el tenant principal. Esos
 * códigos de área van por WhatsApp, igual que cualquier otro país. Los
 * territorios de EE.UU. (Puerto Rico, Islas Vírgenes, Guam…) también: Twilio
 * no garantiza toll-free ahí y WhatsApp sí llega.
 */
const NANP_FUERA_DE_EEUU_Y_CANADA = new Set([
  "242", "246", "264", "268", "284", "340", "345", "441", "473", "649",
  "658", "664", "670", "671", "684", "721", "758", "767", "784", "787",
  "809", "829", "849", "868", "869", "876", "939",
]);

export function channelFor(e164: string): OtpChannel {
  if (!/^\+1\d{10}$/.test(e164)) return "whatsapp";
  return NANP_FUERA_DE_EEUU_Y_CANADA.has(e164.slice(2, 5)) ? "whatsapp" : "sms";
}
