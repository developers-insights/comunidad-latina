// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * ═══ LAS GARANTÍAS DEL "ESTÁ ESCRIBIENDO…" ═════════════════════════════════
 *
 * Este indicador estuvo apagado a propósito hasta la 0143 porque un cartel que
 * miente es peor que no tener cartel. Lo que se fija acá es exactamente eso:
 *
 *  1. NUNCA QUEDA PEGADO. Sin un aviso nuevo se apaga solo a los `VIGENCIA_MS`.
 *     Quien cierra la pestaña de golpe no manda ninguna despedida.
 *  2. NO SE INUNDA EL CANAL. Una señal cada `THROTTLE_MS` como mucho, aunque el
 *     composer llame en cada tecla.
 *  3. NADIE SE ESCUCHA A SÍ MISMO — ni entre dos pestañas de la misma persona.
 *  4. EL NOMBRE NO SALE DEL PAYLOAD. Lo pone el mapa del servidor; un id
 *     desconocido cae en el genérico.
 *  5. EL CANAL ES PRIVADO Y SE AUTENTICA ANTES DE SUSCRIBIRSE. Sin `setAuth()`
 *     un canal privado conecta y no llega un solo aviso — el silencio más caro
 *     de diagnosticar que tiene Realtime.
 */

type Escucha = (mensaje: { payload: unknown }) => void;

const realtime = vi.hoisted(() => {
  const canales: {
    topico: string;
    config: unknown;
    escuchas: Escucha[];
    suscripto: boolean;
    enviados: unknown[];
  }[] = [];
  const orden: string[] = [];

  return {
    canales,
    orden,
    setAuth: vi.fn(async () => {
      orden.push("setAuth");
    }),
    reset() {
      canales.length = 0;
      orden.length = 0;
      realtime.setAuth.mockClear();
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    realtime: { setAuth: realtime.setAuth },
    channel(topico: string, config: unknown) {
      const canal = {
        topico,
        config,
        escuchas: [] as Escucha[],
        suscripto: false,
        enviados: [] as unknown[],
        on(_tipo: string, _filtro: unknown, cb: Escucha) {
          canal.escuchas.push(cb);
          return canal;
        },
        subscribe() {
          canal.suscripto = true;
          realtime.orden.push(`subscribe:${topico}`);
          return canal;
        },
        send(mensaje: unknown) {
          canal.enviados.push(mensaje);
          return Promise.resolve("ok");
        },
      };
      realtime.canales.push(canal);
      return canal;
    },
    removeChannel: vi.fn(async () => "ok"),
  }),
}));

import {
  EscribiendoProvider,
  QuienEscribe,
  RenglonEnVivo,
  useAvisoDeEscritura,
} from "./escribiendo-live";
import {
  EVENTO_ESCRIBIENDO,
  THROTTLE_MS,
  VIGENCIA_MS,
  topicoDeDirecto,
  topicoDeGrupo,
} from "@/lib/messaging/escribiendo";

const YO = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const BETO = "33333333-3333-4333-8333-333333333333";
const CONVERSACION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const GRUPO = "99999999-8888-4777-8666-555555555555";

const TOPICO = topicoDeDirecto(CONVERSACION);

function Emisor() {
  const avisar = useAvisoDeEscritura();
  return (
    <>
      <button type="button" onClick={() => avisar(true)}>
        tecla
      </button>
      <button type="button" onClick={() => avisar(false)}>
        enviado
      </button>
    </>
  );
}

/** Simula un aviso que llega por el websocket. */
function llega(topico: string, payload: unknown) {
  const canal = realtime.canales.find((c) => c.topico === topico);
  if (!canal) throw new Error(`no hay canal para ${topico}`);
  act(() => {
    for (const escucha of canal.escuchas) escucha({ payload });
  });
}

