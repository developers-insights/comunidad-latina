import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/**
 * Chip honesto de campaña paga — mismo lenguaje que "Destacado" de boosts (FTC:
 * la publicidad se divulga). Se extrajo de PostCard para poder mostrarlo también
 * SOBRE la foto/el video del post (card-post-media, card-video) sin ciclo de
 * imports. SIEMPRE visible en un post promocionado, aunque tenga CTA de campaña.
 */
export function AdChip({ className }: { className?: string }) {
  return (
    <Chip variant="brand" size="sm" className={cn("shrink-0", className)}>
      <Megaphone size={14} weight="fill" aria-hidden="true" />
      {COPY.post.adChip}
    </Chip>
  );
}
