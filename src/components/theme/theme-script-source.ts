import { DARK_THEME_COLOR, MEDIA_QUERY, THEME_STORAGE_KEY } from "./constants";

/** Azul default del brand pipeline: el que se usa si el tenant trae basura. */
const FALLBACK_BRAND_HEX = "#1a5edb";
/** Un hex de 6 dígitos y nada más. Ver `safeBrandHex()`. */
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * El hex del tenant se INTERPOLA dentro de un `<script>` inline. `JSON.stringify`
 * escapa comillas y saltos de línea, pero NO la secuencia `</script>`, que cierra
 * el elemento desde dentro del literal y deja al admin de un tenant inyectar
 * markup arbitrario en todas las páginas de su dominio. El allowlist estricto de
 * hex hace que eso sea imposible por construcción.
 */
function safeBrandHex(hex: string): string {
  return HEX_RE.test(hex) ? hex : FALLBACK_BRAND_HEX;
}

/**
 * Cuerpo del script anti-FOUC, como string. Vive aparte del componente para que
 * el test lo pueda leer sin arrastrar JSX ni React.
 *
 * Hace DOS cosas antes del primer paint:
 *
 *  1. Estampa la clase de tema en <html>. Contrato con globals.css:
 *     · `.dark`  → paleta oscura.
 *     · `.light` → fuerza la paleta clara aunque el SO esté en dark
 *                  (el selector del @media es `:root:not(.light):not(.dark)`).
 *     · sin clase (localStorage inaccesible) → manda el @media, que ya es correcto.
 *
 *  2. Resuelve `<meta name="theme-color">`. `generateViewport()` emite dos metas
 *     con `media`, pero esos `media` siguen al SISTEMA OPERATIVO, no al toggle:
 *     con el SO en light y el tema elegido en dark, el celular pintaba una franja
 *     azul de marca arriba de una app oscura hasta que terminaba de hidratar
 *     (cientos de ms en un Android de gama media, y es una PWA `standalone`).
 *     Se borran las metas que haya y se agrega UNA sin `media`, que siempre
 *     matchea. El `remove()` es la red por si React ya las hoisteó al <head>; el
 *     `appendChild` cubre el caso inverso, porque el browser aplica la PRIMERA
 *     meta que matchea y la nuestra queda antes de todo lo que se parsee después.
 *     Sin JS el script no corre y siguen valiendo las dos metas con `media`, que
 *     es exactamente el comportamiento deseado.
 *
 * Minificado a mano: es blocking y entra literal en el HTML de cada request.
 * Cualquier valor distinto de "light"/"dark" en storage (incluido "system" y la
 * basura de una versión vieja) cae al sistema operativo.
 */
export function themeScriptSource(brandHex: string): string {
  return `(function(){try{var e=document.documentElement,s=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )});var d=s==="dark"||(s!=="light"&&window.matchMedia(${JSON.stringify(
    MEDIA_QUERY,
  )}).matches);e.classList.remove("light","dark");e.classList.add(d?"dark":"light");var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].remove();var n=document.createElement("meta");n.setAttribute("name","theme-color");n.setAttribute("content",d?${JSON.stringify(
    DARK_THEME_COLOR,
  )}:${JSON.stringify(safeBrandHex(brandHex))});(document.head||e).appendChild(n)}catch(e){}})()`;
}
