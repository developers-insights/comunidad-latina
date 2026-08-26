import { House, MapPin } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, Avatar, BezelCard, Chip, Skeleton } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { IdentityBadge } from "@/components/auth/identity-badge";
import type { TrustLevel, TrustSignal } from "@/components/trust";
import { ADVERTISER_ROLE_LABEL, type AdvertiserRole } from "@/lib/propiedades/anunciante";

/** Vivienda → mismo acento azul del módulo que ya usa ListingCard. */
const ACCENT = "var(--accent-vivienda)";

const COPY = {
  activeCount: (n: number) => (n === 1 ? "1 propiedad activa" : `${n} propiedades activas`),
  viewProfile: "Ver perfil",
} as const;

export interface AdvertiserCardModel {
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  /** `profiles.identity_verified` — Stripe Identity, gratis. Mismo hecho que dibuja `IdentityBadge` en el resto de la app. */
  identityVerified: boolean;
  /** Rol declarado en SU aviso más reciente. `null` = no lo declaró — nunca se inventa una etiqueta. */
  role: AdvertiserRole | null;
  /** Zona de su aviso más reciente. */
  areaLabel: string | null;
  /** Avisos de vivienda `published` que tiene hoy (dentro de la ventana consultada — ver advertiser-directory.tsx). */
  activeListingCount: number;
  /** Trust Score a nivel PERFIL (trust_scores) — la "calificación" de este directorio, no una reseña de un aviso puntual. */
  trust: {
    score: number;
    level: TrustLevel;
    signals: TrustSignal[];
  };
}

/**
 * Card del directorio "Agentes y propietarios" (pestaña nueva de /propiedades,
 * requisito del cliente). A diferencia de `ListingCard`/`ProfessionalCard`/
 * `BusinessCard` — que muestran un AVISO — ésta muestra a una PERSONA: no hay
 * foto de portada que mostrar (un propietario no "es" una foto de producto),
 * así que el avatar es el protagonista, apoyado sobre una banda con el acento
 * del módulo en vez de una foto de portada inexistente.
 *
 * Mismo acento (`--accent-vivienda`) y mismo criterio Double-Bezel que
 * `ListingCard` — el shell tinta `success` cuando hay identidad verificada —
 * para que las dos pestañas de Propiedades se sientan la misma sección.
 */
export function AdvertiserCard({ advertiser }: { advertiser: AdvertiserCardModel }) {
  const roleLabel = advertiser.role ? ADVERTISER_ROLE_LABEL[advertiser.role] : null;

  return (
    <BezelCard
      variant={advertiser.identityVerified ? "success" : "default"}
      coreClassName="overflow-hidden p-0"
    >
      <article aria-label={advertiser.displayName} className="flex flex-col">
        {/* Banda con el acento del módulo — nunca hay foto de portada acá: esto
            es una persona, no un aviso. El avatar flota sobre su borde. */}
        <div
          aria-hidden="true"
          className="h-14 shrink-0 bg-gradient-to-br from-[var(--accent-vivienda)]/24 via-surface-subtle to-surface-subtle"
        />

        <div className="px-4">
          <Avatar
            src={advertiser.avatarUrl}
            name={advertiser.displayName}
            size="xl"
            className="-mt-8 ring-4 ring-surface shadow-md"
            badge={advertiser.identityVerified ? <IdentityBadge /> : undefined}
          />
        </div>

        <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3">
          {roleLabel && (
            <Chip className="self-start border-[var(--accent-vivienda)]/30 bg-[var(--accent-vivienda)]/10 text-foreground">
              {roleLabel}
            </Chip>
          )}

          <h3 className="truncate font-display text-lg font-bold leading-snug text-foreground">
            {advertiser.displayName}
          </h3>

          {advertiser.areaLabel && (
            <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <MapPin size={15} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{advertiser.areaLabel}</span>
            </p>
          )}

          <PublisherTrust
            displayName={advertiser.displayName}
            firstName={firstNameOf(advertiser.displayName)}
            score={advertiser.trust.score}
            level={advertiser.trust.level}
            signals={advertiser.trust.signals}
            profileId={advertiser.profileId}
            size="inline"
          />

          <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
            <House size={15} aria-hidden="true" className="shrink-0" />
            {COPY.activeCount(advertiser.activeListingCount)}
          </p>

          <AccentLink
            accent={ACCENT}
            href={`/perfil/${advertiser.profileId}`}
            ariaLabel={advertiser.displayName}
          >
            {COPY.viewProfile}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}

/** Silueta de <AdvertiserCard> — shimmer, nunca spinner (§5.2). */
export function AdvertiserCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
        <Skeleton className="h-14 w-full rounded-none" />
        <div className="px-4">
          <Skeleton className="-mt-8 size-20 rounded-full ring-4 ring-surface" />
        </div>
        <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function AdvertiserListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      role="status"
      aria-label="Cargando agentes y propietarios"
    >
      {Array.from({ length: count }, (_, index) => (
        <AdvertiserCardSkeleton key={index} />
      ))}
      <span className="sr-only">Cargando agentes y propietarios…</span>
    </div>
  );
}
