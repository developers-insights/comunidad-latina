"use client";

import { useEffect, useRef, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { Heart } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { textBackgroundOf } from "@/lib/feed/text-backgrounds";
import { COPY } from "./copy";
import { useCardLike } from "./card-like-context";

/**
 * BANNER DE LAS PUBLICACIONES TIPO "TEXTO" (pedido de Manuel, 2026-07-29: el
 * menú de crear necesitaba un "Texto" separado de "Pregunta").
 *
 * `kind='text'` es, junto con `kind='question'`, el único otro kind exento del
 * requisito de medio (0023/0043 — el trigger sólo exige foto/video cuando
 * `kind='post'`), así que un texto suelto tiene el MISMO problema que tenía la
 * pregunta antes del 2026-07-26: cae en el feed como un párrafo sin nada
 * alrededor, en un feed que por lo demás es todo foto 4:5.
 *
 * La solución es la misma que ya funcionó ahí: el cuerpo del post ES la pieza
 * gráfica, sobre el mismo campo tricolor de marca. Este archivo es un
 * HERMANO de question-banner.tsx, no una variante suya — comparten la fórmula
 * (campo de marca + marca de agua + grano + marco) pero cada uno es su propia
 * superficie de producción, con sus propios tests. Se duplica el motor de
 * variantes a propósito: la alternativa (compartir un módulo genérico entre
 * dos componentes con vidas propias) hoy cuesta más de lo que ahorra, y
 * "pregunta" y "texto" ya divergen en el ornamento y van a seguir divergiendo
 * (el texto nunca lleva encuesta).
 *
 * Lo que lo distingue de QuestionBanner:
 *  · ORNAMENTO. Nada de "¿ ?" — un texto no es una pregunta. Van comillas
 *    tipográficas grandes, en las mismas esquinas.
 *  · FONDO ELEGIBLE. Ocho fondos propios (`@/lib/feed/text-backgrounds`), que
 *    quien publica elige en el composer y quedan guardados en la publicación.
 *    Sin elección se sortea uno por el id, que es lo que pasaba siempre.
 *  · SIN ENCUESTA. `kind='text'` nunca lleva poll_kind (posts_poll_only_on_question,
 *    0041) — no hay prop de footer.
 *
 * ── EL CUERPO NO SE ACHICA A MEDIDA QUE SE ESCRIBE (call 3/9, punto 15) ─────
 *
 * «Mientras más se escribe, se van haciendo más pequeñas; parece que hay sólo
 * un espacio pequeño en el centro de la tarjeta.» Era literal: había una
 * escalera de cuatro cuerpos (text-3xl → text-2xl → text-xl → text-lg) atada al
 * largo del texto, más un recorte de líneas que empezaba en cualquier texto de
 * más de tres renglones. El resultado es el que describió el cliente: la letra
 * se iba encogiendo sola mientras escribía, y el texto quedaba apretado en el
 * medio de una tarjeta que nunca crecía.
 *
 * Ahora hay DOS cuerpos y nada más (ver `textTypeScale`), el párrafo usa todo
 * el ancho disponible, y la tarjeta CRECE con el contenido —el 4:5 pasó a ser
 * un piso, no una jaula: el espaciador y el texto comparten celda de grilla, y
 * la fila mide lo que mida el más alto de los dos—. El recorte quedó sólo para
 * los textos de verdad largos, con "Ver completo" que expande EN EL LUGAR.
 */

const DOUBLE_TAP_MS = 250;
const SHADE = "var(--color-media-shade)";

const luz = (pct: number) =>
  `color-mix(in oklab, var(--color-on-media) ${pct}%, transparent)`;
const velo = (pct: number) =>
  `color-mix(in oklab, ${SHADE} ${pct}%, transparent)`;

const VIGNETTE = `radial-gradient(118% 96% at 50% 46%, transparent 34%, ${velo(46)} 100%)`;
const GRAIN = `radial-gradient(var(--color-on-media) 0.5px, transparent 0.6px)`;

/** Mismas tres figuras del logo que QuestionBanner, prensadas igual (deboss). */
function BrandFigures({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const figure = (key: string, transform?: string) => (
    <g key={key} transform={transform}>
      <circle cx="34" cy="16" r="16" />
      <rect x="4" y="38" width="60" height="44" rx="22" />
      <rect x="13" y="64" width="42" height="40" rx="6" />
      <rect x="4" y="54" width="15" height="44" rx="7.5" />
      <rect x="49" y="54" width="15" height="44" rx="7.5" />
      <rect x="13" y="90" width="18" height="62" rx="9" />
      <rect x="37" y="90" width="18" height="62" rx="9" />
    </g>
  );
  return (
    <svg viewBox="0 0 180 156" aria-hidden="true" fill="currentColor" className={className} style={style}>
      {figure("left")}
      {figure("center", "translate(52 -8) scale(1.07)")}
      {figure("right", "translate(112 0)")}
    </svg>
  );
}

function BrandWatermark() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -bottom-[9%] -left-[7%] w-[58%]">
      <BrandFigures
        className="absolute inset-0 h-auto w-full translate-x-[1.5px] translate-y-[1.5px]"
        style={{ color: "var(--color-on-media)", opacity: 0.08 }}
      />
      <BrandFigures className="relative h-auto w-full" style={{ color: SHADE, opacity: 0.17 }} />
    </span>
  );
}

