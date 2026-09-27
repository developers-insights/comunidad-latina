import Link from "next/link";
import { FilmSlate, MapPin, Play } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import { formatDuration } from "@/lib/media/video-policy";
import { longVideoHrefForListing } from "@/lib/media/listing-video-policy";
import { cn } from "@/lib/utils";
import { VIDEOS_COPY } from "../copy";
import type { AvisoConVideoLargo } from "./aviso-queries";

export const AVISOS_LARGOS_COPY = {
  titulo: "De los avisos",
  bajada: "Recorridas y presentaciones completas de propiedades, negocios y más.",
  chip: "Aviso",
  verAviso: "Ver el aviso",
  mas: "Más videos de avisos",
} as const;

export function AvisoVideoCard({ aviso, first = false }: { aviso: AvisoConVideoLargo; first?: boolean }) {
  const duracion = formatDuration(aviso.video.durationSeconds);

  return (
    <li>
      <Link
        href={longVideoHrefForListing(aviso.id)}
        aria-label={VIDEOS_COPY.largos.openVideo(aviso.title)}
        className={cn(
          "group block overflow-hidden rounded-xl bg-surface shadow-bezel",
          "transition-transform duration-(--duration-base) ease-(--ease-out-premium)",
          "active:scale-[0.99]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-media-shade">
          <div className="absolute inset-0 bg-[radial-gradient(115%_85%_at_50%_20%,var(--color-brand-900),var(--color-media-shade)_70%)]" />
          {aviso.video.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- poster del bucket público, mismo trato que LongVideoCard
            <img
              src={aviso.video.posterUrl}
              alt=""
              loading={first ? "eager" : "lazy"}
              className="relative h-full w-full object-cover transition-transform duration-(--duration-slow) ease-(--ease-out-premium) group-hover:scale-[1.02]"
              draggable={false}
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center">
              <FilmSlate size={34} className="text-on-media/45" aria-hidden="true" />
            </span>
          )}
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-(--duration-base) ease-(--ease-out-premium) group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <span className="grid size-14 place-items-center rounded-full bg-media-scrim text-on-media backdrop-blur-sm">
              <Play size={24} weight="fill" />
            </span>
          </span>
          {duracion && (
            <span
              aria-hidden="true"
              className="numeric cl-print-fill absolute bottom-2 right-2 rounded-md bg-media-scrim px-1.5 py-0.5 text-xs font-semibold text-on-media backdrop-blur-sm"
            >
              {duracion}
            </span>
          )}
          <span className="absolute left-2 top-2">
            <Chip variant="brand" size="sm">
              {AVISOS_LARGOS_COPY.chip}
            </Chip>
          </span>
        </div>

        <div className="px-3.5 pb-3.5 pt-3">
          <p className="line-clamp-2 font-display text-[0.9375rem] font-bold leading-snug text-foreground">
            {aviso.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm text-foreground-secondary">
            {aviso.priceLabel && (
              <span className="numeric font-semibold text-foreground">{aviso.priceLabel}</span>
            )}
            {aviso.areaLabel && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin size={14} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{aviso.areaLabel}</span>
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function AvisosConVideoLargo({
  avisos,
  titulo = AVISOS_LARGOS_COPY.titulo,
  className,
}: {
  avisos: readonly AvisoConVideoLargo[];
  titulo?: string;
  className?: string;
}) {
  if (avisos.length === 0) return null;
  return (
    <section className={className} aria-labelledby="avisos-video-largo">
      <h2 id="avisos-video-largo" className="font-display text-base font-bold text-foreground">
        {titulo}
      </h2>
      <p className="mt-0.5 text-sm text-foreground-secondary">{AVISOS_LARGOS_COPY.bajada}</p>
      <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {avisos.map((aviso, index) => (
          <AvisoVideoCard key={aviso.id} aviso={aviso} first={index === 0} />
        ))}
      </ul>
    </section>
  );
}
