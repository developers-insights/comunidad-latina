// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/**
 * La hoja de entrada existe para que ninguna acción del feed expulse a la
 * persona de la pantalla (feedback cliente 2026-08-20: "ahí nomás dentro de
 * pantalla se tiene que fluir sin sacarte del feed").
 *
 * Lo que se prueba acá es ESE contrato, no los formularios de auth —que ya
 * tienen su propio camino y sus server actions— sino: que pedir sesión NO
 * navega, que al entrar se reanuda la acción original, que cerrar sin entrar la
 * descarta, y que sin provider nada explota (una card puede renderizarse fuera
 * del layout de la app).
 */

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  pathname: "/feed",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: vi.fn() }),
  usePathname: () => nav.pathname,
}));

// El PANEL se stubea entero: trae los dos formularios de auth, los botones de
// OAuth y sus server actions (que importan `next/headers`). Acá sólo interesa
// CUÁNDO se monta y qué pasa cuando avisa que hay sesión, así que el stub
// expone `onAuthenticated` y `onDismiss` como botones.
vi.mock("./auth-sheet-panel", () => ({
  AuthSheetPanel: ({
    step,
    destination,
    onAuthenticated,
    onDismiss,
  }: {
    step: string;
    destination: string;
    onAuthenticated: () => void;
    onDismiss: () => void;
  }) => (
    <div data-testid="panel" data-step={step} data-destination={destination}>
      <button type="button" onClick={onAuthenticated}>
        stub-entrar
      </button>
      <button type="button" onClick={onDismiss}>
        stub-cerrar
      </button>
    </div>
  ),
}));

// motion neutralizado: el DOM refleja el estado al instante (patrón del repo).
vi.mock("motion/react", () => {
  const filter = (props: Record<string, unknown>) => {
    const {
      layout,
      initial,
      animate,
      exit,
      transition,
      drag,
      dragConstraints,
      dragElastic,
      onDragEnd,
      whileTap,
      whileHover,
      ...rest
    } = props;
    return rest;
  };
  const div = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div {...filter(props)}>{children}</div>
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { div },
    motion: { div },
    useReducedMotion: () => true,
  };
});

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { AUTH_REASON, AuthSheetProvider, useRequireAuth } from "./auth-sheet";

/**
 * Isla de prueba con la misma forma que las del feed: un guard anónimo que pide
 * sesión y una acción que sólo puede correr con sesión. `hechas` cuenta las
 * veces que la acción llegó a ejecutarse.
 */
const hechas: string[] = [];

function IslaDelFeed({ reason }: { reason?: string }) {
  const requireAuth = useRequireAuth();
  return (
    <button
      type="button"
      onClick={() =>
        requireAuth({
          ...(reason ? { reason } : {}),
          onAuthenticated: () => hechas.push("comentario publicado"),
        })
      }
    >
      Comentar
    </button>
  );
}

/**
 * Isla que SÍ sabe dónde está parada: la publicación de la pantalla es la que
 * la persona fue a ver (abrió el enlace compartido), así que pide no plegar.
 */
function IslaDelDetalle() {
  const requireAuth = useRequireAuth();
  return (
    <button
      type="button"
      onClick={() =>
        requireAuth({
          reason: AUTH_REASON.like,
          foldPostDetail: false,
          onAuthenticated: () => hechas.push("me gusta guardado"),
        })
      }
    >
      Me gusta acá
    </button>
  );
}

function OtraIsla() {
  const requireAuth = useRequireAuth();
  return (
    <button
      type="button"
      onClick={() =>
        requireAuth({
          reason: AUTH_REASON.like,
          onAuthenticated: () => hechas.push("me gusta guardado"),
        })
      }
    >
      Me gusta
    </button>
  );
}

beforeEach(() => {
  hechas.length = 0;
  nav.push.mockClear();
  nav.refresh.mockClear();
  nav.pathname = "/feed";
});

afterEach(() => {
  cleanup();
});

