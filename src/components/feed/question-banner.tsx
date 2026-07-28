"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart } from "@phosphor-icons/react/dist/ssr";
import { m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { useCardLike } from "./card-like-context";

/**
 * BANNER DE LAS PUBLICACIONES TIPO "PREGUNTA" (feedback cliente 2026-07-26:
 * "que siempre tenga un banner o algo").
 *
 * `kind='question'` es el ÚNICO kind de post exento del requisito de medio (el
 * trigger de 0023 no le pide foto ni video), así que hasta hoy una pregunta caía
 * en el feed como un párrafo suelto entre cards con foto 4:5 a sangre — un hueco
 * de aire en un feed que por lo demás es visual.
 *
 * La solución NO es inventarle una foto: es tratar la pregunta COMO la pieza
 * gráfica. El cuerpo del post se compone sobre un campo de marca (el tricolor
 * azul · amarillo · rojo del logo, siempre rebajado contra `media-shade` para que
 * la tinta `on-media` quede AA), con la caja tipográfica de un afiche: signos de
 * interrogación de apertura y cierre sangrando por las esquinas, marco interior
 * de hairline (bisel anidado) y grano fino de papel. Nada de degradado plano.
 *
 * Decisiones que valen la pena conocer antes de tocar el archivo:
 *
 *  · VARIANTE DETERMINÍSTICA. El fondo sale de un hash del id del post, no de un
 *    random: la misma pregunta se ve igual en el feed, en el detalle y después de
 *    recargar. Tres variantes alcanzan para que un feed con varias preguntas no
 *    parezca un patrón repetido.
 *
 *  · EL 4:5 ES UN MÍNIMO, NO UNA JAULA. El alto lo fija un espaciador
 *    (`pt-[125%]`) apilado en la MISMA celda de grid que el texto: la celda mide
 *    lo que mida el más alto de los dos. En el feed el texto se recorta y el
 *    banner queda exacto al alto de las fotos; en el detalle no se recorta nada y
 *    el banner crece lo que haga falta — una pregunta larga se lee entera.
 *
 *  · ES MEDIA A TODOS LOS EFECTOS. Doble toque = me gusta con el mismo estado
 *    compartido de la card (useCardLike) y la misma ventana de 250ms que la foto.
 *    Toque simple: en el feed abre el detalle (no hay visor para un banner); en
 *    el detalle no hace nada, y por eso ahí la capa de toque ni siquiera es
 *    focusable — el camino accesible al me gusta sigue siendo el botón de
 *    PostActions, el doble toque es un extra táctil.
 */

/** Ventana para distinguir un toque simple de un doble toque (misma que la foto). */
const DOUBLE_TAP_MS = 250;

/** Tinta de los rebajes. Una foto es oscura en los dos temas; este campo también. */
const SHADE = "var(--color-media-shade)";

/**
 * Acento de marca rebajado contra la tinta oscura. El porcentaje NO es estético:
 * es el que mantiene `on-media` (#f7f6f3) por encima de 4.5:1 sobre cada parada
 * del degradado. El amarillo es el delicado —a plena fuerza da ~2.2:1— y por eso
 * nunca pasa de ~60%; el azul aguanta casi puro.
 */
const tinte = (accent: string, pct: number) =>
  `color-mix(in oklab, ${accent} ${pct}%, ${SHADE})`;

/** Vidrio claro (luz) o velo oscuro (vignette), siempre desde tokens. */
const luz = (pct: number) =>
  `color-mix(in oklab, var(--color-on-media) ${pct}%, transparent)`;
const velo = (pct: number) =>
  `color-mix(in oklab, ${SHADE} ${pct}%, transparent)`;

/**
 * Las tres identidades del banner. Cada una mueve el ángulo, el orden del
 * tricolor y de dónde viene la luz: dos preguntas seguidas en el feed no se leen
 * como la misma plantilla repintada.
 *
 * LA LUZ ES PARTE DE LA CUENTA DE CONTRASTE (corregido 2026-07-27). Los
 * porcentajes de `tinte` estaban calculados sobre las paradas del degradado
 * SOLAS, pero encima va este `glow`, que suma blanco: con la luz al 17% el peor
 * píxel bajo un glifo medía 4.25:1 — por debajo de AA — en la variante azul.
 * Medido en el navegador (captura del banner con el texto oculto, luminancia
 * relativa WCAG del fondo bajo cada píxel de glifo pleno), bajarla a 9/8/7 deja
 * el peor caso en 4.67:1 y el cambio no se nota a simple vista. Si alguien sube
 * estos números, que vuelva a medir.
 */
const VARIANTS = [
  {
    // Atardecer — azul profundo que cae en rojo ladrillo.
    field: `linear-gradient(152deg, ${tinte("var(--brand-blue)", 94)} 0%, ${tinte("var(--brand-blue)", 60)} 44%, ${tinte("var(--brand-red)", 64)} 100%)`,
    glow: `radial-gradient(84% 58% at 16% 6%, ${luz(9)} 0%, transparent 64%)`,
  },
  {
    // Brasa — rojo que se abre en bronce (el amarillo del logo, rebajado).
    field: `linear-gradient(158deg, ${tinte("var(--brand-red)", 84)} 0%, ${tinte("var(--brand-red)", 56)} 38%, ${tinte("var(--brand-yellow)", 58)} 100%)`,
    glow: `radial-gradient(78% 56% at 84% 10%, ${luz(8)} 0%, transparent 60%)`,
  },
  {
    // Sobremesa — bronce arriba, azul noche abajo. La más editorial de las tres.
    field: `linear-gradient(146deg, ${tinte("var(--brand-yellow)", 54)} 0%, ${tinte("var(--brand-blue)", 64)} 52%, ${tinte("var(--brand-blue)", 98)} 100%)`,
    glow: `radial-gradient(92% 64% at 24% 92%, ${luz(7)} 0%, transparent 66%)`,
  },
] as const;

/** Vignette común: cierra los bordes y le da cuerpo al centro donde va el texto. */
const VIGNETTE = `radial-gradient(118% 96% at 50% 46%, transparent 34%, ${velo(46)} 100%)`;

/**
 * Grano de papel. Un punto de medio píxel cada 3px: a simple vista no se ve un
 * patrón, se ve una superficie impresa en vez de un degradado de CSS.
 */
const GRAIN = `radial-gradient(var(--color-on-media) 0.5px, transparent 0.6px)`;

// ---------------------------------------------------------------------------
// MARCA DE AGUA (feedback cliente 2026-07-27: "puede ser el fondo, el watermark
// de comunidad latina… no tan clarito, pero que esté como watermark")
// ---------------------------------------------------------------------------

/**
 * Las tres figuras del logo, dibujadas con primitivas que se funden en una sola
 * silueta. Va inline y en `currentColor` a propósito: el PNG de marca pesa 318
 * KB —una barbaridad para repetirlo en cada pregunta del feed— y además trae
 * sus colores fijos, que acá pelearían con el tricolor del campo. Una marca de
 * agua es un relieve monocromo, no el logo pegado encima.
 */
function BrandFigures({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
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
    <svg
      viewBox="0 0 180 156"
      aria-hidden="true"
      fill="currentColor"
      className={className}
      style={style}
    >
      {figure("left")}
      {figure("center", "translate(52 -8) scale(1.07)")}
      {figure("right", "translate(112 0)")}
    </svg>
  );
}

/**
 * La marca prensada en el papel. Dos copias con 1.5px de corrimiento: abajo el
 * labio de luz, encima el cuerpo en tinta OSCURA — un deboss, no una calcomanía.
 *
 * DOS DECISIONES QUE NO SON DE GUSTO:
 *
 *  · EL CUERPO ES OSCURO. Una marca de agua clara sobre este campo levanta la
 *    luminancia justo donde cae la tinta `on-media` y tira la pregunta por
 *    debajo de 4.5:1 (con apenas 6% de blanco encima, el peor stop del degradado
 *    cae a ~3.9:1). Oscureciendo, el texto encima solo puede GANAR contraste.
 *    Por eso además va antes del vignette: el velo de los bordes la asienta.
 *
 *  · VA ABAJO A LA IZQUIERDA, NO CENTRADA. Centrada compite de frente con el
 *    titular y ensucia la caja tipográfica. Sangrando por la esquina libre —el
 *    `¿` toma la de arriba a la izquierda y el `?` la de abajo a la derecha—
 *    firma la pieza sin meterse en la lectura.
 */
function BrandWatermark() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-[9%] -left-[7%] w-[58%]"
    >
      <BrandFigures
        className="absolute inset-0 h-auto w-full translate-x-[1.5px] translate-y-[1.5px]"
        style={{ color: "var(--color-on-media)", opacity: 0.08 }}
      />
      <BrandFigures
        className="relative h-auto w-full"
        style={{ color: SHADE, opacity: 0.17 }}
      />
    </span>
  );
}

