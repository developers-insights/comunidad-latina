import Link from "next/link";
import {
  Cake,
  CalendarBlank,
  Camera,
  ChatCircleDots,
  Globe,
  Lock,
  MapPin,
  ShieldCheck,
  Star,
  Translate,
  UsersThree,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, EmptyState } from "@/components/ui";
import { languageLabels, residenceCountryLabel } from "@/lib/profile/catalogs";
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
  infoZone: "Su zona",
  infoAge: "Edad",
  infoAgeValue: (years: number) => `${years} años`,
  infoLanguages: "Habla",
  infoMemberSince: "Miembro desde",
  infoVerified: "Identidad verificada",
  infoVerifiedYes: "Sí, con documento",
  /** Nombre accesible del escudito que va al lado de un nombre en las listas. */
  personIdentityVerified: "Identidad verificada con documento",
  infoBioEmpty: "Todavía no escribió una presentación.",
  infoBioEmptyOwn: "Contale a la comunidad quién sos: se edita desde «Editar perfil».",

  /* Pestañas cerradas por privacidad. */
  postsClosedTitle: "Sus publicaciones son privadas",
  postsClosedBody:
    "Eligió que sus publicaciones no se listen en su perfil. Si te sigue o lo seguís, puede cambiar.",
  followersClosedTitle: "Su lista es privada",
  followersClosedBody:
    "Eligió no mostrar a quién sigue ni quién lo sigue. Los contadores de arriba sí son públicos.",

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
  /**
   * Apellido — llega sólo si la privacidad lo permite, y esta pestaña NO lo
   * dibuja a propósito: ya está en el `h1` de la cabecera, junto al nombre.
   * Repetirlo acá sería la misma persona dos veces en la misma pantalla.
   * Está en el tipo para que se vea que la pantalla lo recibe y decide.
   */
  lastName?: string | null;
  /** Edad EN AÑOS. La fecha exacta no sale de la base ni para esta pantalla. */
  age?: number | null;
  countryResidence?: string | null;
  city?: string | null;
  languages?: readonly string[];
}

/**
 * Pestaña "Información".
 *
 * ── TODO LO QUE LLEGA ACÁ YA PASÓ POR LA MATRIZ DE PRIVACIDAD ────────────────
 * Antes esta pestaña mostraba exclusivamente columnas de `public.profiles` y la
 * regla era "si querés sumar un dato, pasá por esa puerta primero". Ahora la
 * puerta es `public.profile_card()` (0063), que es mejor: los campos privados
 * (apellido, edad, ciudad, idiomas) llegan en `null` cuando la configuración de
 * la persona no los permite, decidido ADENTRO de la base. Este componente no
 * decide nada sobre privacidad — sólo omite las filas vacías.
 *
 * ── LO QUE NO ESTÁ, NO ESTÁ POR DISEÑO ───────────────────────────────────────
 * No hay dirección, ni teléfono, ni correo, ni documento, ni la fecha de
 * nacimiento COMPLETA. La edad sí, en años: un cumpleaños exacto + nombre +
 * ciudad es el kit de suplantación de identidad, y la edad sola no lo es. La
 * fecha entera sólo la ve su dueño, y eso lo garantiza `profile_card`, no esta
 * pantalla.
 */
export function ProfileInfoPanel({
  bio,
  country,
  areaLabel,
  memberSince,
  identityVerified,
  isOwn,
  age,
  countryResidence,
  city,
  languages,
}: ProfileInfoPanelProps) {
  // "Vive en" combina ciudad y país de residencia: son un solo bloque de
  // privacidad (`show_location`), así que o llegan los dos o no llega ninguno.
  const livesIn = [city, residenceCountryLabel(countryResidence)]
    .filter(Boolean)
    .join(", ");
  const spoken = languageLabels(languages);

  const rows = [
    country && { icon: <Globe size={18} />, label: COPY.infoFrom, value: country },
    livesIn && { icon: <MapPin size={18} />, label: COPY.infoLives, value: livesIn },
    // La zona declarada es OTRA cosa que la ciudad de residencia: es el barrio
    // que la persona eligió mostrar (§5.4), y no lo cubre `show_location`.
    areaLabel && { icon: <MapPin size={18} />, label: COPY.infoZone, value: areaLabel },
    typeof age === "number" && {
      icon: <Cake size={18} />,
      label: COPY.infoAge,
      value: COPY.infoAgeValue(age),
    },
    spoken.length > 0 && {
      icon: <Translate size={18} />,
      label: COPY.infoLanguages,
      value: spoken.join(" · "),
    },
    memberSince && {
      icon: <CalendarBlank size={18} />,
      label: COPY.infoMemberSince,
      value: memberSince,
    },
    identityVerified && {
      // Escudo y no sello: el sello con tilde es la insignia PAGA (el check
      // azul). Esta fila habla de la verificación de identidad, que es gratis
      // y es un hecho comprobado — le corresponde el escudo de `IdentityBadge`.
      icon: <ShieldCheck size={18} />,
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
                  {/*
                    ESCUDO VERDE, no sello azul.

                    Hasta este cambio esta lista dibujaba un `SealCheck` en
                    `text-info` para `identity_verified`: o sea, exactamente el
                    check azul pago (`CheckAzulInline`, mismo ícono, mismo
                    azul, 14px contra 16px) para una verificación GRATIS. En la
                    lista de seguidores las dos cosas eran la misma marca, y la
                    gratuita se hacía pasar por la comprada.

                    Y llevaba `aria-hidden`: quien navega con lector de
                    pantalla no se enteraba de nada. Ahora tiene nombre propio
                    y dice qué se verificó.
                  */}
                  {person.identityVerified && (
                    <ShieldCheck
                      size={14}
                      weight="fill"
                      role="img"
                      aria-label={COPY.personIdentityVerified}
                      className="shrink-0 text-success-ink"
                    />
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

/* ──────────────────────── Cerrado por privacidad ──────────────────────── */

/**
 * Lo que se ve cuando la persona eligió no mostrar ese bloque.
 *
 * ── SE DICE, NO SE ESCONDE ───────────────────────────────────────────────────
 * La tentación es hacer desaparecer la pestaña. No: quien mira ya vio el
 * contador arriba y esperaría encontrar la lista; una pestaña que se esfuma
 * parece un error de la app. Y esconder la decisión también la vuelve
 * sospechosa. Se cuenta como lo que es —una elección de esa persona— y se
 * explica cómo cambia (siguiéndola), que es la única acción que existe.
 *
 * Lo que NO se dice es cuánto hay del otro lado: "12 publicaciones privadas"
 * sería filtrar exactamente el dato que la persona cerró.
 */
export function ProfileClosedPanel({ kind }: { kind: "posts" | "followers" }) {
  const posts = kind === "posts";
  return (
    <EmptyState
      icon={<Lock />}
      title={posts ? COPY.postsClosedTitle : COPY.followersClosedTitle}
      message={posts ? COPY.postsClosedBody : COPY.followersClosedBody}
    />
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
