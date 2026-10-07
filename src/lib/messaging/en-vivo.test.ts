import { describe, expect, it } from "vitest";
import type { FilaDeBandeja, MensajeDeBandeja } from "./bandeja";
import {
  aplicarMensajesALaBandeja,
  entrantesSinCubrir,
  retirarPendientes,
  esAvisoDeMensaje,
  hiloDeTopico,
  marcarFilaLeida,
  masReciente,
  sumarEntrantes,
  sumarNoLeidos,
  textoDeEntrante,
  type MensajeEntrante,
} from "./en-vivo";
import { topicoDeDirecto, topicoDeGrupo } from "./escribiendo";

/**
 * El parcheo en memoria de la bandeja y del hilo. Lo que no se puede equivocar:
 * la fila correcta, el contador sólo con mensajes ajenos, el orden, y que un
 * aviso que viene del navegador de otra persona nunca se pinte como mensaje.
 */

const YO = "yo";
const ANA = "ana";
const BETO = "beto";

function fila(parcial: Partial<FilaDeBandeja> & { personaId: string }): FilaDeBandeja {
  return {
    persona: { id: parcial.personaId, display_name: parcial.personaId, avatar_url: null },
    conversacionPrincipalId: `c-${parcial.personaId}`,
    conversacionIds: [`c-${parcial.personaId}`],
    ultimoMensaje: null,
    ultimaActividad: "2026-10-06T10:00:00.000Z",
    solicitudRecibidaId: null,
    solicitudRecibidaAviso: null,
    esperandoRespuesta: false,
    avisos: [],
    resumen: null,
    noLeidos: 0,
    leidoPorElOtro: false,
    esAmigo: null,
    aceptada: true,
    ...parcial,
  };
}

function mensaje(parcial: Partial<MensajeDeBandeja> = {}): MensajeDeBandeja {
  return {
    conversation_id: "c-ana",
    sender_id: ANA,
    body: "hola",
    created_at: "2026-10-06T12:00:00.000Z",
    ...parcial,
  };
}

