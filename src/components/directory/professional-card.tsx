import Link from "next/link";
import { ArrowRight, MapPin, ShieldCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, BezelCard, Chip, buttonVariants } from "@/components/ui";
import {
  PublisherTrust,
  firstNameOf,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { categoryLabel } from "./helpers";

export interface ProfessionalCardModel {
  id: string;
  title: string;
  category: string | null;
  areaLabel: string | null;
  /** SOLO presente si hay verification_check found_active vinculado (regla estricta). */
  verification: VerificationView | null;
  publisher: PublisherView;
}

/**
 * Card del directorio de profesionales (§4.b): identidad + rubro + zona +
 * Trust Score del dueño + banda de verificación por presencia (nunca un
 * negativo) + 1 solo CTA. Sin foto hero: acá manda la persona, no el lugar.
 */
export function ProfessionalCard({ professional }: { professional: ProfessionalCardModel }) {
  const isMember = professional.publisher?.type === "member";

  return (
    <BezelCard
      variant={professional.verification ? "success" : "default"}
      coreClassName="flex flex-col gap-3 p-4"
    >
      <article aria-label={professional.title} className="contents">
        <div className="flex items-start gap-3">
          {isMember && professional.publisher?.type === "member" ? (
            <Avatar
              src={professional.publisher.avatarUrl}
              name={professional.publisher.displayName}
              size="lg"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-muted"
            >
              <Storefront size={24} />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-bold leading-snug text-foreground">
              {professional.title}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Chip>{categoryLabel(professional.category)}</Chip>
              {professional.areaLabel && (
                <span className="flex items-center gap-1 text-sm text-foreground-secondary">
                  <MapPin size={14} aria-hidden="true" className="shrink-0" />
                  {professional.areaLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {professional.verification && (
          <Badge variant="success" className="self-start">
            <ShieldCheck size={13} weight="fill" aria-hidden="true" />
            {COPY.professionals.verifiedChip(professional.verification.dateLabel)}
          </Badge>
        )}

        {professional.publisher?.type === "member" ? (
          <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
            <span className="truncate">{professional.publisher.displayName}</span>
            <PublisherTrust
              displayName={professional.publisher.displayName}
              firstName={firstNameOf(professional.publisher.displayName)}
              score={professional.publisher.score}
              level={professional.publisher.level}
              signals={professional.publisher.signals}
              size="inline"
            />
          </div>
        ) : professional.publisher?.type === "external" ? (
          <p className="text-sm text-foreground-muted">
            {COPY.professionals.externalPublisher(professional.publisher.name)}
          </p>
        ) : null}

        <Link
          href={`/profesionales/${professional.id}`}
          className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full")}
        >
          {COPY.professionals.viewProfile}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </article>
    </BezelCard>
  );
}
