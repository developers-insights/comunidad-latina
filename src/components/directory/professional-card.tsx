import { MapPin, ShieldCheck, UserGear } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, Avatar, Badge, BezelCard } from "@/components/ui";
import {
  PublisherTrust,
  firstNameOf,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import { PhotoTap } from "@/components/media/photo-tap";
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
  /**
   * TODO el portfolio ya resuelto (allPhotoUrls) — el visor lo pasa de una.
   * Opcional: quien todavía no lo manda cae a `photoUrl`.
   */
  photos?: string[];
  /** SOLO presente si hay verification_check found_active vinculado (regla estricta). */
  verification: VerificationView | null;
  publisher: PublisherView;
}

/** Acento teal del módulo (solo decorativo) para la píldora de acción. */
const ACCENT = "var(--accent-profesionales)";

/**
 * Card del directorio de profesionales (§ feedback cliente 2026-07-24: se siente
 * RED SOCIAL). Foto vertical 4:5; el avatar del profesional (si es miembro) se
 * apoya sobre la portada como una foto de perfil y el nombre/rubro/zona viven en
 * una franja de VIDRIO encima de la foto. Debajo, credenciales, confianza y una
 * píldora con el acento teal del módulo.
 *
 * DOS destinos, uno por gesto (feedback 2026-07-26): tocar la FOTO abre el visor
 * con el portfolio; la píldora "Ver perfil" es la única que navega.
 */
export function ProfessionalCard({ professional }: { professional: ProfessionalCardModel }) {
  const isMember = professional.publisher?.type === "member";
  const avatarSrc = professional.publisher?.type === "member" ? professional.publisher.avatarUrl : null;
  const avatarName =
    professional.publisher?.type === "member" ? professional.publisher.displayName : professional.title;
  const photos = professional.photos?.length
    ? professional.photos
    : professional.photoUrl
      ? [professional.photoUrl]
      : [];

  return (
    <BezelCard variant={professional.verification ? "success" : "default"} coreClassName="overflow-hidden p-0">
      <article aria-label={professional.title}>
        <PhotoTap
          photos={photos}
          label={COPY.openPhotos(professional.title)}
          authorName={professional.title}
        >
          <DirectoryMedia
            src={professional.photoUrl}
            accent="profesionales"
            icon={UserGear}
            aspect="portrait"
            overlayTopLeft={
              isMember ? (
                <Avatar src={avatarSrc} name={avatarName} size="md" className="ring-2 ring-surface shadow-md" />
              ) : undefined
            }
            overlayTopRight={
              professional.verification ? (
                <Badge variant="success">
                  <ShieldCheck size={13} weight="fill" aria-hidden="true" />
                  {COPY.professionals.verifiedChip(professional.verification.dateLabel)}
                </Badge>
              ) : undefined
            }
            overlayBottom={
              <div>
                <h3 className="font-display text-base font-bold leading-snug line-clamp-2">
                  {professional.title}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-on-media/15 px-2 py-0.5 text-xs font-semibold">
                    {categoryLabel(professional.category)}
                  </span>
                  {professional.areaLabel && (
                    <span className="flex items-center gap-1 opacity-90">
                      <MapPin size={14} aria-hidden="true" className="shrink-0" />
                      <span className="min-w-0 truncate">{professional.areaLabel}</span>
                    </span>
                  )}
                </div>
              </div>
            }
          />
        </PhotoTap>

        <div className="flex flex-col gap-2.5 p-4">
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

          <AccentLink
            accent={ACCENT}
            href={`/profesionales/${professional.id}`}
            ariaLabel={professional.title}
          >
            {COPY.professionals.viewProfile}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}
