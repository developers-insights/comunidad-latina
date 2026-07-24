import Link from "next/link";
import { Camera, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, Avatar, BezelCard, CardMedia, MediaScrimBottom } from "@/components/ui";
import { IdentityBadge } from "@/components/auth/identity-badge";
import { FollowButton } from "@/components/social/follow-button";
import { cn } from "@/lib/utils";
import { RatingStars } from "./rating-stars";
import { COPY } from "./copy";

export interface CreatorCardModel {
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  identityVerified: boolean;
  headline: string;
  skills: string[];
  /** Primera foto del portfolio (post-media) o null → hero violeta. */
  portfolioUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  completedJobs: number;
  available: boolean;
  /** ¿Ya lo sigue quien mira? (resuelto en el server). */
  initialFollowing: boolean;
  /** ¿La card es del propio usuario? Si sí, no se muestra "Seguir" (no podés seguirte). */
  isSelf?: boolean;
}

const MAX_SKILLS = 4;

/** Acento violeta del módulo (solo decorativo) para la píldora de acción. */
const ACCENT = "var(--accent-creadores)";

const MEDIA_LINK =
  "group block focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]";

/**
 * Card de creador del directorio "Buscar creadores" (§ feedback cliente
 * 2026-07-24: se siente RED SOCIAL, tipo perfil de Instagram). Hero de portfolio
 * vertical 4:5 (o fallback violeta); el avatar + nombre + titular viven en una
 * franja de VIDRIO sobre la foto, con la disponibilidad flotando arriba. Tap en
 * la foto abre el perfil; debajo, reputación, habilidades y las acciones
 * (Seguir + una píldora con el acento del módulo).
 */
export function CreatorCard({ creator }: { creator: CreatorCardModel }) {
  const availabilityChip = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-sm",
        "cl-print-fill bg-media-scrim text-on-media",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", creator.available ? "bg-success" : "bg-foreground-muted")}
      />
      {creator.available ? COPY.directory.available : COPY.directory.unavailable}
    </span>
  );

  const band = (
    <div className="flex items-center gap-2.5">
      <Avatar
        size="md"
        src={creator.avatarUrl}
        name={creator.displayName}
        badge={creator.identityVerified ? <IdentityBadge /> : undefined}
        className="ring-2 ring-on-media/40"
      />
      <div className="min-w-0">
        <p className="truncate font-display text-base font-bold leading-tight">{creator.displayName}</p>
        <p className="truncate text-sm opacity-90">{creator.headline}</p>
      </div>
    </div>
  );

  const skills = creator.skills.slice(0, MAX_SKILLS);
  const extraSkills = creator.skills.length - skills.length;

  return (
    <BezelCard coreClassName="overflow-hidden p-0">
      <article aria-label={creator.displayName}>
        <Link
          href={`/creadores/perfil/${creator.profileId}`}
          aria-label={creator.displayName}
          className={MEDIA_LINK}
        >
          {creator.portfolioUrl ? (
            <CardMedia
              src={creator.portfolioUrl}
              fallbackSrc={creator.portfolioUrl}
              aspect="portrait"
              overlayTopRight={availabilityChip}
              overlayBottom={band}
            />
          ) : (
            <div
              className="relative flex aspect-[4/5] w-full items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in oklab, var(--accent-creadores) 78%, black), var(--accent-creadores))",
              }}
            >
              <Camera size={56} weight="fill" aria-hidden="true" className="text-on-media/85" />
              <div className="absolute right-2.5 top-2.5">{availabilityChip}</div>
              <MediaScrimBottom>{band}</MediaScrimBottom>
            </div>
          )}
        </Link>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RatingStars avg={creator.ratingAvg} count={creator.ratingCount} />
            {creator.completedJobs > 0 && (
              <span className="inline-flex items-center gap-1 text-sm text-foreground-secondary">
                <CheckCircle size={15} weight="fill" aria-hidden="true" className="text-success" />
                {COPY.directory.completedJobs(creator.completedJobs)}
              </span>
            )}
          </div>

          {skills.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {skills.map((skill) => (
                <li
                  key={skill}
                  className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-secondary"
                >
                  {skill}
                </li>
              ))}
              {extraSkills > 0 && (
                <li className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-muted">
                  +{extraSkills}
                </li>
              )}
            </ul>
          )}

          <div className="mt-1 flex items-center gap-2">
            {!creator.isSelf && (
              <FollowButton
                targetKind="profile"
                targetId={creator.profileId}
                initialFollowing={creator.initialFollowing}
                size="sm"
              />
            )}
            <AccentLink
              accent={ACCENT}
              href={`/creadores/perfil/${creator.profileId}`}
              className="mt-0 w-auto flex-1"
            >
              {COPY.directory.viewProfile}
            </AccentLink>
          </div>
        </div>
      </article>
    </BezelCard>
  );
}
