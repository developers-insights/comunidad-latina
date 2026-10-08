// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";

/**
 * VARIOS VIDEOS POR PUBLICACIÓN (camino del bucket). Lo que se ancla:
 *  · se eligen varios de una, hasta el tope; con Mux el tope es uno;
 *  · la subida arranca al ELEGIR, con progreso por miniatura;
 *  · quitar un video aborta su subida y borra lo que ya subió;
 *  · publicar espera las subidas, reintenta las fallidas y manda los arreglos
 *    paralelos (rutas, duraciones, filtros, huellas) en el orden elegido.
 * Subida, medición y muestreo van stubeados: jsdom no decodifica video.
 */

interface PendingUpload {
  path: string;
  signal?: AbortSignal;
  onProgress: (pct: number) => void;
  resolve: (ok: boolean) => void;
}

const mocks = vi.hoisted(() => ({
  createPostAction: vi.fn(),
  prepareMediaUploadAction: vi.fn(),
  getAutoriasAction: vi.fn(),
  uploads: [] as PendingUpload[],
  storageRemove: vi.fn(),
  storageUpload: vi.fn(),
  readVideoIntro: vi.fn(),
  requestMuxUpload: vi.fn(),
  startMuxUpload: vi.fn(),
}));

vi.mock("@/lib/media/upload-video", () => ({
  POST_MEDIA_BUCKET: "post-media",
  uploadVideoWithProgress: vi.fn(
    (
      _file: File,
      path: string,
      onProgress: (pct: number) => void,
      _contentType: string,
      signal?: AbortSignal,
    ) =>
      new Promise<boolean>((resolve) => {
        const entry: PendingUpload = { path, signal, onProgress, resolve };
        signal?.addEventListener("abort", () => resolve(false));
        mocks.uploads.push(entry);
      }),
  ),
}));
vi.mock("@/lib/media/measure-video", () => ({ readVideoIntro: mocks.readVideoIntro }));
vi.mock("@/lib/media/video-frames", () => ({
  sampleVideoLumaFrames: vi.fn(async () => [[7]]),
}));
vi.mock("@/lib/media/audio-samples", () => ({
  sampleAudioPcm: vi.fn(async () => new Float32Array(4)),
  encodeAudioPcm16: vi.fn(() => "PCM"),
}));
vi.mock("@/lib/media/mux-video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/mux-video")>()),
  requestMuxUpload: mocks.requestMuxUpload,
}));
vi.mock("@/components/video/mux-upload", () => ({ startMuxUpload: mocks.startMuxUpload }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: {
      from: () => ({ remove: mocks.storageRemove, upload: mocks.storageUpload }),
    },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/feed",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));
vi.mock("@/app/(app)/feed/actions", () => ({
  createPostAction: mocks.createPostAction,
  prepareMediaUploadAction: mocks.prepareMediaUploadAction,
}));
vi.mock("@/app/(app)/feed/autoria-actions", () => ({
  getAutoriasAction: mocks.getAutoriasAction,
}));
vi.mock("@/app/(app)/feed/tag-actions", () => ({
  saveTagsAction: vi.fn(async () => ({ ok: true, tagged: [], rejected: [] })),
  searchTaggableMembersAction: vi.fn(async () => ({ ok: true, people: [] })),
  removeTagAction: vi.fn(),
}));
vi.mock("@/app/(app)/feed/music-actions", () => ({
  attachPostMusicAction: vi.fn(async () => ({ ok: true, startSeconds: 0 })),
  listMusicTracksAction: vi.fn(async () => ({ ok: true, tracks: [] })),
  detachPostMusicAction: vi.fn(),
}));
vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock({ reducedMotion: false }),
);

import { PostComposerHost } from "./post-composer";
import { ComposerTrigger } from "./composer-trigger";
import { COPY } from "./copy";
import { MAX_VIDEOS } from "@/lib/media/post-media-limits";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";

function mount(muxEnabled = false) {
  return render(
    <ToastProvider>
      <PostComposerHost modules={{}} modulesSoon={{}} muxEnabled={muxEnabled}>
        <ComposerTrigger viewerName="Ana" viewerAvatarUrl={null} />
      </PostComposerHost>
    </ToastProvider>,
  );
}

function clip(name: string) {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "video/mp4" });
}