describe("aplicarMensajesALaBandeja", () => {
  it("un mensaje ajeno actualiza resumen, hora y contador, y sube la fila", () => {
    const filas = [
      fila({ personaId: BETO, ultimaActividad: "2026-10-06T11:00:00.000Z" }),
      fila({ personaId: ANA, ultimaActividad: "2026-10-06T09:00:00.000Z", noLeidos: 1 }),
    ];

    const siguiente = aplicarMensajesALaBandeja(filas, [mensaje({ body: " ¿vamos? " })], YO);

    expect(siguiente.map((f) => f.personaId)).toEqual([ANA, BETO]);
    expect(siguiente[0]).toMatchObject({
      noLeidos: 2,
      ultimaActividad: "2026-10-06T12:00:00.000Z",
      resumen: { icono: null, texto: "¿vamos?" },
      ultimoMensaje: { sender_id: ANA, body: " ¿vamos? " },
    });
  });

  it("uno propio no suma al contador y apaga el tilde de leído", () => {
    const filas = [fila({ personaId: ANA, noLeidos: 0, leidoPorElOtro: true })];
    const [actual] = aplicarMensajesALaBandeja(filas, [mensaje({ sender_id: YO })], YO);
    expect(actual.noLeidos).toBe(0);
    expect(actual.leidoPorElOtro).toBe(false);
  });

  it("un adjunto se resume, no muestra el nombre del archivo", () => {
    const [actual] = aplicarMensajesALaBandeja(
      [fila({ personaId: ANA })],
      [mensaje({ kind: "audio", body: "nota.webm", adjunto: { duracion_ms: 24_400 } })],
      YO,
    );
    expect(actual.resumen).toEqual({ icono: "audio", texto: "Nota de voz · 0:24" });
  });

  it("busca la fila por CUALQUIERA de las conversaciones con esa persona", () => {
    const filas = [
      fila({ personaId: ANA, conversacionIds: ["c-ana", "c-ana-vieja"] }),
    ];
    const [actual] = aplicarMensajesALaBandeja(
      filas,
      [mensaje({ conversation_id: "c-ana-vieja" })],
      YO,
    );
    expect(actual.noLeidos).toBe(1);
  });

  it("un mensaje más viejo que lo último suma al contador pero no pisa el resumen", () => {
    const filas = [
      fila({
        personaId: ANA,
        ultimaActividad: "2026-10-06T13:00:00.000Z",
        resumen: { icono: null, texto: "lo último" },
      }),
    ];
    const [actual] = aplicarMensajesALaBandeja(filas, [mensaje()], YO);
    expect(actual.noLeidos).toBe(1);
    expect(actual.resumen?.texto).toBe("lo último");
    expect(actual.ultimaActividad).toBe("2026-10-06T13:00:00.000Z");
  });

  it("una conversación que no está en pantalla no toca nada", () => {
    const filas = [fila({ personaId: BETO })];
    expect(aplicarMensajesALaBandeja(filas, [mensaje()], YO)).toEqual(filas);
  });

  it("si la otra persona contesta, deja de estar 'esperando respuesta'", () => {
    const [actual] = aplicarMensajesALaBandeja(
      [fila({ personaId: ANA, esperandoRespuesta: true })],
      [mensaje()],
      YO,
    );
    expect(actual.esperandoRespuesta).toBe(false);
  });

  it("varios mensajes en la misma tanda: el resumen es el más nuevo, sin importar el orden", () => {
    const [actual] = aplicarMensajesALaBandeja(
      [fila({ personaId: ANA })],
      [
        mensaje({ body: "segundo", created_at: "2026-10-06T12:00:02.000Z" }),
        mensaje({ body: "primero", created_at: "2026-10-06T12:00:01.000Z" }),
      ],
      YO,
    );
    expect(actual.resumen?.texto).toBe("segundo");
    expect(actual.noLeidos).toBe(2);
  });

  it("no muta la lista que recibe", () => {
    const filas = [fila({ personaId: ANA })];
    const copia = structuredClone(filas);
    aplicarMensajesALaBandeja(filas, [mensaje()], YO);
    expect(filas).toEqual(copia);
  });
});

describe("marcarFilaLeida / sumarNoLeidos", () => {
  it("baja el globito sólo de esa persona", () => {
    const filas = [fila({ personaId: ANA, noLeidos: 3 }), fila({ personaId: BETO, noLeidos: 2 })];
    const siguiente = marcarFilaLeida(filas, ANA);
    expect(siguiente.map((f) => f.noLeidos)).toEqual([0, 2]);
    expect(sumarNoLeidos(siguiente)).toBe(2);
  });
});

describe("el aviso por el canal", () => {
  it("sólo acepta `{de, tipo}` con un tipo conocido", () => {
    expect(esAvisoDeMensaje({ de: ANA, tipo: "nuevo" })).toBe(true);
    expect(esAvisoDeMensaje({ de: ANA, tipo: "cambio" })).toBe(true);
    expect(esAvisoDeMensaje({ de: ANA, tipo: "borrar-todo" })).toBe(false);
    expect(esAvisoDeMensaje({ de: "", tipo: "nuevo" })).toBe(false);
    expect(esAvisoDeMensaje(null)).toBe(false);
  });

  it("del tópico sale el hilo, y nada de un tópico mal formado", () => {
    const conversacion = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(hiloDeTopico(topicoDeDirecto(conversacion))).toEqual({
      ambito: "directo",
      id: conversacion,
    });
    expect(hiloDeTopico(topicoDeGrupo(conversacion))).toEqual({
      ambito: "grupo",
      id: conversacion,
    });
    expect(hiloDeTopico("escribiendo-directo:no-es-uuid")).toBeNull();
  });
});

