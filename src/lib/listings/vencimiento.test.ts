import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CLOSED_REASONS,
  DEFAULT_EXPIRY_CONFIG,
  MOTIVOS_NO_RENOVABLE,
  calcularVencimiento,
  closedReasonForKind,
  diasHasta,
  estadoDeVencimiento,
  isClosedReason,
  isMotivoNoRenovable,
  kindVence,
  parseExpiryConfig,
  puedeRenovar,
  type ExpiryConfig,
  type PublicacionVencible,
} from "./vencimiento";

/**
 * La app y la base tienen que decir lo MISMO. Si estos números se separan de la
 * migración, la pantalla promete un plazo y el cron aplica otro — y el bug se
 * ve recién cuando a alguien se le cae una publicación antes de tiempo. Por eso
 * el test lee la migración, igual que hace `categories.test.ts` con 0045.
 */
const MIGRACION = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/0098_vencimiento_de_publicaciones.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

/**
 * El sexto motivo —`necesita_confirmar_disponibilidad`— lo agregó la 0117 y
 * vive SÓLO ahí: 0098 nunca lo va a tener (ver la cabecera de 0117, sección
 * "ESPEJO EN TYPESCRIPT"). Se lee aparte para poder verificar cada motivo
 * contra SU migración y no contra "alguna de las dos".
 */
const MIGRACION_0117 = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/0117_cierre_y_reconfirmacion.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const AHORA = new Date("2026-08-13T12:00:00.000Z");
const DIA_MS = 86_400_000;

function enDias(dias: number): string {
  return new Date(AHORA.getTime() + dias * DIA_MS).toISOString();
}

/** Una publicación publicada a la que le faltan `dias` para vencer. */
function publicada(dias: number, extra: Partial<PublicacionVencible> = {}): PublicacionVencible {
  return {
    status: "published",
    kind: "property",
    expiresAt: enDias(dias),
    warnAt: enDias(dias - DEFAULT_EXPIRY_CONFIG.diasDeAviso),
    renewalCount: 0,
    ...extra,
  };
}

describe("los defaults espejan la migración 0098", () => {
  it("30 días de vigencia y 3 de aviso, como el pedido del cliente", () => {
    expect(DEFAULT_EXPIRY_CONFIG.diasDeVigencia).toBe(30);
    expect(DEFAULT_EXPIRY_CONFIG.diasDeAviso).toBe(3);
    expect(MIGRACION).toContain("dias_de_vigencia     int not null default 30");
    expect(MIGRACION).toContain("dias_de_aviso        int not null default 3");
  });

  it("sin tope de renovaciones por default", () => {
    expect(DEFAULT_EXPIRY_CONFIG.renovacionesMaximas).toBeNull();
  });

  it("los seis kinds que vencen son los mismos que el default de la columna", () => {
    expect([...DEFAULT_EXPIRY_CONFIG.kindsQueVencen].sort()).toEqual([
      "creator_gig",
      "event",
      "job",
      "lost_found",
      "product",
      "property",
    ]);
    expect(MIGRACION).toContain(
      "array['property','event','job','product','creator_gig','lost_found']",
    );
  });

  it("negocios y profesionales NO vencen: son presencia, no avisos", () => {
    expect(kindVence("business", DEFAULT_EXPIRY_CONFIG)).toBe(false);
    expect(kindVence("professional", DEFAULT_EXPIRY_CONFIG)).toBe(false);
    expect(kindVence("property", DEFAULT_EXPIRY_CONFIG)).toBe(true);
  });

  it("el estado 'expired' existe en el CHECK de la base", () => {
    expect(MIGRACION).toContain("'expired'");
  });
});

describe("parseExpiryConfig", () => {
  it("sin fila devuelve los defaults (la ausencia ES la configuración)", () => {
    expect(parseExpiryConfig(null)).toEqual(DEFAULT_EXPIRY_CONFIG);
    expect(parseExpiryConfig(undefined)).toEqual(DEFAULT_EXPIRY_CONFIG);
  });

  it("lee una fila completa", () => {
    expect(
      parseExpiryConfig({
        dias_de_vigencia: 45,
        dias_de_aviso: 7,
        renovaciones_maximas: 3,
        kinds_que_vencen: ["property", "job"],
      }),
    ).toEqual({
      diasDeVigencia: 45,
      diasDeAviso: 7,
      renovacionesMaximas: 3,
      kindsQueVencen: ["property", "job"],
    });
  });

  it("un aviso que no entra antes del vencimiento se descarta", () => {
    // El CHECK de la base lo impide; si igual llegara, una ventana de aviso más
    // larga que la vigencia haría "renovable" todo desde el día 1.
    const cfg = parseExpiryConfig({ dias_de_vigencia: 5, dias_de_aviso: 9 });
    expect(cfg.diasDeAviso).toBe(DEFAULT_EXPIRY_CONFIG.diasDeAviso);
  });

  it("descarta kinds inventados y nunca lanza con basura", () => {
    expect(
      parseExpiryConfig({ kinds_que_vencen: ["property", "propiedad", 7] }).kindsQueVencen,
    ).toEqual(["property"]);
    expect(parseExpiryConfig({ dias_de_vigencia: "treinta" })).toEqual(
      DEFAULT_EXPIRY_CONFIG,
    );
  });

  it("renovaciones_maximas 0 es un tope real, no 'sin tope'", () => {
    // 0 significa "no se puede renovar ninguna vez". Confundirlo con null
    // (sin tope) sería exactamente el bug contrario al que quiso el admin.
    expect(parseExpiryConfig({ renovaciones_maximas: 0 }).renovacionesMaximas).toBe(0);
    expect(parseExpiryConfig({ renovaciones_maximas: null }).renovacionesMaximas).toBeNull();
  });
});

