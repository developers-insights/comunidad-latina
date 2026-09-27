// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const readVideoIntro = vi.fn();
vi.mock("@/lib/media/measure-video", () => ({ readVideoIntro: (f: File) => readVideoIntro(f) }));
vi.mock("@/app/(app)/feed/actions", () => ({ prepareMediaUploadAction: vi.fn() }));
vi.mock("@/lib/media/upload-video", () => ({
  POST_MEDIA_BUCKET: "post-media",
  uploadVideoWithProgress: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const { ListingVideoField } = await import("./listing-video-field");

function elegir(seconds: number | null) {
  readVideoIntro.mockResolvedValueOnce({ durationSeconds: seconds, poster: null });
  const input = screen.getByLabelText("Sumar un video") as HTMLInputElement;
  const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ListingVideoField", () => {
  afterEach(cleanup);
  beforeEach(() => {
    readVideoIntro.mockReset();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("un video corto queda elegido", async () => {
    const onChange = vi.fn();
    render(<ListingVideoField value={null} onChange={onChange} tier="free" />);
    elegir(45);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toMatchObject({ tipo: "nuevo", seconds: 45 });
  });

  it("un video de 3 minutos en un aviso gratis explica lo de premium y no se elige", async () => {
    const onChange = vi.fn();
    render(
      <ListingVideoField
        value={null}
        onChange={onChange}
        tier="free"
        premiumHref="/negocios/presencia/aviso/x"
      />,
    );
    elegir(180);
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("3:00");
    expect(alerta.textContent?.toLowerCase()).toContain("premium");
    expect(screen.getByRole("link", { name: /premium/i }).getAttribute("href")).toBe(
      "/negocios/presencia/aviso/x",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("más de 5 minutos se rechaza con el tope claro", async () => {
    const onChange = vi.fn();
    render(<ListingVideoField value={null} onChange={onChange} tier="premium" />);
    elegir(360);
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("5 minutos");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("en premium un video de 4 minutos se acepta como largo", async () => {
    const onChange = vi.fn();
    render(<ListingVideoField value={null} onChange={onChange} tier="premium" />);
    elegir(240);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });

  it("se puede quitar el video elegido", () => {
    const onChange = vi.fn();
    render(
      <ListingVideoField
        value={{ tipo: "guardado", path: "t/u/v.mp4", posterPath: null, url: "https://x/v.mp4", posterUrl: null, seconds: 30 }}
        onChange={onChange}
        tier="free"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Quitar el video" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
