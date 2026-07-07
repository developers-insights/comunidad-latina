/**
 * Sanitiza el parámetro `next` de login / magic link.
 * Solo rutas internas (evita open redirect): debe empezar con "/" simple.
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback = "/feed",
): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
