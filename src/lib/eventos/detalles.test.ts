import { describe, expect, it } from "vitest";
import {
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
  eventAudienceLabel,
  eventCategoryLabel,
  isEventAudience,
  isEventCategory,
} from "./categorias";
import {
  EVENT_AUDIENCE_ATTR,
  EVENT_CAPACITY_ATTR,
  EVENT_CATEGORY_ATTR,
  EVENT_ENDS_ATTR,
  EVENT_FREE_ATTR,
  EVENT_MODES,
  EVENT_MODE_ATTR,
  EVENT_MODE_OPTIONS,
  EVENT_ONLINE_URL_ATTR,
  EVENT_STARTS_ATTR,
  EVENT_TICKETS_URL_ATTR,
  EVENT_VENUE_AREA_ATTR,
  MAX_EVENT_CAPACITY,
  normalizeCapacity,
  normalizeEventMode,
  normalizeEventUrl,
  readEventDetails,
  requiresVenue,
  resolveEventDates,
  resolveEventTicketsUrl,
} from "./detalles";

/**
 * Estos tests cuidan tres cosas:
 *
 *  1. Que un evento VIEJO (el que hoy sólo tiene `starts_at`) siga siendo
 *     legible y no reciba valores inventados — sobre todo que no pase a
 *     declararse "pago" por no tener el campo `free`.
 *  2. Que la regla de precedencia del enlace de boletos —gana el premium— esté
 *     escrita una sola vez y se cumpla. Es la parte que más fácil se
 *     desincroniza porque el dato vive en dos lugares.
 *  3. Que ninguna URL de origen dudoso se convierta en un botón.
 */

// ---------------------------------------------------------------------------
// Claves y catálogos
// ---------------------------------------------------------------------------

describe("claves de attrs", () => {
  /**
   * Las cuatro primeras YA EXISTEN en producción: las escriben los scripts de
   * seed y las lee `parseEventAttrs` (components/directory/helpers.ts).
   * Renombrarlas dejaría huérfano todo lo sembrado y todo lo publicado.
   */
  it("las que ya existían no cambian de nombre", () => {
    expect(EVENT_STARTS_ATTR).toBe("starts_at");
    expect(EVENT_ENDS_ATTR).toBe("ends_at");
    expect(EVENT_FREE_ATTR).toBe("free");
    expect(EVENT_VENUE_AREA_ATTR).toBe("venue_area");
  });

  it("las nuevas quedan fijadas", () => {
    expect(EVENT_CATEGORY_ATTR).toBe("category");
    expect(EVENT_MODE_ATTR).toBe("event_mode");
    expect(EVENT_ONLINE_URL_ATTR).toBe("online_url");
    expect(EVENT_TICKETS_URL_ATTR).toBe("tickets_url");
    expect(EVENT_CAPACITY_ATTR).toBe("capacity");
    expect(EVENT_AUDIENCE_ATTR).toBe("audience");
  });
});

describe("taxonomía", () => {
  it("las categorías no se repiten y cierran con 'otro'", () => {
    const values = EVENT_CATEGORIES.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.at(-1)).toBe("otro");
  });

  it("una categoría desconocida se capitaliza en vez de descartarse", () => {
    // Misma decisión que `businessCategoryLabel`: la taxonomía es lo que la UI
    // CONOCE, no una restricción sobre un JSONB que nunca la tuvo. Descartar
    // escondería un evento que existe.
    expect(eventCategoryLabel("fiesta")).toBe("Fiesta y música");
    expect(eventCategoryLabel("carnaval")).toBe("Carnaval");
    expect(eventCategoryLabel("")).toBeNull();
    expect(eventCategoryLabel(null)).toBeNull();
    expect(isEventCategory("carnaval")).toBe(false);
  });

  it("el público recomendado abre en 'todo público'", () => {
    expect(EVENT_AUDIENCES[0].value).toBe("todo_publico");
    expect(isEventAudience("familias")).toBe(true);
    expect(isEventAudience("perros")).toBe(false);
    expect(eventAudienceLabel("adultos")).toBe("Solo adultos (+18)");
    expect(eventAudienceLabel("perros")).toBeNull();
  });
});

