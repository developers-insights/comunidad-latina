import Link from "next/link";
import {
  ArrowRight,
  Buildings,
  Confetti,
  DotsThreeCircle,
  ForkKnife,
  MusicNotes,
  Play,
  SmileyWink,
  SoccerBall,
  Storefront,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { VideoCategory } from "@/lib/media/video-policy";
import {
  VIDEOS_COPY,
  VIDEO_CATEGORY_HINTS,
  VIDEO_CATEGORY_LABELS,
  VIDEO_CATEGORY_ORDER,
} from "./copy";
import { ALL_CATEGORIES } from "./helpers";
import styles from "./category-menu.module.css";

/**
 * MENÚ DE ENTRADA DE VIDEOS CORTOS (pedido de la call del 29/7, 1:20: "cuando
 * haces clic a videos, sale un menú y tú escoges los videos que quieres").
 *
 * Antes `/videos` arrancaba reproduciendo de una. Ahora, cuando se llega a la
 * sección pelada, primero se elige el tema; el reel abre filtrado desde acá.
 * Los deep links (`?start=`, `?scope=`) NO pasan por esta pantalla — ver
 * `shouldShowCategoryMenu`.
 *
 * SERVER COMPONENT. No tiene estado ni gestos: son diez enlaces. La entrada
 * escalonada es CSS (category-menu.module.css) justamente para no arrastrar
 * hidratación a una pantalla que no la necesita.
 *
 * VISUAL. Doble bisel del sistema (§2.5): un marco teñido con el acento del
 * tema y el núcleo sobre superficie neutra, con su luz interior. El acento sólo
 * TIÑE (marco, halo del ícono); el texto y el glifo se quedan en tinta
 * `foreground`, que es lo único que garantiza AA en los dos temas — el amarillo
 * de negocios no es AA como texto y el sistema ya lo tiene documentado.
 */

interface CategoryVisual {
  icon: Icon;
  /** Variable de acento del sistema. No se inventan colores nuevos acá. */
  accentVar: string;
}

const CATEGORY_VISUALS: Record<VideoCategory, CategoryVisual> = {
  comida: { icon: ForkKnife, accentVar: "var(--accent-empleos)" },
  musica: { icon: MusicNotes, accentVar: "var(--accent-creadores)" },
  eventos: { icon: Confetti, accentVar: "var(--accent-eventos)" },
  propiedades: { icon: Buildings, accentVar: "var(--accent-vivienda)" },
  negocios: { icon: Storefront, accentVar: "var(--accent-negocios)" },
  humor: { icon: SmileyWink, accentVar: "var(--accent-creadores)" },
  deportes: { icon: SoccerBall, accentVar: "var(--accent-marketplace)" },
  comunidad: { icon: UsersThree, accentVar: "var(--accent-profesionales)" },
  otros: { icon: DotsThreeCircle, accentVar: "var(--accent-escudo)" },
};

/** Escalón entre tarjetas. 45 ms: se percibe la cascada sin que se haga lenta. */
const STAGGER_MS = 45;

export function VideoCategoryMenu() {
  return (
    <div className="pb-8">
      <header className={styles.item} style={stagger(0)}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground-muted">
          {VIDEOS_COPY.menu.eyebrow}
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground">
          {VIDEOS_COPY.menu.title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
          {VIDEOS_COPY.menu.subtitle}
        </p>
      </header>

      {/* "Todos" primero y a lo ancho: es el camino de siempre y el que la
          mayoría va a querer. Que sea la pieza más grande no es decoración —
          es la jerarquía de la pantalla. */}
      <Link
        href={`/videos?cat=${ALL_CATEGORIES}`}
        aria-label={VIDEOS_COPY.menu.openAll}
        className={cn(
          "group mt-5 block rounded-xl bg-brand-tint p-1 shadow-bezel",
          "transition-transform duration-(--duration-base) ease-(--ease-out-premium)",
          "active:scale-[0.985]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          styles.item,
        )}
        style={stagger(1)}
      >
        <span
          className={cn(
            "flex items-center gap-3.5 rounded-[calc(var(--radius-xl)-4px)] bg-surface px-4 py-4",
            "shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]",
          )}
        >
          {/* `cl-print-fill`: el glifo es tinta `brand-foreground` —clara por
              definición— y vive de su relleno. En papel, sin el relleno, queda
              en 1.00:1 (ver src/test/print-contract.test.ts). */}
          <span
            aria-hidden="true"
            className="cl-print-fill grid size-11 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground"
          >
            <Play size={20} weight="fill" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-base font-bold text-foreground">
              {VIDEOS_COPY.menu.allLabel}
            </span>
            <span className="mt-0.5 block text-sm leading-snug text-foreground-secondary">
              {VIDEOS_COPY.menu.allHint}
            </span>
          </span>
          {/* Flecha dentro de su propio círculo, al ras del borde interior:
              el patrón de CTA del sistema. Se corre con el grupo, no sola. */}
          <span
            aria-hidden="true"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full bg-surface-subtle text-foreground-secondary",
              "transition-transform duration-(--duration-base) ease-(--ease-out-premium)",
              "group-hover:translate-x-0.5 group-hover:bg-brand-tint group-hover:text-brand-ink",
            )}
          >
            <ArrowRight size={15} weight="bold" />
          </span>
        </span>
      </Link>

      <ul
        aria-label={VIDEOS_COPY.menu.listLabel}
        className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {VIDEO_CATEGORY_ORDER.map((category, index) => {
          const visual = CATEGORY_VISUALS[category];
          const CategoryIcon = visual.icon;
          const label = VIDEO_CATEGORY_LABELS[category];
          return (
            <li key={category} className={styles.item} style={stagger(index + 2)}>
              <Link
                href={`/videos?cat=${category}`}
                aria-label={VIDEOS_COPY.menu.openCategory(label)}
                className={cn(
                  "group block h-full rounded-xl p-1 shadow-bezel",
                  "transition-transform duration-(--duration-base) ease-(--ease-out-premium)",
                  "active:scale-[0.97]",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
                // El marco toma el acento del tema en una mezcla suave: tiñe sin
                // competir con el contenido, y funciona igual en claro y oscuro
                // porque se mezcla contra la superficie, no contra blanco.
                style={{
                  backgroundColor: `color-mix(in oklab, ${visual.accentVar} 16%, var(--color-surface-subtle))`,
                }}
              >
                <span
                  className={cn(
                    "flex h-full flex-col gap-2 rounded-[calc(var(--radius-xl)-4px)] bg-surface p-3.5",
                    "shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-10 place-items-center rounded-full text-foreground",
                      "transition-transform duration-(--duration-base) ease-(--ease-spring)",
                      "group-hover:scale-105",
                    )}
                    style={{
                      backgroundColor: `color-mix(in oklab, ${visual.accentVar} 18%, var(--color-surface))`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${visual.accentVar} 32%, transparent)`,
                    }}
                  >
                    <CategoryIcon size={19} weight="duotone" />
                  </span>
                  <span className="block font-display text-sm font-bold leading-tight text-foreground">
                    {label}
                  </span>
                  <span className="block text-xs leading-snug text-foreground-secondary">
                    {VIDEO_CATEGORY_HINTS[category]}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p
        className={cn("mt-5 text-center text-xs text-foreground-muted", styles.item)}
        style={stagger(VIDEO_CATEGORY_ORDER.length + 2)}
      >
        {VIDEOS_COPY.menu.footnote}
      </p>
    </div>
  );
}

/** Delay de la cascada como custom property (ver el módulo CSS). */
function stagger(index: number): React.CSSProperties {
  return { "--cl-stagger": `${index * STAGGER_MS}ms` } as React.CSSProperties;
}