describe("hoja de entrada del feed", () => {
  it("comentar sin sesión NO navega: abre la hoja ahí mismo", () => {
    render(
      <AuthSheetProvider>
        <IslaDelFeed reason={AUTH_REASON.comment} />
      </AuthSheetProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Comentar"));

    // Lo que el cliente pidió: nadie se mueve de pantalla.
    expect(nav.push).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // El título nombra la acción que se intentó, no el mecanismo.
    expect(screen.getByText(AUTH_REASON.comment)).toBeTruthy();
  });

  it("al entrar cierra, refresca el servidor y reanuda la acción original", async () => {
    render(
      <AuthSheetProvider>
        <IslaDelFeed reason={AUTH_REASON.comment} />
      </AuthSheetProvider>,
    );

    fireEvent.click(screen.getByText("Comentar"));
    fireEvent.click(await screen.findByText("stub-entrar"));

    expect(hechas).toEqual(["comentario publicado"]);
    // Refresh y no push: la sesión del servidor se renueva SIN navegar, así que
    // el scroll y la hoja de comentarios de atrás quedan donde estaban.
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("un pedido nuevo pisa la acción del anterior, no las encola", async () => {
    render(
      <AuthSheetProvider>
        <IslaDelFeed reason={AUTH_REASON.comment} />
        <OtraIsla />
      </AuthSheetProvider>,
    );

    // Pide sesión para comentar y se arrepiente…
    fireEvent.click(screen.getByText("Comentar"));
    fireEvent.click(await screen.findByText("stub-cerrar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // …y después le da me gusta a otra cosa. Al entrar se reanuda ESO, no el
    // comentario que ya había abandonado.
    fireEvent.click(screen.getByText("Me gusta"));
    fireEvent.click(await screen.findByText("stub-entrar"));

    expect(hechas).toEqual(["me gusta guardado"]);
  });

  it("cerrar sin entrar descarta la acción: no se publica nada a escondidas", async () => {
    render(
      <AuthSheetProvider>
        <IslaDelFeed reason={AUTH_REASON.comment} />
      </AuthSheetProvider>,
    );

    fireEvent.click(screen.getByText("Comentar"));
    fireEvent.click(await screen.findByText("stub-cerrar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Reabrir sin acción pendiente y entrar: la anterior NO revive.
    fireEvent.click(screen.getByText("Comentar"));
    fireEvent.click(await screen.findByText("stub-cerrar"));
    expect(hechas).toEqual([]);
  });

  it("Escape cierra la hoja de arriba y deja abierta la de abajo", async () => {
    /**
     * ESTE TEST CAMBIÓ DE SUJETO EL 2026-08-20, y vale la pena decir por qué.
     *
     * Antes espiaba un `keydown` suelto en `document` y exigía que NO llegara:
     * estaba fijando el MECANISMO del parche que vivía en esta hoja —un
     * interceptor de Escape en fase de captura con `stopImmediatePropagation`—
     * y no el resultado. Ese parche se borró: era la defensa de UNA hoja para
     * un problema de TODAS (dos hojas cualesquiera sin ésta de por medio
     * seguían cayendo juntas), y ahora el reparto lo hace la pila LIFO de
     * `useFocusTrap`, donde atiende el teclado sólo la capa de más arriba.
     *
     * Con ese reparto la propagación ya no es la señal: los listeners vecinos
     * SÍ reciben el evento y se abstienen solos. Así que abajo va una hoja de
     * verdad, y lo que se fija es lo único que la persona percibe: un Escape
     * cierra la hoja de entrada y la de atrás sigue ahí, con su hilo abierto.
     */
    const cerrarLaDeAbajo = vi.fn();
    render(
      <AuthSheetProvider>
        <BottomSheet open onClose={cerrarLaDeAbajo} title="Comentarios">
          <p>hilo de la publicación</p>
        </BottomSheet>
        <IslaDelFeed reason={AUTH_REASON.comment} />
      </AuthSheetProvider>,
    );

    const laDeAbajo = screen.getByRole("dialog", { name: "Comentarios" });
    fireEvent.click(screen.getByText("Comentar"));
    await screen.findByText("stub-entrar");
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: AUTH_REASON.comment }),
      ).toBeNull(),
    );
    expect(cerrarLaDeAbajo).not.toHaveBeenCalled();
    expect(laDeAbajo.isConnected).toBe(true);
  });

  it("el destino de respaldo nunca es el detalle de una publicación", async () => {
    // Desde /feed/[id] los caminos que se van del navegador (Google, enlace
    // mágico, confirmar correo) vuelven al feed: es el destino que el cliente
    // marcó como error — "no te tiene que mover a otra publicación".
    nav.pathname = "/feed/abc-123";
    render(
      <AuthSheetProvider>
        <IslaDelFeed />
      </AuthSheetProvider>,
    );
    fireEvent.click(screen.getByText("Comentar"));

    const panel = await screen.findByTestId("panel");
    expect(panel.getAttribute("data-destination")).toBe("/feed");
  });

  it("quien abrió el enlace compartido vuelve A ESA publicación, no al feed", async () => {
    /**
     * EL OTRO LADO DE LA MONEDA (revisión 2026-08-20). El pliegue de arriba
     * nació para quien tocó comentar DESDE el feed. Pero `/feed/[id]` es una
     * página, y al `pathname` sólo se llega estando ahí: abriendo el enlace que
     * alguien compartió o una notificación. A esa persona plegarle al feed le
     * come justo lo que fue a ver — toca ♥, entra con Google, vuelve del
     * navegador y la publicación no está.
     *
     * Y son los caminos que se van del navegador los únicos que no pueden
     * reanudar nada: el destino es todo lo que tienen. Por eso lo decide la
     * isla, que es la que sabe desde qué superficie se tocó.
     */
    nav.pathname = "/feed/abc-123";
    render(
      <AuthSheetProvider>
        <IslaDelDetalle />
      </AuthSheetProvider>,
    );
    fireEvent.click(screen.getByText("Me gusta acá"));

    const panel = await screen.findByTestId("panel");
    expect(panel.getAttribute("data-destination")).toBe("/feed/abc-123");
  });

  it("el pliegue es por pedido: dos islas en la misma pantalla, dos destinos", async () => {
    // Que el default siga plegando es lo que mantiene retrocompatible a toda
    // isla que no se enteró del parámetro: en la MISMA pantalla, la que no pide
    // nada se comporta como siempre.
    nav.pathname = "/feed/abc-123";
    render(
      <AuthSheetProvider>
        <IslaDelFeed reason={AUTH_REASON.comment} />
        <IslaDelDetalle />
      </AuthSheetProvider>,
    );

    fireEvent.click(screen.getByText("Comentar"));
    expect((await screen.findByTestId("panel")).getAttribute("data-destination")).toBe(
      "/feed",
    );

    fireEvent.click(await screen.findByText("stub-cerrar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByText("Me gusta acá"));
    expect((await screen.findByTestId("panel")).getAttribute("data-destination")).toBe(
      "/feed/abc-123",
    );
  });

  it("sin provider la isla del detalle tampoco pierde la publicación", () => {
    // El camino de respaldo (una card renderizada fuera del layout de la app)
    // respeta el mismo pedido: si no, quien entra por ahí termina en otro lado
    // que quien entra por la hoja, y el bug vuelve por la puerta de atrás.
    nav.pathname = "/feed/abc-123";
    render(<IslaDelDetalle />);
    fireEvent.click(screen.getByText("Me gusta acá"));

    expect(nav.push).toHaveBeenCalledWith("/entrar?next=%2Ffeed%2Fabc-123");
  });

  it("sin provider el hook no explota: cae a /entrar con retorno al feed", () => {
    // Una card puede renderizarse fuera del layout de la app (tests, rutas
    // sueltas). El botón no puede quedar mudo ni tirar el árbol abajo.
    render(<IslaDelFeed reason={AUTH_REASON.comment} />);
    fireEvent.click(screen.getByText("Comentar"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(nav.push).toHaveBeenCalledWith("/entrar?next=%2Ffeed");
    expect(hechas).toEqual([]);
  });
});
