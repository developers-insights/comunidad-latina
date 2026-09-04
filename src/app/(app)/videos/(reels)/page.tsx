import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { VideoCategoryMenu } from "../category-menu";
import {
  categoryFilterValue,
  firstParamValue,
  parseStartId,
  parseVideoCategoryParam,
  parseVideosScope,
  shouldShowCategoryMenu,
  type VideoCategoryFilter,
} from "../helpers";
import { fetchVideoReelsPage } from "../queries";
import { VideoReels } from "../video-reels";
import { VIDEOS_COPY } from "../copy";

export const metadata = { title: "Videos Cortos" };

/**
 * /videos — VIDEOS CORTOS: menú de categorías + reel vertical.
 *
 * Query params (los tres son deep links compartibles y ninguno se puede romper):
 * - `cat`: todos | comida | musica | eventos | propiedades | negocios | humor |
 *   deportes | comunidad | otros — el tema elegido en el menú de entrada.
 *   AUSENTE (y sin los otros dos) = todavía no eligió ⇒ se muestra el MENÚ.
 * - `scope`: para-ti | propiedades | negocios | profesionales | eventos —
 *   filtra por el vertical del listing asociado al post (mismo reproductor,
 *   distinto módulo). Default: para-ti (todos los videos visibles).
 * - `start`: id del post que abre el reel (viene de tocar un video en el
 *   feed): ese video va primero y el scroll sigue con los más viejos.
 *
 * Llegar con `?start=` va DERECHO al video: el menú se interpone sólo cuando la
 * persona entra a la sección, nunca cuando abre algo que alguien compartió.
 *
 * La primera página se resuelve en el server (RLS del usuario); el scroll
 * infinito sigue por server action con el MISMO keyset del feed.
 */

const FIRST_PAGE_SIZE = 8;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VideosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rawScope = firstParamValue(sp.scope);
  const scope = parseVideosScope(rawScope || undefined);
  const startId = parseStartId(firstParamValue(sp.start));
  const category = parseVideoCategoryParam(firstParamValue(sp.cat));

  if (shouldShowCategoryMenu({ category, startId, rawScope })) {
    return <VideoCategoryMenu />;
  }

  return (
    <Suspense
      key={`${scope}|${category ?? ""}|${startId ?? ""}`}
      fallback={<ReelsLoading />}
    >
      <ReelsContent scope={scope} startId={startId} category={category} />
    </Suspense>
  );
}

async function ReelsContent({
  scope,
  startId,
  category,
}: {
  scope: ReturnType<typeof parseVideosScope>;
  startId: string | null;
  category: VideoCategoryFilter | null;
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
    category: categoryFilterValue(category),
    cursor: null,
    startId,
    pageSize: FIRST_PAGE_SIZE,
  });

  return (
    <VideoReels
      key={`${scope}|${category ?? ""}`}
      tenantId={tenant.id}
      viewerId={user?.id ?? null}
      scope={scope}
      category={category}
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