describe("modalidad", () => {
  it("tiene dos valores, con etiqueta y ayuda", () => {
    expect([...EVENT_MODES]).toEqual(["presencial", "virtual"]);
    expect(EVENT_MODE_OPTIONS).toHaveLength(2);
    for (const option of EVENT_MODE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(2);
      expect(option.hint.length).toBeGreaterThan(5);
    }
  });

  it("tolera acentos, mayúsculas y sinónimos de seed", () => {
    expect(normalizeEventMode(" VIRTUAL ")).toBe("virtual");
    expect(normalizeEventMode("online")).toBe("virtual");
    expect(normalizeEventMode("en_linea")).toBe("virtual");
    expect(normalizeEventMode("in_person")).toBe("presencial");
  });

  it("nunca lanza y devuelve null ante basura", () => {
    for (const value of [null, undefined, 42, {}, [], "", "híbrido"]) {
      expect(() => normalizeEventMode(value)).not.toThrow();
      expect(normalizeEventMode(value)).toBeNull();
    }
  });

  it("sólo lo presencial necesita declarar dónde queda", () => {
    expect(requiresVenue("presencial")).toBe(true);
    expect(requiresVenue("virtual")).toBe(false);
    // Sin modalidad declarada se pide la zona: falla del lado seguro.
    expect(requiresVenue(null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

describe("normalizeEventUrl", () => {
  it("acepta http y https externos", () => {
    expect(normalizeEventUrl("https://boleteria.com/fiesta")).toBe(
      "https://boleteria.com/fiesta",
    );
    expect(normalizeEventUrl("  http://ejemplo.com/x  ")).toBe("http://ejemplo.com/x");
  });

  /**
   * `safeExternalHref` clasifica por ORIGEN RESUELTO, no por prefijo de string:
   * un `javascript:` resuelve a origen "null" y cae. Este test existe para que
   * nadie "simplifique" la validación a un `startsWith("http")`.
   */
  it("rechaza esquemas que no son http(s)", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>x</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
    ]) {
      expect(normalizeEventUrl(value)).toBeNull();
    }
  });

  /**
   * Un "enlace de entradas" que apunta adentro de la propia app no es un enlace
   * de entradas: es un error de tipeo con forma de botón.
   */
  it("rechaza rutas internas y texto que no es un enlace", () => {
    expect(normalizeEventUrl("/eventos/123")).toBeNull();
    expect(normalizeEventUrl("pagina de entradas")).toBeNull();
    expect(normalizeEventUrl("")).toBeNull();
  });

  it("nunca lanza", () => {
    for (const value of [null, undefined, 42, {}, [], "://"]) {
      expect(() => normalizeEventUrl(value)).not.toThrow();
      expect(normalizeEventUrl(value)).toBeNull();
    }
  });
});

describe("resolveEventTicketsUrl — premium gana, base es el respaldo", () => {
  const base = { [EVENT_TICKETS_URL_ATTR]: "https://base.com/entradas" };

  it("con premium cargado, gana el premium", () => {
    expect(resolveEventTicketsUrl("https://premium.com/entradas", base)).toEqual({
      href: "https://premium.com/entradas",
      source: "premium",
    });
  });

  /**
   * El caso normal de un aviso gratuito: la columna `cta_tickets_url` está en
   * null porque la 0048 se la prohíbe a un aviso `free`, y el enlace que cargó
   * la persona al publicar vive en attrs.
   */
  it("sin premium, se usa el de attrs", () => {
    expect(resolveEventTicketsUrl(null, base)).toEqual({
      href: "https://base.com/entradas",
      source: "base",
    });
  });

  it("si el premium se limpia o vence, el base vuelve solo", () => {
    expect(resolveEventTicketsUrl("", base)?.source).toBe("base");
    expect(resolveEventTicketsUrl(undefined, base)?.source).toBe("base");
  });

  it("un premium que no es una URL válida no tapa al base", () => {
    expect(resolveEventTicketsUrl("javascript:alert(1)", base)?.source).toBe("base");
  });

  it("sin ninguno de los dos no hay botón", () => {
    expect(resolveEventTicketsUrl(null, {})).toBeNull();
    expect(resolveEventTicketsUrl(null, null)).toBeNull();
    expect(resolveEventTicketsUrl(null, { [EVENT_TICKETS_URL_ATTR]: "no soy un link" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fechas y capacidad
// ---------------------------------------------------------------------------

describe("resolveEventDates", () => {
  it("devuelve ISO canónico", () => {
    const result = resolveEventDates("2026-09-01T20:00:00Z", null);
    expect(result).toEqual({
      ok: true,
      startsAt: "2026-09-01T20:00:00.000Z",
      endsAt: null,
    });
  });

  it("acepta un fin posterior al inicio", () => {
    const result = resolveEventDates("2026-09-01T20:00:00Z", "2026-09-01T23:00:00Z");
    expect(result.ok).toBe(true);
    expect(result.ok && result.endsAt).toBe("2026-09-01T23:00:00.000Z");
  });

  /**
   * Contradicción, no dato incompleto: se rechaza en vez de descartar el fin en
   * silencio. Si se descartara, la persona publicaría convencida de haber
   * puesto un horario de cierre que nadie va a ver.
   */
  it("rechaza un fin anterior o igual al inicio", () => {
    expect(resolveEventDates("2026-09-01T20:00:00Z", "2026-09-01T19:00:00Z")).toEqual({
      ok: false,
      reason: "fin_antes_del_inicio",
    });
    expect(resolveEventDates("2026-09-01T20:00:00Z", "2026-09-01T20:00:00Z").ok).toBe(false);
  });

  it("sin inicio no hay evento", () => {
    expect(resolveEventDates(null, null)).toEqual({ ok: false, reason: "sin_inicio" });
    expect(resolveEventDates("no es una fecha", null).ok).toBe(false);
  });

  it("un fin ilegible se lee como 'no lo declaró', no como error", () => {
    // El fin es opcional: basura ahí no puede tumbar una publicación válida.
    const result = resolveEventDates("2026-09-01T20:00:00Z", "cualquier cosa");
    expect(result.ok).toBe(true);
    expect(result.ok && result.endsAt).toBeNull();
  });
});

describe("normalizeCapacity", () => {
  it("acepta enteros dentro del tope", () => {
    expect(normalizeCapacity(80)).toBe(80);
    expect(normalizeCapacity("80")).toBe(80);
    expect(normalizeCapacity(80.7)).toBe(80);
  });

  it("rechaza cero, negativos y el dedo pesado sobre el teclado", () => {
    expect(normalizeCapacity(0)).toBeNull();
    expect(normalizeCapacity(-5)).toBeNull();
    expect(normalizeCapacity(MAX_EVENT_CAPACITY + 1)).toBeNull();
  });

  it("nunca lanza", () => {
    for (const value of [null, undefined, {}, [], "muchos", Number.NaN]) {
      expect(() => normalizeCapacity(value)).not.toThrow();
      expect(normalizeCapacity(value)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Lectura desde attrs
// ---------------------------------------------------------------------------

describe("readEventDetails", () => {
  /**
   * EL TEST QUE MÁS IMPORTA. Un evento publicado antes de esta feature sólo
   * tiene `starts_at`. Todo lo demás sale nulo — y en particular `free` sale
   * `null` y NO `false`: "no declaró si es gratis" no es "declaró que se cobra".
   */
  it("un evento viejo no recibe ningún valor inventado", () => {
    const details = readEventDetails({ [EVENT_STARTS_ATTR]: "2026-09-01T20:00:00Z" });
    expect(details).toEqual({
      category: null,
      mode: null,
      onlineUrl: null,
      ticketsUrl: null,
      capacity: null,
      audience: null,
      free: null,
    });
  });

  it("distingue los tres estados de la entrada", () => {
    expect(readEventDetails({ [EVENT_FREE_ATTR]: true }).free).toBe(true);
    expect(readEventDetails({ [EVENT_FREE_ATTR]: false }).free).toBe(false);
    expect(readEventDetails({}).free).toBeNull();
    // Un `free` que no es booleano no es una declaración.
    expect(readEventDetails({ [EVENT_FREE_ATTR]: "si" }).free).toBeNull();
  });

  it("lee todo lo declarado", () => {
    const details = readEventDetails({
      [EVENT_CATEGORY_ATTR]: "fiesta",
      [EVENT_MODE_ATTR]: "virtual",
      [EVENT_ONLINE_URL_ATTR]: "https://meet.example.com/sala",
      [EVENT_TICKETS_URL_ATTR]: "https://boleteria.com/x",
      [EVENT_CAPACITY_ATTR]: 120,
      [EVENT_AUDIENCE_ATTR]: "familias",
      [EVENT_FREE_ATTR]: false,
    });
    expect(details.category).toBe("fiesta");
    expect(details.mode).toBe("virtual");
    expect(details.onlineUrl).toBe("https://meet.example.com/sala");
    expect(details.ticketsUrl).toBe("https://boleteria.com/x");
    expect(details.capacity).toBe(120);
    expect(details.audience).toBe("familias");
    expect(details.free).toBe(false);
  });

  it("conserva una categoría fuera del catálogo, pero no un público inventado", () => {
    // La categoría se muestra capitalizada (ver eventCategoryLabel); el público
    // sale de una lista cerrada porque cambia cómo se filtra, no cómo se lee.
    expect(readEventDetails({ [EVENT_CATEGORY_ATTR]: " carnaval " }).category).toBe("carnaval");
    expect(readEventDetails({ [EVENT_AUDIENCE_ATTR]: "perros" }).audience).toBeNull();
  });

  it("no deja pasar un enlace peligroso guardado a mano en el JSONB", () => {
    const details = readEventDetails({
      [EVENT_ONLINE_URL_ATTR]: "javascript:alert(1)",
      [EVENT_TICKETS_URL_ATTR]: "/interno",
    });
    expect(details.onlineUrl).toBeNull();
    expect(details.ticketsUrl).toBeNull();
  });

  it("nunca lanza, con cualquier forma de attrs", () => {
    for (const attrs of [null, undefined, 42, "texto", [], [1, 2]]) {
      expect(() => readEventDetails(attrs)).not.toThrow();
      expect(readEventDetails(attrs).free).toBeNull();
    }
  });
});
