import { createHash } from "node:crypto";

/**
 * SHA-256 del archivo ORIGINAL — el camino determinístico de Content Integrity.
 *
 * Es el único de los dos caminos que no aproxima: dos archivos con el mismo
 * SHA-256 son el mismo archivo, punto. El perceptual encuentra parecidos (y a
 * veces se los pierde, porque HNSW es aproximado); éste no falla nunca, y por
 * eso es el que sostiene la parte que importa legalmente.
 *
 * `node:crypto` y nada más: no hay dependencia que agregar para esto.
 */

/** SHA-256 en hexadecimal minúscula (64 caracteres). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Formato que PostgREST espera —y devuelve— para una columna `bytea`: `\x`
 * seguido del hexadecimal. La columna guarda 32 bytes en vez de los 64
 * caracteres del hex; la mitad de espacio y comparación binaria directa
 * (razón textual del comentario de `content_assets.sha256` en la 0061).
 */
export function toByteaLiteral(hex: string): string {
  return `\\x${hex}`;
}

/** Inversa de `toByteaLiteral`. Devuelve null si el valor no es un bytea hex. */
export function byteaToHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return /^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0 ? hex.toLowerCase() : null;
}

/**
 * Los primeros 12 caracteres del hex, para mostrarle al moderador "cuál" es el
 * archivo sin volcarle 64 caracteres encima. NUNCA para comparar: un prefijo
 * corto tiene colisiones y este módulo existe justamente para no confundir un
 * parecido con una identidad.
 */
export function shortHash(hex: string | null): string | null {
  return hex ? hex.slice(0, 12) : null;
}
