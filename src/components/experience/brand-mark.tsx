"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

type BrandMarkProps = {
  /** Lado del emblema en px. Default 40 (ideal para header). */
  size?: number;
  /**
   * Shine premium: un barrido de luz diagonal al hacer hover sobre el mark
   * (o su contenedor `.group`). Respeta reduced-motion (se desactiva solo).
   * Default true.
   */
  shine?: boolean;
  /** Texto accesible. Si null/"" el mark queda decorativo (aria-hidden). */
  title?: string | null;
  className?: string;
};

/**
 * BRAND MARK — emblema de marca vectorial premium (escudo + monograma "CL").
 *
 * SVG inline, nítido a cualquier resolución y retintable: el silueta del escudo
 * usa `currentColor`, así que hereda el color del contexto (útil para variantes
 * monocromas). Por defecto renderiza el gradiente de marca completo.
 *
 * Micro-interacción: un "shine" — barrido de luz diagonal — cruza el emblema al
 * hover. Es puro adorno (clip-path + transform sobre un gradiente), acotado al
 * client island, y se apaga entero con prefers-reduced-motion:reduce (queda el
 * emblema estático, sin crossfade ni movimiento). No toca layout ni el LCP.
 *
 * Accesibilidad: con `title` se anuncia como imagen con label; sin title queda
 * `aria-hidden` (decorativo). No es focuseable ni atrapa teclado.
 *
 * @example
 * <BrandMark size={40} title="Comunidad Latina" />          // header
 * <BrandMark size={72} shine={false} title={null} />         // splash estático
 */
export function BrandMark({
  size = 40,
  shine = true,
  title,
  className,
}: BrandMarkProps) {
  const reduce = usePrefersReducedMotion();
  const uid = useId().replace(/:/g, "");
  const shineOn = shine && !reduce;
  const labelled = title != null && title !== "";

  const fillId = `clFill-${uid}`;
  const glossId = `clGloss-${uid}`;
  const shineId = `clShine-${uid}`;
  const clipId = `clClip-${uid}`;

  return (
    <span
      className={cn(
        "group/brandmark relative inline-flex shrink-0 [color:var(--color-brand,#1a5edb)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 128 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative"
        role={labelled ? "img" : undefined}
        aria-label={labelled ? title! : undefined}
        aria-hidden={labelled ? undefined : true}
      >
        <defs>
          <linearGradient id={fillId} x1="64" y1="8" x2="64" y2="120" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2C6CE0" />
            <stop offset="1" stopColor="#154CB2" />
          </linearGradient>
          <linearGradient id={glossId} x1="64" y1="8" x2="64" y2="72" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          {shineOn && (
            <linearGradient id={shineId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.55" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
          )}
          <clipPath id={clipId}>
            <path d="M64 8 20 24v40c0 27.6 18.4 47.4 44 56 25.6-8.6 44-28.4 44-56V24L64 8Z" />
          </clipPath>
        </defs>

        {/* Silueta retintable (currentColor) + relleno de marca + gloss superior */}
        <g clipPath={`url(#${clipId})`}>
          <path
            fill="currentColor"
            d="M64 8 20 24v40c0 27.6 18.4 47.4 44 56 25.6-8.6 44-28.4 44-56V24L64 8Z"
          />
          <path
            fill={`url(#${fillId})`}
            d="M64 8 20 24v40c0 27.6 18.4 47.4 44 56 25.6-8.6 44-28.4 44-56V24L64 8Z"
          />
          <path
            fill={`url(#${glossId})`}
            d="M64 8 20 24v40c0 27.6 18.4 47.4 44 56 25.6-8.6 44-28.4 44-56V24L64 8Z"
          />

          {/* Shine: barra diagonal que cruza en hover; recortada al escudo */}
          {shineOn && (
            <rect
              className="cl-brandmark-shine"
              x="-70"
              y="-20"
              width="42"
              height="168"
              fill={`url(#${shineId})`}
              transform="rotate(18 64 64)"
            />
          )}
        </g>

        {/* Borde interior sutil */}
        <path
          fill="none"
          stroke="#86ADEF"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          d="M64 15 27 28.5V64c0 24.2 15.9 41.9 37 49.9 21.1-8 37-25.7 37-49.9V28.5L64 15Z"
        />

        {/* Monograma CL: C (arco abierto) + L anidada */}
        <path
          fill="none"
          stroke="#FCFCFB"
          strokeWidth="9"
          strokeLinecap="round"
          d="M78 47a22 22 0 1 0 0 34"
        />
        <path
          fill="none"
          stroke="#FCFCFB"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M62 45v34h20"
        />
      </svg>

      {shineOn && (
        <style>{`
          .cl-brandmark-shine {
            transform: translateX(0) rotate(18deg);
            transform-origin: 64px 64px;
            transform-box: view-box;
            opacity: 0;
            will-change: transform, opacity;
          }
          .group\\/brandmark:hover .cl-brandmark-shine {
            animation: cl-brandmark-sweep var(--duration-slow, 400ms) var(--ease-out-premium, cubic-bezier(0.32,0.72,0,1)) 1;
          }
          @keyframes cl-brandmark-sweep {
            0%   { transform: translateX(0) rotate(18deg);   opacity: 0; }
            15%  { opacity: 1; }
            85%  { opacity: 1; }
            100% { transform: translateX(200px) rotate(18deg); opacity: 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            .group\\/brandmark:hover .cl-brandmark-shine { animation: none; opacity: 0; }
          }
        `}</style>
      )}
    </span>
  );
}
