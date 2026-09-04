import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { VIDEOS_COPY } from "../../copy";
import { LongVideoList } from "../long-video-list";
import { fetchLongVideoById, fetchLongVideosPage } from "../queries";
import { LongVideoPlayer } from "./long-video-player";

export const metadata = { title: "Video completo" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuántos "Más videos largos" se listan debajo del reproductor. */
const MORE_PAGE_SIZE = 6;

/**
 * /videos/largos/[id] — EL VIDEO LARGO, COMPLETO.
 *
 * Es el destino del botón "Ver video completo" que aparece en la tarjeta del
 * feed, en el visor y en el reel cuando el video se frena a los 59 segundos
 * (cliente 2026-09-03: "le das click y empieza a ver el video completo").
 *
 * ---- CUÁNDO ES 404, Y POR QUÉ ES 404 Y NO OTRA COSA ------------------------
 * Cuando el id no tiene forma de uuid, cuando la publicación no existe o la RLS
 * no la deja ver, y —esto es lo propio de esta ruta— cuando el video NO ES
 * LARGO. `fetchLongVideoById` responde `null` en los tres casos.
 *
 * Un corto de 30 segundos abierto acá a mano no puede devolver una pantalla
 * amable con status 200: sería un link muerto que parece válido para los
 * buscadores y para las analíticas, y además abriría la sección de los cinco
 * minutos para algo que se ve entero en su propia publicación. Mismo criterio
 * que `/feed/[id]` — el 404 lo pinta `not-found.tsx` de esa rama.
 */
export default async function LongVideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  const post = await fetchLongVideoById({
    supabase,
    tenantId: tenant.id,
    viewerId,
    postId: id,
  });
  if (!post) notFound();

  /**
   * "Más videos largos" sale de la MISMA consulta que la lista de la sección,
   * con este video excluido. No es una recomendación —no hay motor que la
   * calcule— y por eso el título no promete una: son los otros videos largos,
   * los más nuevos primero, que es exactamente lo que dice.
   */
  const more = await fetchLongVideosPage({
    supabase,
    tenantId: tenant.id,
    viewerId,
    category: null,
    cursor: null,
    pageSize: MORE_PAGE_SIZE,
    excludeId: post.id,
  });

  return (
    <div className="pb-10">
      <LongVideoPlayer post={post} tenantId={tenant.id} viewerId={viewerId} />

      {more.items.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-base font-bold text-foreground">
            {VIDEOS_COPY.largos.moreTitle}
          </h2>
          <LongVideoList
            className="mt-3"
            initialItems={more.items}
            initialCursor={more.nextCursor}
            excludeId={post.id}
            // La imagen que importa en esta pantalla es el poster del video de
            // arriba; una miniatura de más abajo no le compite el ancho de banda.
            priorityFirst={false}
          />
        </section>
      )}

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
  );
}
