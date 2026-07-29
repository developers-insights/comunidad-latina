"use client";

import { useEffect, useRef, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { Heart } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
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
 *  · TRES VARIANTES PROPIAS. Mismos ángulos de luz que la fórmula general,
 *    pero con su propio recorrido de color: que un texto y una pregunta
 *    vecinos en el feed no salgan de la misma paleta en el mismo orden.
 *  · SIN ENCUESTA. `kind='text'` nunca lleva poll_kind (posts_poll_only_on_question,
 *    0041) — no hay prop de footer.
 */

const DOUBLE_TAP_MS = 250;
const SHADE = "var(--color-media-shade)";

const tinte = (accent: string, pct: number) =>
  `color-mix(in oklab, ${accent} ${pct}%, ${SHADE})`;
const luz = (pct: number) =>
  `color-mix(in oklab, var(--color-on-media) ${pct}%, transparent)`;
const velo = (pct: number) =>
  `color-mix(in oklab, ${SHADE} ${pct}%, transparent)`;

/**
 * Tres identidades propias (ver docblock). Los porcentajes de `tinte` se
 * eligieron por DEBAJO de los máximos ya probados en QuestionBanner (blue
 * ≤90%, red ≤80%, yellow ≤50% — la original usa amarillo hasta 58% y rojo
 * hasta 84%) y se verificaron con `culori` (oklab, mismo espacio que
 * `color-mix`) sumando el brillo como un overlay PLANO al 100% de su opacidad
 * —más severo que el degradado radial real, que solo pega así de fuerte en un
 * punto— y el peor caso dio 5.90:1, con margen sobre el 4.5:1 de AA.
 */
const VARIANTS = [
  {
    // Amanecer — amarillo que se abre en azul, el recorrido inverso al de Pregunta.
    field: `linear-gradient(148deg, ${tinte("var(--brand-yellow)", 60)} 0%, ${tinte("var(--brand-blue)", 62)} 46%, ${tinte("var(--brand-blue)", 92)} 100%)`,
    glow: `radial-gradient(86% 60% at 18% 8%, ${luz(9)} 0%, transparent 64%)`,
  },
  {
    // Noche — azul que se hunde en un rojo casi negro.
    field: `linear-gradient(160deg, ${tinte("var(--brand-blue)", 88)} 0%, ${tinte("var(--brand-blue)", 52)} 40%, ${tinte("var(--brand-red)", 70)} 100%)`,
    glow: `radial-gradient(80% 58% at 82% 12%, ${luz(8)} 0%, transparent 60%)`,
  },
  {
    // Plaza — rojo que se calienta en amarillo, sin pasar por el azul.
    field: `linear-gradient(150deg, ${tinte("var(--brand-red)", 82)} 0%, ${tinte("var(--brand-red)", 50)} 42%, ${tinte("var(--brand-yellow)", 66)} 100%)`,
    glow: `radial-gradient(90% 62% at 22% 90%, ${luz(7)} 0%, transparent 66%)`,
  },
] as const;

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

/** Hash determinístico sobre el id — mismo id, misma variante, siempre. */
export function textVariantOf(postId: string): number {
  let hash = 0;
  for (let i = 0; i < postId.length; i++) {
    hash = (hash * 33 + postId.charCodeAt(i)) >>> 0;
  }
  return hash % VARIANTS.length;
}

const LONG_TEXT = 300;

export interface TextTypeScale {
  size: string;
  rhythm: string;
  clamp: string | null;
}

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

/** Mismos tramos que QuestionBanner (misma card, mismo 4:5 mínimo). */
export function textTypeScale(text: string, isDetail: boolean): TextTypeScale {
  const length = text.trim().length;
  const clamp = (lines: number) => (isDetail ? null : (CLAMP[Math.max(3, lines)] ?? CLAMP[3]));
  if (length <= 48) {
    return { size: "text-3xl", rhythm: "leading-tight tracking-tight", clamp: clamp(7) };
  }
  if (length <= 110) {
    return { size: "text-2xl", rhythm: "leading-snug tracking-tight", clamp: clamp(9) };
  }
  if (length <= 200) {
    return { size: "text-xl", rhythm: "leading-snug", clamp: clamp(11) };
  }
  return { size: "text-lg", rhythm: "leading-relaxed", clamp: clamp(11) };
}

export interface TextBannerProps {
  postId: string;
  /** El cuerpo del post: acá ES la pieza gráfica, no se repite abajo. */
  text: string;
  /** true en /feed/[id]: sin recorte. */
  isDetail?: boolean;
  /** Vista previa del composer: sin capa de toque, sin doble-toque. */
  preview?: boolean;
  className?: string;
}

export function TextBanner({ postId, text, isDetail = false, preview = false, className }: TextBannerProps) {
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
  const variant = VARIANTS[textVariantOf(postId)];
  const type = textTypeScale(text, unclamped);
  const showMore = !unclamped && !preview && text.trim().length > LONG_TEXT;

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
          {text}
        </m.p>

        {showMore && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="relative z-20 cursor-pointer rounded-full border border-on-media/25 bg-media-scrim px-3 py-1 text-xs font-semibold transition-colors duration-(--duration-fast) hover:bg-on-media/15 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60"
          >
            {COPY.post.textReadFull}
          </button>
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
