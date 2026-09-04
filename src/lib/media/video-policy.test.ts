import { describe, expect, it } from "vitest";
import {
  ADVERTISING_VIDEO_MAX_SECONDS,
  DEFAULT_VIDEO_CATEGORY,
  FEED_PREVIEW_MAX_SECONDS,
  PREMIUM_DETAIL_MAX_SECONDS,
  SHORT_VIDEO_LIMIT_MESSAGE,
  SHORT_VIDEO_MAX_SECONDS,
  VIDEO_CATEGORIES,
  checkVideoDuration,
  formatDuration,
  isEligibleForShortFeed,
  isLongVideo,
  isPreviewTruncated,
  longVideoCapSeconds,
  maxDurationFor,
  normalizeDeclaredDuration,
  parseVideoCategory,
  parseVideoType,
  playbackCapSeconds,
} from "./video-policy";

/**
 * Estos tests son la red que evita el defecto que más caro sale: un video de 10
 * minutos entrando al scroll de Videos Cortos, o un tope de 90 s que se
 * convierte en 90 s en el formulario y otra cosa en el servidor.
 */

describe("los cuatro topes viven en un solo lugar", () => {
  it("son los números de la spec y no se movieron", () => {
    expect(SHORT_VIDEO_MAX_SECONDS).toBe(90);
    expect(FEED_PREVIEW_MAX_SECONDS).toBe(59);
    expect(PREMIUM_DETAIL_MAX_SECONDS).toBe(300);
    expect(ADVERTISING_VIDEO_MAX_SECONDS).toBe(600);
  });

  it("cada superficie reproduce su propio tope", () => {
    expect(playbackCapSeconds("feed")).toBe(59);
    expect(playbackCapSeconds("reel")).toBe(90);
    expect(playbackCapSeconds("detail")).toBe(300);
    expect(playbackCapSeconds("advertising")).toBe(600);
  });

  it("la vista previa del feed es MÁS CORTA que el tope orgánico", () => {
    // Si esto se invierte, el feed reproduce más de lo que se puede publicar.
    expect(FEED_PREVIEW_MAX_SECONDS).toBeLessThan(SHORT_VIDEO_MAX_SECONDS);
  });

  it("el tope de publicación depende del tipo", () => {
    expect(maxDurationFor("short_video")).toBe(90);
    expect(maxDurationFor("advertising_video")).toBe(600);
  });
});

describe("el mensaje del tope va palabra por palabra", () => {
  it("es exactamente el texto de la spec", () => {
    expect(SHORT_VIDEO_LIMIT_MESSAGE).toBe(
      "Los Videos Cortos pueden durar un máximo de 90 segundos. Para publicar un video más largo, debe formar parte de una publicidad pagada.",
    );
  });
});

describe("normalizeDeclaredDuration", () => {
  it("redondea HACIA ARRIBA: declarar menos de lo que dura no es una opción", () => {
    expect(normalizeDeclaredDuration(89.2)).toBe(90);
    expect(normalizeDeclaredDuration(90.0)).toBe(90);
    // El caso que importa: 90,4 s no puede convertirse en "90 y pasa".
    expect(normalizeDeclaredDuration(90.4)).toBe(91);
  });

  it("acepta el número escrito como texto (viaja por FormData)", () => {
    expect(normalizeDeclaredDuration("42")).toBe(42);
    expect(normalizeDeclaredDuration("42.7")).toBe(43);
  });

  it("desconocida es null, no cero ni un número inventado", () => {
    expect(normalizeDeclaredDuration(null)).toBeNull();
    expect(normalizeDeclaredDuration(undefined)).toBeNull();
    expect(normalizeDeclaredDuration(NaN)).toBeNull();
    expect(normalizeDeclaredDuration(Infinity)).toBeNull();
    expect(normalizeDeclaredDuration(0)).toBeNull();
    expect(normalizeDeclaredDuration(-10)).toBeNull();
    expect(normalizeDeclaredDuration("no soy un número")).toBeNull();
  });

  it("nunca devuelve 0 para un video real de menos de un segundo", () => {
    expect(normalizeDeclaredDuration(0.4)).toBe(1);
  });
});