describe("calcularVencimiento", () => {
  it("vence a los 30 días y avisa 3 antes", () => {
    const { expiresAt, warnAt } = calcularVencimiento(
      AHORA,
      "property",
      DEFAULT_EXPIRY_CONFIG,
    );
    expect(expiresAt?.toISOString()).toBe(enDias(30));
    expect(warnAt?.toISOString()).toBe(enDias(27));
  });

  it("un kind que no vence no tiene fechas (queda fuera de los índices del cron)", () => {
    expect(calcularVencimiento(AHORA, "business", DEFAULT_EXPIRY_CONFIG)).toEqual({
      expiresAt: null,
      warnAt: null,
    });
  });
});

describe("diasHasta redondea a favor de quien lee", () => {
  it("30 horas son 2 días, no 1", () => {
    expect(diasHasta(new Date(AHORA.getTime() + 30 * 3_600_000), AHORA)).toBe(2);
  });

  it("nunca devuelve negativos", () => {
    expect(diasHasta(new Date(AHORA.getTime() - 5 * DIA_MS), AHORA)).toBe(0);
  });
});

describe("estadoDeVencimiento", () => {
  it("con tiempo de sobra está vigente", () => {
    expect(estadoDeVencimiento(publicada(20), DEFAULT_EXPIRY_CONFIG, AHORA)).toEqual({
      estado: "vigente",
      diasRestantes: 20,
      expiresAt: new Date(enDias(20)),
    });
  });

  it("dentro de la ventana de aviso pasa a por_vencer", () => {
    const estado = estadoDeVencimiento(publicada(2), DEFAULT_EXPIRY_CONFIG, AHORA);
    expect(estado.estado).toBe("por_vencer");
  });

  it("status expired es 'vencida', sin importar las fechas", () => {
    expect(
      estadoDeVencimiento({ ...publicada(-4), status: "expired" }, DEFAULT_EXPIRY_CONFIG, AHORA),
    ).toEqual({ estado: "vencida" });
  });

  it("un borrador, una pausada o una cerrada no hablan de vencimiento", () => {
    for (const status of ["draft", "pending_review", "paused", "removed", "closed"]) {
      expect(
        estadoDeVencimiento({ ...publicada(10), status }, DEFAULT_EXPIRY_CONFIG, AHORA).estado,
      ).toBe("no_vence");
    }
  });

  it("un negocio publicado no vence aunque tenga fecha vieja pegada", () => {
    expect(
      estadoDeVencimiento(
        { ...publicada(5), kind: "business" },
        DEFAULT_EXPIRY_CONFIG,
        AHORA,
      ).estado,
    ).toBe("no_vence");
  });

  it("manda warnAt, no el recálculo: acortar el aviso no le saca el botón a quien ya lo vio", () => {
    // La comunidad bajó el aviso de 3 días a 1, pero esta publicación se
    // publicó con la ventana vieja congelada en la fila.
    const config: ExpiryConfig = { ...DEFAULT_EXPIRY_CONFIG, diasDeAviso: 1 };
    const conVentanaVieja = { ...publicada(2), warnAt: enDias(-1) };
    expect(estadoDeVencimiento(conVentanaVieja, config, AHORA).estado).toBe("por_vencer");
  });

  it("sin warnAt cae al cálculo por días (mostrar de más > no mostrar nunca)", () => {
    expect(
      estadoDeVencimiento({ ...publicada(2), warnAt: null }, DEFAULT_EXPIRY_CONFIG, AHORA)
        .estado,
    ).toBe("por_vencer");
    expect(
      estadoDeVencimiento({ ...publicada(20), warnAt: null }, DEFAULT_EXPIRY_CONFIG, AHORA)
        .estado,
    ).toBe("vigente");
  });

  it("una fecha corrupta no rompe la pantalla", () => {
    expect(
      estadoDeVencimiento({ ...publicada(5), expiresAt: "ayer" }, DEFAULT_EXPIRY_CONFIG, AHORA)
        .estado,
    ).toBe("no_vence");
  });
});

