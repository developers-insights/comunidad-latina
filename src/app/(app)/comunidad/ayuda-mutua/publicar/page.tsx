import { permanentRedirect } from "next/navigation";

/**
 * "Publicar un aviso de ayuda" → "Escribir un pedido".
 *
 * Los parámetros viejos (`?modo=offer|need`, `?lugar=<uuid>`, `?editar=<uuid>`)
 * se DESCARTAN a propósito y no se traducen: `modo` ya no existe (no se puede
 * ofrecer), `lugar` tampoco (el formulario nuevo no elige ficha) y `editar`
 * apuntaba a un borrador, un estado que la 0130 dejó de crear. Arrastrar un
 * parámetro que el destino ignora sólo sirve para que alguien lo crea vivo.
 *
 * `?tema=` sí sobrevive como concepto, pero llegaría desde un link viejo con
 * uno de los seis temas de la 0120 — todos siguen siendo válidos. Aun así no se
 * reenvía: `permanentRedirect` no lee search params sin volver esta página
 * dinámica, y el formulario abre igual con su tema por defecto. Un tema de
 * más no vale una lectura de `searchParams` en un redirect.
 */
export default function PublicarAvisoRedirect() {
  permanentRedirect("/comunidad/pedir-ayuda/publicar");
}
