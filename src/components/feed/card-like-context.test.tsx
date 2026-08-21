// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useOptimisticLike, type UseOptimisticLikeArgs } from "./card-like-context";

/**
 * Motor de me gusta optimista compartido (Instagram: foto y botón mueven el mismo
 * contador). Estado mutable via vi.hoisted para poder simular éxito, 23505 (ya
 * existía) y error real de la DB desde cada caso.
 */
const state = vi.hoisted(() => ({
  insertResult: { error: null as { code: string } | null },
  deleteResult: { error: null as { code: string } | null },
  push: vi.fn(),
  inserts: 0,
}));
// La hoja de entrada, manejada a mano: se registra el pedido y se guarda el
// `onAuthenticated` para poder decidir, por caso, si la persona ENTRÓ o si
// cerró la hoja sin entrar.
const authGate = vi.hoisted(() => ({
  calls: [] as { reason?: string; onAuthenticated?: () => void }[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => "/feed",
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { like: "Entrá para dar me gusta" },
  useRequireAuth: () => (args: { reason?: string; onAuthenticated?: () => void }) => {
    authGate.calls.push(args ?? {});
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      insert: () => {
        state.inserts += 1;
        return Promise.resolve(state.insertResult);
      },
      delete: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => Promise.resolve(state.deleteResult),
          }),
        }),
      }),
    }),
  }),
}));

function Harness(props: UseOptimisticLikeArgs) {
  const like = useOptimisticLike(props);
  return (
    <div>
      <span data-testid="liked">{String(like.liked)}</span>
      <span data-testid="count">{like.count}</span>
      <span data-testid="canReact">{String(like.canReact)}</span>
      <button type="button" onClick={() => like.toggle(!like.liked)}>
        toggle
      </button>
      <button type="button" onClick={() => like.likeOnce()}>
        likeOnce
      </button>
    </div>
  );
}

const LOGGED_IN: UseOptimisticLikeArgs = {
  postId: "post-1",
  tenantId: "tenant-1",
  viewerId: "user-1",
  initialLiked: false,
  initialCount: 3,
};

const liked = () => screen.getByTestId("liked").textContent;
const count = () => screen.getByTestId("count").textContent;

describe("useOptimisticLike", () => {
  beforeEach(() => {
    state.insertResult = { error: null };
    state.deleteResult = { error: null };
    state.inserts = 0;
    state.push.mockClear();
    authGate.calls.length = 0;
  });
  afterEach(cleanup);

  /**
   * Regresión de la revisión de código (2026-08-20): el ME GUSTA FANTASMA.
   *
   * El deseo pendiente se armaba ANTES de abrir la hoja de entrada, así que
   * cerrarla sin entrar dejaba el ref cargado. El efecto que lo consume espera
   * un cambio de `viewerId`, o sea CUALQUIER login posterior: entrar más tarde
   * por otro motivo le aplicaba el me gusta abandonado a la publicación de
   * antes, y le mandaba la notificación a su autor.
   */
  it("cerrar la hoja sin entrar NO deja un me gusta armado para el próximo login", async () => {
    const view = render(
      <Harness {...LOGGED_IN} viewerId={null} initialLiked={false} />,
    );
    fireEvent.click(screen.getByText("toggle"));

    // Se pidió sesión y no se escribió nada todavía.
    expect(authGate.calls).toHaveLength(1);
    expect(state.inserts).toBe(0);

    // La persona CIERRA la hoja: `onAuthenticated` no se ejecuta nunca.
    // Más tarde entra por otro motivo y el viewer aparece.
    view.rerender(<Harness {...LOGGED_IN} viewerId="user-1" initialLiked={false} />);

    await waitFor(() => expect(state.inserts).toBe(0));
    expect(liked()).toBe("false");
  });

  it("si SÍ entra, el me gusta que había quedado pendiente se aplica", async () => {
    const view = render(
      <Harness {...LOGGED_IN} viewerId={null} initialLiked={false} />,
    );
    fireEvent.click(screen.getByText("toggle"));
    expect(authGate.calls).toHaveLength(1);

    // Entró: la hoja ejecuta el `onAuthenticated` y después llega el viewer
    // verdadero con el refresh del árbol del servidor.
    authGate.calls[0].onAuthenticated?.();
    view.rerender(<Harness {...LOGGED_IN} viewerId="user-1" initialLiked={false} />);

    await waitFor(() => expect(state.inserts).toBe(1));
  });

  it("like optimista: la UI sube al instante (antes de que responda la DB)", () => {
    render(<Harness {...LOGGED_IN} />);
    fireEvent.click(screen.getByText("toggle"));
    expect(liked()).toBe("true");
    expect(count()).toBe("4");
  });

  it("quitar el me gusta baja el contador (nunca por debajo de 0)", () => {
    render(<Harness {...LOGGED_IN} initialLiked initialCount={1} />);
    fireEvent.click(screen.getByText("toggle"));
    expect(liked()).toBe("false");
    expect(count()).toBe("0");
  });

  it("doble-tap (likeOnce) es idempotente: no suma dos veces", () => {
    render(<Harness {...LOGGED_IN} initialCount={0} />);
    fireEvent.click(screen.getByText("likeOnce"));
    fireEvent.click(screen.getByText("likeOnce"));
    expect(liked()).toBe("true");
    expect(count()).toBe("1");
  });

  /**
   * Antes esto navegaba a /entrar. Desde 2026-08-20 la sesión se pide en la
   * misma pantalla ("no te tiene que mover a otra publicación"), así que lo que
   * se fija es que el corazón no miente Y que nadie sale del feed.
   */
  it("anónimo (viewer null): no cambia el estado y pide sesión sin navegar", () => {
    render(<Harness {...LOGGED_IN} viewerId={null} />);
    fireEvent.click(screen.getByText("toggle"));
    expect(liked()).toBe("false");
    expect(count()).toBe("3");
    expect(state.push).not.toHaveBeenCalled();
    expect(authGate.calls).toHaveLength(1);
    expect(screen.getByTestId("canReact").textContent).toBe("false");
  });

  it("si la DB rechaza el insert, se revierte el optimismo", async () => {
    state.insertResult = { error: { code: "500" } };
    render(<Harness {...LOGGED_IN} />);
    fireEvent.click(screen.getByText("toggle"));
    // Optimista primero…
    expect(liked()).toBe("true");
    // …y luego revierte cuando la DB dice que no.
    await waitFor(() => expect(liked()).toBe("false"));
    expect(count()).toBe("3");
  });

  it("23505 (ya existía la reacción) NO revierte: el estado ya es correcto", async () => {
    state.insertResult = { error: { code: "23505" } };
    render(<Harness {...LOGGED_IN} />);
    fireEvent.click(screen.getByText("toggle"));
    expect(liked()).toBe("true");
    // Damos tiempo a la transición; debe seguir en true.
    await waitFor(() => expect(count()).toBe("4"));
    expect(liked()).toBe("true");
  });
});
