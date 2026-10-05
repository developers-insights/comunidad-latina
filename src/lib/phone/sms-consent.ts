import { BRAND_NAME } from "@/lib/brand";

/**
 * Twilio compara el texto de la pantalla donde se pide el código con el que
 * declara /legal/sms y con el formulario de la verificación toll-free
 * (docs/twilio-toll-free-reenvio.md). Por eso vive en un solo lugar: si alguno
 * de los tres dice otra cosa, el reenvío vuelve rechazado por 30507.
 */
export const SMS_SENDER_NUMBER = "+1 (844) 727-4049";

export const SMS_SEND_CTA = "Enviar código";

export const SMS_CONSENT_ES = `Al tocar «${SMS_SEND_CTA}» aceptás recibir un SMS con tu código de verificación de ${BRAND_NAME}. Es un mensaje por cada código que pidas. Pueden aplicarse tarifas de mensajes y datos. Respondé STOP para cancelar o HELP para pedir ayuda.`;

export const SMS_CONSENT_EN = `By tapping “${SMS_SEND_CTA}” (Send code) you agree to receive a text message with your ${BRAND_NAME} verification code. One message per code you request. Message and data rates may apply. Reply STOP to opt out or HELP for help.`;

export const SMS_POLICY_HREF = "/legal/sms";

export const WHATSAPP_CONSENT_ES = `Si tu número no es de Estados Unidos ni de Canadá, el código te llega por WhatsApp desde la cuenta verificada de ${BRAND_NAME}, también un mensaje por cada código que pidas.`;

export const WHATSAPP_CONSENT_EN = `If your number is not from the United States or Canada, the code is sent through WhatsApp from the verified ${BRAND_NAME} account, also one message per code you request.`;