describe("entrantes del hilo", () => {
  const entrante = (id: string, created_at: string, parcial: Partial<MensajeEntrante> = {}) => ({
    id,
    body: id,
    created_at,
    kind: null,
    adjunto: null,
    propio: false,
    autorNombre: null,
    ...parcial,
  });

  it("no repite, no dibuja lo que el servidor ya pintó y ordena por envío", () => {
    const resultado = sumarEntrantes(
      [entrante("b", "2026-10-06T12:00:02.000Z")],
      [
        entrante("b", "2026-10-06T12:00:02.000Z"),
        entrante("a", "2026-10-06T12:00:01.000Z"),
        entrante("ya", "2026-10-06T12:00:00.000Z"),
      ],
      new Set(["ya"]),
    );
    expect(resultado.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("una foto se anuncia como 'Foto' hasta que llega la burbuja completa", () => {
    expect(
      textoDeEntrante(entrante("f", "2026-10-06T12:00:00.000Z", { kind: "imagen", body: "" })),
    ).toEqual({ texto: "Foto", esResumen: true });
    expect(textoDeEntrante(entrante("t", "2026-10-06T12:00:00.000Z"))).toEqual({
      texto: "t",
      esResumen: false,
    });
  });

  it("masReciente elige el ISO más nuevo y tolera null", () => {
    expect(masReciente(null, "2026-10-06T12:00:00.000Z")).toBe("2026-10-06T12:00:00.000Z");
    expect(masReciente("2026-10-06T13:00:00.000Z", "2026-10-06T12:00:00.000Z")).toBe(
      "2026-10-06T13:00:00.000Z",
    );
  });
});

describe("retirarPendientes", () => {
  const p = (tempId: string, body: string) => ({ tempId, body });

  it("retira la pendiente con el MISMO texto, no la primera de la cola", () => {
    const { quedan, salen } = retirarPendientes(
      [p("1", "falló"), p("2", "salió")],
      [{ id: "m", propio: true, body: "salió" }],
    );
    expect(salen.map((x) => x.tempId)).toEqual(["2"]);
    expect(quedan.map((x) => x.tempId)).toEqual(["1"]);
  });

  it("dos con el mismo texto salen de a una", () => {
    const { quedan } = retirarPendientes(
      [p("1", "ok"), p("2", "ok")],
      [{ id: "m", propio: true, body: " ok " }],
    );
    expect(quedan.map((x) => x.tempId)).toEqual(["2"]);
  });

  it("un texto que no coincide (otra pestaña) no retira nada", () => {
    const { salen } = retirarPendientes([p("1", "hola")], [{ id: "m", propio: true, body: "chau" }]);
    expect(salen).toEqual([]);
  });

  it("sin texto para comparar cae al orden de envío", () => {
    const { salen } = retirarPendientes([p("1", "a"), p("2", "b")], [{ id: "m", propio: true }]);
    expect(salen.map((x) => x.tempId)).toEqual(["1"]);
  });
});

describe("entrantesSinCubrir", () => {
  const e = (id: string, created_at: string): MensajeEntrante => ({
    id,
    body: id,
    created_at,
    kind: null,
    adjunto: null,
    propio: false,
    autorNombre: null,
  });

  it("retira las que el servidor trajo y las que quedaron detrás de su último mensaje", () => {
    const quedan = entrantesSinCubrir(
      [
        e("traida", "2026-10-06T12:00:01.000Z"),
        e("borrada", "2026-10-06T12:00:02.000Z"),
        e("nueva", "2026-10-06T12:00:09.000Z"),
      ],
      [
        { id: "traida", propio: false, created_at: "2026-10-06T12:00:01.000Z" },
        { id: "otra", propio: false, created_at: "2026-10-06T12:00:05.000Z" },
      ],
    );
    expect(quedan.map((m) => m.id)).toEqual(["nueva"]);
  });
});
