import { Certificate, MapPin, Translate, UserGear } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, Avatar, Badge, BezelCard } from "@/components/ui";
import {
  PublisherTrust,
  firstNameOf,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import { IdentityBadge } from "@/components/auth/identity-badge";
import { PhotoTap } from "@/components/media/photo-tap";
import { Estrellas } from "@/components/resenas";
import { RESENAS_COPY, formatearPromedio, type ResumenPuntaje } from "@/lib/resenas";
import { languageLabels } from "@/lib/profile/catalogs";
import { COPY } from "./copy";
import { categoryLabel } from "./helpers";
import { DirectoryMedia } from "./module-media";
import { ProfessionalContactCta } from "./professional-contact-cta";

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
  /** SOLO presente si hay verification_check found_active vinculado (regla estricta): credenciales/matrícula. */
  verification: VerificationView | null;
  /**
   * `profiles.identity_verified` del publicador — SIEMPRE presente cuando hay
   * cuenta, aunque no aplique la verificación de credenciales de arriba.
   *
   * Es su PROPIO campo y no una señal más adentro de `publisher.signals` a
   * propósito (spec cliente: "estado de verificación de identidad" y "estado de
   * verificación de credenciales" son DOS cosas y tienen que leerse distintas de
   * un vistazo). Ligarla al desglose del Trust Score la habría dejado a un tap
   * de distancia, enterrada junto a señales que no son verificación de nada
   * (antigüedad, transacciones, avales).
   */
  identityVerified: boolean;
  /** Códigos de idioma (profiles_private.languages vía profile_card, 0062/0063) del publicador con cuenta. Vacío si no hay o es fuente externa. */
  languages: string[];
  /** Resumen de calificaciones del aviso (listing_review_stats, 0093). cantidad=0 ⇒ "Sin reseñas todavía", nunca un cero. */
  rating: ResumenPuntaje;
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
 * con el portfolio; la píldora "Ver perfil" es la única que navega. "Contactar"
 * (spec cliente) es la tercera acción: ni navega ni abre el visor — abre el
 * mensaje ahí mismo (ver professional-contact-cta.tsx).
 */
export function ProfessionalCard({
  professional,
  isLoggedIn,
}: {
  professional: ProfessionalCardModel;
  /**
   * Misma sesión para las 12+ cards de la página — se resuelve UNA vez arriba
   * (page.tsx) y se pasa, en vez de que cada card pregunte por su cuenta.
   */
  isLoggedIn: boolean;
}) {
  const isMember = professional.publisher?.type === "member";
  const isExternal = professional.publisher?.type === "external";
  const avatarSrc = professional.publisher?.type === "member" ? professional.publisher.avatarUrl : null;
  const avatarName =
    professional.publisher?.type === "member" ? professional.publisher.displayName : professional.title;
  const photos = professional.photos?.length
    ? professional.photos
    : professional.photoUrl
      ? [professional.photoUrl]
      : [];
  const spokenLanguages = languageLabels(professional.languages);
  const ratingPromedio = formatearPromedio(professional.rating.promedio);

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
                <Avatar
                  src={avatarSrc}
                  name={avatarName}
                  size="md"
                  className="ring-2 ring-surface shadow-md"
                  // Identidad verificada (Stripe Identity, gratis) — insignia
                  // PROPIA sobre el avatar, mismo lugar y mismo componente que
                  // ProfileHeader. Deliberadamente distinta de la credencial de
                  // abajo: círculo sobre la persona, no una píldora con texto.
                  badge={professional.identityVerified ? <IdentityBadge /> : undefined}
                />
              ) : undefined
            }
            overlayTopRight={
              professional.verification ? (
                <Badge variant="success">
                  {/* Certificate y no ShieldCheck (el de IdentityBadge, arriba a
                      la izquierda): dos insignias de verificación en la MISMA
                      card tienen que distinguirse por FORMA, no sólo por texto
                      — mismo criterio que separa el escudo de IdentityBadge del
                      sello de CheckAzul en verificacion/check-azul.tsx. Este es
                      el ícono que ya usa el detalle para "Credenciales". */}
                  <Certificate size={13} weight="fill" aria-hidden="true" />
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
          {/* Idiomas (spec cliente: campo propio de cada perfil, no un detalle
              secundario) — mismo ícono que la pestaña "Información" del perfil
              (ProfileInfoPanel), así "Habla español" se lee igual en toda la app. */}
          {spokenLanguages.length > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <Translate size={15} aria-hidden="true" className="shrink-0 text-foreground-muted" />
              <span className="line-clamp-1">{spokenLanguages.join(" · ")}</span>
            </p>
          )}

          {professional.credentials.length > 0 && (
            <p className="line-clamp-1 text-sm text-foreground-secondary">
              {professional.credentials.join(" · ")}
            </p>
          )}

          {/* Calificaciones (spec cliente). "Sin reseñas todavía" y NO un cero:
              un profesional nuevo no vale menos que uno con mala calificación,
              y estrellas vacías + "0,0" leerían justo eso (mismo criterio que
              ResumenPuntajeCard). */}
          {professional.rating.cantidad > 0 ? (
            <div className="flex items-center gap-1.5">
              <Estrellas
                valor={professional.rating.promedio}
                size={14}
                etiqueta={RESENAS_COPY.promedioAria(ratingPromedio ?? "", professional.rating.cantidad)}
              />
              <span className="numeric text-sm text-foreground-secondary">
                {ratingPromedio} ({professional.rating.cantidad})
              </span>
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">{RESENAS_COPY.sinPuntaje}</p>
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
                profileId={professional.publisher.profileId}
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

          {/* "Contactar" (spec cliente): la SEGUNDA acción de la card, además de
              "Ver perfil". Nunca navega — abre el mensaje acá mismo. */}
          <ProfessionalContactCta
            listingId={professional.id}
            title={professional.title}
            isLoggedIn={isLoggedIn}
            isExternal={isExternal}
            externalName={
              professional.publisher?.type === "external" ? professional.publisher.name : null
            }
          />
        </div>
      </article>
    </BezelCard>
  );
}
