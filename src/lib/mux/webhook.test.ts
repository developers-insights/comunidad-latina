import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { MUX_SIGNATURE_TOLERANCE_MS, verifyMuxSignature } from "./webhook";

/**
 * Tests de la verificación de firma del webhook de Mux.
 *
 * Esta función es la ÚNICA autorización de `/api/mux/webhook`: no hay sesión, no
 * hay cookie, y del otro lado hay un handler que escribe con service_role. Si
 * acepta de más, cualquiera mueve el estado de cualquier video; si acepta de
 * menos, los videos se quedan en "procesando" para siempre.
 *
 * ── EL VECTOR FIJO NO ES DECORACIÓN ─────────────────────────────────────────
 * El primer test compara contra un HMAC ESCRITO A MANO, no contra uno calculado
 * por el propio test. Un test que arma la firma con el mismo `createHmac` que la
 * implementación pasa igual si los dos se equivocan en lo mismo (el separador,
 * el orden `timestamp.body`, la codificación). El vector fijo ancla el algoritmo
 * documentado por Mux: `HMAC-SHA256(secreto, "<t>.<body crudo>")` en hex.
 */

const SECRETO = "secreto-de-prueba";
const TIMESTAMP = 1_700_000_000;
const AHORA_MS = TIMESTAMP * 1000;
const BODY = '{"type":"video.asset.ready","id":"evt_1"}';
/** Calculado aparte, fuera de la implementación. Ver la nota de arriba. */
const V1_ESPERADA = "93a8055d705f156eedec7b3361379fc7c3f3b88dc956f02969c07bd0f2712587";