/**
 * Variante del banner para un post. Hash determinístico (djb2-ish) sobre el id:
 * mismo id → misma variante, siempre y en todos lados. Los uuid difieren desde
 * los primeros caracteres, así que reparte bien sin necesitar nada más caro.
 */
export function questionVariantOf(postId: string): number {
  let hash = 0;
  for (let i = 0; i < postId.length; i++) {
    hash = (hash * 33 + postId.charCodeAt(i)) >>> 0;
  }
  return hash % VARIANTS.length;
}

/**
 * A partir de ~300 caracteres la pregunta ya no entra en el 4:5 ni en el cuerpo
 * más chico: en el feed se recorta y aparece el "ver completa". En el detalle no
 * se recorta nunca (ahí el banner crece).
 */
const LONG_QUESTION = 300;

export interface QuestionTypeScale {
  /** Clase de tamaño de la escala tipográfica (§2.2), no un valor arbitrario. */
  size: string;
  /** Interlineado y tracking acordes al cuerpo elegido. */
  rhythm: string;
  /** Recorte elegante en el feed; null en el detalle (se lee entera). */
  clamp: string | null;
}

/**
 * Los `line-clamp-[N]` posibles, ESCRITOS COMO LITERALES: Tailwind los descubre
 * escaneando el fuente, así que una clase armada en runtime
 * (`line-clamp-[${n}]`) no generaría CSS y el recorte no existiría.
 */
