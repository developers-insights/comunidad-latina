import "server-only";

import type { SmsMessage, SmsSender } from "./sms";

const TWILIO_REJECTED_CODES = new Set([21211, 21214, 21610, 21612, 21614]);

function twilioErrorCode(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("code" in value)) return null;

  const { code } = value;
  return typeof code === "number" ? code : null;
}

function logFailure(message: SmsMessage, status?: number, code?: number): void {
  console.error("[sms] Twilio no pudo enviar el SMS", {
    to: message.maskedTo,
    status,
    code,
  });
}

export function createTwilioSender(): SmsSender {
  return {
    name: "twilio",
    async send(message) {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const apiKeySid = process.env.TWILIO_API_KEY_SID;
      const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
      const from = process.env.TWILIO_PHONE_NUMBER;

      if (!accountSid || !apiKeySid || !apiKeySecret || !from) {
        logFailure(message);
        return { ok: false, reason: "proveedor" };
      }

      try {
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: message.to,
              From: from,
              Body: message.body,
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );

        if (response.ok) return { ok: true };

        let code: number | null;
        try {
          code = twilioErrorCode(await response.json());
        } catch {
          logFailure(message, response.status);
          return { ok: false, reason: "proveedor" };
        }

        if (response.status === 400 || response.status === 401 || response.status === 403) {
          logFailure(message, response.status, code ?? undefined);
          return { ok: false, reason: "rechazado" };
        }

        if (code !== null && TWILIO_REJECTED_CODES.has(code)) {
          logFailure(message, response.status, code);
          return { ok: false, reason: "rechazado" };
        }

        logFailure(message, response.status, code ?? undefined);
        return { ok: false, reason: "proveedor" };
      } catch {
        logFailure(message);
        return { ok: false, reason: "proveedor" };
      }
    },
  };
}
