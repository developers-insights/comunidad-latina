// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CardVideo } from "./card-video";
import { VIDEO_COPY } from "@/components/video/copy";
import { __resetMuxPollForTests } from "@/components/video/mux-status-poll";

/**
 * =============================================================================
 * LAS DOS REGLAS INNEGOCIABLES DEL PEDIDO, VISTAS DESDE LA TARJETA
 * =============================================================================
 *
 *  · REGLA 2 — los 36 videos que YA estaban en el bucket tienen que seguir
 *    reproduciéndose. Una fila sin `mux_playback_id` usa el `<video>` de
 *    siempre, y nada de lo que se agregó puede cambiar eso.
 *  · REGLA 3 — mientras Mux transcodifica, la tarjeta muestra un estado honesto.
 *    Nunca un reproductor vacío, nunca un cuadro negro.
 *
 * El reproductor de Mux se stubea a propósito: montarlo de verdad en jsdom
 * traería `media-chrome` y `hls.js` a un test que no está probando la
 * reproducción, sino QUÉ decide pintar la tarjeta. Lo que sí se verifica de
 * verdad es que llegue el `playbackId` correcto.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const viewer = vi.hoisted(() => ({ open: vi.fn(), available: true }));
const sondeo = vi.hoisted(() => ({ fetch: vi.fn(async () => ({})) }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/feed",
}));

vi.mock("./media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open, available: viewer.available }),
}));

vi.mock("@/components/video/mux-player", () => ({
  MuxVideoSurface: ({ playbackId }: { playbackId: string }) => (
    <div data-testid="mux-surface" data-playback-id={playbackId} />
  ),
}));

vi.mock("@/app/(app)/feed/mux-status-actions", () => ({
  fetchMuxStatusesAction: sondeo.fetch,
}));

const POST_ID = "11111111-1111-4111-8111-111111111111";
const ARCHIVO = "https://cdn.example.com/clip.mp4";
const PLAYBACK = "AbC123playback";

function renderVideo(props: Partial<React.ComponentProps<typeof CardVideo>> = {}) {
  return render(
    <CardVideo src={ARCHIVO} postId={POST_ID} scope="para-ti" {...props} />,
  );
}

afterEach(() => {
  cleanup();
  __resetMuxPollForTests();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("REGLA 2 — los videos que ya estaban siguen andando", () => {
  it("sin nada de Mux se reproduce el archivo del bucket, como siempre", () => {
    const { container } = renderVideo();
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", ARCHIVO);
    expect(screen.queryByTestId("mux-surface")).not.toBeInTheDocument();
  });

  it("un mux_status que no reconocemos NO rompe la tarjeta: cae al archivo", () => {
    // Basura en la columna no puede dejar sin video una publicación que tiene
    // un archivo perfectamente reproducible.
    const { container } = renderVideo({ muxStatus: "vaya-a-saber", muxPlaybackId: PLAYBACK });
    expect(container.querySelector("video")).not.toBeNull();
    expect(screen.queryByTestId("mux-surface")).not.toBeInTheDocument();
  });

  it("un video del bucket NUNCA dispara el sondeo de estado", () => {
    renderVideo();
    expect(sondeo.fetch).not.toHaveBeenCalled();
  });
});

describe("con el video listo en Mux", () => {
  it("reproduce con el reproductor de Mux y no con un <video>", () => {
    const { container } = renderVideo({ muxStatus: "ready", muxPlaybackId: PLAYBACK });
    expect(screen.getByTestId("mux-surface")).toHaveAttribute("data-playback-id", PLAYBACK);
    expect(container.querySelector("video")).toBeNull();
  });

  it("la tarjeta conserva su gramática: la capa de toque sigue estando", () => {
    // Es lo que garantiza que un toque siga abriendo el video y dos toques
    // sigan dando me gusta, con el reproductor que sea.
    renderVideo({ muxStatus: "ready", muxPlaybackId: PLAYBACK });
    expect(screen.getByRole("button", { name: /ver el video/i })).toBeInTheDocument();
  });

  it("listo pero SIN playbackId no monta un reproductor vacío", () => {
    const { container } = renderVideo({ muxStatus: "ready", muxPlaybackId: null });
    expect(screen.queryByTestId("mux-surface")).not.toBeInTheDocument();
    expect(container.querySelector("video")).not.toBeNull();
  });
});

describe("REGLA 3 — mientras se prepara, un estado honesto", () => {
  for (const status of ["uploading", "processing"] as const) {
    it(`con estado "${status}" muestra que se está preparando`, () => {
      const { container } = renderVideo({ muxStatus: status, muxPlaybackId: null });
      expect(screen.getByText(VIDEO_COPY.procesando.titulo)).toBeInTheDocument();
      expect(container.querySelector("video")).toBeNull();
      expect(screen.queryByTestId("mux-surface")).not.toBeInTheDocument();
    });
  }

  it("con el playbackId ya escrito pero todavía procesando TAMPOCO reproduce", () => {
    // Mux escribe el id del asset antes de terminar: montar el reproductor acá
    // daría un error de reproducción sobre un HLS que no existe.
    renderVideo({ muxStatus: "processing", muxPlaybackId: PLAYBACK });
    expect(screen.queryByTestId("mux-surface")).not.toBeInTheDocument();
    expect(screen.getByText(VIDEO_COPY.procesando.titulo)).toBeInTheDocument();
  });

  it("no ofrece 'Ver el video' sobre algo que todavía no se puede ver", () => {
    renderVideo({ muxStatus: "processing", muxPlaybackId: null });
    expect(screen.queryByRole("button", { name: /ver el video/i })).not.toBeInTheDocument();
  });

  it("un video que se está preparando SÍ dispara el sondeo, y no en el acto", () => {
    vi.useFakeTimers();
    renderVideo({ muxStatus: "processing", muxPlaybackId: null });
    // Al montar NO se pregunta nada: el dato que trajo el servidor es de hace un
    // instante. Preguntar en el mismo render sería una consulta garantizada por
    // cada tarjeta que aparece, para confirmar lo que ya sabemos.
    expect(sondeo.fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(1);
    expect(sondeo.fetch).toHaveBeenCalledWith([POST_ID]);
  });

  it("VARIAS tarjetas preparándose son UNA sola consulta, no una por tarjeta", () => {
    // Es la diferencia entre este sondeo y el del panel de admin de Poncho (un
    // `setInterval` por componente): en un feed, ese patrón serían N consultas
    // cada pocos segundos durante los minutos que dure la transcodificación.
    vi.useFakeTimers();
    const OTRO = "22222222-2222-4222-8222-222222222222";
    render(
      <>
        <CardVideo src={ARCHIVO} postId={POST_ID} scope="para-ti" muxStatus="processing" />
        <CardVideo src={ARCHIVO} postId={OTRO} scope="para-ti" muxStatus="processing" />
      </>,
    );

    vi.advanceTimersByTime(4_000);
    expect(sondeo.fetch).toHaveBeenCalledTimes(1);
    expect(sondeo.fetch).toHaveBeenCalledWith([POST_ID, OTRO]);
  });
});

describe("cuando Mux no pudo", () => {
  it("se dice, en vez de dejar un reproductor que no carga", () => {
    const { container } = renderVideo({ muxStatus: "errored", muxPlaybackId: PLAYBACK });
    expect(screen.getByText(VIDEO_COPY.fallo.titulo)).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByTestId("mux-surface")).not.toBeInTheDocument();
  });

  it("un video fallado no se sondea: ese estado ya no cambia solo", () => {
    renderVideo({ muxStatus: "errored", muxPlaybackId: PLAYBACK });
    expect(sondeo.fetch).not.toHaveBeenCalled();
  });
});