const CLAMP: Record<number, string> = {
  3: "line-clamp-[3]",
  4: "line-clamp-[4]",
  5: "line-clamp-[5]",
  6: "line-clamp-[6]",
  7: "line-clamp-[7]",
  8: "line-clamp-[8]",
  9: "line-clamp-[9]",
  10: "line-clamp-[10]",
  11: "line-clamp-[11]",
};

/**
 * Cuerpo decreciente por longitud, al estilo de los posts de color: una pregunta
 * de seis palabras es un titular; una de tres renglones es un párrafo.
 *
 * Los topes de `line-clamp` son los renglones que ENTRAN en el 4:5 con ese
 * cuerpo, medidos sobre una card de 360px (el banner queda de 450px; descontado
 * el `py-10` y, en el tramo largo, la píldora de "ver completa"). Como el alto de
 * cada renglón sale de `leading-*` —un múltiplo del cuerpo, no de la familia—,
 * la cuenta no depende de que General Sans haya cargado. En una card MÁS ancha
 * sobra lugar; en uno de esos teléfonos de 320px el peor caso puede empujar el
 * banner unos pocos píxeles más abajo del 4:5, y está bien: el 4:5 es un mínimo,
 * no una jaula (ver la cabecera del archivo).
 */
export function questionTypeScale(
  question: string,
  isDetail: boolean,
  /**
   * Renglones que OTRO contenido del banner ya reservó. Hoy lo usa la encuesta
   * Sí/No: dos barras de 44px + su pie ocupan ~120px, que a estos cuerpos son
   * unos cuatro renglones. Sin descontarlos, una pregunta larga con encuesta
   * empujaría la card muy por debajo del 4:5 del resto del feed.
   */
  reservedLines = 0,
): QuestionTypeScale {
  const length = question.trim().length;
  // Nunca por debajo de 3 renglones: un recorte de una línea no es un recorte,
  // es una pregunta ilegible.
  const clamp = (lines: number) =>
    isDetail ? null : (CLAMP[Math.max(3, lines - reservedLines)] ?? CLAMP[3]);
  if (length <= 48) {
    return { size: "text-3xl", rhythm: "leading-tight tracking-tight", clamp: clamp(7) };
  }
  if (length <= 110) {
    return { size: "text-2xl", rhythm: "leading-snug tracking-tight", clamp: clamp(9) };
  }
  if (length <= 200) {
    return { size: "text-xl", rhythm: "leading-snug", clamp: clamp(11) };
  }
  // 11 y no 12: en este tramo aparece la píldora de "ver completa", que se come
  // un renglón largo del presupuesto vertical.
  return { size: "text-lg", rhythm: "leading-relaxed", clamp: clamp(11) };
}

export interface QuestionBannerProps {
  postId: string;
  /** El cuerpo del post: acá ES la pieza gráfica, no se repite abajo. */
  question: string;
  /** true en /feed/[id]: sin recorte y sin navegación al tocar. */
  isDetail?: boolean;
  /**
   * Contenido interactivo bajo la pregunta, DENTRO de la pieza (hoy: la
   * encuesta Sí/No). Va por encima de la capa de toque, así que sus botones
   * reciben el tap sin que el banner navegue al detalle.
   */
  footer?: React.ReactNode;
  /**
   * Vista previa del composer: sin capa de toque, sin navegación y sin doble
   * toque. Es una maqueta de "así se va a ver", no una publicación.
   */
  preview?: boolean;
  className?: string;
}

