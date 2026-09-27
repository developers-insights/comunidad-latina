import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, MapPin } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui";
import { SectionTopBar } from "@/components/shell";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDuration } from "@/lib/media/video-policy";
import { cn } from "@/lib/utils";
import { VIDEOS_COPY } from "../../../copy";
import { fetchAvisoConVideoLargo, fetchAvisosConVideoLargo } from "../../aviso-queries";
import { AVISOS_LARGOS_COPY, AvisosConVideoLargo } from "../../aviso-video-card";
import { AvisoVideoPlayer } from "./aviso-video-player";

export const metadata = { title: "Video completo" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AvisoVideoLargoPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  if (!UUID_RE.test(listingId)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  const [aviso, mas] = await Promise.all([
    fetchAvisoConVideoLargo({ supabase, tenantId: tenant.id, viewerId, listingId, locale: tenant.locale }),
    fetchAvisosConVideoLargo({
      supabase,
      tenantId: tenant.id,
      viewerId,
      locale: tenant.locale,
      limit: 6,
      excludeId: listingId,
    }),
  ]);
  if (!aviso) notFound();

  const duracion = formatDuration(aviso.video.durationSeconds);

  return (
    <>
      <SectionTopBar fallbackHref="/videos/largos" />
      <div className="pb-10">
        <article>
          <AvisoVideoPlayer
            url={aviso.video.url}
            posterUrl={aviso.video.posterUrl}
            title={aviso.title}
          />
          <div className="pt-4">
            <h1 className="font-display text-lg font-bold leading-snug text-foreground">
              {aviso.title}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-foreground-secondary">
              {aviso.priceLabel && (
                <span className="numeric font-semibold text-foreground">{aviso.priceLabel}</span>
              )}
              {aviso.areaLabel && (
                <span className="flex items-center gap-1">
                  <MapPin size={14} aria-hidden="true" className="shrink-0" />
                  {aviso.areaLabel}
                </span>
              )}
              {duracion && <span className="numeric text-foreground-muted">{duracion}</span>}
            </p>
            <Link
              href={aviso.detailHref}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-4 w-full sm:w-auto")}
            >
              {AVISOS_LARGOS_COPY.verAviso}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </article>

        <AvisosConVideoLargo avisos={mas} titulo={AVISOS_LARGOS_COPY.mas} className="mt-8" />

        <div className="mt-8 flex justify-center">
          <Link
            href="/videos/largos"
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold",
              "text-foreground-secondary transition-colors duration-(--duration-fast)",
              "hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            {VIDEOS_COPY.largos.backToSection}
          </Link>
        </div>
      </div>
    </>
  );
}
