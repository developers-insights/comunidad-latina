"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import styles from "./motion.module.css";

export type CelebrationProps = {
  /** Dispara la celebración cuando pasa a true. */
  active: boolean;
  /** Se llama al terminar (para resetear el estado del padre). */
  onDone?: () => void;
  /** Mensaje accesible anunciado por el lector. Default "¡Listo!". */
  message?: string;
  /** Tamaño del check en px. Default 64. */
  size?: number;
  className?: string;
};

const RAYS = 8;

/**
 * Celebración sutil y ELEGANTE para momentos de logro (publicar aviso, verificar identidad,
 * completar onboarding): un check que se dibuja + un destello suave con rayos de marca.
 * Nada de confeti chillón.
 *
 * - Reduced-motion: check estático con fade, sin rayos ni dibujo de trazo.
 * - Accesible: `role="status"` + `aria-live` anuncian el logro; el overlay es `aria-hidden`
 *   salvo el mensaje. No atrapa foco. Se auto-desmonta al terminar.
 *
 * @example
 * const { celebrating, celebrate } = useCelebration();
 * <Celebration active={celebrating} message="¡Aviso publicado!" />
 */
export function Celebration({
  active,
  onDone,
  message = "¡Listo!",
  size = 64,
  className,
}: CelebrationProps) {
  const reduce = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    const ms = reduce ? 1100 : 1600;
    const t = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, ms);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [active, reduce, onDone]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-[60] flex items-center justify-center",
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "relative flex items-center justify-center rounded-full",
          "bg-success-bg text-success shadow-md",
          reduce ? styles.celebrateFade : styles.celebratePop,
        )}
        style={{ width: size * 1.35, height: size * 1.35 }}
      >
        {!reduce && (
          <span className="pointer-events-none absolute inset-0" aria-hidden>
            {Array.from({ length: RAYS }).map((_, i) => (
              <span
                key={`${uid}-${i}`}
                className={styles.celebrateRay}
                style={{ ["--angle" as string]: `${(360 / RAYS) * i}deg` }}
              />
            ))}
          </span>
        )}
        <svg
          width={size}
          height={size}
          viewBox="0 0 52 52"
          fill="none"
          className="relative z-10"
          aria-hidden
        >
          <path
            d="M14 27l8 8 16-18"
            stroke="currentColor"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={reduce ? undefined : styles.celebrateCheck}
          />
        </svg>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </div>
  );
}
