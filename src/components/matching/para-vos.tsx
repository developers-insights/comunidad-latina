import Image from "next/image";
import Link from "next/link";
import {
  BookOpen,
  Briefcase,
  CalendarDots,
  HouseLine,
  MapPin,
  SealCheck,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip, Skeleton, buttonVariants } from "@/components/ui";
import { formatListingPrice, isOptimizableSrc, listingPhotoUrl } from "@/components/listings";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getMatches, type MatchItem } from "@/lib/matching";
import { cn } from "@/lib/utils";

/**
 * Sección "Para vos" (módulo MATCHING) — server component autocontenido.
 *
 * Carrusel horizontal de matches determinísticos con la RAZÓN visible en
 * cada card (transparencia = confianza). Solo para usuarios logueados:
 *   - con needs → top 4 matches
 *   - sin needs → invitación cálida a completar el onboarding
 *   - falla técnica / sin matches → no renderiza nada (nunca rompe el feed)
 *
 * Corre con el cliente server del usuario: la lectura de profiles_private
 * es owner-only por RLS (jamás admin acá).
 */

const COPY = {
  titulo: "Para vos",
  verificado: "Verificación vigente",
  invitacionTitulo: "Contanos qué estás buscando",
  invitacionTexto:
    "Con dos o tres respuestas te mostramos vivienda, trabajo y guías que de verdad te sirven.",
  invitacionCta: "Completar mi perfil",
} as const;

const KIND_META: Record<string, { label: string; icon: React.ReactNode }> = {
  property: { label: "Vivienda", icon: <HouseLine aria-hidden="true" /> },
  job: { label: "Trabajo", icon: <Briefcase aria-hidden="true" /> },
  event: { label: "Evento", icon: <CalendarDots aria-hidden="true" /> },
  guide: { label: "Guía", icon: <BookOpen aria-hidden="true" /> },
};

export async function ParaVos({ userId }: { userId: string }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const result = await getMatches(supabase, userId, tenant);

  if (result.status === "unavailable" || result.status === "empty") return null;

  if (result.status === "no-needs") {
    return (
      <section aria-label={COPY.titulo}>
        <BezelCard variant="featured" coreClassName="flex flex-col gap-3 p-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
            >
              <Sparkle size={22} weight="light" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-foreground">
                {COPY.invitacionTitulo}
              </h2>
              <p className="mt-0.5 text-sm text-foreground-secondary">
                {COPY.invitacionTexto}
              </p>
            </div>
          </div>
          <Link
            href="/bienvenida"
            className={cn(buttonVariants({ variant: "primary", size: "sm" }), "self-start")}
          >
            {COPY.invitacionCta}
          </Link>
        </BezelCard>
      </section>
    );
  }

  return (
    <section aria-label={COPY.titulo}>
      {/* Sin encabezado visible (pedido 2026-07-09): el carrusel habla solo, sin
          el título "Para vos" ni la bajada. El aria-label conserva "Para vos"
          para lectores de pantalla. */}
      <ul
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={COPY.titulo}
      >
        {result.items.map((item) => (
          <li key={item.key} className="w-[248px] shrink-0 snap-start">
            <MatchCard item={item} locale={tenant.locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MatchCard({ item, locale }: { item: MatchItem; locale: string }) {
  const meta = KIND_META[item.kind] ?? KIND_META.guide;
  const priceLabel =
    item.type === "listing"
      ? formatListingPrice(item.priceAmount, item.priceCurrency, item.pricePeriod, locale)
      : null;

  return (
    <Link href={item.href} className="group block h-full focus-visible:outline-none">
      <BezelCard
        className="h-full transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-focus-visible:ring-2 group-focus-visible:ring-brand"
        coreClassName="flex h-full flex-col gap-2.5 p-4"
      >
        {/* La razón del match — SIEMPRE visible, arriba de todo. */}
        <p className="flex items-start gap-1.5 text-xs font-medium text-brand-ink">
          <Sparkle size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          {item.reason}
        </p>

        {item.photoPath &&
          (() => {
            const src = listingPhotoUrl(item.photoPath);
            return isOptimizableSrc(src) ? (
              <div className="relative h-24 w-full overflow-hidden rounded-md bg-surface-subtle">
                <Image src={src} alt="" fill sizes="248px" quality={62} className="object-cover" />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- URL externa de seed/API: host fuera del allowlist de next/image
              <img
                src={src}
                alt=""
                loading="lazy"
                className="h-24 w-full rounded-md object-cover"
              />
            );
          })()}

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip size="sm" icon={meta.icon}>
            {meta.label}
          </Chip>
          {item.verified && (
            <Chip size="sm" variant="success" icon={<SealCheck aria-hidden="true" />}>
              {COPY.verificado}
            </Chip>
          )}
        </div>

        <h3 className="line-clamp-2 font-display text-sm font-semibold leading-snug text-foreground">
          {item.title}
        </h3>

        <div className="mt-auto flex items-center justify-between gap-2">
          {priceLabel ? (
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {priceLabel}
            </span>
          ) : (
            <span />
          )}
          {item.areaLabel && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-foreground-muted">
              <MapPin size={13} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{item.areaLabel}</span>
            </span>
          )}
        </div>
      </BezelCard>
    </Link>
  );
}

/** Silueta del carrusel para el Suspense del feed (§5.2 — nunca spinners). */
export function ParaVosSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-6 w-32" />
      <div className="-mx-4 mt-3 flex gap-3 overflow-hidden px-4 pb-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="w-[248px] shrink-0">
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