export function QuestionBanner({
  postId,
  question,
  isDetail = false,
  footer,
  preview = false,
  className,
}: QuestionBannerProps) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const like = useCardLike();
  const [bursts, setBursts] = useState(0);
  const tapTimer = useRef<number | null>(null);

  // Si la card se desmonta con un toque en vuelo (scroll rápido), que el timer no
  // navegue desde una card que ya no está. Mismo cuidado que en la foto.
  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  const variant = VARIANTS[questionVariantOf(postId)];
  const type = questionTypeScale(question, isDetail, footer ? 4 : 0);
  const href = isDetail || preview ? null : `/feed/${postId}`;
  const showMore = !isDetail && !preview && question.trim().length > LONG_QUESTION;

  function handleDoubleTap() {
    if (!like) return;
    // El corazón grande es feedback visual y sólo con sesión: sin ella likeOnce
    // lleva a /entrar y un corazón mentiría un me gusta que no existe.
    if (like.canReact) setBursts((current) => current + 1);
    like.likeOnce();
  }

  function handleTap(event: React.MouseEvent) {
    // Teclado (Enter sobre el link) y ctrl/⌘+clic: no son gestos táctiles, no
    // tienen por qué esperar la ventana del doble toque. Dejamos pasar el link.
    if (href && (event.detail === 0 || event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (tapTimer.current !== null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      handleDoubleTap();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      // En el detalle un toque simple no hace nada: no hay visor para un banner
      // y ya estás en la publicación.
      if (href) router.push(href);
    }, DOUBLE_TAP_MS);
  }

  return (
    <div
      className={cn(
        // `cl-print-fill`: la tinta es clara por definición — sin su relleno
        // impreso, la pregunta sale en 1.00:1 sobre el papel.
        "cl-print-fill relative isolate grid w-full overflow-hidden text-on-media",
        className,
      )}
      style={{
        backgroundColor: "var(--color-media-backdrop)",
        backgroundImage: variant.field,
      }}
    >
      {/* Espaciador: fija el 4:5 como ALTO MÍNIMO de la celda (ver cabecera). */}
      <span
        aria-hidden="true"
        className="col-start-1 row-start-1 block w-full pt-[125%]"
      />

      {/* Marca de agua ANTES de la luz y el vignette: es parte del papel, no
          algo apoyado encima (ver el comentario de BrandWatermark). */}
      <BrandWatermark />

      {/* Luz de la variante + vignette que cierra los bordes. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: `${variant.glow}, ${VIGNETTE}` }}
      />

      {/* Grano fino de papel impreso. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: GRAIN, backgroundSize: "3px 3px" }}
      />

      {/* Marco interior (bisel anidado): hairline + brillo superior de 1px. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-3 rounded-md border border-on-media/15"
        style={{ boxShadow: `inset 0 1px 0 ${luz(20)}` }}
      />

      {/* Los signos, sangrando por las esquinas: ornamento, no copy — por eso van
          en aria-hidden y no en copy.ts (misma categoría que un ícono). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-3 -top-10 select-none font-display text-[9rem] leading-none opacity-[0.13]"
      >
        ¿
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-14 -right-2 select-none font-display text-[9rem] leading-none opacity-[0.13]"
      >
        ?
      </span>

      {/* LA PREGUNTA. Entra con un fundido corto hacia arriba; con
          prefers-reduced-motion aparece y listo. */}
      <div className="col-start-1 row-start-1 flex flex-col items-center justify-center gap-4 px-7 py-10">
        <m.p
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
          className={cn(
            "whitespace-pre-wrap text-center font-display font-semibold text-balance",
            type.size,
            type.rhythm,
            type.clamp,
          )}
          style={{ textShadow: `0 1px 3px ${velo(40)}` }}
        >
          {question}
        </m.p>

        {showMore && (
          <span className="rounded-full border border-on-media/25 bg-media-scrim px-3 py-1 text-xs font-semibold">
            {COPY.post.questionReadFull}
          </span>
        )}

        {/* La encuesta vive DENTRO de la pieza (el cliente la dibujó pegada a la
            pregunta) pero por encima de la capa de toque: tocar "Sí" vota, no
            abre el detalle. `w-full` para que las barras midan la columna. */}
        {footer && <div className="relative z-20 mt-1 w-full">{footer}</div>}
      </div>

      {/* Capa de toque. En el feed es un link real (Enter navega, ⌘+clic abre en
          otra pestaña); en el detalle no hay acción simple, así que no es
          focusable ni se anuncia: el doble toque es un extra táctil. */}
      {href ? (
        <Link
          href={href}
          aria-label={COPY.post.openPost}
          onClick={handleTap}
          className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
        />
      ) : preview ? null : (
        <span
          aria-hidden="true"
          onClick={handleTap}
          className="absolute inset-0 z-10"
        />
      )}

      {/* Corazón del doble toque (decorativo: el estado lo comunica el botón). */}
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
