import Link from "next/link";
import { ArrowRight, MapPin, ShieldCheck, UserGear } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, BezelCard, Chip, buttonVariants } from "@/components/ui";
import {
  PublisherTrust,
  firstNameOf,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import { cn } from "@/lib/utils";
import { ACCENT_CHIP_CLASS } from "./accent";
import { COPY } from "./copy";
import { categoryLabel } from "./helpers";
import { DirectoryMedia } from "./module-media";

export interface ProfessionalCardModel {
  id: string;
  title: string;
  category: string | null;
  /** attrs.credentials ya normalizadas (parseProfessionalAttrs) — línea compacta debajo del rubro. */
  credentials: string[];
  areaLabel: string | null;
  /** Primera foto de portfolio/local ya resuelta, o null — DirectoryMedia cae al fallback del módulo. */
  photoUrl: string | null;
  /** SOLO presente si hay verification_check found_active vinculado (regla estricta). */
  verification: VerificationView | null;
  publisher: PublisherView;
}

/**
 * Card del directorio de profesionales (§ feedback cliente 2026-07-19: misma
 * estética que Propiedades — foto grande, contenido debajo). El avatar del
 * profesional (si es miembro) se superpone al borde inferior de la foto,
 * como una portada de perfil. Acento --accent-profesionales (teal), solo
 * decorativo. Banda de confianza por presencia (nunca un negativo).
 */
export function ProfessionalCard({ professional }: { professional: ProfessionalCardModel }) {
  const isMember = professional.publisher?.type === "member";
  const avatarSrc = professional.publisher?.type === "member" ? professional.publisher.avatarUrl : null;
  const avatarName =
    professional.publisher?.type === "member" ? professional.publisher.displayName : professional.title;

  return (
    <BezelCard
      variant={professional.verification ? "success" : "default"}
      coreClassName="p-0"
    >
      <article aria-label={professional.title}>
        <div className="relative">
          <DirectoryMedia
            src={professional.photoUrl}
            accent="profesionales"
            icon={UserGear}
            className="overflow-hidden rounded-t-[calc(var(--radius-xl)-6px)]"
          />
          {isMember && (
            <Avatar
              src={avatarSrc}
              name={avatarName}
              size="lg"
              className="absolute -bottom-7 left-4 ring-4 ring-surface"
            />
          )}
        </div>

        <div className={cn("flex flex-col gap-2.5 p-4", isMember ? "pt-9" : "pt-4")}>
          {professional.verification && (
            <Badge variant="success" className="self-start">
              <ShieldCheck size={13} weight="fill" aria-hidden="true" />
              {COPY.professionals.verifiedChip(professional.verification.dateLabel)}
            </Badge>
          )}

          <h3 className="font-display text-lg font-bold leading-snug text-foreground">
            {professional.title}
          </h3>

          <div className="flex flex-wrap items-center gap-2">
            <Chip className={ACCENT_CHIP_CLASS.profesionales}>{categoryLabel(professional.category)}</Chip>
            {professional.areaLabel && (
              <span className="flex items-center gap-1 text-sm text-foreground-secondary">
                <MapPin size={14} aria-hidden="true" className="shrink-0" />
                {professional.areaLabel}
              </span>
            )}
          </div>

          {professional.credentials.length > 0 && (
            <p className="line-clamp-1 text-sm text-foreground-secondary">
              {professional.credentials.join(" · ")}
            </p>
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
            className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1 w-full")}
          >
            {COPY.professionals.viewProfile}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </article>
    </BezelCard>
  );
}
