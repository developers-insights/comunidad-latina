import { MapPin, SealCheck, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { Avatar } from "@/components/ui";
import type { ApplicantProfilePreview } from "@/app/(app)/empleos/queries";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

const C = COPY.apply.profile;

export interface ApplicantProfileCardProps {
  profile: ApplicantProfilePreview;
  className?: string;
}

/**
 * Lo que quien contrata va a ver del perfil, mostrado TAL CUAL antes de enviar.
 *
 * No es decoración: es el consentimiento hecho visible. "Compartir mi perfil"
 * es una casilla que no significa nada si la persona no puede ver qué está
 * compartiendo — así que se muestra el bloque real, con los mismos datos y en
 * el mismo orden en que le van a aparecer al otro lado.
 */
export function ApplicantProfileCard({ profile, className }: ApplicantProfileCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-3",
        className,
      )}
    >
      <Avatar src={profile.avatarUrl} name={profile.displayName} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-semibold text-foreground">
          {profile.displayName}
          {profile.identityVerified && (
            <SealCheck
              size={16}
              weight="fill"
              className="shrink-0 text-brand"
              aria-label={C.verified}
            />
          )}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-foreground-muted">
          <span className="flex items-center gap-1">
            <MapPin size={13} aria-hidden="true" />
            {profile.areaLabel ?? C.noCity}
          </span>
          {profile.trust && (
            <span className="flex items-center gap-1">
              <ShieldCheck size={13} aria-hidden="true" />
              {C.trustLabel}: <span className="numeric font-semibold">{profile.trust.score}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
