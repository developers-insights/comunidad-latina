/**
 * Protocolo de streaming del Asistente Comunitario (NDJSON).
 *
 * El route handler (/api/assistant) emite UNA línea JSON por evento; el client
 * (assistant-chat) las parsea a medida que llegan. Este archivo es isomórfico
 * (sin server-only): el server importa los tipos para emitir y el client para
 * consumir — una sola fuente de verdad del contrato.
 */

/** Tarjeta de fuente citada (BezelCard bajo la respuesta, copy legal §11). */
export type AssistantSource = {
  title: string;
  /** Ruta interna: /guias/[slug], /propiedades/[id], /profesionales/[id]… */
  href: string;
  /** "Según [fuente oficial] al [fecha]" o descriptor honesto equivalente. */
  descriptor: string;
};

/** Botón de derivación bajo la respuesta (profesionales, guías, escudo…). */
export type AssistantAction = {
  label: string;
  href: string;
};

export type AssistantEvent =
  /**
   * Primer evento: id de la consulta registrada (assistant_queries) para el
   * feedback 👍/👎 — null si la telemetría falló (la UI oculta el feedback).
   */
  | { t: "start"; queryId: string | null }
  /** Fragmento de texto de la respuesta (streaming del LLM o respuesta fija). */
  | { t: "delta"; text: string }
  /** Fuentes citadas — se emiten al final, cuando la respuesta ya está completa. */
  | { t: "sources"; sources: AssistantSource[] }
  /** Derivaciones ("hablá con un profesional verificado", etc.). */
  | { t: "actions"; actions: AssistantAction[] }
  /** Fin normal del stream. */
  | { t: "done" }
  /** Falla a mitad del stream — el client muestra el error cálido. */
  | { t: "error" };

/** Códigos de error de las respuestas NO streaming (JSON con status ≠ 200). */
export type AssistantErrorCode =
  | "anon_limit" // 429 — 3 preguntas de invitado agotadas → invitación a crear cuenta
  | "rate_limit" // 429 — 10/hora del usuario logueado
  | "ai_unavailable" // 503 — OpenAI sin configurar → <ProximamentePremium>
  | "invalid"; // 400 — pregunta vacía/larguísima

/** Parsea una línea NDJSON del stream; null si la línea no es un evento válido. */
export function parseAssistantEvent(line: string): AssistantEvent | null {
  try {
    const value: unknown = JSON.parse(line);
    if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { t?: unknown }).t === "string"
    ) {
      return value as AssistantEvent;
    }
    return null;
  } catch {
    return null;
  }
}
