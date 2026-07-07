"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import styles from "./motion.module.css";

export type LikeBurstProps = {
  /** Estado controlado: reaccionado o no. */
  active: boolean;
  /** Se llama al togglear. El padre actualiza `active`. */
  onToggle: (next: boolean) => void;
  /** Contenido: normalmente el ícono de corazón (Phosphor). Recibís `active` para pintar fill. */
  children: React.ReactNode;
  /** Etiqueta accesible. Default "Me gusta". */
  label?: string;
  /** Color de las partículas. Default var(--color-brand). */
  particleColor?: string;
  className?: string;
};

const PARTICLES = 6;

/**
 * Micro-celebración al reaccionar: el ícono hace pop (spring) + 6 partículas sutiles
 * de marca que se dispersan. Muy breve (~500ms).
 *
 * - Accesible: es un `<button>` real con `aria-pressed`; la reacción NO depende de la
 *   animación (el estado se comunica por aria-pressed + el fill del ícono que renderiza el padre).
 * - Reduced-motion: sin partículas ni pop; sólo el cambio de estado inmediato.
 *
 * @example
 * <LikeBurst active={liked} onToggle={setLiked}>
 *   <Heart weight={liked ? "fill" : "regular"} className={liked ? "text-brand" : ""} />
 * </LikeBurst>
 */
export function LikeBurst({
  active,
  onToggle,
  children,
  label = "Me gusta",
  particleColor = "var(--color-brand)",
  className,
}: LikeBurstProps) {
  const reduce = usePrefersReducedMotion();
  const [bursting, setBursting] = useState(false);
  const uid = useId().replace(/:/g, "");

  const handleClick = () => {
    const next = !active;
    onToggle(next);
    if (next && !reduce) {
      setBursting(false);
      // reinicia la animación aunque se toque rápido
      requestAnimationFrame(() => setBursting(true));
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "relative inline-flex items-center justify-center rounded-full",
        "transition-transform duration-(--duration-instant) ease-(--ease-spring)",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-200",
        !reduce && bursting && styles.likePop,
        className,
      )}
      onAnimationEnd={(e) => {
        // El burst dura lo que dura la partícula más larga (like-particle, 520ms).
        // El pop del botón (like-pop, 250ms) termina antes y burbujea hasta acá:
        // ignoramos su animationend para no desmontar las partículas a mitad de vuelo.
        // Las partículas son hijas → e.target !== e.currentTarget; el pop es del
        // propio botón → e.target === e.currentTarget.
        if (e.target === e.currentTarget) return;
        setBursting(false);
      }}
    >
      {!reduce && bursting && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: PARTICLES }).map((_, i) => {
            const angle = (360 / PARTICLES) * i;
            return (
              <span
                key={`${uid}-${i}`}
                className={styles.likeParticle}
                style={{
                  ["--angle" as string]: `${angle}deg`,
                  background: particleColor,
                }}
              />
            );
          })}
        </span>
      )}
      <span className="relative z-10 inline-flex">{children}</span>
    </button>
  );
}
