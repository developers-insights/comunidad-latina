import Link from "next/link";
import { ArrowRight, Camera, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, CardMedia, buttonVariants } from "@/components/ui";
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
}

const MAX_SKILLS = 4;

/**
 * Card de creador para el directorio "Buscar creadores". Hero de portfolio (o
 * fallback violeta), disponibilidad, avatar + verificación, titular, estrellas,
 * trabajos completados, habilidades y botón Seguir. Estética de feed alegre.
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

  const skills = creator.skills.slice(0, MAX_SKILLS);
  const extraSkills = creator.skills.length - skills.length;

  return (
    <BezelCard coreClassName="overflow-hidden p-0">
      <article aria-label={creator.displayName}>
        {creator.portfolioUrl ? (
          <CardMedia
            src={creator.portfolioUrl}
            fallbackSrc={creator.portfolioUrl}
            aspect="video"
            overlayTopRight={availabilityChip}
          />
        ) : (
          <div
            className="relative flex aspect-video w-full items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in oklab, var(--accent-creadores) 78%, black), var(--accent-creadores))",
            }}
          >
            <Camera size={56} weight="fill" aria-hidden="true" className="text-on-media/85" />
            <div className="absolute right-2.5 top-2.5">{availabilityChip}</div>
          </div>
        )}

        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <Avatar
              size="md"
              src={creator.avatarUrl}
              name={creator.displayName}
              badge={creator.identityVerified ? <IdentityBadge /> : undefined}
            />
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold text-foreground">
                {creator.displayName}
              </p>
              <p className="truncate text-sm text-foreground-secondary">{creator.headline}</p>
            </div>
          </div>

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
            <FollowButton
              targetKind="profile"
              targetId={creator.profileId}
              initialFollowing={creator.initialFollowing}
              size="sm"
            />
            <Link
              href={`/creadores/perfil/${creator.profileId}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "flex-1")}
            >
              {COPY.directory.viewProfile}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </article>
    </BezelCard>
  );
}
