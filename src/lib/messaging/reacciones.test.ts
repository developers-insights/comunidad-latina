import { describe, expect, it, vi } from "vitest";
import {
  MAX_NOMBRES_POR_REACCION,
  REACCIONES_RAPIDAS,
  VENTANA_DE_EDICION_MS,
  accionesDisponibles,
  agruparReacciones,
  aplicarReaccion,
  emojiUnicodeDeReaccion,
  esReaccionValida,
  leerReaccionesDeMensajes,
  miReaccion,
  msRestantesDeEdicion,
  slugDeReaccion,
  type ReaccionAgrupada,
  type ReaccionRow,
} from "./reacciones";

/**
 * Contrato de las reacciones a mensajes (0138) y de qué acciones se habilitan
 * según autor, rol y ventana de edición (0136 §5).
 *
 * Nada de esto toca Supabase ni la RLS: lo que se verifica es la parte que
 * DECIDE la pantalla. La autorización vive en las policies y se testea con
 * `check:rls`.
 */

const YO = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const TERCERA = "33333333-3333-4333-8333-333333333333";
const MENSAJE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MENSAJE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fila(
  subject_id: string,
  profile_id: string,
  kind: string,
  nombre?: string,
): ReaccionRow {
  return {
    subject_id,
    profile_id,
    kind,
    autor: nombre ? { display_name: nombre } : null,
  };
}

describe("agruparReacciones", () => {
  it("agrupa por mensaje y por emoji en una sola pasada", () => {
    const mapa = agruparReacciones(
      [
        fila(MENSAJE_A, OTRA, "❤️", "Ana"),
        fila(MENSAJE_A, TERCERA, "❤️", "Beto"),
        fila(MENSAJE_A, YO, "👍", "Yo"),
        fila(MENSAJE_B, OTRA, "😂", "Ana"),
      ],
      YO,
    );

    expect(mapa.size).toBe(2);
    const deA = mapa.get(MENSAJE_A) ?? [];
    expect(deA).toHaveLength(2);
    expect(deA[0]).toMatchObject({ kind: "❤️", total: 2, mia: false });
    expect(deA[0].nombres).toEqual(["Ana", "Beto"]);
    expect(deA[1]).toMatchObject({ kind: "👍", total: 1, mia: true });
    expect(mapa.get(MENSAJE_B)?.[0]).toMatchObject({ kind: "😂", total: 1, mia: false });
  });

  it("ordena por cantidad y desempata por orden de aparición (fila estable)", () => {
    const mapa = agruparReacciones(
      [
        fila(MENSAJE_A, OTRA, "🙏"),
        fila(MENSAJE_A, TERCERA, "😮"),
        fila(MENSAJE_A, YO, "😮"),
      ],
      YO,
    );
    // 😮 tiene 2 y va primero; con empate mandaría el orden de aparición.
    expect((mapa.get(MENSAJE_A) ?? []).map((r) => r.kind)).toEqual(["😮", "🙏"]);
  });

  it("recorta los nombres para no arrastrar la comunidad entera", () => {
    const muchas = Array.from({ length: 30 }, (_, i) =>
      fila(MENSAJE_A, `p-${i}`, "❤️", `Persona ${i}`),
    );
    const grupo = agruparReacciones(muchas, YO).get(MENSAJE_A)?.[0];
    expect(grupo?.total).toBe(30);
    expect(grupo?.nombres).toHaveLength(MAX_NOMBRES_POR_REACCION);
  });

  it("sin viewer, ninguna reacción es propia", () => {
    const grupo = agruparReacciones([fila(MENSAJE_A, YO, "❤️")], null).get(MENSAJE_A)?.[0];
    expect(grupo?.mia).toBe(false);
  });
});

