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
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => "/feed",
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      insert: () => Promise.resolve(state.insertResult),
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
    state.push.mockClear();
  });
  afterEach(cleanup);

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

  it("anónimo (viewer null): no cambia el estado y va a /entrar con retorno", () => {
    render(<Harness {...LOGGED_IN} viewerId={null} />);
    fireEvent.click(screen.getByText("toggle"));
    expect(liked()).toBe("false");
    expect(count()).toBe("3");
    expect(state.push).toHaveBeenCalledWith("/entrar?next=%2Ffeed");
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
