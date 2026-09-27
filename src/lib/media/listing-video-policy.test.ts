import { describe, expect, it } from "vitest";
import {
  LISTING_VIDEO_CARD_CAP_SECONDS,
  LISTING_VIDEO_MAX_SECONDS,
  esVideoLargoDeAviso,
  evaluarVideoDeAviso,
  mensajeDeVideoDeAviso,
  toListingVideoView,
} from "./listing-video-policy";

describe("evaluarVideoDeAviso", () => {
  it("acepta un video de 90 s en un aviso gratis", () => {
    expect(evaluarVideoDeAviso(90, "free")).toEqual({ ok: true, seconds: 90, largo: false });
  });

  it("pide premium para un video de más de 90 s en un aviso gratis", () => {
    expect(evaluarVideoDeAviso(91, "free")).toEqual({
      ok: false,
      motivo: "necesita-premium",
      seconds: 91,
    });
  });

  it("acepta hasta 5 minutos en un aviso premium y lo marca como largo", () => {
    expect(evaluarVideoDeAviso(300, "premium")).toEqual({ ok: true, seconds: 300, largo: true });
  });

  it("rechaza más de 5 minutos aunque el aviso sea premium", () => {
    expect(evaluarVideoDeAviso(301, "premium")).toEqual({
      ok: false,
      motivo: "supera-5-minutos",
      seconds: 301,
    });
  });

  it("rechaza más de 5 minutos en un aviso gratis sin ofrecer premium", () => {
    const veredicto = evaluarVideoDeAviso(400, "free");
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.motivo).toBe("supera-5-minutos");
  });

  it("redondea hacia arriba: 90.2 s ya no es un video corto", () => {
    const veredicto = evaluarVideoDeAviso(90.2, "free");
    expect(veredicto.ok).toBe(false);
  });

  it("no acepta una duración que no se pudo medir", () => {
    expect(evaluarVideoDeAviso(null, "premium")).toEqual({
      ok: false,
      motivo: "duracion-desconocida",
      seconds: null,
    });
  });

  it("trata un tier desconocido como gratis", () => {
    expect(evaluarVideoDeAviso(120, "gold").ok).toBe(false);
  });
});

describe("esVideoLargoDeAviso", () => {
  it("es largo sólo si pasa de 90 s y el aviso es premium", () => {
    expect(esVideoLargoDeAviso({ durationSeconds: 200, tier: "premium" })).toBe(true);
    expect(esVideoLargoDeAviso({ durationSeconds: 90, tier: "premium" })).toBe(false);
  });

  it("un aviso que dejó de ser premium no ofrece el video completo", () => {
    expect(esVideoLargoDeAviso({ durationSeconds: 200, tier: "free" })).toBe(false);
  });
});

describe("mensajeDeVideoDeAviso", () => {
  it("dice cuánto dura el video y el tope al pasarse de 5 minutos", () => {
    const texto = mensajeDeVideoDeAviso({ ok: false, motivo: "supera-5-minutos", seconds: 372 });
    expect(texto).toContain("6:12");
    expect(texto).toContain("5 minutos");
  });

  it("nombra premium cuando el video pasa de 90 s", () => {
    const texto = mensajeDeVideoDeAviso({ ok: false, motivo: "necesita-premium", seconds: 150 });
    expect(texto).toContain("90 segundos");
    expect(texto.toLowerCase()).toContain("premium");
  });
});

describe("toListingVideoView", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    video_path: "t/u/video-1.mp4",
    video_poster_path: "t/u/poster-1.jpg",
    video_duration_seconds: 45,
    tier: "free",
  };

  it("sin ruta no hay video", () => {
    expect(toListingVideoView({ ...base, video_path: null })).toBeNull();
  });

  it("arma las URLs públicas del bucket de medios", () => {
    const view = toListingVideoView(base);
    expect(view?.url).toMatch(/\/storage\/v1\/object\/public\/post-media\/t\/u\/video-1\.mp4$/);
    expect(view?.posterUrl).toMatch(/post-media\/t\/u\/poster-1\.jpg$/);
    expect(view?.durationSeconds).toBe(45);
  });

  it("sólo un video largo de un aviso premium lleva a la sección de videos largos", () => {
    expect(toListingVideoView(base)?.fullVideoHref).toBeNull();
    expect(
      toListingVideoView({ ...base, video_duration_seconds: 200, tier: "premium" })?.fullVideoHref,
    ).toBe(`/videos/largos/aviso/${base.id}`);
  });

  it("los topes son 90 s en la tarjeta y 5 minutos en total", () => {
    expect(LISTING_VIDEO_CARD_CAP_SECONDS).toBe(90);
    expect(LISTING_VIDEO_MAX_SECONDS).toBe(300);
  });
});
