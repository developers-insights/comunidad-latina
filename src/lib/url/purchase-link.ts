import { safeExternalHref } from "./safe-href";

/**
 * LINK DE COMPRA: ¿ALGUIEN PUEDE COMPRAR DE VERDAD DEL OTRO LADO?
 *
 * `safeExternalHref` responde otra pregunta: si abrir una URL es seguro. Por eso
 * `https://example.com/entradas` la pasa, y por eso el QA encontró botones reales
 * de "Comprar" y "Sacar boletos" que llevaban a una página de documentación. Un
 * botón de compra promete una tienda, así que acá se exige más:
 *
 *   · https, escrito así. Se paga del otro lado.
 *   · sin usuario ni clave en la URL: `https://boleteria.com@otro-sitio.com` lleva
 *     a `otro-sitio.com`, y es el truco clásico para hacer pasar un sitio por otro;
 *   · un dominio público, no `localhost`, ni una IP, ni un nombre interno;
 *   · que no sea un dominio reservado o un marcador de ejemplo o de prueba.
 *
 * `null` significa "no hay botón". Es el único lugar donde se decide: lo usan las
 * server actions para no guardarlo y las pantallas para no mostrar lo ya guardado.
 * El espejo en SQL es `app.es_link_de_compra_valido` (migración 0183): un test falla
 * si las dos listas se separan.
 *
 * Módulo PURO. Nunca lanza.
 */

/** Igual que las columnas `cta_*` de la 0048. */
const MAX_LARGO = 500;

/**
 * Marcadores: se comparan contra cada ETIQUETA del host, no contra el texto
 * entero, para no rechazar `testimonios.com` ni `myexample.com`. Cubre
 * `example.com/.net/.org/.edu`, sus subdominios y las variantes tipo `test.com`.
 */
export const ETIQUETAS_DE_EJEMPLO: ReadonlySet<string> = new Set([
  "example",
  "ejemplo",
  "test",
  "prueba",
  "localhost",
  "placeholder",
  "dummy",
]);

/** Terminaciones reservadas (RFC 2606 / 6761) o que sólo existen en redes internas. */
export const TERMINACIONES_NO_PUBLICAS: ReadonlySet<string> = new Set([
  "invalid",
  "local",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "arpa",
  "onion",
]);

/** Letras, o punycode. Una IP o un número nunca termina así. */
const TERMINACION_VALIDA = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;

/** Ya normalizado por `new URL`. Mismo juego de caracteres que exige el CHECK de la 0183. */
const HOST_ASCII = /^[a-z0-9.-]+$/;

function hostEsPublicoYReal(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!HOST_ASCII.test(host)) return false;

  const etiquetas = host.split(".");
  if (etiquetas.length < 2) return false;

  const terminacion = etiquetas[etiquetas.length - 1];
  if (!TERMINACION_VALIDA.test(terminacion)) return false;
  if (TERMINACIONES_NO_PUBLICAS.has(terminacion)) return false;

  return !etiquetas.some((etiqueta) => ETIQUETAS_DE_EJEMPLO.has(etiqueta));
}

/** El link listo para un `href`, o `null` si no sirve para comprar. */
export function linkDeCompraValido(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LARGO) return null;
  if (!/^https:\/\//i.test(value)) return null;

  const safe = safeExternalHref(value);
  if (!safe || !safe.external || safe.href.length > MAX_LARGO) return null;

  // `safeExternalHref` ya lo parseó: este `new URL` no puede tirar.
  const url = new URL(safe.href);
  if (url.username || url.password) return null;
  return hostEsPublicoYReal(url.hostname) ? safe.href : null;
}