describe("checkVideoDuration", () => {
  it("un corto de hasta 90 s pasa", () => {
    expect(checkVideoDuration("short_video", 1)).toEqual({ ok: true, seconds: 1 });
    expect(checkVideoDuration("short_video", 90)).toEqual({ ok: true, seconds: 90 });
  });

  it("91 s NO pasa como corto", () => {
    expect(checkVideoDuration("short_video", 91)).toEqual({
      ok: false,
      reason: "too-long",
    });
    expect(checkVideoDuration("short_video", 600)).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("90,4 s no se cuela por redondeo", () => {
    expect(checkVideoDuration("short_video", 90.4)).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("el video publicitario llega a 10 minutos y ni un segundo más", () => {
    expect(checkVideoDuration("advertising_video", 600)).toEqual({
      ok: true,
      seconds: 600,
    });
    expect(checkVideoDuration("advertising_video", 601)).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("duración desconocida NO se publica (es la contracara de la exención 0049)", () => {
    expect(checkVideoDuration("short_video", null)).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(checkVideoDuration("short_video", Infinity)).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});

describe("parseVideoType / parseVideoCategory", () => {
  it("sólo los dos tipos del contrato", () => {
    expect(parseVideoType("short_video")).toBe("short_video");
    expect(parseVideoType("advertising_video")).toBe("advertising_video");
    expect(parseVideoType("video_largo")).toBeNull();
    expect(parseVideoType("")).toBeNull();
    expect(parseVideoType(undefined)).toBeNull();
  });

  it("las nueve categorías del catálogo cerrado y ninguna más", () => {
    expect(VIDEO_CATEGORIES).toHaveLength(9);
    for (const category of VIDEO_CATEGORIES) {
      expect(parseVideoCategory(category)).toBe(category);
    }
    expect(parseVideoCategory("recetas")).toBeNull();
    expect(parseVideoCategory("MUSICA")).toBeNull();
    expect(parseVideoCategory("todos")).toBeNull();
  });

  it("el default de publicación es una categoría del catálogo", () => {
    expect(VIDEO_CATEGORIES).toContain(DEFAULT_VIDEO_CATEGORY);
  });
});

// ---------------------------------------------------------------------------
// LA REGLA QUE SOSTIENE LA SUPERFICIE
// ---------------------------------------------------------------------------

const SHORT = {
  videoType: "short_video",
  eligibleForShortFeed: true,
  status: "published",
  hasVideoMedia: true,
  durationSeconds: 45,
  isPaidAd: false,
} as const;

describe("isEligibleForShortFeed", () => {
  it("un corto publicado y elegible entra", () => {
    expect(isEligibleForShortFeed(SHORT)).toBe(true);
  });

  it("un video PUBLICITARIO de 10 minutos NUNCA entra", () => {
    expect(
      isEligibleForShortFeed({
        ...SHORT,
        videoType: "advertising_video",
        durationSeconds: 600,
        eligibleForShortFeed: false,
        isPaidAd: true,
      }),
    ).toBe(false);
  });

  it("no entra ni aunque la fila mienta y se declare elegible", () => {
    // Defensa en profundidad: la base lo impide con tres constraints, pero el
    // reel no puede depender de que ninguna se haya caído.
    expect(
      isEligibleForShortFeed({
        ...SHORT,
        videoType: "advertising_video",
        durationSeconds: 600,
        eligibleForShortFeed: true,
        isPaidAd: false,
      }),
    ).toBe(false);
  });

  it("publicidad paga fuera del scroll orgánico, sea cual sea el tipo", () => {
    expect(isEligibleForShortFeed({ ...SHORT, isPaidAd: true })).toBe(false);
  });

  it("eligible_for_short_feed es un VETO: en un texto no mete nada", () => {
    // La trampa exacta del contrato: `true` en una publicación sin video.
    expect(
      isEligibleForShortFeed({
        videoType: null,
        eligibleForShortFeed: true,
        status: "published",
        hasVideoMedia: false,
      }),
    ).toBe(false);
  });

  it("el veto en false saca al corto del reel", () => {
    expect(isEligibleForShortFeed({ ...SHORT, eligibleForShortFeed: false })).toBe(
      false,
    );
  });

  it("sin video, sin reel (aunque el tipo diga short_video)", () => {
    expect(isEligibleForShortFeed({ ...SHORT, hasVideoMedia: false })).toBe(false);
  });

  it("sólo contenido publicado", () => {
    expect(isEligibleForShortFeed({ ...SHORT, status: "pending_review" })).toBe(false);
  });

  it("duración conocida por encima del tope descarta", () => {
    expect(isEligibleForShortFeed({ ...SHORT, durationSeconds: 91 })).toBe(false);
  });

  it("duración DESCONOCIDA sigue entrando: son los 7 videos previos a la 0046", () => {
    // Desconocida no es "larga" ni "corta". Sacarlos sería inventar el dato en
    // la otra dirección; el tope de reproducción del reel los cubre igual.
    expect(isEligibleForShortFeed({ ...SHORT, durationSeconds: null })).toBe(true);
  });
});

describe("isPreviewTruncated", () => {
  it("por encima de 59 s la tarjeta está mostrando sólo una parte", () => {
    expect(isPreviewTruncated(90)).toBe(true);
    expect(isPreviewTruncated(75.3)).toBe(true);
  });

  it("hasta 59 s (con medio segundo de tolerancia) se ve completo", () => {
    expect(isPreviewTruncated(30)).toBe(false);
    expect(isPreviewTruncated(59)).toBe(false);
    expect(isPreviewTruncated(59.2)).toBe(false);
  });

  it("sin duración medida no se promete que haya más", () => {
    expect(isPreviewTruncated(null)).toBe(false);
    expect(isPreviewTruncated(undefined)).toBe(false);
    expect(isPreviewTruncated(NaN)).toBe(false);
  });
});

describe("formatDuration", () => {
  it("minutos:segundos con dos dígitos", () => {
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(5.2)).toBe("0:06");
  });

  it("sin duración no hay etiqueta", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(Infinity)).toBeNull();
  });
});

/**
 * VIDEOS LARGOS (cliente 2026-09-03, 19:40–23:44): "quien paga publicidad puede
 * subir hasta 5 minutos… en el feed y en Videos Cortos solamente sale los 59
 * segundos y ahí va a estar un botón que dice ver video completo".
 *
 * De esta función cuelgan tres cosas que tienen que decir lo mismo: qué se
 * lista en `/videos/largos`, qué se puede reproducir entero ahí, y dónde
 * aparece el botón. Si se separan, el botón lleva a una página que no existe.
 */
describe("isLongVideo", () => {
  it("un video publicitario es largo por contrato, dure lo que dure", () => {
    expect(isLongVideo({ videoType: "advertising_video" })).toBe(true);
    expect(
      isLongVideo({ videoType: "advertising_video", durationSeconds: 45 }),
    ).toBe(true);
  });

  it("pasar el tope de los cortos es largo aunque no se declare el tipo", () => {
    expect(isLongVideo({ durationSeconds: PREMIUM_DETAIL_MAX_SECONDS })).toBe(true);
    expect(isLongVideo({ durationSeconds: SHORT_VIDEO_MAX_SECONDS + 1 })).toBe(true);
  });

  it("un corto NO es largo — ni el que llega justo al tope", () => {
    expect(isLongVideo({ videoType: "short_video", durationSeconds: 45 })).toBe(false);
    expect(
      isLongVideo({ videoType: "short_video", durationSeconds: SHORT_VIDEO_MAX_SECONDS }),
    ).toBe(false);
    // Medio segundo de tolerancia: la duración MEDIDA por el navegador es un
    // float, y un archivo de 90,2 s sigue siendo el corto de 90 s que declaró.
    expect(isLongVideo({ durationSeconds: 90.2 })).toBe(false);
  });

  it("sin duración conocida no se inventa que sea largo", () => {
    expect(isLongVideo({})).toBe(false);
    expect(isLongVideo({ videoType: "short_video", durationSeconds: null })).toBe(false);
    expect(isLongVideo({ durationSeconds: NaN })).toBe(false);
  });

  it("el veto del scroll no convierte un corto en largo", () => {
    // `eligible_for_short_feed = false` habla del SCROLL, no de la duración: un
    // corto que su autor sacó de Videos Cortos no se muda a Videos largos.
    expect(isLongVideo({ videoType: "short_video", durationSeconds: 60 })).toBe(false);
  });
});

describe("longVideoCapSeconds", () => {
  it("el publicitario se ve hasta sus 10 minutos; el resto, hasta los 5", () => {
    expect(longVideoCapSeconds("advertising_video")).toBe(ADVERTISING_VIDEO_MAX_SECONDS);
    expect(longVideoCapSeconds("short_video")).toBe(PREMIUM_DETAIL_MAX_SECONDS);
    expect(longVideoCapSeconds(null)).toBe(PREMIUM_DETAIL_MAX_SECONDS);
  });

  it("nunca deja al archivo sin tope: la vista previa del feed es más corta", () => {
    expect(longVideoCapSeconds("advertising_video")).toBeGreaterThan(
      FEED_PREVIEW_MAX_SECONDS,
    );
  });
});
