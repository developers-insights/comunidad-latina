import { describe, expect, it } from "vitest";
import {
  amigosPorSeguimientoMutuo,
  calcularNoLeidos,
  describirLlamada,
  duracionDeAdjunto,
  esFiltroDePersonas,
  formatearDuracion,
  fueLeidoPorElOtro,
  hrefDeFiltro,
  noLeidosDelHilo,
  parseFiltroDePersonas,
  resumirMensaje,
  type MensajeDeBandeja,
} from "./bandeja";

/**
 * Lógica pura de la bandeja. Sin base y sin React: lo único que se prueba acá
 * es lo que la pantalla no puede equivocarse en calcular — qué dice cada fila,
 * cuántos mensajes quedan sin leer y quién cuenta como amigo.
 */

const YO = "yo";
const OTRO = "otro";

function mensaje(parcial: Partial<MensajeDeBandeja> = {}): MensajeDeBandeja {
  return {
    conversation_id: "c1",
    sender_id: OTRO,
    body: "hola",
    created_at: "2026-09-07T12:00:00.000Z",
    ...parcial,
  };
}

describe("resumirMensaje", () => {
  it("sin kind se lee como texto: una base sin la 0136 muestra la bandeja de siempre", () => {
    expect(resumirMensaje(mensaje({ body: "  nos vemos  " }))).toEqual({
      icono: null,
      texto: "nos vemos",
    });
  });

  it("kind desconocido también cae en texto", () => {
    expect(resumirMensaje(mensaje({ kind: "sticker", body: "hola" }))).toEqual({
      icono: null,
      texto: "hola",
    });
  });

  it("audio con duración dice la duración", () => {
    expect(
      resumirMensaje(mensaje({ kind: "audio", adjunto: { duracion_ms: 24_400 } })),
    ).toEqual({ icono: "audio", texto: "Nota de voz · 0:24" });
  });

  it("audio sin duración legible no inventa un 0:00", () => {
    expect(resumirMensaje(mensaje({ kind: "audio", adjunto: null }))).toEqual({
      icono: "audio",
      texto: "Nota de voz",
    });
  });

  it("el cuerpo de un adjunto no se muestra: en un audio es el nombre del archivo", () => {
    const resumen = resumirMensaje(
      mensaje({ kind: "audio", body: "audio-2026-09-07.m4a", adjunto: {} }),
    );
    expect(resumen.texto).not.toContain("m4a");
  });

  it.each([
    ["imagen", "Foto"],
    ["video", "Video"],
    ["archivo", "Archivo"],
    ["ubicacion", "Ubicación"],
    ["perfil", "Perfil compartido"],
    ["contenido", "Publicación compartida"],
  ])("kind %s dice %s", (kind, texto) => {
    const resumen = resumirMensaje(mensaje({ kind }));
    expect(resumen.texto).toBe(texto);
    expect(resumen.icono).toBe(kind);
  });
});

describe("formatearDuracion", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [24_400, "0:24"],
    [65_000, "1:05"],
    [3_723_000, "1:02:03"],
  ])("%d ms → %s", (ms, esperado) => {
    expect(formatearDuracion(ms)).toBe(esperado);
  });

  it("un valor imposible no rompe la fila", () => {
    expect(formatearDuracion(Number.NaN)).toBe("0:00");
    expect(formatearDuracion(-5)).toBe("0:00");
  });
});

describe("duracionDeAdjunto", () => {
  it("acepta el número y el string que devuelve ->> de jsonb", () => {
    expect(duracionDeAdjunto({ duracion_ms: 1200 })).toBe(1200);
    expect(duracionDeAdjunto({ duracion_ms: "1200" })).toBe(1200);
  });

  it("descarta lo que no sea un número usable", () => {
    expect(duracionDeAdjunto(null)).toBeNull();
    expect(duracionDeAdjunto("1200")).toBeNull();
    expect(duracionDeAdjunto({ duracion_ms: "largo" })).toBeNull();
    expect(duracionDeAdjunto({})).toBeNull();
  });
});

describe("describirLlamada", () => {
  it("traduce lo que manda la base, que viene en literales de esquema", () => {
    expect(describirLlamada("video · perdida")).toBe("Videollamada perdida");
    expect(describirLlamada("audio · perdida")).toBe("Llamada de voz perdida");
    expect(describirLlamada("audio · terminada")).toBe("Llamada de voz");
    expect(describirLlamada("video · en_curso")).toBe("Videollamada en curso");
    expect(describirLlamada("audio · rechazada")).toBe("Llamada de voz rechazada");
  });

  it("nunca deja salir un literal crudo a la pantalla", () => {
    for (const entrada of [null, "", "cualquiera", "video", "· perdida"]) {
      const salida = describirLlamada(entrada);
      expect(salida).not.toContain("·");
      expect(salida).not.toContain("_");
      expect(salida.length).toBeGreaterThan(0);
    }
  });
});

