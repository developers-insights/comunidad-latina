// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PostCardModel } from "@/components/feed";

/**
 * EL REEL QUE SE ABRE ENCIMA DEL FEED — la parte que decide SI se abre.
 *
 * El overlay pide su primera tanda al servidor y tiene una sola pregunta que
 * contestar antes de pintarse: ¿esta tanda EMPIEZA en el video que la persona
 * tocó? Si no, no se abre — se avisa y quien tocó cae a su respaldo.
 *
 * No es una defensa teórica. `fetchVideoReelsPage` intenta poner el post de
 * `startId` a la cabeza, pero cuando ese post no es elegible para Videos Cortos
 * lo SALTEA y devuelve la tanda igual, empezando por otro. Los posts que llegan
 * a este camino y pueden no ser elegibles existen: un video de más de 90 s de
 * una publicación premium, o los 7 anteriores a la 0046 que no declaran tipo.
 * Sin el chequeo, tocar uno de ésos abriría el reel en el video de otra persona.
 */

const state = vi.hoisted(() => ({ abrir: vi.fn() }));

vi.mock("./actions", () => ({
  openReelAtPostAction: (input: unknown) => state.abrir(input),
}));

// El scroll de videos tiene sus propios tests (`video-reels.test.tsx`): acá sólo
// importa SI se monta y con qué tanda.
vi.mock("./video-reels", () => ({
  ReelStream: ({ initialItems }: { initialItems: PostCardModel[] }) => (
    <div data-testid="reel-stream" data-primero={initialItems[0]?.id ?? ""} />
  ),
}));

import { ReelOverlay } from "./reel-overlay";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const OTRO_ID = "22222222-2222-4222-8222-222222222222";

const post = (id: string) => ({ id }) as PostCardModel;

function montar() {
  const onClose = vi.fn();
  const onUnavailable = vi.fn();
  render(
    <ReelOverlay
      postId={POST_ID}
      scope="negocios"
      onClose={onClose}
      onUnavailable={onUnavailable}
    />,
  );
  return { onClose, onUnavailable };
}

afterEach(() => {
  cleanup();
  state.abrir.mockReset();
});

describe("ReelOverlay — abre en el video que se tocó, o no abre", () => {
  it("pide la tanda empezando por ESE post y con el scope de la tarjeta", async () => {
    state.abrir.mockResolvedValue({
      items: [post(POST_ID), post(OTRO_ID)],
      nextCursor: null,
      tenantId: "tenant-1",
      viewerId: "user-1",
    });

    montar();

    await waitFor(() => expect(screen.getByTestId("reel-stream")).toBeTruthy());
    expect(state.abrir).toHaveBeenCalledWith({ scope: "negocios", startId: POST_ID });
    // El scroll arranca en el video tocado; los demás vienen detrás.
    expect(screen.getByTestId("reel-stream").getAttribute("data-primero")).toBe(POST_ID);
  });

  it("si la tanda EMPIEZA en otro video, no se abre: avisa y se corre", async () => {
    // El caso real: el post tocado no es elegible para Videos Cortos, así que la
    // query lo saltea y devuelve la tanda igual. Abrir acá sería mandar a la
    // persona al video de otra persona.
    state.abrir.mockResolvedValue({
      items: [post(OTRO_ID)],
      nextCursor: null,
      tenantId: "tenant-1",
      viewerId: "user-1",
    });

    const { onUnavailable } = montar();

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("reel-stream")).toBeNull();
  });

  it("una tanda vacía tampoco abre un reel vacío", async () => {
    state.abrir.mockResolvedValue({
      items: [],
      nextCursor: null,
      tenantId: "",
      viewerId: null,
    });

    const { onUnavailable } = montar();

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("reel-stream")).toBeNull();
  });

  it("si la consulta falla, cae al respaldo en vez de dejar un overlay negro", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.abrir.mockRejectedValue(new Error("sin red"));

    const { onUnavailable } = montar();

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
  });

  it("mientras carga ya se puede volver: la salida está desde el primer frame", async () => {
    // Si la consulta tarda, quedarse encerrado mirando un esqueleto sería peor
    // que la espera.
    state.abrir.mockReturnValue(new Promise(() => {}));

    const { onClose } = montar();

    const salida = await screen.findByRole("button");
    salida.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
