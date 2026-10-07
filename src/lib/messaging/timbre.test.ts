import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pendientes: [] as Promise<unknown>[],
}));

vi.mock("next/server", () => ({
  after: (tarea: () => Promise<unknown>) => {
    mocks.pendientes.push(tarea());
  },
}));

import { tocarTimbre } from "./timbre";
import { EVENTO_MENSAJE } from "./en-vivo";

/**
 * El timbre sale con la sesión de quien escribió (canal PRIVADO, para que la
 * policy de la 0148 vuelva a verificar que participa) y no lleva contenido:
 * sólo quién y qué tipo de cambio.
 */

const GRUPO = "99999999-8888-4777-8666-555555555555";

function cliente(resultado: { success: boolean; status?: number } = { success: true }) {
  const orden: string[] = [];
  const canal = {
    httpSend: vi.fn(async () => {
      orden.push("httpSend");
      return resultado;
    }),
  };
  const supabase = {
    realtime: {
      setAuth: vi.fn(async () => {
        orden.push("setAuth");
      }),
    },
    channel: vi.fn(() => canal),
    removeChannel: vi.fn(async () => {
      orden.push("removeChannel");
    }),
  };
  return { supabase, canal, orden };
}

beforeEach(() => {
  mocks.pendientes.length = 0;
});

describe("tocarTimbre", () => {
  it("autentica, manda por REST al tópico privado del hilo y suelta el canal", async () => {
    const { supabase, canal, orden } = cliente();

    tocarTimbre(supabase, { ambito: "grupo", id: GRUPO }, "yo", "nuevo");
    await Promise.all(mocks.pendientes);

    expect(supabase.channel).toHaveBeenCalledWith(`escribiendo-grupo:${GRUPO}`, {
      config: { private: true },
    });
    expect(canal.httpSend).toHaveBeenCalledWith(
      EVENTO_MENSAJE,
      { de: "yo", tipo: "nuevo" },
      expect.anything(),
    );
    expect(orden).toEqual(["setAuth", "httpSend", "removeChannel"]);
  });

  it("si Realtime lo rechaza, avisa en el log y la action no se entera", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { supabase } = cliente({ success: false, status: 403 });

    expect(() =>
      tocarTimbre(supabase, { ambito: "directo", id: GRUPO }, "yo", "cambio"),
    ).not.toThrow();
    await Promise.all(mocks.pendientes);

    expect(aviso).toHaveBeenCalledWith("[mensajes] el timbre no salió", { status: 403 });
    aviso.mockRestore();
  });
});
