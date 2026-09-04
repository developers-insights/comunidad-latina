import { describe, expect, it } from "vitest";
import {
  agruparPorPersona,
  type ConversacionLite,
  type UltimoMensaje,
} from "./agrupar-por-persona";

/**
 * El caso de la foto del cliente: Ramón aparecía TRES veces en la bandeja
 * porque tenía tres avisos. Estos tests son esa pantalla, escrita.
 */

const YO = "11111111-1111-1111-1111-111111111111";
const RAMON = "22222222-2222-2222-2222-222222222222";
const ALTAGRACIA = "33333333-3333-3333-3333-333333333333";

function persona(id: string, nombre: string) {
  return { id, display_name: nombre, avatar_url: null };
}

function conversacion(over: Partial<ConversacionLite> & { id: string }): ConversacionLite {
  return {
    status: "accepted",
    created_at: "2026-09-01T10:00:00.000Z",
    created_by: YO,
    counterpart_id: RAMON,
    listing: null,
    creator: persona(YO, "Yo Mismo"),
    counterpart: persona(RAMON, "Ramón Cabrera"),
    ...over,
  };
}

function ultimos(entradas: UltimoMensaje[]): Map<string, UltimoMensaje> {
  return new Map(entradas.map((m) => [m.conversation_id, m]));
}

describe("agruparPorPersona", () => {
  it("junta en UNA fila los tres hilos por aviso con la misma persona", () => {
    const hilos = agruparPorPersona(
      [
        conversacion({ id: "a", listing: { id: "l1", title: "Gorra bordada" } }),
        conversacion({ id: "b", listing: { id: "l2", title: "Barbería El Nítido" } }),
        conversacion({ id: "c", listing: { id: "l3", title: "Corte de pelo" } }),
      ],
      ultimos([
        {
          conversation_id: "b",
          sender_id: RAMON,
          body: "Dale, te espero",
          created_at: "2026-09-03T12:00:00.000Z",
        },
      ]),
      YO,
    );

    expect(hilos).toHaveLength(1);
    expect(hilos[0].personaId).toBe(RAMON);
    expect(hilos[0].conversacionIds).toHaveLength(3);
    // Abre la de actividad más reciente, no la primera que vino de la base.
    expect(hilos[0].conversacionPrincipalId).toBe("b");
    expect(hilos[0].ultimoMensaje?.body).toBe("Dale, te espero");
  });

  it("conserva los avisos como contexto, sin repetirlos", () => {
    const hilos = agruparPorPersona(
      [
        conversacion({ id: "a", listing: { id: "l1", title: "Gorra bordada" } }),
        conversacion({ id: "b", listing: { id: "l1", title: "Gorra bordada" } }),
        conversacion({ id: "c", listing: null }),
      ],
      ultimos([]),
      YO,
    );

    expect(hilos[0].avisos).toEqual(["Gorra bordada"]);
  });

  it("separa a dos personas distintas y ordena por última actividad", () => {
    const hilos = agruparPorPersona(
      [
        conversacion({ id: "a" }),
        conversacion({
          id: "b",
          counterpart_id: ALTAGRACIA,
          counterpart: persona(ALTAGRACIA, "Doña Altagracia Frías"),
        }),
      ],
      ultimos([
        {
          conversation_id: "b",
          sender_id: ALTAGRACIA,
          body: "Buenas",
          created_at: "2026-09-03T18:00:00.000Z",
        },
        {
          conversation_id: "a",
          sender_id: RAMON,
          body: "Hola",
          created_at: "2026-09-02T09:00:00.000Z",
        },
      ]),
      YO,
    );

    expect(hilos.map((h) => h.personaId)).toEqual([ALTAGRACIA, RAMON]);
  });

  it("una solicitud recibida gana sobre la charla más reciente: pide una decisión", () => {
    const hilos = agruparPorPersona(
      [
        conversacion({ id: "vieja", status: "accepted" }),
        conversacion({
          id: "solicitud",
          status: "pending",
          created_by: RAMON,
          counterpart_id: YO,
          created_at: "2026-08-01T10:00:00.000Z",
          listing: { id: "l9", title: "Habitación en Corona" },
        }),
      ],
      ultimos([
        {
          conversation_id: "vieja",
          sender_id: RAMON,
          body: "Ahí va",
          created_at: "2026-09-03T20:00:00.000Z",
        },
      ]),
      YO,
    );

    expect(hilos[0].conversacionPrincipalId).toBe("solicitud");
    expect(hilos[0].solicitudRecibidaId).toBe("solicitud");
    expect(hilos[0].solicitudRecibidaAviso).toBe("Habitación en Corona");
  });

  it("marca 'esperando respuesta' sólo si no hay ninguna charla abierta", () => {
    const soloPendienteMia = agruparPorPersona(
      [conversacion({ id: "a", status: "pending", created_by: YO })],
      ultimos([]),
      YO,
    );
    expect(soloPendienteMia[0].esperandoRespuesta).toBe(true);

    const conAceptadaAlLado = agruparPorPersona(
      [
        conversacion({ id: "a", status: "pending", created_by: YO }),
        conversacion({ id: "b", status: "accepted" }),
      ],
      ultimos([]),
      YO,
    );
    expect(conAceptadaAlLado[0].esperandoRespuesta).toBe(false);
  });

  it("ignora las bloqueadas aunque la consulta se olvide de filtrarlas", () => {
    const hilos = agruparPorPersona(
      [conversacion({ id: "a", status: "blocked" })],
      ultimos([]),
      YO,
    );
    expect(hilos).toHaveLength(0);
  });

  it("usa el alta de la solicitud cuando todavía no hay mensajes", () => {
    const hilos = agruparPorPersona(
      [conversacion({ id: "a", created_at: "2026-09-04T08:00:00.000Z" })],
      ultimos([]),
      YO,
    );
    expect(hilos[0].ultimaActividad).toBe("2026-09-04T08:00:00.000Z");
    expect(hilos[0].ultimoMensaje).toBeNull();
  });

  it("toma el perfil correcto según quién creó la conversación", () => {
    const hilos = agruparPorPersona(
      [
        conversacion({
          id: "a",
          created_by: RAMON,
          counterpart_id: YO,
          creator: persona(RAMON, "Ramón Cabrera"),
          counterpart: persona(YO, "Yo Mismo"),
        }),
      ],
      ultimos([]),
      YO,
    );
    expect(hilos[0].persona?.display_name).toBe("Ramón Cabrera");
  });
});