describe("leerReaccionesDeMensajes — cero N+1", () => {
  function clienteFalso(filas: ReaccionRow[]) {
    const llamadas: { select: string; ids: unknown }[] = [];
    const builder = {
      select(select: string) {
        llamadas.push({ select, ids: null });
        return builder;
      },
      eq() {
        return builder;
      },
      in(_columna: string, ids: unknown) {
        llamadas[llamadas.length - 1].ids = ids;
        return Promise.resolve({ data: filas, error: null });
      },
    };
    const from = vi.fn(() => builder);
    return { cliente: { from } as never, from, llamadas };
  }

  it("pide TODAS las reacciones del hilo en una sola consulta", async () => {
    const { cliente, from, llamadas } = clienteFalso([
      fila(MENSAJE_A, OTRA, "❤️", "Ana"),
      fila(MENSAJE_B, OTRA, "👍", "Ana"),
    ]);

    const mapa = await leerReaccionesDeMensajes(
      cliente,
      "directo",
      [MENSAJE_A, MENSAJE_B],
      YO,
    );

    expect(from).toHaveBeenCalledTimes(1);
    expect(llamadas[0].ids).toEqual([MENSAJE_A, MENSAJE_B]);
    // El nombre viene EMBEBIDO en la misma consulta, no en una segunda.
    expect(llamadas[0].select).toContain("autor:profiles(display_name)");
    expect(mapa.get(MENSAJE_A)?.[0].kind).toBe("❤️");
    expect(mapa.get(MENSAJE_B)?.[0].kind).toBe("👍");
  });

  it("con un hilo vacío no toca la base", async () => {
    const { cliente, from } = clienteFalso([]);
    const mapa = await leerReaccionesDeMensajes(cliente, "grupo", [], YO);
    expect(from).not.toHaveBeenCalled();
    expect(mapa.size).toBe(0);
  });
});

describe("aplicarReaccion — una sola por persona", () => {
  const base: ReaccionAgrupada[] = [
    { kind: "❤️", total: 2, mia: true, nombres: ["Yo", "Ana"] },
    { kind: "👍", total: 1, mia: false, nombres: ["Beto"] },
  ];

  it("cambiar de emoji saca la vieja y pone la nueva", () => {
    const siguiente = aplicarReaccion(base, "👍", "Yo");
    expect(siguiente.find((r) => r.kind === "❤️")).toMatchObject({
      total: 1,
      mia: false,
    });
    expect(siguiente.find((r) => r.kind === "👍")).toMatchObject({
      total: 2,
      mia: true,
    });
    expect(miReaccion(siguiente)).toBe("👍");
    // La regla de la 0007: nunca dos mías a la vez.
    expect(siguiente.filter((r) => r.mia)).toHaveLength(1);
  });

  it("sacar la mía cuando era la única deja la pastilla afuera", () => {
    const sola: ReaccionAgrupada[] = [{ kind: "🙏", total: 1, mia: true, nombres: ["Yo"] }];
    expect(aplicarReaccion(sola, null, "Yo")).toEqual([]);
  });

  it("un emoji nuevo se suma al final con mi nombre", () => {
    const siguiente = aplicarReaccion(base, "😮", "Yo");
    expect(siguiente.at(-1)).toEqual({
      kind: "😮",
      total: 1,
      mia: true,
      nombres: ["Yo"],
    });
  });

  it("no toca las reacciones de otras personas", () => {
    const siguiente = aplicarReaccion(base, null, "Yo");
    expect(siguiente.find((r) => r.kind === "👍")).toEqual(base[1]);
  });
});

