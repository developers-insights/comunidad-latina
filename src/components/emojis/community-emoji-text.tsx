import { Fragment } from "react";
import { cn } from "@/lib/utils";
import {
  EMOJI_INLINE_SIDE_PX,
  indexBySlug,
  parseEmojiText,
  type CommunityEmoji,
} from "@/lib/emojis/catalog";
import { CommunityEmojiImage } from "./community-emoji-image";

/**
 * UN TEXTO CON EMOJIS DE LA COMUNIDAD ADENTRO.
 *
 * El cuerpo de un comentario es TEXTO (`comments.body`), así que el emoji
 * viaja como código corto —`:klk:`— y acá se cambia por el dibujo al pintar.
 * Guardar la URL dentro del texto sería peor de tres maneras: el día que el
 * archivo se mueva quedan comentarios rotos para siempre, apagar un emoji no
 * lo apagaría en lo ya escrito, y el texto crudo (notificaciones, mails,
 * moderación) mostraría una URL de 120 caracteres en vez de un nombre.
 *
 * SIN HOOKS a propósito: así el mismo componente sirve en un Server Component
 * (el detalle de la publicación, que llega renderizado) y en uno de cliente
 * (la hoja de comentarios del feed). El trabajo es recorrer un texto corto una
 * vez — memoizarlo costaría más que hacerlo.
 *
 * UN CÓDIGO QUE NO ESTÁ EN EL CATÁLOGO SE DEJA COMO TEXTO. Se apagó, es de otra
 * comunidad, o alguien escribió `:hola:` a mano: en los tres casos se ve lo que
 * la persona escribió. Borrarlo sería editarle el mensaje.
 */
export function CommunityEmojiText({
  text,
  catalog,
  className,
}: {
  text: string;
  /** El catálogo activo. Vacío = el texto se pinta tal cual. */
  catalog: readonly CommunityEmoji[];
  className?: string;
}) {
  const segments = parseEmojiText(text, indexBySlug(catalog));

  // SIN EMOJIS NO SE ENVUELVE NADA. Sin este atajo el componente agrega un
  // <span> alrededor de todo texto que pase por acá — y hoy, con el catálogo
  // apagado, eso es el 100% de los comentarios. Un envoltorio de más mueve el
  // texto un nivel abajo en el DOM: lo que antes era hijo directo del <p> que
  // lleva las clases de color pasa a ser hijo del span, y cualquier estilo o
  // consulta que dependa de esa relación (`parentElement`, un selector `>`)
  // empieza a mirar el nodo equivocado. Ya rompió tres tests del vidrio de la
  // hoja de comentarios, que es justo donde el color del texto importa.
  //
  // El principio es el mismo por el que el catálogo nace en `is_active=false`:
  // una feature apagada no se tiene que notar en ningún lado.
  if (!className && !segments.some((segment) => segment.kind !== "text")) {
    return <>{text}</>;
  }

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <Fragment key={index}>{segment.text}</Fragment>
        ) : (
          <CommunityEmojiImage
            key={index}
            emoji={segment.emoji}
            // Alineado al texto y no al bloque: un emoji con `align-baseline`
            // queda flotando sobre la línea. `-0.28em` lo apoya donde apoyan
            // los emojis del sistema.
            className={cn("inline-block align-[-0.28em]")}
            style={{ width: EMOJI_INLINE_SIDE_PX, height: EMOJI_INLINE_SIDE_PX }}
          />
        ),
      )}
    </span>
  );
}
