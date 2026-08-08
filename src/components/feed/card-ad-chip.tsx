import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/**
 * Chip honesto de campaña paga — misma palabra ("Patrocinado") que el chip de
 * los avisos impulsados de Vivienda (FTC: la publicidad se divulga, y con un
 * solo nombre en toda la app). Se extrajo de PostCard para poder mostrarlo también
 * SOBRE la foto/el video del post (card-post-media, card-video) sin ciclo de
 * imports. SIEMPRE visible en un post promocionado, aunque tenga CTA de campaña.
 *
 * Variante DORADA (feedback cliente Geovanny, 2026-08-05): "lo que se paga
 * tiene que tener los alrededores en amarillo/dorado... que se reconozca que
 * es publicidad paga". El chip pasa de `variant="brand"` (celeste del tenant)
 * a los tokens `--color-sponsored` / `--color-sponsored-ink` para que hable el
 * MISMO idioma que el anillo dorado que ahora rodea la card entera (ver
 * `card-post-media.tsx` y `post-card.tsx`) — el ojo asocia contorno + chip de
 * un vistazo.
 *
 * FONDO SÓLIDO, no un tinte translúcido: igual que `gold` (§ globals.css,
 * "el dorado nunca es un fondo teñido"), acá tampoco. Este chip flota SOBRE
 * una foto o un video en `card-post-media.tsx` — un tinte al 14% se lee sucio
 * (o directamente ilegible) contra una foto clara, y las badges que ya viven
 * sobre medios en esta app (verificación en `listing-card.tsx`) resuelven
 * igual: `bg-surface` opaco + color de estado en el borde/ícono/texto. Un
 * pill blanco/oscuro con borde dorado grueso además destaca MÁS sobre una
 * foto que un tinte dorado bajo, que a veces se funde con el fondo.
 *
 * `Chip` no expone una variante "sponsored" propia (no es un archivo de este
 * agente); se logra pisando sus clases vía `className`, que `cn()` resuelve
 * con tailwind-merge sin dejar residuo del variant `neutral` de base.
 */
export function AdChip({ className }: { className?: string }) {
  return (
    <Chip
      variant="neutral"
      size="sm"
      className={cn(
        "shrink-0 border-[1.5px] border-sponsored bg-surface text-sponsored-ink shadow-sm",
        className,
      )}
    >
      <Megaphone size={14} weight="fill" aria-hidden="true" />
      {COPY.post.adChip}
    </Chip>
  );
}
