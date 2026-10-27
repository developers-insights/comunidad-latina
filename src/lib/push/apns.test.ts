import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { apnsJwt, apnsPayload, apnsConfigFromEnv } = await import("./apns");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config = { keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: "com.comunidadlatina.app", privateKey: pem, production: true };

describe("apnsJwt", () => {
  it("firma un ES256 verificable con kid e iss", () => {
    const jwt = apnsJwt(config, 1_800_000_000);
    const [h, c, sig] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(header).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(claims).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
  });

  it("reusa el token dentro de los 40 minutos", () => {
    const a = apnsJwt(config, 1_900_000_000);
    expect(apnsJwt(config, 1_900_000_000 + 39 * 60)).toBe(a);
    expect(apnsJwt(config, 1_900_000_000 + 41 * 60)).not.toBe(a);
  });
});

describe("apnsPayload", () => {
  it("lleva el href fuera de aps para abrir la pantalla al tocar", () => {
    expect(apnsPayload({ title: "Hola", body: "Mensaje", href: "/mensajes/1", threadId: "mensajes" })).toEqual({
      aps: { alert: { title: "Hola", body: "Mensaje" }, sound: "default", "thread-id": "mensajes" },
      href: "/mensajes/1",
    });
  });
});

describe("apnsConfigFromEnv", () => {
  it("devuelve null si falta algo y normaliza los \n literales", () => {
    vi.stubEnv("APNS_KEY_ID", "");
    expect(apnsConfigFromEnv()).toBeNull();
    vi.stubEnv("APNS_KEY_ID", "K");
    vi.stubEnv("APNS_TEAM_ID", "T");
    vi.stubEnv("APNS_BUNDLE_ID", "B");
    vi.stubEnv("APNS_PRIVATE_KEY", "-----BEGIN-----\nabc\n-----END-----");
    expect(apnsConfigFromEnv()?.privateKey).toBe("-----BEGIN-----\nabc\n-----END-----");
    vi.unstubAllEnvs();
  });
});
