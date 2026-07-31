import Link from "next/link";
import {
  CalendarBlank,
  Camera,
  ChatCircleDots,
  Globe,
  MapPin,
  SealCheck,
  Star,
  UsersThree,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, EmptyState } from "@/components/ui";
import type { PersonRow, ReviewRow } from "./profile-data";

/**
 * Los paneles de las pestañas del perfil que NO son la grilla de publicaciones
 * (ésa ya existía: <ProfilePostsGrid>).
 *
 * ── LA REGLA QUE MANDA ACÁ: NINGÚN CONTENIDO INVENTADO ───────────────────────
 * Varias de estas pestañas están legítimamente vacías hoy (el Creator
 * Marketplace, de donde salen las reseñas, abre en 3-4 meses según el propio
 * cliente). Un placeholder con reseñas de mentira o seguidores de mentira haría
 * ver bien la demo y sería una mentira sobre el estado del producto. Cada vacío
 * dice qué falta y por qué, que es lo único útil para quien lo mira.
 */

const COPY = {
  photosEmptyTitle: "Todavía no hay fotos",
  photosEmptyOwn: "Cuando publiques una foto, va a aparecer acá.",
  photosEmptyOther: "Cuando publique una foto, va a aparecer acá.",
  videosEmptyTitle: "Todavía no hay videos",
  videosEmptyOwn: "Tus videos de hasta 90 segundos se van a juntar en esta pestaña.",
  videosEmptyOther: "Cuando publique un video, lo vas a encontrar acá.",

  infoHeading: "Información",
  infoFrom: "De",
  infoLives: "Vive en",
  infoMemberSince: "Miembro desde",
  infoVerified: "Identidad verificada",
  infoVerifiedYes: "Sí, verificada",
  infoBioEmpty: "Todavía no escribió una presentación.",
  infoBioEmptyOwn: "Contale a la comunidad quién sos: se edita desde «Editar perfil».",

  reviewsEmptyTitle: "Todavía no hay reseñas",
  reviewsEmptyBody:
    "Las reseñas llegan cuando se completa un trabajo en Colaboraciones. Todavía no hay ninguno cerrado.",
  reviewsRating: (n: number) => `${n} de 5`,

  followersEmptyTitle: "Todavía no tiene seguidores",
  followersEmptyOwn:
    "Cuando alguien te siga, va a aparecer acá. Publicar seguido es la forma más rápida de que te encuentren.",
  followersEmptyOther: "Cuando alguien la siga, va a aparecer acá.",
  followingEmptyTitle: "Todavía no sigue a nadie",
  followingEmptyOwn: "Seguí a personas y negocios para que sus novedades te lleguen al inicio.",
  followingEmptyOther: "Cuando siga a alguien, va a aparecer acá.",
  followingOnlyPeople:
    "Acá se ven sólo personas. El contador de arriba incluye además los negocios, eventos y tiendas que sigue.",
} as const;

/* ────────────────────────────── Información ────────────────────────────── */

export interface ProfileInfoPanelProps {
  bio: string | null;
  /** País de origen ya traducido a nombre, no el código. */
  country: string | null;
  /** Zona/ciudad declarada. NUNCA la dirección exacta (§9). */
  areaLabel: string | null;
  /** "marzo de 2026" — mes y año, nunca el día. */
  memberSince: string | null;
  identityVerified: boolean;
  isOwn: boolean;
}

/**
 * Pestaña "Información".
 *
 * ── LO QUE NO ESTÁ, NO ESTÁ POR DISEÑO ───────────────────────────────────────
 * No hay dirección, ni teléfono, ni correo, ni documento, ni fecha de
 * nacimiento. No es que no existan en la base: el teléfono y la fecha de
 * nacimiento viven en `profiles_phone` (0030) con RLS SOLO-DUEÑO y ni siquiera
 * son consultables desde acá, y el resto nunca se guardó. Esta pestaña muestra
 * exclusivamente columnas de `public.profiles`, que es la tabla pensada para
 * ser pública. Si algún día alguien quiere sumar un dato acá, tiene que pasar
 * por esa puerta primero.
 */