describe("calcularNoLeidos", () => {
  const mensajes: MensajeDeBandeja[] = [
    mensaje({ conversation_id: "c1", created_at: "2026-09-07T10:00:00.000Z" }),
    mensaje({ conversation_id: "c1", created_at: "2026-09-07T11:00:00.000Z" }),
    mensaje({ conversation_id: "c1", created_at: "2026-09-07T12:00:00.000Z" }),
  ];

  it("cuenta sólo lo que llegó después de la última lectura", () => {
    const conteo = calcularNoLeidos(
      mensajes,
      new Map([["c1", "2026-09-07T10:30:00.000Z"]]),
      YO,
    );
    expect(conteo.get("c1")).toBe(2);
  });

  it("sin fila de lectura la conversación cuenta como nunca leída", () => {
    const conteo = calcularNoLeidos(mensajes, new Map(), YO);
    expect(conteo.get("c1")).toBe(3);
  });

  it("los mensajes propios nunca cuentan", () => {
    const conteo = calcularNoLeidos(
      [...mensajes, mensaje({ conversation_id: "c1", sender_id: YO })],
      new Map(),
      YO,
    );
    expect(conteo.get("c1")).toBe(3);
  });

  it("un mensaje exactamente en el corte ya está leído", () => {
    const conteo = calcularNoLeidos(
      [mensaje({ created_at: "2026-09-07T10:00:00.000Z" })],
      new Map([["c1", "2026-09-07T10:00:00.000Z"]]),
      YO,
    );
    expect(conteo.get("c1")).toBeUndefined();
  });

  it("una fecha de lectura ilegible se trata como nunca leí, no como leí todo", () => {
    const conteo = calcularNoLeidos(mensajes, new Map([["c1", "ayer"]]), YO);
    expect(conteo.get("c1")).toBe(3);
  });

  it("compara instantes, no strings: +00:00 y Z son el mismo momento", () => {
    const conteo = calcularNoLeidos(
      [mensaje({ created_at: "2026-09-07T12:00:00+00:00" })],
      new Map([["c1", "2026-09-07T12:00:00.000Z"]]),
      YO,
    );
    expect(conteo.get("c1")).toBeUndefined();
  });

  it("noLeidosDelHilo suma todas las conversaciones con la misma persona", () => {
    const porConversacion = new Map([
      ["c1", 2],
      ["c2", 3],
      ["c9", 7],
    ]);
    expect(noLeidosDelHilo(["c1", "c2"], porConversacion)).toBe(5);
    expect(noLeidosDelHilo([], porConversacion)).toBe(0);
  });
});

describe("fueLeidoPorElOtro", () => {
  const mio = mensaje({ sender_id: YO, created_at: "2026-09-07T12:00:00.000Z" });

  it("el tilde aparece cuando la otra persona leyó después de mi último mensaje", () => {
    expect(fueLeidoPorElOtro(mio, YO, "2026-09-07T12:30:00.000Z")).toBe(true);
  });

  it("no aparece si leyó antes", () => {
    expect(fueLeidoPorElOtro(mio, YO, "2026-09-07T11:00:00.000Z")).toBe(false);
  });

  it("nunca aparece sobre un mensaje ajeno", () => {
    const ajeno = mensaje({ sender_id: OTRO });
    expect(fueLeidoPorElOtro(ajeno, YO, "2026-09-08T00:00:00.000Z")).toBe(false);
  });

  it("sin dato de lectura no se afirma nada", () => {
    expect(fueLeidoPorElOtro(mio, YO, null)).toBe(false);
    expect(fueLeidoPorElOtro(null, YO, "2026-09-08T00:00:00.000Z")).toBe(false);
  });
});

describe("amigosPorSeguimientoMutuo", () => {
  it("amigo es sólo quien está en las dos direcciones", () => {
    const amigos = amigosPorSeguimientoMutuo(["a", "b", "c"], ["b", "c", "d"]);
    expect([...amigos].sort()).toEqual(["b", "c"]);
  });

  it("seguir sin ser seguido no alcanza", () => {
    expect(amigosPorSeguimientoMutuo(["a"], []).size).toBe(0);
    expect(amigosPorSeguimientoMutuo([], ["a"]).size).toBe(0);
  });
});

describe("filtro en la URL", () => {
  it("acepta los tres válidos y descarta el resto", () => {
    expect(esFiltroDePersonas("amigos")).toBe(true);
    expect(esFiltroDePersonas("archivados")).toBe(false);
    expect(parseFiltroDePersonas("no-leidos")).toBe("no-leidos");
    expect(parseFiltroDePersonas("cualquiera")).toBe("todos");
    expect(parseFiltroDePersonas(undefined)).toBe("todos");
    expect(parseFiltroDePersonas(["amigos", "todos"])).toBe("amigos");
  });

  it("el default no se escribe en la URL", () => {
    expect(hrefDeFiltro("todos")).toBe("/mensajes");
    expect(hrefDeFiltro("amigos")).toBe("/mensajes?filtro=amigos");
    expect(hrefDeFiltro("no-leidos")).toBe("/mensajes?filtro=no-leidos");
  });
});