async function montar(ui: React.ReactNode) {
  const resultado = render(<>{ui}</>);
  // El provider hace `await setAuth()` antes de suscribirse: sin este flush,
  // los canales todavía no existen cuando el test los busca.
  await act(async () => {});
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers();
  realtime.reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("el canal", () => {
  it("es privado, no se escucha a sí mismo, y se autentica ANTES de suscribirse", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <QuienEscribe />
      </EscribiendoProvider>,
    );

    expect(realtime.canales).toHaveLength(1);
    expect(realtime.canales[0].topico).toBe(TOPICO);
    expect(realtime.canales[0].config).toMatchObject({
      config: { private: true, broadcast: { self: false } },
    });
    expect(realtime.orden).toEqual(["setAuth", `subscribe:${TOPICO}`]);
  });

  it("no abre nada con un tópico mal formado", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={["escribiendo-directo:no-es-uuid", "llamadas:x"]}>
        <QuienEscribe />
      </EscribiendoProvider>,
    );
    expect(realtime.canales).toHaveLength(0);
  });
});

describe("recibir", () => {
  it("pinta el cartel cuando alguien teclea", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <QuienEscribe />
      </EscribiendoProvider>,
    );

    expect(screen.queryByText("Está escribiendo…")).toBeNull();
    llega(TOPICO, { de: ANA, activo: true });
    expect(screen.getByText("Está escribiendo…")).toBeTruthy();
  });

  /** LA garantía: sin otro aviso, se apaga solo. */
  it("se apaga solo al vencer, sin que nadie avise que dejó de escribir", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <QuienEscribe />
      </EscribiendoProvider>,
    );

    llega(TOPICO, { de: ANA, activo: true });
    expect(screen.getByText("Está escribiendo…")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(VIGENCIA_MS - 1);
    });
    expect(screen.queryByText("Está escribiendo…")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.queryByText("Está escribiendo…")).toBeNull();
  });

  it("cada aviso nuevo reinicia el reloj", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <QuienEscribe />
      </EscribiendoProvider>,
    );

    llega(TOPICO, { de: ANA, activo: true });
    act(() => {
      vi.advanceTimersByTime(VIGENCIA_MS - 500);
    });
    llega(TOPICO, { de: ANA, activo: true });
    act(() => {
      vi.advanceTimersByTime(VIGENCIA_MS - 500);
    });
    expect(screen.getByText("Está escribiendo…")).toBeTruthy();
  });

  it("el aviso de que dejó de escribir lo apaga en el acto", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <QuienEscribe />
      </EscribiendoProvider>,
    );

    llega(TOPICO, { de: ANA, activo: true });
    llega(TOPICO, { de: ANA, activo: false });
    expect(screen.queryByText("Está escribiendo…")).toBeNull();
  });

  it("ignora mi propio aviso — dos pestañas mías no se hacen escribir", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <QuienEscribe />
      </EscribiendoProvider>,
    );

    llega(TOPICO, { de: YO, activo: true });
    expect(screen.queryByText("Está escribiendo…")).toBeNull();
  });

  it("ignora un payload con cualquier otra forma", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <QuienEscribe />
      </EscribiendoProvider>,
    );

    llega(TOPICO, { de: ANA });
    llega(TOPICO, "escribiendo");
    llega(TOPICO, null);
    expect(screen.queryByText("Está escribiendo…")).toBeNull();
  });
});