/**
 * Hasta acá el texto se CENTRA: una o dos frases se leen como una declaración,
 * y centradas ocupan la tarjeta como la pieza gráfica que son. Pasado el
 * umbral, un párrafo centrado es incómodo de leer —los renglones no comparten
 * margen izquierdo— así que se alinea a la izquierda, como cualquier texto
 * corrido. Se decide solo, sin preguntarle nada a quien publica: la alternativa
 * (un selector de alineación) es otra decisión más antes de publicar, otra
 * columna y otro catálogo, para un problema que la regla resuelve bien.
 */
const TEXTO_CENTRADO = 120;
/**
 * EL ÚNICO ESCALÓN. Arriba de esto el cuerpo baja de 24 a 20 px — no para que
 * "entre", sino porque un texto de varios párrafos a 24 px se lee peor que a
 * 20. Es el ajuste que un diseñador haría a mano una vez, no una escalera que
 * encoge la letra mientras la persona escribe.
 */
const TEXTO_COMPACTO = 280;
/**
 * A partir de acá el feed recorta y ofrece "Ver completo" (que expande EN EL
 * LUGAR, sin sacar a nadie del feed). Está alto a propósito: hasta 600
 * caracteres la tarjeta simplemente crece, que es lo que el cliente mostró con
 * el ejemplo de Instagram. El detalle (`isDetail`) nunca recorta.
 */
const TEXTO_LARGO = 600;
/** Cuántos renglones se ven antes del recorte. A 20 px son ~14 de tarjeta llena. */
const CLAMP_LARGO = "line-clamp-[14]";

export interface TextTypeScale {
  /** Cuerpo del texto. Sólo dos valores posibles — ver `TEXTO_COMPACTO`. */
  size: string;
  /** Interlineado y tracking. */
  rhythm: string;
  /** Alineación + modo de corte de renglón (balance para frases, pretty para párrafos). */
  align: string;
  /** Clase de recorte, o null cuando el texto se lee entero. */
  clamp: string | null;
}

/**
 * DOS CUERPOS Y NADA MÁS. `unclamped` es "este texto se lee entero" (detalle, o
 * ya expandido en el feed) y sólo afecta al recorte: el cuerpo NO cambia entre
 * el feed y el detalle, así que una publicación se ve igual en los dos lados.
 */
export function textTypeScale(text: string, unclamped: boolean): TextTypeScale {
  const length = text.trim().length;
  const compacto = length > TEXTO_COMPACTO;
  return {
    size: compacto ? "text-xl" : "text-2xl",
    rhythm: compacto ? "leading-relaxed" : "leading-snug tracking-tight",
    align:
      length <= TEXTO_CENTRADO ? "text-center text-balance" : "text-left text-pretty",
    clamp: unclamped || length <= TEXTO_LARGO ? null : CLAMP_LARGO,
  };
}

export interface TextBannerProps {
  postId: string;
  /** El cuerpo del post: acá ES la pieza gráfica, no se repite abajo. */
  text: string;
  /**
   * Fondo elegido al publicar (`posts.text_background`). null/ausente = modo
   * Automático: se sortea por el id, que es lo que hacían TODAS las
   * publicaciones antes de que esto se pudiera elegir. Llega como string suelto
   * a propósito —es lo que devuelve la base— y `textBackgroundOf` es quien lo
   * valida contra el catálogo: un valor desconocido cae al sorteo, nunca a una
   * tarjeta sin fondo.
   */
  background?: string | null;
  /** true en /feed/[id]: sin recorte. */
  isDetail?: boolean;
  /** Vista previa del composer: sin capa de toque, sin doble-toque. */
  preview?: boolean;
  className?: string;
}

