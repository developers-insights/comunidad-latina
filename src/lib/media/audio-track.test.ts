import { afterEach, describe, expect, it } from "vitest";

import {
  MUSIC_CLIP_SECONDS,
  attributionLine,
  clampStartSeconds,
  clipEndSeconds,
  clipLengthSeconds,
  formatClock,
  licenseRequiresAttribution,
  maxStartSeconds,
  musicTrackUrl,
  type MusicTrackView,
} from "./audio-track";

/**
 * Lo que estos tests protegen:
 *  - El recorte NUNCA se cae del final de la canción (ni con datos basura).
 *  - Una pista más corta que el recorte no produce números negativos.
 *  - La ATRIBUCIÓN nunca desaparece cuando la licencia la exige — ni siquiera
 *    si la fila viene con la bandera mal cargada. Es el punto legal de la
 *    feature, no una preferencia de UI.
 */

function trackOf(overrides: Partial<MusicTrackView> = {}): MusicTrackView {
  return {
    id: "t1",
    title: "Cumbia del barrio",
    artist: "Los del Sur",
    durationSeconds: 180,
    previewUrl: "https://cdn.test/audio.mp3",
    licenseKind: "cc0",
    attributionRequired: false,
    attributionText: null,
    category: "tropical",
    ...overrides,
  };
}

describe("maxStartSeconds", () => {
  it("deja lugar para el recorte completo", () => {
    expect(maxStartSeconds(180)).toBe(180 - MUSIC_CLIP_SECONDS);
  });

  it("una pista más corta que el recorte sólo puede arrancar en 0", () => {
    expect(maxStartSeconds(12)).toBe(0);
    expect(maxStartSeconds(MUSIC_CLIP_SECONDS)).toBe(0);
  });

  it("duración inválida no produce un máximo negativo", () => {
    expect(maxStartSeconds(Number.NaN)).toBe(0);
    expect(maxStartSeconds(-5)).toBe(0);
  });
});

describe("clampStartSeconds", () => {
  it("respeta un offset válido y lo deja entero", () => {
    expect(clampStartSeconds(42.7, 180)).toBe(42);
  });

  it("un offset pasado de rosca cae en el último arranque posible", () => {
    expect(clampStartSeconds(9999, 180)).toBe(150);
  });

  it("un offset negativo o basura cae en 0", () => {
    expect(clampStartSeconds(-10, 180)).toBe(0);
    expect(clampStartSeconds(Number.NaN, 180)).toBe(0);
  });
});

describe("clipEndSeconds / clipLengthSeconds", () => {
  it("el recorte estándar dura MUSIC_CLIP_SECONDS", () => {
    expect(clipEndSeconds(60, 180)).toBe(60 + MUSIC_CLIP_SECONDS);
    expect(clipLengthSeconds(60, 180)).toBe(MUSIC_CLIP_SECONDS);
  });

  it("en una pista corta el recorte es la canción entera, no un negativo", () => {
    expect(clipEndSeconds(0, 12)).toBe(12);
    expect(clipLengthSeconds(0, 12)).toBe(12);
  });

  it("nunca termina después del final del archivo", () => {
    expect(clipEndSeconds(175, 180)).toBeLessThanOrEqual(180);
  });
});

describe("licenseRequiresAttribution", () => {
  it("CC BY y CC BY-SA obligan", () => {
    expect(licenseRequiresAttribution("cc_by")).toBe(true);
    expect(licenseRequiresAttribution("cc_by_sa")).toBe(true);
  });

  it("CC0 y dominio público no", () => {
    expect(licenseRequiresAttribution("cc0")).toBe(false);
    expect(licenseRequiresAttribution("public_domain")).toBe(false);
  });
});

describe("attributionLine", () => {
  it("devuelve el texto EXACTO que pide la licencia", () => {
    const line = attributionLine(
      trackOf({
        licenseKind: "cc_by",
        attributionRequired: true,
        attributionText: "«Cumbia del barrio» de Los del Sur (CC BY 4.0)",
      }),
    );
    expect(line).toBe("«Cumbia del barrio» de Los del Sur (CC BY 4.0)");
  });

  it("sin obligación de atribuir, no inventa una línea", () => {
    expect(attributionLine(trackOf({ licenseKind: "cc0" }))).toBeNull();
  });

  it("una licencia CC BY atribuye aunque la fila diga que no hace falta", () => {
    // La bandera mal cargada no puede terminar en música sin crédito.
    const line = attributionLine(
      trackOf({ licenseKind: "cc_by", attributionRequired: false, attributionText: null }),
    );
    expect(line).toBe("Cumbia del barrio — Los del Sur");
  });

  it("texto en blanco cuenta como ausente y cae al respaldo", () => {
    const line = attributionLine(
      trackOf({ licenseKind: "cc_by", attributionRequired: true, attributionText: "   " }),
    );
    expect(line).toBe("Cumbia del barrio — Los del Sur");
  });
});

describe("formatClock", () => {
  it("formatea minutos y segundos con cero a la izquierda", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7)).toBe("0:07");
    expect(formatClock(161)).toBe("2:41");
  });

  it("valores imposibles no imprimen NaN", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("musicTrackUrl", () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  });

  it("arma la URL pública del bucket music-tracks", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
    expect(musicTrackUrl("global/cumbia.mp3")).toBe(
      "https://proyecto.supabase.co/storage/v1/object/public/music-tracks/global/cumbia.mp3",
    );
  });

  it("una URL absoluta se respeta tal cual", () => {
    expect(musicTrackUrl("https://cdn.externo/x.mp3")).toBe("https://cdn.externo/x.mp3");
  });
});