describe("en un grupo, con varias personas", () => {
  const TOPICO_GRUPO = topicoDeGrupo(GRUPO);
  const nombres = { [ANA]: "Ana", [BETO]: "Beto" };

  async function grupo() {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO_GRUPO]}>
        <QuienEscribe nombres={nombres} />
      </EscribiendoProvider>,
    );
  }

  it("nombra a una", async () => {
    await grupo();
    llega(TOPICO_GRUPO, { de: ANA, activo: true });
    expect(screen.getByText("Ana está escribiendo…")).toBeTruthy();
  });

  it("nombra a las dos, en orden de llegada", async () => {
    await grupo();
    llega(TOPICO_GRUPO, { de: BETO, activo: true });
    llega(TOPICO_GRUPO, { de: ANA, activo: true });
    expect(screen.getByText("Beto y Ana están escribiendo…")).toBeTruthy();
  });

  it("con tres o más deja de nombrar", async () => {
    await grupo();
    llega(TOPICO_GRUPO, { de: ANA, activo: true });
    llega(TOPICO_GRUPO, { de: BETO, activo: true });
    llega(TOPICO_GRUPO, { de: "44444444-4444-4444-8444-444444444444", activo: true });
    expect(screen.getByText("Varias personas están escribiendo…")).toBeTruthy();
  });

  /**
   * El payload lo escribe el navegador de otra persona: si el nombre viniera de
   * ahí, cualquier miembro podría hacer aparecer "Ana está escribiendo…".
   */
  it("un id que no está en el mapa del servidor cae en el genérico", async () => {
    await grupo();
    llega(TOPICO_GRUPO, {
      de: "55555555-5555-4555-8555-555555555555",
      activo: true,
      nombre: "Ana",
    });
    expect(screen.getByText("Alguien está escribiendo…")).toBeTruthy();
  });
});

describe("emitir", () => {
  it("manda una señal cada THROTTLE_MS como mucho, aunque se llame en cada tecla", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <Emisor />
      </EscribiendoProvider>,
    );

    const tecla = screen.getByText("tecla");
    for (let i = 0; i < 8; i += 1) fireEvent.click(tecla);

    const canal = realtime.canales[0];
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0]).toMatchObject({
      type: "broadcast",
      event: EVENTO_ESCRIBIENDO,
      payload: { de: YO, activo: true },
    });

    act(() => {
      vi.advanceTimersByTime(THROTTLE_MS + 1);
    });
    fireEvent.click(tecla);
    expect(canal.enviados).toHaveLength(2);
  });

  it("el aviso de que dejé de escribir sale enseguida, pero una sola vez", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <Emisor />
      </EscribiendoProvider>,
    );

    const canal = realtime.canales[0];
    fireEvent.click(screen.getByText("tecla"));
    fireEvent.click(screen.getByText("enviado"));
    expect(canal.enviados).toHaveLength(2);
    expect(canal.enviados[1]).toMatchObject({ payload: { de: YO, activo: false } });

    // El composer llama en CADA tecla: con el campo vacío, esto se dispararía
    // una vez por pulsación si no hubiera nada que apagar.
    fireEvent.click(screen.getByText("enviado"));
    fireEvent.click(screen.getByText("enviado"));
    expect(canal.enviados).toHaveLength(2);
  });

  it("fuera del provider no explota ni manda nada", () => {
    render(<Emisor />);
    fireEvent.click(screen.getByText("tecla"));
    expect(realtime.canales).toHaveLength(0);
  });
});

describe("la fila de la bandeja", () => {
  it("muestra el resumen del servidor y lo tapa sólo mientras alguien teclea", async () => {
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO]}>
        <RenglonEnVivo topico={TOPICO}>
          <span>Nota de voz · 0:24</span>
        </RenglonEnVivo>
      </EscribiendoProvider>,
    );

    expect(screen.getByText("Nota de voz · 0:24")).toBeTruthy();

    llega(TOPICO, { de: ANA, activo: true });
    expect(screen.queryByText("Nota de voz · 0:24")).toBeNull();
    expect(screen.getByText("Está escribiendo…")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(VIGENCIA_MS + 1);
    });
    expect(screen.getByText("Nota de voz · 0:24")).toBeTruthy();
  });

  it("cada fila escucha lo suyo — un aviso de otro hilo no la toca", async () => {
    const otro = topicoDeDirecto("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff");
    await montar(
      <EscribiendoProvider miId={YO} topicos={[TOPICO, otro]}>
        <RenglonEnVivo topico={TOPICO}>
          <span>resumen del primero</span>
        </RenglonEnVivo>
      </EscribiendoProvider>,
    );

    llega(otro, { de: ANA, activo: true });
    expect(screen.getByText("resumen del primero")).toBeTruthy();
    expect(screen.queryByText("Está escribiendo…")).toBeNull();
  });
});
