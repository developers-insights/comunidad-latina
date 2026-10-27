import "server-only";

import { createPrivateKey, sign } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";

/**
 * Cliente mínimo de APNs con autenticación por token (.p8). Sin dependencias:
 * http2 y crypto de Node alcanzan, y una librería de push arrastraría FCM y
 * otras cosas que no usamos.
 *
 * El JWT de APNs dura hasta 60 minutos y Apple rechaza (TooManyProviderTokenUpdates)
 * si se regenera más de una vez cada 20; por eso se cachea 40 minutos por
 * instancia de la función.
 */

export type ApnsConfig = {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKey: string;
  production: boolean;
};

export type ApnsMessage = {
  title: string;
  body?: string | null;
  href?: string | null;
  threadId?: string | null;
};

export type ApnsResult =
  | { ok: true }
  | { ok: false; status: number; reason: string; tokenInvalid: boolean };

export function apnsConfigFromEnv(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const privateKey = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !bundleId || !privateKey) return null;
  return {
    keyId,
    teamId,
    bundleId,
    // En Vercel la clave suele quedar con "\n" literales en vez de saltos.
    privateKey: privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey,
    production: process.env.APNS_ENVIRONMENT !== "development",
  };
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let cachedJwt: { value: string; keyId: string; issuedAt: number } | null = null;

export function apnsJwt(config: ApnsConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (cachedJwt && cachedJwt.keyId === config.keyId && nowSeconds - cachedJwt.issuedAt < 40 * 60) {
    return cachedJwt.value;
  }
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: nowSeconds }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(config.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  const value = `${header}.${claims}.${base64url(signature)}`;
  cachedJwt = { value, keyId: config.keyId, issuedAt: nowSeconds };
  return value;
}

export function apnsPayload(message: ApnsMessage) {
  return {
    aps: {
      alert: { title: message.title, ...(message.body ? { body: message.body } : {}) },
      sound: "default",
      ...(message.threadId ? { "thread-id": message.threadId } : {}),
    },
    ...(message.href ? { href: message.href } : {}),
  };
}

/** Razones con las que Apple dice que el token ya no sirve y hay que borrarlo. */
const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

function sendOne(
  session: ClientHttp2Session,
  config: ApnsConfig,
  token: string,
  payload: string,
): Promise<ApnsResult> {
  return new Promise((resolve) => {
    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${apnsJwt(config)}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      if (status === 200) return resolve({ ok: true });
      let reason = "Unknown";
      try {
        reason = (JSON.parse(body) as { reason?: string }).reason ?? reason;
      } catch {}
      resolve({
        ok: false,
        status,
        reason,
        tokenInvalid: status === 410 || INVALID_TOKEN_REASONS.has(reason),
      });
    });
    request.on("error", (error) =>
      resolve({ ok: false, status: 0, reason: error.message, tokenInvalid: false }),
    );
    request.setTimeout(8000, () => {
      request.close();
      resolve({ ok: false, status: 0, reason: "Timeout", tokenInvalid: false });
    });
    request.end(payload);
  });
}

export async function sendApns(
  config: ApnsConfig,
  tokens: string[],
  message: ApnsMessage,
): Promise<Map<string, ApnsResult>> {
  const results = new Map<string, ApnsResult>();
  if (tokens.length === 0) return results;
  const host = config.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const session = connect(host);
  session.on("error", () => {});
  try {
    const payload = JSON.stringify(apnsPayload(message));
    const settled = await Promise.all(tokens.map((token) => sendOne(session, config, token, payload)));
    tokens.forEach((token, index) => results.set(token, settled[index]));
  } finally {
    session.close();
  }
  return results;
}