export function ProfileInfoPanel({
  bio,
  country,
  areaLabel,
  memberSince,
  identityVerified,
  isOwn,
}: ProfileInfoPanelProps) {
  const rows = [
    country && { icon: <Globe size={18} />, label: COPY.infoFrom, value: country },
    areaLabel && { icon: <MapPin size={18} />, label: COPY.infoLives, value: areaLabel },
    memberSince && {
      icon: <CalendarBlank size={18} />,
      label: COPY.infoMemberSince,
      value: memberSince,
    },
    identityVerified && {
      icon: <SealCheck size={18} />,
      label: COPY.infoVerified,
      value: COPY.infoVerifiedYes,
    },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string }[];

  return (
    <BezelCard coreClassName="flex flex-col gap-5 p-5">
      <h2 className="sr-only">{COPY.infoHeading}</h2>

      <p className="text-sm leading-relaxed text-foreground-secondary">
        {bio || (isOwn ? COPY.infoBioEmptyOwn : COPY.infoBioEmpty)}
      </p>

      {rows.length > 0 && (
        <dl className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted">
                {row.icon}
              </span>
              <div className="min-w-0">
                <dt className="text-xs text-foreground-muted">{row.label}</dt>
                <dd className="text-sm font-medium text-foreground">{row.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </BezelCard>
  );
}

/* ──────────────────────────────── Reseñas ──────────────────────────────── */

/** Estrellas del rating. El número también va en texto: el color nunca es el único canal. */
function RatingStars({ rating }: { rating: number }) {
  const rounded = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden="true" className="flex text-gold">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} size={14} weight={i < rounded ? "fill" : "regular"} />
        ))}
      </span>
      <span className="numeric text-xs text-foreground-muted">{COPY.reviewsRating(rating)}</span>
    </span>
  );
}

export function ProfileReviewsPanel({ reviews }: { reviews: ReviewRow[] }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={<ChatCircleDots />}
        title={COPY.reviewsEmptyTitle}
        message={COPY.reviewsEmptyBody}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {reviews.map((review) => (
        <li key={review.id}>
          <BezelCard coreClassName="flex gap-3 p-4">
            <Avatar size="sm" src={review.reviewerAvatarUrl} name={review.reviewerName} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{review.reviewerName}</p>
              <RatingStars rating={review.rating} />
              {review.body && (
                <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                  {review.body}
                </p>
              )}
            </div>
          </BezelCard>
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────── Seguidores · Siguiendo (personas) ────────────────────── */

export interface ProfilePeoplePanelProps {
  people: PersonRow[];
  direction: "followers" | "following";
  isOwn: boolean;
}

export function ProfilePeoplePanel({ people, direction, isOwn }: ProfilePeoplePanelProps) {
  if (people.length === 0) {
    const followers = direction === "followers";
    return (
      <EmptyState
        icon={<UsersThree />}
        title={followers ? COPY.followersEmptyTitle : COPY.followingEmptyTitle}
        message={
          followers
            ? isOwn
              ? COPY.followersEmptyOwn
              : COPY.followersEmptyOther
            : isOwn
              ? COPY.followingEmptyOwn
              : COPY.followingEmptyOther
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {people.map((person) => (
          <li key={person.id}>
            <Link
              href={`/perfil/${person.id}`}
              className="flex items-center gap-3 rounded-lg p-2 transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              <Avatar size="md" src={person.avatarUrl} name={person.displayName} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">
                  {person.displayName}
                  {person.identityVerified && (
                    <SealCheck size={14} weight="fill" aria-hidden="true" className="shrink-0 text-info" />
                  )}
                </span>
                {person.areaLabel && (
                  <span className="block truncate text-xs text-foreground-muted">
                    {person.areaLabel}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* La honestidad del contador: ver el comentario de fetchFollowPeople. */}
      {direction === "following" && (
        <p className="px-2 text-xs text-foreground-muted">{COPY.followingOnlyPeople}</p>
      )}
    </div>
  );
}

/* ─────────────────────────── Fotos · Videos (vacíos) ─────────────────────────── */

export function ProfileMediaEmpty({
  kind,
  isOwn,
}: {
  kind: "image" | "video";
  isOwn: boolean;
}) {
  const photos = kind === "image";
  return (
    <EmptyState
      icon={photos ? <Camera /> : <VideoCamera />}
      title={photos ? COPY.photosEmptyTitle : COPY.videosEmptyTitle}
      message={
        photos
          ? isOwn
            ? COPY.photosEmptyOwn
            : COPY.photosEmptyOther
          : isOwn
            ? COPY.videosEmptyOwn
            : COPY.videosEmptyOther
      }
    />
  );
}
