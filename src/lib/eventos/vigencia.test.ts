import { describe, expect, it } from "vitest";
import { eventDateParts } from "@/components/directory/helpers";
import { estadoDelEvento, eventoTerminado } from "./vigencia";

const NY = "America/New_York"; // UTC-4 en agosto (EDT)
const LA = "America/Los_Angeles"; // UTC-7 en agosto (PDT)

describe("estadoDelEvento — con hora de fin", () => {
  const evento = {
    startsAt: "2026-08-15T16:00:00-04:00",
    endsAt: "2026-08-15T22:00:00-04:00",
  };

  it("todavía no empezó → próximo", () => {
    expect(estadoDelEvento(evento, new Date("2026-08-15T15:59:00-04:00"), NY)).toBe("proximo");
  });

  it("entre el inicio y el fin → en curso", () => {
    expect(estadoDelEvento(evento, new Date("2026-08-15T16:00:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(evento, new Date("2026-08-15T21:59:00-04:00"), NY)).toBe("en_curso");
  });

  it("llegó la hora de fin → terminado, sin tolerancia", () => {
    expect(estadoDelEvento(evento, new Date("2026-08-15T22:00:00-04:00"), NY)).toBe("terminado");
  });

  it("el festival del QA, meses después → terminado", () => {
    expect(estadoDelEvento(evento, new Date("2026-11-05T12:00:00-05:00"), NY)).toBe("terminado");
  });

  it("un evento de varios días sigue en curso hasta su último día", () => {
    const feria = { startsAt: "2026-08-14T10:00:00-04:00", endsAt: "2026-08-16T18:00:00-04:00" };
    expect(estadoDelEvento(feria, new Date("2026-08-16T12:00:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(feria, new Date("2026-08-16T18:01:00-04:00"), NY)).toBe("terminado");
  });

  it("termina a la misma hora real para cualquiera, mire desde donde mire", () => {
    const now = new Date("2026-08-15T22:30:00-04:00");
    expect(estadoDelEvento(evento, now, NY)).toBe("terminado");
    expect(estadoDelEvento(evento, now, LA)).toBe("terminado");
  });

  it("un fin que cruza la medianoche se respeta", () => {
    const fiesta = { startsAt: "2026-08-15T22:00:00-04:00", endsAt: "2026-08-16T02:00:00-04:00" };
    expect(estadoDelEvento(fiesta, new Date("2026-08-16T01:59:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(fiesta, new Date("2026-08-16T02:00:00-04:00"), NY)).toBe("terminado");
  });

  it("un fin igual al inicio no es un fin: se trata como si no lo hubiera declarado", () => {
    const sembrado = { startsAt: "2026-08-15T16:00:00-04:00", endsAt: "2026-08-15T16:00:00-04:00" };
    expect(estadoDelEvento(sembrado, new Date("2026-08-15T20:00:00-04:00"), NY)).toBe("en_curso");
  });

  it("un fin ilegible también", () => {
    const roto = { startsAt: "2026-08-15T16:00:00-04:00", endsAt: "mañana" };
    expect(estadoDelEvento(roto, new Date("2026-08-15T20:00:00-04:00"), NY)).toBe("en_curso");
  });
});

describe("estadoDelEvento — sin hora de fin", () => {
  it("sigue en curso hasta que termina el día en que empezó", () => {
    const evento = { startsAt: "2026-08-15T10:00:00-04:00" };
    expect(estadoDelEvento(evento, new Date("2026-08-15T23:59:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(evento, new Date("2026-08-16T00:01:00-04:00"), NY)).toBe("terminado");
  });

  it("uno que arranca cerca de medianoche no termina a los minutos: tiene 6 horas", () => {
    const evento = { startsAt: "2026-08-15T23:30:00-04:00", endsAt: null };
    expect(estadoDelEvento(evento, new Date("2026-08-16T00:30:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(evento, new Date("2026-08-16T05:29:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(evento, new Date("2026-08-16T05:30:00-04:00"), NY)).toBe("terminado");
  });

  it("el día se cuenta en la zona de quien mira, no en la del servidor", () => {
    const evento = { startsAt: "2026-08-15T16:00:00-07:00" };
    // 00:30 del 16 en Nueva York, 21:30 del 15 en Los Ángeles.
    const now = new Date("2026-08-16T04:30:00Z");
    expect(estadoDelEvento(evento, now, LA)).toBe("en_curso");
    expect(estadoDelEvento(evento, now, NY)).toBe("en_curso"); // todavía en las 6 horas
    const masTarde = new Date("2026-08-16T05:30:00Z"); // 01:30 NY · 22:30 LA
    expect(estadoDelEvento(evento, masTarde, LA)).toBe("en_curso");
    expect(estadoDelEvento(evento, masTarde, NY)).toBe("terminado");
  });
});

describe("estadoDelEvento — fecha sin hora", () => {
  const evento = { startsAt: "2026-08-15" };

  it("dura el día entero en la zona de quien mira", () => {
    expect(estadoDelEvento(evento, new Date("2026-08-14T23:59:00-04:00"), NY)).toBe("proximo");
    expect(estadoDelEvento(evento, new Date("2026-08-15T00:01:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(evento, new Date("2026-08-15T23:59:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(evento, new Date("2026-08-16T00:01:00-04:00"), NY)).toBe("terminado");
  });

  it("no le roba un día a nadie al oeste de Greenwich", () => {
    // Medianoche UTC del 15 todavía es 14 en Los Ángeles: el evento no empezó.
    expect(estadoDelEvento(evento, new Date("2026-08-15T00:30:00Z"), LA)).toBe("proximo");
    // 23:59 del 15 en Los Ángeles ya es 16 en UTC: el evento no terminó.
    expect(estadoDelEvento(evento, new Date("2026-08-16T06:59:00Z"), LA)).toBe("en_curso");
  });

  it("un fin sin hora incluye ese día completo", () => {
    const feria = { startsAt: "2026-08-14", endsAt: "2026-08-16" };
    expect(estadoDelEvento(feria, new Date("2026-08-16T23:59:00-04:00"), NY)).toBe("en_curso");
    expect(estadoDelEvento(feria, new Date("2026-08-17T00:01:00-04:00"), NY)).toBe("terminado");
  });
});

describe("estadoDelEvento — sin fecha", () => {
  it.each([[null], [undefined], [""], ["no-es-una-fecha"]])("%j → sin_fecha", (startsAt) => {
    expect(estadoDelEvento({ startsAt }, new Date(), NY)).toBe("sin_fecha");
  });

  it("sin fecha no se puede afirmar que terminó", () => {
    expect(eventoTerminado({ startsAt: null }, new Date(), NY)).toBe(false);
  });
});

describe("eventDateParts usa el mismo criterio", () => {
  it("con `ends_at` por delante, un evento largo no se marca como pasado", () => {
    const inicio = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(eventDateParts(inicio, "es-US", NY, fin)?.isPast).toBe(false);
  });

  it("con `ends_at` ya vencido se marca como pasado aunque hayan pasado menos de 6 horas", () => {
    const inicio = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() - 60 * 1000).toISOString();
    expect(eventDateParts(inicio, "es-US", NY, fin)?.isPast).toBe(true);
  });
});