async function pickVideos(names: string[]) {
  const input = document.getElementById("post-composer-video") as HTMLInputElement;
  fireEvent.change(input, { target: { files: names.map(clip) } });
  await act(async () => {});
}

function publishButton() {
  return screen.getByRole("button", { name: COPY.composer.publish }) as HTMLButtonElement;
}

beforeEach(() => {
  mocks.uploads.length = 0;
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:preview";
    URL.revokeObjectURL = () => {};
  }
  mocks.getAutoriasAction.mockResolvedValue({
    personal: { displayName: "Ana", avatarUrl: null },
    entidades: [],
    porDefecto: null,
  });
  mocks.prepareMediaUploadAction.mockResolvedValue({ ok: true, tenantId: TENANT, userId: USER });
  mocks.readVideoIntro.mockImplementation(async (file: File) => ({
    durationSeconds: file.name.startsWith("largo") ? 75 : 30,
    poster: new Blob(["jpg"], { type: "image/jpeg" }),
  }));
  mocks.storageRemove.mockResolvedValue({ error: null });
  mocks.storageUpload.mockResolvedValue({ error: null });
  mocks.createPostAction.mockResolvedValue({ ok: true, status: "published", postId: "p1" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PostComposer — varios videos por el bucket", () => {
  it("el selector de video acepta varios archivos sin Mux y uno solo con Mux", () => {
    mount(false);
    expect((document.getElementById("post-composer-video") as HTMLInputElement).multiple).toBe(
      true,
    );
    cleanup();
    mount(true);
    expect((document.getElementById("post-composer-video") as HTMLInputElement).multiple).toBe(
      false,
    );
  });

  it("elegir varios arranca una subida por video, con progreso en su miniatura", async () => {
    mount();
    await pickVideos(["a.mp4", "b.mp4"]);

    await waitFor(() => expect(mocks.uploads).toHaveLength(2));
    expect(mocks.prepareMediaUploadAction).toHaveBeenCalledTimes(1);
    expect(mocks.uploads[0].path).toMatch(new RegExp(`^${TENANT}/${USER}/video-.+\\.mp4$`));

    act(() => mocks.uploads[1].onProgress(55));
    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["0", "55"]);
    expect(screen.getByText(`2 de ${MAX_VIDEOS} videos`)).toBeTruthy();
  });

  it("más allá del tope se descartan y se avisa", async () => {
    mount();
    await pickVideos(Array.from({ length: MAX_VIDEOS + 2 }, (_, index) => `c-${index}.mp4`));

    expect(await screen.findByText(COPY.composer.videoLimit)).toBeTruthy();
    await waitFor(() => expect(mocks.uploads).toHaveLength(MAX_VIDEOS));
  });

  it("quitar un video aborta su subida en vuelo", async () => {
    mount();
    await pickVideos(["a.mp4", "b.mp4"]);
    await waitFor(() => expect(mocks.uploads).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: `${COPY.composer.removeVideo} 1` }));

    expect(mocks.uploads[0].signal?.aborted).toBe(true);
    expect(mocks.uploads[1].signal?.aborted).toBe(false);
    expect(screen.getAllByRole("button", { name: /Quitar video/ })).toHaveLength(1);
  });

  it("quitar un video que ya subió lo borra del bucket", async () => {
    mount();
    await pickVideos(["a.mp4"]);
    await waitFor(() => expect(mocks.uploads).toHaveLength(1));
    await act(async () => mocks.uploads[0].resolve(true));

    fireEvent.click(screen.getByRole("button", { name: `${COPY.composer.removeVideo} 1` }));

    await waitFor(() => expect(mocks.storageRemove).toHaveBeenCalledWith([mocks.uploads[0].path]));
  });

  it("publicar espera las subidas y manda los arreglos paralelos en orden", async () => {
    mount();
    await pickVideos(["a.mp4", "largo.mp4"]);
    await waitFor(() => expect(mocks.uploads).toHaveLength(2));
    await act(async () => mocks.uploads[0].resolve(true));

    fireEvent.click(publishButton());
    await act(async () => {});
    expect(mocks.createPostAction).not.toHaveBeenCalled();

    await act(async () => mocks.uploads[1].resolve(true));
    await waitFor(() => expect(mocks.createPostAction).toHaveBeenCalledTimes(1));

    const data = mocks.createPostAction.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(data.get("videoPaths")))).toEqual([
      mocks.uploads[0].path,
      mocks.uploads[1].path,
    ]);
    expect(JSON.parse(String(data.get("videoDurations")))).toEqual([30, 75]);
    expect(JSON.parse(String(data.get("videoFilters")))).toEqual([null, null]);
    expect(JSON.parse(String(data.get("videoFrames")))).toEqual([[[7]], [[7]]]);
    expect(JSON.parse(String(data.get("videoAudioPcm")))).toEqual(["PCM", "PCM"]);
    expect(JSON.parse(String(data.get("mediaOrder")))).toEqual(["video", "video"]);
    // Un solo poster, del primer video, con el prefijo propio.
    expect(mocks.storageUpload).toHaveBeenCalledTimes(1);
    expect(String(data.get("videoPosterPath"))).toMatch(
      new RegExp(`^${TENANT}/${USER}/poster-`),
    );
    // Publicado: los videos son de la publicación, no se borra nada.
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it("una subida que falló se reintenta al publicar", async () => {
    mount();
    await pickVideos(["a.mp4"]);
    await waitFor(() => expect(mocks.uploads).toHaveLength(1));
    await act(async () => mocks.uploads[0].resolve(false));
    expect(await screen.findByText(COPY.composer.videoUploadRetryTitle)).toBeTruthy();

    fireEvent.click(publishButton());
    await waitFor(() => expect(mocks.uploads).toHaveLength(2));
    await act(async () => mocks.uploads[1].resolve(true));

    await waitFor(() => expect(mocks.createPostAction).toHaveBeenCalledTimes(1));
    const data = mocks.createPostAction.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(data.get("videoPaths")))).toEqual([mocks.uploads[1].path]);
  });

  it("si la publicación falla, los videos se quedan y sólo se borra el poster", async () => {
    mocks.createPostAction.mockResolvedValue({ ok: false, code: "error" });
    mount();
    await pickVideos(["a.mp4"]);
    await waitFor(() => expect(mocks.uploads).toHaveLength(1));
    await act(async () => mocks.uploads[0].resolve(true));

    fireEvent.click(publishButton());
    await waitFor(() => expect(mocks.createPostAction).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(mocks.storageRemove).toHaveBeenCalledTimes(1));
    const removed = mocks.storageRemove.mock.calls[0][0] as string[];
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/poster-/);
    expect(screen.getByRole("button", { name: `${COPY.composer.removeVideo} 1` })).toBeTruthy();
  });
});

describe("PostComposer — con Mux el tope es un video", () => {
  it("elegir dos deja uno solo, por Mux, y lo explica", async () => {
    mocks.requestMuxUpload.mockResolvedValue({
      ok: true,
      ticket: { uploadId: "u1", uploadUrl: "https://mux.test/u1", postDraftId: "d1" },
    });
    mocks.startMuxUpload.mockReturnValue({ cancel: vi.fn() });
    mount(true);

    await pickVideos(["a.mp4", "b.mp4"]);

    expect(await screen.findByText(COPY.composer.videoLimitSingle)).toBeTruthy();
    expect(screen.getByText(COPY.composer.videoSingleNote)).toBeTruthy();
    expect(mocks.requestMuxUpload).toHaveBeenCalledTimes(1);
    expect(mocks.startMuxUpload).toHaveBeenCalledTimes(1);
    expect(mocks.uploads).toHaveLength(0);
    expect(screen.queryByRole("button", { name: COPY.composer.addVideo })).toBeNull();
  });
});