function firmar(body: string, timestamp = TIMESTAMP, secreto = SECRETO): string {
  const v1 = crypto.createHmac("sha256", secreto).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

describe("verifyMuxSignature", () => {
  it("acepta la firma del vector fijo (algoritmo documentado por Mux)", () => {
    const resultado = verifyMuxSignature(
      BODY,
      `t=${TIMESTAMP},v1=${V1_ESPERADA}`,
      SECRETO,
      { nowMs: AHORA_MS },
    );
    expect(resultado).toEqual({ ok: true, timestampMs: AHORA_MS });
  });

  it("rechaza si falta el header por completo", () => {
    for (const ausente of [null, undefined, ""]) {
      expect(verifyMuxSignature(BODY, ausente, SECRETO, { nowMs: AHORA_MS })).toEqual({
        ok: false,
        reason: "sin_firma",
      });
    }
  });

  it("rechaza si no hay secreto configurado — fail-closed, nunca 'entonces lo acepto'", () => {
    expect(verifyMuxSignature(BODY, firmar(BODY), undefined, { nowMs: AHORA_MS })).toEqual({
      ok: false,
      reason: "sin_secreto",
    });
  });

  it("rechaza una firma que no corresponde al body", () => {
    // Firma legítima, body distinto: es el caso de un payload manipulado en vuelo.
    const resultado = verifyMuxSignature(
      '{"type":"video.asset.ready","id":"evt_INTRUSO"}',
      firmar(BODY),
      SECRETO,
      { nowMs: AHORA_MS },
    );
    expect(resultado).toEqual({ ok: false, reason: "firma_invalida" });
  });

  it("rechaza una firma hecha con otro secreto", () => {
    const resultado = verifyMuxSignature(
      BODY,
      firmar(BODY, TIMESTAMP, "otro-secreto"),
      SECRETO,
      { nowMs: AHORA_MS },
    );
    expect(resultado).toEqual({ ok: false, reason: "firma_invalida" });
  });

  it("rechaza headers mal formados sin lanzar", () => {
    const malos = [
      "",                                   // vacío → se lee como "sin firma"
      "no-tiene-nada-que-ver",              // sin pares clave=valor
      `v1=${V1_ESPERADA}`,                  // sin timestamp
      `t=${TIMESTAMP}`,                     // sin firma
      `t=hoy,v1=${V1_ESPERADA}`,            // timestamp no numérico
      `t=,v1=${V1_ESPERADA}`,               // timestamp vacío: Number("") es 0, no vale
      `t=${TIMESTAMP}0000000000,v1=${V1_ESPERADA}`, // timestamp absurdo → vencida
    ];
    for (const header of malos) {
      const resultado = verifyMuxSignature(BODY, header, SECRETO, { nowMs: AHORA_MS });
      expect(resultado.ok, `header: ${header}`).toBe(false);
    }
  });

  /**
   * El caso que rompe la implementación ingenua: `crypto.timingSafeEqual` LANZA
   * `RangeError` si los buffers miden distinto. Sin el filtro de formato, un
   * `v1=chau` convierte un 401 prolijo en un 500 con stack trace.
   */
  it("rechaza —sin lanzar— una v1 que no es hex de 64 caracteres", () => {
    const basura = [
      "chau",
      "ZZ".repeat(32),                        // largo correcto, no es hex
      V1_ESPERADA.slice(0, 63),               // un carácter de menos
      `${V1_ESPERADA}00`,                     // dos de más
    ];
    for (const v1 of basura) {
      expect(() =>
        verifyMuxSignature(BODY, `t=${TIMESTAMP},v1=${v1}`, SECRETO, { nowMs: AHORA_MS }),
      ).not.toThrow();
      expect(
        verifyMuxSignature(BODY, `t=${TIMESTAMP},v1=${v1}`, SECRETO, { nowMs: AHORA_MS }),
      ).toEqual({ ok: false, reason: "firma_invalida" });
    }
  });

  describe("tolerancia de reloj", () => {
    it("acepta justo dentro de la ventana, para los dos lados", () => {
      const casiVencida = AHORA_MS + MUX_SIGNATURE_TOLERANCE_MS - 1_000;
      const casiFutura = AHORA_MS - MUX_SIGNATURE_TOLERANCE_MS + 1_000;
      expect(verifyMuxSignature(BODY, firmar(BODY), SECRETO, { nowMs: casiVencida }).ok).toBe(true);
      expect(verifyMuxSignature(BODY, firmar(BODY), SECRETO, { nowMs: casiFutura }).ok).toBe(true);
    });

    it("rechaza una firma vieja — el replay de una entrega capturada", () => {
      const muyDespues = AHORA_MS + MUX_SIGNATURE_TOLERANCE_MS + 1_000;
      expect(verifyMuxSignature(BODY, firmar(BODY), SECRETO, { nowMs: muyDespues })).toEqual({
        ok: false,
        reason: "firma_vencida",
      });
    });

    /**
     * Mirar sólo el pasado dejaría pasar una firma fabricada con el reloj
     * adelantado, que serviría durante meses. Por eso la comparación es en valor
     * absoluto y este test existe.
     */
    it("rechaza una firma con timestamp en el futuro", () => {
      const muyAntes = AHORA_MS - MUX_SIGNATURE_TOLERANCE_MS - 1_000;
      expect(verifyMuxSignature(BODY, firmar(BODY), SECRETO, { nowMs: muyAntes })).toEqual({
        ok: false,
        reason: "firma_vencida",
      });
    });
  });

  /**
   * Durante una rotación de secreto Mux firma la misma entrega con el viejo y
   * con el nuevo. Aceptar sólo el primer `v1` haría que la rotación cortara el
   * servicio hasta que el deploy con la clave nueva estuviera arriba.
   */
  it("acepta cuando una de varias v1 cierra (rotación de secreto)", () => {
    const header = `t=${TIMESTAMP},v1=${"a".repeat(64)},v1=${V1_ESPERADA}`;
    expect(verifyMuxSignature(BODY, header, SECRETO, { nowMs: AHORA_MS }).ok).toBe(true);
  });

  it("rechaza cuando ninguna de varias v1 cierra", () => {
    const header = `t=${TIMESTAMP},v1=${"a".repeat(64)},v1=${"b".repeat(64)}`;
    expect(verifyMuxSignature(BODY, header, SECRETO, { nowMs: AHORA_MS })).toEqual({
      ok: false,
      reason: "firma_invalida",
    });
  });

  it("no se confunde con espacios ni con pares desconocidos en el header", () => {
    const header = ` t=${TIMESTAMP} , v1=${V1_ESPERADA} , futuro=algo `;
    expect(verifyMuxSignature(BODY, header, SECRETO, { nowMs: AHORA_MS }).ok).toBe(true);
  });
});
