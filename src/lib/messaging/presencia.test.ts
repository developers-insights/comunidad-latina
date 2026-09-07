import { describe, expect, it, vi } from "vitest";
import {
  MAX_IDS_POR_CONSULTA,
  MINIMO_ENTRE_TOQUES_MS,
  leerPresencia,
  presenciaVisible,
  textoDeUltimaVez,
} from "./presencia";

/**
 * Contrato de "En línea" / "Última vez" (0145).
 *
 * Nada de esto toca Supabase ni la RLS: lo que se verifica es la parte que
 * DECIDE qué se pinta. Que la presencia ajena no se pueda leer sin pasar por
 * `presencia_de()` lo garantizan la RLS de `profiles_private` y la propia
 * función, y se testea con `check:rls`.
 */

const AHORA = new Date("2026-09-07T12:00:00.000Z");
const ANA = "11111111-1111-4111-8111-111111111111";
const BETO = "22222222-2222-4222-8222-222222222222";

function haceMs(ms: number): string {
  return new Date(AHORA.getTime() - ms).toISOString();
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

describe("textoDeUltimaVez", () => {
  it("dice minutos, horas y días como los pidió el cliente", () => {
    expect(textoDeUltimaVez(haceMs(20 * MINUTO), AHORA)).toBe("hace 20 minutos");
    expect(textoDeUltimaVez(haceMs(3 * HORA), AHORA)).toBe("hace 3 horas");
    expect(textoDeUltimaVez(haceMs(5 * DIA), AHORA)).toBe("hace 5 días");
  });

  it("usa singular donde corresponde", () => {
    expect(textoDeUltimaVez(haceMs(MINUTO), AHORA)).toBe("hace 1 minuto");
    expect(textoDeUltimaVez(haceMs(HORA), AHORA)).toBe("hace 1 hora");
    expect(textoDeUltimaVez(haceMs(DIA), AHORA)).toBe("hace 1 día");
  });

  it("abajo del minuto no inventa un número", () => {
    expect(textoDeUltimaVez(haceMs(5_000), AHORA)).toBe("hace un momento");
  });

  /**
   * El reloj del otro lado puede estar adelantado. Sin el piso en cero esto
   * daría "hace -3 minutos", que es lo que se ve cuando un chat se rompe.
   */
  it("una marca en el futuro se lee como recién", () => {
    expect(textoDeUltimaVez(haceMs(-3 * MINUTO), AHORA)).toBe("hace un momento");
  });

  it("pasado el mes deja de contar días", () => {
    expect(textoDeUltimaVez(haceMs(30 * DIA), AHORA)).toBe("hace 30 días");
    expect(textoDeUltimaVez(haceMs(45 * DIA), AHORA)).toBe("hace más de un mes");
  });

  it("una fecha rota no pinta nada", () => {
    expect(textoDeUltimaVez("no soy una fecha", AHORA)).toBeNull();
  });

  /**
   * El texto va DESPUÉS de "Última vez" (`COPY.inbox.resumen.ultimaVez`), así
   * que tiene que empezar en minúscula y encadenar. Sin esto la fila diría
   * "Última vez Hace 20 minutos".
   */
  it("encadena con el prefijo de la copy", () => {
    const cuando = textoDeUltimaVez(haceMs(20 * MINUTO), AHORA);
    expect(`Última vez ${cuando}`).toBe("Última vez hace 20 minutos");
  });
});

describe("presenciaVisible", () => {
  it("en línea gana sobre la última vez", () => {
    expect(
      presenciaVisible({ enLinea: true, ultimaVez: haceMs(MINUTO) }, AHORA),
    ).toEqual({ tipo: "en-linea" });
  });

  it("sin conexión muestra hace cuánto", () => {
    expect(
      presenciaVisible({ enLinea: false, ultimaVez: haceMs(20 * MINUTO) }, AHORA),
    ).toEqual({ tipo: "ultima-vez", cuando: "hace 20 minutos" });
  });

  /**
   * EL CASO QUE MÁS IMPORTA. Quien apagó `mostrar_ultima_vez` vuelve de la RPC
   * como `false` / `null` (0145 §4). Eso NO se pinta como "desconocido" ni con
   * un punto gris: no se pinta nada, porque un estado vacío con forma propia
   * sigue delatando que hay alguien que eligió no mostrarse.
   */
  it("quien apagó que se vea no produce ningún renglón", () => {
    expect(presenciaVisible({ enLinea: false, ultimaVez: null }, AHORA)).toBeNull();
  });

  it("un perfil que la RPC no contestó tampoco produce renglón", () => {
    expect(presenciaVisible(undefined, AHORA)).toBeNull();
  });
});

describe("leerPresencia", () => {
  function clienteFalso(
    porTanda: Array<{ data?: unknown[]; error?: { code: string } }>,
  ) {
    const llamadas: unknown[][] = [];
    let i = 0;
    const rpc = vi.fn((nombre: string, args: unknown) => {
      llamadas.push([nombre, args]);
      const respuesta = porTanda[i] ?? { data: [] };
      i += 1;
      return Promise.resolve({ data: respuesta.data ?? null, error: respuesta.error ?? null });
    });
    return { cliente: { rpc } as never, rpc, llamadas };
  }

  it("sin ids no toca la red", async () => {
    const { cliente, rpc } = clienteFalso([]);
    expect(await leerPresencia(cliente, [])).toEqual(new Map());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("mapea las filas por profile_id", async () => {
    const { cliente, llamadas } = clienteFalso([
      {
        data: [
          { profile_id: ANA, en_linea: true, ultima_vez: haceMs(MINUTO) },
          { profile_id: BETO, en_linea: false, ultima_vez: null },
        ],
      },
    ]);

    const mapa = await leerPresencia(cliente, [ANA, BETO]);

    expect(llamadas[0][0]).toBe("presencia_de");
    expect(llamadas[0][1]).toEqual({ ids: [ANA, BETO] });
    expect(mapa.get(ANA)?.enLinea).toBe(true);
    expect(mapa.get(BETO)).toEqual({ enLinea: false, ultimaVez: null });
  });

  /**
   * Pasarse de 100 hace que la RPC LANCE `TOO_MANY_PROFILES` (0145 §4) — no
   * devuelve menos filas. Sin las tandas, una bandeja con 101 conversaciones
   * se queda sin presencia entera.
   */
  it("parte en tandas de 100", async () => {
    const ids = Array.from(
      { length: MAX_IDS_POR_CONSULTA + 5 },
      (_, n) => `${n}`.padStart(8, "0") + "-0000-4000-8000-000000000000",
    );
    const { cliente, llamadas } = clienteFalso([{ data: [] }, { data: [] }]);

    await leerPresencia(cliente, ids);

    expect(llamadas).toHaveLength(2);
    expect((llamadas[0][1] as { ids: string[] }).ids).toHaveLength(MAX_IDS_POR_CONSULTA);
    expect((llamadas[1][1] as { ids: string[] }).ids).toHaveLength(5);
  });

  it("no repite un id que aparece dos veces", async () => {
    const { cliente, llamadas } = clienteFalso([{ data: [] }]);
    await leerPresencia(cliente, [ANA, ANA, BETO]);
    expect((llamadas[0][1] as { ids: string[] }).ids).toEqual([ANA, BETO]);
  });

  /**
   * La 0145 puede no estar aplicada (42883 = la función no existe). La bandeja
   * se tiene que seguir leyendo: un adorno que falta no puede vaciar la pantalla.
   */
  it("un error de la RPC devuelve el mapa vacío en vez de romper", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente } = clienteFalso([{ error: { code: "42883" } }]);

    expect(await leerPresencia(cliente, [ANA])).toEqual(new Map());
    aviso.mockRestore();
  });

  it("una tanda que falla no se lleva puesta a la que anduvo", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ids = Array.from(
      { length: MAX_IDS_POR_CONSULTA + 1 },
      (_, n) => `${n}`.padStart(8, "0") + "-0000-4000-8000-000000000000",
    );
    const { cliente } = clienteFalso([
      { error: { code: "57014" } },
      { data: [{ profile_id: ANA, en_linea: true, ultima_vez: null }] },
    ]);

    const mapa = await leerPresencia(cliente, ids);

    expect(mapa.get(ANA)?.enLinea).toBe(true);
    aviso.mockRestore();
  });
});

/**
 * El latido tiene que caer DENTRO de la ventana de "en línea" de la 0145 (2
 * minutos). Con un latido más espaciado, alguien con la app abierta parpadearía
 * entre conectado y desconectado.
 */
describe("el latido contra la ventana de la RPC", () => {
  it("late al menos dos veces por ventana", () => {
    const VENTANA_EN_LINEA_MS = 2 * MINUTO;
    expect(MINIMO_ENTRE_TOQUES_MS * 2).toBeLessThanOrEqual(VENTANA_EN_LINEA_MS);
  });
});