describe("puedeRenovar espeja public.renovar_publicacion()", () => {
  it("dentro de la ventana de aviso, sí", () => {
    expect(puedeRenovar(publicada(2), DEFAULT_EXPIRY_CONFIG, AHORA)).toEqual({ ok: true });
  });

  it("todavía falta → todavia_no (el mismo motivo que devuelve la base)", () => {
    expect(puedeRenovar(publicada(20), DEFAULT_EXPIRY_CONFIG, AHORA)).toEqual({
      ok: false,
      motivo: "todavia_no",
    });
  });

  it("vencida siempre se puede recuperar: es la promesa del modelo", () => {
    expect(
      puedeRenovar({ ...publicada(-9), status: "expired" }, DEFAULT_EXPIRY_CONFIG, AHORA),
    ).toEqual({ ok: true });
  });

  it("una pausada no se renueva: se despublicó por decisión del dueño", () => {
    expect(
      puedeRenovar({ ...publicada(2), status: "paused" }, DEFAULT_EXPIRY_CONFIG, AHORA),
    ).toEqual({ ok: false, motivo: "estado_invalido" });
  });

  it("lo que no vence no se renueva", () => {
    expect(
      puedeRenovar({ ...publicada(2), kind: "business" }, DEFAULT_EXPIRY_CONFIG, AHORA),
    ).toEqual({ ok: false, motivo: "no_vence" });
  });

  it("el tope gana sobre 'vencida': el motivo que se lee es el que bloquea", () => {
    const config: ExpiryConfig = { ...DEFAULT_EXPIRY_CONFIG, renovacionesMaximas: 2 };
    const alTope = { ...publicada(-1), status: "expired", renewalCount: 2 };
    expect(puedeRenovar(alTope, config, AHORA)).toEqual({
      ok: false,
      motivo: "tope_alcanzado",
    });
  });

  it("con tope configurado, por debajo del tope se renueva", () => {
    const config: ExpiryConfig = { ...DEFAULT_EXPIRY_CONFIG, renovacionesMaximas: 2 };
    expect(puedeRenovar({ ...publicada(2), renewalCount: 1 }, config, AHORA)).toEqual({
      ok: true,
    });
  });

  it("los motivos son exactamente los seis de la función SQL, cada uno en SU migración", () => {
    // Los cinco de siempre viven en 0098. El sexto lo sumó 0117 y NO existe en
    // 0098 — buscarlo ahí haría que el test se cayera buscando en el archivo
    // equivocado (exactamente la advertencia que deja escrita la cabecera de
    // 0117).
    const MOTIVOS_EN_0098 = [
      "no_encontrada",
      "estado_invalido",
      "no_vence",
      "tope_alcanzado",
      "todavia_no",
    ] as const;
    const MOTIVOS_EN_0117 = ["necesita_confirmar_disponibilidad"] as const;

    for (const motivo of MOTIVOS_EN_0098) {
      expect(MIGRACION).toContain(`'motivo', '${motivo}'`);
    }
    for (const motivo of MOTIVOS_EN_0117) {
      expect(MIGRACION_0117).toContain(`'motivo', '${motivo}'`);
    }
    // Cubre la constante ENTERA: si alguien suma un motivo nuevo sin
    // clasificarlo en una de las dos listas de arriba, esta comparación lo
    // nota — es lo que mantiene al test capaz de fallar si un motivo no
    // existe en NINGUNA migración, en vez de debilitarlo a "en alguna de
    // las dos".
    expect([...MOTIVOS_EN_0098, ...MOTIVOS_EN_0117].sort()).toEqual(
      [...MOTIVOS_NO_RENOVABLE].sort(),
    );
    for (const motivo of MOTIVOS_NO_RENOVABLE) {
      expect(isMotivoNoRenovable(motivo)).toBe(true);
    }
    expect(isMotivoNoRenovable("porque_si")).toBe(false);
  });

  it("una cerrada no se renueva: el trato ya se hizo (0117)", () => {
    expect(
      puedeRenovar({ ...publicada(2), status: "closed" }, DEFAULT_EXPIRY_CONFIG, AHORA),
    ).toEqual({ ok: false, motivo: "estado_invalido" });
  });
});

describe("cierre (0117): closedReasonForKind espeja attrs.closed_reason", () => {
  it("los cuatro motivos son los mismos que documenta la migración", () => {
    expect([...CLOSED_REASONS].sort()).toEqual(["done", "filled", "rented", "sold"]);
    for (const reason of CLOSED_REASONS) {
      expect(MIGRACION_0117).toContain(`'${reason}'`);
    }
  });

  it("vivienda, empleos y marketplace tienen motivo propio", () => {
    expect(closedReasonForKind("property")).toBe("rented");
    expect(closedReasonForKind("job")).toBe("filled");
    expect(closedReasonForKind("product")).toBe("sold");
  });

  it("el resto usa el genérico 'done', a propósito (sin taxonomía por vertical)", () => {
    for (const kind of ["business", "professional", "event", "creator_gig", "lost_found"]) {
      expect(closedReasonForKind(kind)).toBe("done");
    }
  });

  it("isClosedReason sólo acepta los cuatro literales del contrato", () => {
    for (const reason of CLOSED_REASONS) {
      expect(isClosedReason(reason)).toBe(true);
    }
    expect(isClosedReason("cancelado")).toBe(false);
    expect(isClosedReason(null)).toBe(false);
  });
});