export function TextBanner({
  postId,
  text,
  background = null,
  isDetail = false,
  preview = false,
  className,
}: TextBannerProps) {
  const reduce = useReducedMotion();
  const like = useCardLike();
  const [bursts, setBursts] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const tapTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  const unclamped = isDetail || expanded;
  const variant = textBackgroundOf(postId, background);
  const type = textTypeScale(text, unclamped);
  // La misma regla que decide el recorte, del lado del botón: si `type.clamp`
  // es null no hay nada escondido, así que ofrecer "Ver completo" mentiría.
  const showMore = !preview && type.clamp !== null;

  function handleDoubleTap() {
    if (!like) return;
    if (like.canReact) setBursts((current) => current + 1);
    like.likeOnce();
  }

  function handleTap() {
    if (tapTimer.current !== null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      handleDoubleTap();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
    }, DOUBLE_TAP_MS);
  }

  return (
    <div
      className={cn(
        "cl-print-fill relative isolate grid w-full overflow-hidden text-on-media",
        className,
      )}
      style={{ backgroundColor: "var(--color-media-backdrop)", backgroundImage: variant.field }}
    >
      <span aria-hidden="true" className="col-start-1 row-start-1 block w-full pt-[125%]" />

      <BrandWatermark />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: `${variant.glow}, ${VIGNETTE}` }}
      />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: GRAIN, backgroundSize: "3px 3px" }}
      />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-3 rounded-md border border-on-media/15"
        style={{ boxShadow: `inset 0 1px 0 ${luz(20)}` }}
      />

      {/* Comillas tipográficas grandes, sangrando por las esquinas — el
          ornamento propio del texto (QuestionBanner usa "¿ ?"). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-3 -top-12 select-none font-display text-[10rem] leading-none opacity-[0.13]"
      >
        “
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 -right-2 select-none font-display text-[10rem] leading-none opacity-[0.13]"
      >
        ”
      </span>

      {/* El espaciador de arriba y esta columna comparten CELDA de grilla, así
          que la fila mide lo que mida el más alto: el 4:5 es el piso y la
          tarjeta crece con el texto. `items-stretch` (el default) es lo que deja
          al párrafo usar todo el ancho —antes iba `items-center`, que lo
          encogía al contenido y era la mitad del "espacio pequeño en el centro"
          que reportó el cliente—; el botón de "Ver completo" se centra solo,
          sin estirarse, porque va envuelto en su propia fila. */}
      <div className="col-start-1 row-start-1 flex flex-col justify-center gap-4 px-6 py-10 sm:px-8">
        <m.p
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
          className={cn(
            "w-full whitespace-pre-wrap font-display font-semibold",
            type.size,
            type.rhythm,
            type.align,
            type.clamp,
          )}
          style={{ textShadow: `0 1px 3px ${velo(40)}` }}
        >
          {text}
        </m.p>

        {showMore && (
          <span className="flex justify-center">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="relative z-20 cursor-pointer rounded-full border border-on-media/25 bg-media-scrim px-3 py-1 text-xs font-semibold transition-colors duration-(--duration-fast) hover:bg-on-media/15 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60"
            >
              {COPY.post.textReadFull}
            </button>
          </span>
        )}
      </div>

      {!preview && (
        <span aria-hidden="true" onClick={handleTap} className="absolute inset-0 z-10" />
      )}

      {bursts > 0 && (
        <m.span
          key={bursts}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
          initial={{ opacity: 0, scale: reduce ? 1 : 0.3 }}
          animate={
            reduce
              ? { opacity: [0, 0.9, 0.9, 0] }
              : { opacity: [0, 1, 1, 0], scale: [0.3, 1.15, 0.95, 1] }
          }
          transition={{
            duration: reduce ? 0.7 : 0.8,
            times: [0, 0.15, 0.45, 1],
            ease: reduce ? [0.32, 0.72, 0, 1] : [0.34, 1.56, 0.64, 1],
          }}
        >
          <Heart weight="fill" size={96} className="drop-shadow-lg" />
        </m.span>
      )}
    </div>
  );
}
