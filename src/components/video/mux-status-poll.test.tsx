// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { __resetMuxPollForTests, useMuxLiveStatus } from "./mux-status-poll";

/**
 * =============================================================================
 * EL COSTO DEL SONDEO — que es la razón entera por la que este módulo existe
 * =============================================================================
 *
 * La forma obvia de esperar a que Mux termine es un `setInterval` de 4 s por
 * componente. Es lo que hace el panel de admin de Poncho, y para un panel de
 * admin está bien.
 *
 * En un feed sería caro de tres maneras distintas, y este archivo ancla las tres
 * defensas: una sola consulta por tanda sin importar cuántas tarjetas haya, una
 * espera que crece cuando no pasa nada, y cero consultas con la app en segundo
 * plano. Si alguien las saca, los tests de acá se ponen rojos antes de que un
 * teléfono en 4G pague la cuenta.
 */

const sondeo = vi.hoisted(() => ({
  fetch: vi.fn(async (_ids: string[]) => ({}) as Record<string, unknown>),
}));

vi.mock("@/app/(app)/feed/mux-status-actions", () => ({
  fetchMuxStatusesAction: sondeo.fetch,
}));

function Sonda({ postId, status = "processing" }: { postId: string; status?: string }) {
  const vivo = useMuxLiveStatus({ postId, status });
  return <span data-testid={postId}>{vivo.status ?? "sin-estado"}</span>;
}

/** Deja avanzar los timers Y las promesas que esos timers dispararon. */
async function avanzar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  __resetMuxPollForTests();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("una sola consulta por tanda", () => {
  it("cinco tarjetas esperando son UNA consulta, con los cinco ids", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    render(
      <>
        {ids.map((id) => (
          <Sonda key={id} postId={id} />
        ))}
      </>,
    );

    await avanzar(4_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(1);
    expect(sondeo.fetch).toHaveBeenCalledWith(ids);
  });

  it("un estado que ya resolvió no se suscribe: cero consultas", async () => {
    render(
      <>
        <Sonda postId="listo" status="ready" />
        <Sonda postId="fallado" status="errored" />
        <Sonda postId="del-bucket" status="" />
      </>,
    );

    await avanzar(60_000);
    expect(sondeo.fetch).not.toHaveBeenCalled();
  });
});

describe("la espera crece cuando no pasa nada", () => {
  it("4 s, después 6 s, después 9 s… en vez de 4 s para siempre", async () => {
    render(<Sonda postId="a" />);

    await avanzar(4_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(1);

    // A los 4 s de la primera tanda todavía NO hay segunda: la espera ya se
    // estiró a 6 s.
    await avanzar(4_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(1);
    await avanzar(2_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(2);

    // Y la tercera espera 9 s, no 6.
    await avanzar(6_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(2);
    await avanzar(3_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(3);
  });

  it("en cinco minutos de espera son un puñado de consultas, no setenta y cinco", async () => {
    // Con un intervalo fijo de 4 s, cinco minutos son 75 consultas por tarjeta.
    render(<Sonda postId="a" />);
    for (let i = 0; i < 300; i += 1) await avanzar(1_000);
    expect(sondeo.fetch.mock.calls.length).toBeLessThan(20);
    expect(sondeo.fetch.mock.calls.length).toBeGreaterThan(5);
  });
});

describe("con la app en segundo plano no se pregunta nada", () => {
  it("la pestaña oculta apaga el sondeo, y volver lo reanuda enseguida", async () => {
    render(<Sonda postId="a" />);
    await avanzar(4_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(1);

    const visibilidad = vi.spyOn(document, "visibilityState", "get");
    visibilidad.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    // Un minuto entero en segundo plano: ni una consulta más.
    for (let i = 0; i < 60; i += 1) await avanzar(1_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(1);

    // Volver a la app es cuando la persona quiere ver si ya está: se pregunta
    // en el acto, sin esperar el próximo tick.
    visibilidad.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(sondeo.fetch).toHaveBeenCalledTimes(2);
    visibilidad.mockRestore();
  });
});

describe("cuando el video termina", () => {
  it("la tarjeta se entera y el sondeo se apaga solo", async () => {
    sondeo.fetch.mockResolvedValueOnce({
      a: { status: "ready", playbackId: "PLAY", durationSeconds: 12 },
    });
    const { getByTestId } = render(<Sonda postId="a" />);

    await avanzar(4_000);
    expect(getByTestId("a").textContent).toBe("ready");

    // Ya no queda nadie esperando: no se pregunta más, para siempre.
    const consultasHastaAca = sondeo.fetch.mock.calls.length;
    for (let i = 0; i < 120; i += 1) await avanzar(1_000);
    expect(sondeo.fetch.mock.calls.length).toBe(consultasHastaAca);
  });

  it("una tanda que falla no rompe nada: se reintenta más tarde", async () => {
    sondeo.fetch.mockRejectedValueOnce(new Error("sin red"));
    const { getByTestId } = render(<Sonda postId="a" />);

    await avanzar(4_000);
    expect(getByTestId("a").textContent).toBe("processing");
    await avanzar(6_000);
    expect(sondeo.fetch.mock.calls.length).toBeGreaterThan(1);
  });
});
