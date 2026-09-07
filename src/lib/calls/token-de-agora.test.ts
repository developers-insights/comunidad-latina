import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del emisor de tokens de Agora.
 *
 * Lo único que protegen —y alcanza— es que el token VENZA CORTO y que se firme
 * con lo que corresponde. Un TTL largo es la diferencia entre "alguien que
 * capturó un token puede escuchar cinco minutos" y "puede escuchar una hora", y
 * es un número que se cambia sin querer al copiar un ejemplo de la documentación
 * (los de Agora usan 3600).
 *
 * ⚠️ NO HAY UNA CREDENCIAL REAL ACÁ. El certificado que se pone en el entorno es
 * la cadena literal `certificado-de-mentira-para-tests`, y el builder está
 * mockeado, así que ni siquiera se calcula un HMAC. Un test de este módulo nunca
 * necesita la credencial de verdad.
 */

const mocks = vi.hoisted(() => ({
  buildTokenWithUserAccount: vi.fn(() => "token-de-mentira"),
}));

vi.mock("agora-token", () => ({
  RtcTokenBuilder: { buildTokenWithUserAccount: mocks.buildTokenWithUserAccount },
  RtcRole: { PUBLISHER: 1, SUBSCRIBER: 2 },
}));

import {
  agoraEstaConfigurado,
  emitirTokenRtc,
  MARGEN_DE_RENOVACION_SEGUNDOS,
  TOKEN_TTL_SEGUNDOS,
} from "./token-de-agora";

const APP_ID = "app-id-publico-de-prueba";
const CERTIFICADO = "certificado-de-mentira-para-tests";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_AGORA_APP_ID = APP_ID;
  process.env.AGORA_APP_CERTIFICATE = CERTIFICADO;
});

describe("TOKEN_TTL_SEGUNDOS", () => {
  it("vence en minutos, no en horas", () => {
    expect(TOKEN_TTL_SEGUNDOS).toBeGreaterThan(0);
    expect(TOKEN_TTL_SEGUNDOS).toBeLessThanOrEqual(600);
  });

  it("deja margen para renovar antes de vencer", () => {
    // Sin esta relación, el aviso de renovación llegaría después del
    // vencimiento y la llamada se cortaría sola a mitad de una frase.
    expect(MARGEN_DE_RENOVACION_SEGUNDOS).toBeLessThan(TOKEN_TTL_SEGUNDOS);
  });
});

describe("emitirTokenRtc", () => {
  it("firma con el canal y el uid que le pasan, como publisher y con el TTL corto", () => {
    const antes = Date.now();
    const emitido = emitirTokenRtc({ canal: "canal-de-la-base", uid: "perfil-123" });

    expect(mocks.buildTokenWithUserAccount).toHaveBeenCalledWith(
      APP_ID,
      CERTIFICADO,
      "canal-de-la-base",
      "perfil-123",
      1, // RtcRole.PUBLISHER
      TOKEN_TTL_SEGUNDOS,
      TOKEN_TTL_SEGUNDOS,
    );

    expect(emitido.token).toBe("token-de-mentira");
    expect(emitido.appId).toBe(APP_ID);
    expect(emitido.expiraEn).toBeGreaterThanOrEqual(antes + TOKEN_TTL_SEGUNDOS * 1000);
    expect(emitido.expiraEn).toBeLessThanOrEqual(Date.now() + TOKEN_TTL_SEGUNDOS * 1000);
  });

  it("no devuelve el certificado en ningún campo", () => {
    const emitido = emitirTokenRtc({ canal: "canal-de-la-base", uid: "perfil-123" });
    expect(JSON.stringify(emitido)).not.toContain(CERTIFICADO);
  });

  it("lanza si falta el certificado en vez de firmar con undefined", () => {
    delete process.env.AGORA_APP_CERTIFICATE;
    expect(() => emitirTokenRtc({ canal: "c", uid: "u" })).toThrow(/Agora no está configurado/);
    expect(mocks.buildTokenWithUserAccount).not.toHaveBeenCalled();
  });
});

describe("agoraEstaConfigurado", () => {
  it("pide las dos mitades: el App ID público y el certificado de servidor", () => {
    expect(agoraEstaConfigurado()).toBe(true);

    delete process.env.AGORA_APP_CERTIFICATE;
    expect(agoraEstaConfigurado()).toBe(false);

    process.env.AGORA_APP_CERTIFICATE = CERTIFICADO;
    delete process.env.NEXT_PUBLIC_AGORA_APP_ID;
    expect(agoraEstaConfigurado()).toBe(false);
  });
});
