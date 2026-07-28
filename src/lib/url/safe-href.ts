/**
 * DESTINO SEGURO PARA UNA URL QUE CARGÓ UNA PERSONA, NO EL CÓDIGO.
 *
 * El caso real: el panel de admin deja poner un `cta_url` en un broadcast, y esa
 * tarjeta se muestra firmada como mensaje oficial de la plataforma. El público
 * de esta app son migrantes; una tarjeta con el sello de la comunidad que lleva
 * a un login clonado no es una molestia de UX, es robo de credenciales.
 *
 * Dos formas de equivocarse que ya se cometieron acá, las dos encontradas
 * probando en vivo (auditoría 2026-07-27):
 *
 *  1. `url.startsWith("/")` para decidir "es interna" ⇒ `//evil.com` pasa, y un
 *     `router.push` navega FUERA del sitio sin abrir pestaña ni avisar nada.
 *  2. Taparlo con `!url.startsWith("//")` ⇒ `/\evil.com` pasa igual: para los
 *     esquemas especiales, el parser de URL trata `\` como `/`.
 *
 * Se puede seguir tapando prefijos de a uno, o dejar de clasificar por string.
 * Esto hace lo segundo: resuelve la URL contra un origen centinela y pregunta
 * por el **origen resultante**, que es la única fuente de verdad. Lo que resuelve
 * al centinela es interno; lo demás es externo y se abre como externo.
 *
 * `zod.url()` NO alcanza como defensa: la versión 4.4.3 acepta `javascript:`,
 * `data:` y `vbscript:` (verificado). La allowlist de protocolo va acá.
 */

export interface SafeHref {
  /** Listo para un `href`. Si es interno, ya viene como ruta relativa. */
  href: string;
  /** true ⇒ abrir en pestaña nueva con `rel="noopener noreferrer"`. */
  external: boolean;
}

/**
 * Origen imposible de registrar (`.invalid` está reservado por RFC 2606), así
 * que nada que venga de afuera puede resolver a él por casualidad.
 */
const SENTINEL = "https://resolver.invalid";

/**
 * Devuelve el destino seguro, o `null` si la URL no se puede ofrecer (vacía,
 * ilegible, o con un protocolo que no es http/https — `javascript:`, `data:`,
 * `file:`…). `null` significa "no muestres el botón", no "mostralo roto".
 */
export function safeExternalHref(raw: string | null | undefined): SafeHref | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value, SENTINEL);
  } catch {
    return null;
  }

  // Resolvió contra el centinela ⇒ es del propio sitio. Se devuelve relativa
  // para que la navegación interna no salga y vuelva por la red.
  //
  // Se exige además que el original empiece con `/`. Sin eso, un `cta_url` mal
  // tipeado —"pagina de donaciones", sin esquema ni barra— resuelve igual y se
  // convierte en un botón que lleva a un 404 interno; con esto no hay botón, que
  // es lo correcto para un aviso de emergencia. No relaja nada: `/\evil.com`
  // también empieza con `/` y lo sigue frenando la comparación de origen, que es
  // la que hace el trabajo de seguridad.
  if (parsed.origin === SENTINEL) {
    if (!value.startsWith("/")) return null;
    return { href: `${parsed.pathname}${parsed.search}${parsed.hash}`, external: false };
  }

  // Cualquier otra cosa es externa, y sólo se admite si habla http(s): un
  // `javascript:` resuelve a origen "null" y cae acá.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  return { href: parsed.href, external: true };
}
