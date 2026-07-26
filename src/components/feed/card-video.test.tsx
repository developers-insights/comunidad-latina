// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardVideo } from "./card-video";
import { CardLikeProvider } from "./card-like-context";

/**
 * Gramática táctil del video en el feed (§5 + feedback 2026-07-26): un toque
 * abre el reel a pantalla completa, DOS toques dan me gusta — igual que la
 * foto. Acá se testea esa ventana con timers falsos: sin ella, el doble-tap
 * sería indistinguible de dos navegaciones.
 *
 * El estado de me gusta se comparte con el resto de la card vía CardLikeProvider
 * (el mismo que monta PostCard), así que el doble-tap escribe en `reactions` por
 * el cliente de Supabase — acá stubeado.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const supa = vi.hoisted(() => ({ insert: vi.fn(), remove: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/feed",
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      insert: (...args: unknown[]) => {
        supa.insert(...args);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => {
              supa.remove();
              return Promise.resolve({ error: null });
            },
          }),
        }),
      }),
    }),
  }),
}));

const POST_ID = "11111111-1111-4111-8111-111111111111";

function renderCard({
  viewerId = "viewer-1",
  viewCount = 0,
}: { viewerId?: string | null; viewCount?: number } = {}) {
  return render(
    <CardLikeProvider
      postId={POST_ID}
      tenantId="tenant-1"
      viewerId={viewerId}
      initialLiked={false}
      initialCount={3}
    >
      <CardVideo
        src="https://cdn.example.com/clip.mp4"
        postId={POST_ID}
        scope="negocios"
        viewCount={viewCount}
      />
    </CardLikeProvider>,
  );
}

/** La capa de toque es el botón grande de "Ver el video" sobre el propio video. */
function tapLayer() {
  return screen.getByRole("button", { name: /ver el video/i });
}

beforeEach(() => {
  vi.useFakeTimers();
  nav.push.mockReset();
  supa.insert.mockReset();
  supa.remove.mockReset();
  // IntersectionObserver no existe en jsdom: el autoplay no es lo que se testea acá.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CardVideo: un toque abre el reel", () => {
  it("navega a /videos con el post de arranque y el scope del tab, recién al vencer la ventana", () => {
    renderCard();
    fireEvent.click(tapLayer());

    // Todavía dentro de la ventana de doble-tap: no se navegó.
    expect(nav.push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith(
      `/videos?start=${POST_ID}&scope=negocios`,
    );
  });
});

describe("CardVideo: doble toque da me gusta", () => {
  it("dos toques dentro de la ventana likean y NO navegan", () => {
    renderCard();
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(tapLayer());

    // Aunque pase el tiempo, el timer del primer toque quedó cancelado.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(nav.push).not.toHaveBeenCalled();
    expect(supa.insert).toHaveBeenCalledTimes(1);
  });

  it("el doble toque NUNCA quita el me gusta (para eso está el botón)", () => {
    renderCard();
    // Primer doble-tap: likea.
    fireEvent.click(tapLayer());
    fireEvent.click(tapLayer());
    // Segundo doble-tap sobre algo ya likeado: no vuelve a escribir ni borra.
    fireEvent.click(tapLayer());
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(supa.insert).toHaveBeenCalledTimes(1);
    expect(supa.remove).not.toHaveBeenCalled();
  });

  it("sin sesión el doble toque lleva a /entrar en vez de fingir un me gusta", () => {
    renderCard({ viewerId: null });
    fireEvent.click(tapLayer());
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(supa.insert).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/entrar?next=%2Ffeed");
  });
});

describe("CardVideo: píldora de vistas", () => {
  it("muestra las vistas cuando hay, y nada cuando el post todavía no tiene ninguna", () => {
    const { unmount } = renderCard({ viewCount: 1240 });
    expect(screen.getByText(/vistas/)).toBeTruthy();
    unmount();

    renderCard({ viewCount: 0 });
    expect(screen.queryByText(/vistas/)).toBeNull();
  });

  it("el botón de sonido sigue siendo suyo: no abre el reel ni likea", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /silenciar el video|activar el sonido/i }));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(nav.push).not.toHaveBeenCalled();
    expect(supa.insert).not.toHaveBeenCalled();
  });
});
