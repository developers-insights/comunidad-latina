/**
 * Primitivos de micro-interacción premium ("juice"). Client islands acotadas.
 * TODOS respetan prefers-reduced-motion y mantienen la accesibilidad intacta.
 * Guía de adopción: ./README.md
 */
export { TapScale, type TapScaleProps } from "./tap-scale";
export { AnimatedNumber, type AnimatedNumberProps } from "./animated-number";
export { LikeBurst, type LikeBurstProps } from "./like-burst";
export { Celebration, type CelebrationProps } from "./celebration";
export { Reveal, RevealGroup, type RevealProps, type RevealGroupProps } from "./reveal";
export { Shimmer, type ShimmerProps } from "./shimmer";

export { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
export { useCelebration } from "@/hooks/use-celebration";