describe("accionesDisponibles", () => {
  const ahora = Date.parse("2026-09-07T12:00:00.000Z");
  const recien = new Date(ahora - 60_000).toISOString();
  const viejo = new Date(ahora - VENTANA_DE_EDICION_MS - 1_000).toISOString();

  it("el autor puede editar su texto dentro de la ventana", () => {
    const puede = accionesDisponibles(
      { esAutor: true, kind: "texto", createdAt: recien, body: "hola" },
      ahora,
    );
    expect(puede.editar).toBe(true);
    expect(puede.eliminar).toBe(true);
    // Reportarse a uno mismo no significa nada.
    expect(puede.reportar).toBe(false);
  });

  it("pasados los 15 minutos ya no se ofrece editar", () => {
    const puede = accionesDisponibles(
      { esAutor: true, kind: "texto", createdAt: viejo, body: "hola" },
      ahora,
    );
    expect(puede.editar).toBe(false);
    expect(puede.eliminar).toBe(true);
  });

  it("un mensaje ajeno no se edita ni se elimina, pero se reporta", () => {
    const puede = accionesDisponibles(
      { esAutor: false, kind: "texto", createdAt: recien, body: "hola" },
      ahora,
    );
    expect(puede.editar).toBe(false);
    expect(puede.eliminar).toBe(false);
    expect(puede.reportar).toBe(true);
  });

  it("quien administra el grupo puede eliminar lo ajeno, no editarlo", () => {
    const puede = accionesDisponibles(
      {
        esAutor: false,
        administro: true,
        kind: "texto",
        createdAt: recien,
        body: "hola",
      },
      ahora,
    );
    expect(puede.eliminar).toBe(true);
    expect(puede.editar).toBe(false);
  });

  it("sólo los mensajes de texto se editan: el trigger no deja cambiar otra cosa", () => {
    const puede = accionesDisponibles(
      { esAutor: true, kind: "imagen", createdAt: recien, body: "" },
      ahora,
    );
    expect(puede.editar).toBe(false);
    // Sin texto tampoco hay nada que copiar.
    expect(puede.copiar).toBe(false);
  });

  it("un mensaje bajado no habilita NADA", () => {
    const puede = accionesDisponibles(
      {
        esAutor: true,
        kind: "texto",
        createdAt: recien,
        body: "hola",
        deletedAt: new Date(ahora).toISOString(),
      },
      ahora,
    );
    expect(puede).toEqual({
      responder: false,
      copiar: false,
      reenviar: false,
      editar: false,
      eliminar: false,
      reportar: false,
      reaccionar: false,
    });
  });
});

describe("las tres formas de un `kind`", () => {
  it("`like` sigue viéndose como el corazón de siempre", () => {
    expect(emojiUnicodeDeReaccion("like")).toBe("❤️");
    expect(emojiUnicodeDeReaccion("👍")).toBe("👍");
  });

  it("reconoce el código corto de un emoji de la comunidad", () => {
    expect(slugDeReaccion(":klk:")).toBe("klk");
    expect(slugDeReaccion(":que-lo-que:")).toBe("que-lo-que");
    expect(slugDeReaccion("❤️")).toBeNull();
    expect(slugDeReaccion(":KLK:")).toBeNull();
  });

  it("espeja el techo de longitud de `reactions_kind_check`", () => {
    expect(esReaccionValida("❤️")).toBe(true);
    expect(esReaccionValida("   ")).toBe(false);
    expect(esReaccionValida("x".repeat(64))).toBe(true);
    expect(esReaccionValida("x".repeat(65))).toBe(false);
  });

  it("las seis rápidas son las de la lámina del cliente", () => {
    expect([...REACCIONES_RAPIDAS]).toEqual(["❤️", "👍", "😂", "😮", "😢", "🙏"]);
  });
});

describe("msRestantesDeEdicion", () => {
  const ahora = Date.parse("2026-09-07T12:00:00.000Z");

  it("cuenta hacia atrás desde created_at", () => {
    const hace5 = new Date(ahora - 5 * 60_000).toISOString();
    expect(msRestantesDeEdicion(hace5, ahora)).toBe(10 * 60_000);
  });

  it("nunca devuelve negativo", () => {
    const hace1h = new Date(ahora - 3_600_000).toISOString();
    expect(msRestantesDeEdicion(hace1h, ahora)).toBe(0);
  });

  it("una fecha rota cierra la ventana en vez de abrirla", () => {
    expect(msRestantesDeEdicion("no es una fecha", ahora)).toBe(0);
  });
});
