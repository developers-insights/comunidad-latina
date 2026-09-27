export type SituacionDelCreador = "sin_perfil" | "en_camino" | "aprobado" | "no_disponible";

const EN_CAMINO = new Set([
  "application_started",
  "documents_pending",
  "stripe_review_pending",
  "platform_review_pending",
  "needs_info",
]);

export function situacionDelCreador(status: string | null | undefined): SituacionDelCreador {
  if (!status || status === "not_requested") return "sin_perfil";
  if (status === "approved") return "aprobado";
  if (EN_CAMINO.has(status)) return "en_camino";
  return "no_disponible";
}

export function impulsoVigente(
  filas: readonly { status: string; ends_at: string | null }[],
  ahoraMs: number,
): string | null {
  let mejor: { iso: string; ms: number } | null = null;
  for (const fila of filas) {
    if (fila.status !== "active" || !fila.ends_at) continue;
    const ms = Date.parse(fila.ends_at);
    if (Number.isNaN(ms) || ms <= ahoraMs) continue;
    if (!mejor || ms > mejor.ms) mejor = { iso: fila.ends_at, ms };
  }
  return mejor?.iso ?? null;
}

// Más de tres lugares pagos arriba del directorio lo convierten en una vidriera
// de anuncios y entierra a los creadores que se ganaron el orden por reseñas.
export const MAX_PATROCINADOS = 3;

export function separarPatrocinados<T extends { profileId: string }>(
  creadores: readonly T[],
  patrocinadosIds: readonly string[],
): { patrocinados: T[]; resto: T[] } {
  const porId = new Map(creadores.map((c) => [c.profileId, c]));
  const elegidos = new Set<string>();
  const patrocinados: T[] = [];
  for (const id of patrocinadosIds) {
    if (patrocinados.length >= MAX_PATROCINADOS) break;
    const creador = porId.get(id);
    if (!creador || elegidos.has(id)) continue;
    elegidos.add(id);
    patrocinados.push(creador);
  }
  return { patrocinados, resto: creadores.filter((c) => !elegidos.has(c.profileId)) };
}
