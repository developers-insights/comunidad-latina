import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { firstParamValue, parseStartId, parseVideosScope } from "./helpers";
import { fetchVideoReelsPage } from "./queries";
import { VideoReels } from "./video-reels";
import { VIDEOS_COPY } from "./copy";

export const metadata = { title: "Videos" };

/**
 * /videos — reels vertical de la comunidad (pedido cliente 2026-07-21).
 *
 * Query params:
 * - `scope`: para-ti | propiedades | negocios | profesionales | eventos —
 *   filtra por el vertical del listing asociado al post (mismo reproductor,
 *   distinto módulo). Default: para-ti (todos los videos visibles).
 * - `start`: id del post que abre el reel (viene de tocar un video en el
 *   feed): ese video va primero y el scroll sigue con los más viejos.
 *
 * La primera página se resuelve en el server (RLS del usuario); el scroll
 * infinito sigue por server action con el MISMO keyset del feed.
 */

const FIRST_PAGE_SIZE = 8;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VideosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const scope = parseVideosScope(firstParamValue(sp.scope) || undefined);
  const startId = parseStartId(firstParamValue(sp.start));

  return (
    <Suspense key={`${scope}|${startId ?? ""}`} fallback={<ReelsLoading />}>
      <ReelsContent scope={scope} startId={startId} />
    </Suspense>
  );
}

async function ReelsContent({
  scope,
  startId,
}: {
  scope: ReturnType<typeof parseVideosScope>;
  startId: string | null;
}) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const page = await fetchVideoReelsPage({
    supabase,
    tenantId: tenant.id,
    viewerId: user?.id ?? null,
    scope,
    cursor: null,
    startId,
    pageSize: FIRST_PAGE_SIZE,
  });

  return (
    <VideoReels
      key={scope}
      tenantId={tenant.id}
      viewerId={user?.id ?? null}
      scope={scope}
      initialItems={page.items}
      initialCursor={page.nextCursor}
    />
  );
}

/**
 * Fallback del Suspense: skeleton con la SILUETA del reel (§5.2 — carga de
 * contenido con skeleton, no spinner): lienzo negro + placeholder del video,
 * del riel de acciones y de la línea de autor, latiendo suave.
 */
function ReelsLoading() {
  return (
    <div
      aria-busy="true"
      aria-label={VIDEOS_COPY.title}
      className="fixed inset-x-0 bottom-0 top-0 z-30 bg-media-shade"
    >
      <div className="mx-auto flex h-full w-full max-w-lg animate-pulse flex-col justify-end px-4 pb-[calc(6.25rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-full bg-on-media/15" />
          <div className="h-3.5 w-36 rounded-full bg-on-media/15" />
        </div>
        <div className="mt-3 h-3 w-2/3 rounded-full bg-on-media/10" />
        <div className="mt-2 h-3 w-1/2 rounded-full bg-on-media/10" />
      </div>
      <div className="absolute bottom-[calc(6.25rem+env(safe-area-inset-bottom))] right-2 flex animate-pulse flex-col gap-4">
        <div className="size-9 rounded-full bg-on-media/15" />
        <div className="size-9 rounded-full bg-on-media/15" />
        <div className="size-9 rounded-full bg-on-media/15" />
      </div>
    </div>
  );
}
