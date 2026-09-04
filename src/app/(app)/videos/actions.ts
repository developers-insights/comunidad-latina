"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { decodeCursor } from "@/components/listings";
import {
  categoryFilterValue,
  parseStartId,
  parseVideoCategoryParam,
  parseVideosScope,
} from "./helpers";
import { fetchVideoReelsPage, type VideoReelsPage } from "./queries";

/**
 * Server action del scroll infinito de /videos. SOLO LECTURA: no hay efectos
 * colaterales, así que no requiere el tenant guard de escritura — la RLS del
 * cliente del usuario gobierna qué filas devuelve, igual que en la página.
 */

const loadMoreSchema = z.object({
  scope: z.string().max(30),
  /** Tema del menú de entrada. Ausente o basura = sin filtro de tema. */
  category: z.string().max(30).optional(),
  cursor: z.string().min(1).max(200),
});

export async function loadMoreVideosAction(input: {
  scope: string;
  category?: string;
  cursor: string;
}): Promise<VideoReelsPage> {
  const parsed = loadMoreSchema.safeParse(input);
  if (!parsed.success) return { items: [], nextCursor: null };

  const scope = parseVideosScope(parsed.data.scope);
  // La categoría se re-valida contra el catálogo cerrado: la página 2 tiene que
  // filtrar por lo MISMO que la página 1, y el valor llega del cliente.
  const category = categoryFilterValue(parseVideoCategoryParam(parsed.data.category));
  const cursor = decodeCursor(parsed.data.cursor);
  if (!cursor) return { items: [], nextCursor: null };

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return fetchVideoReelsPage({
    supabase,
    tenantId: tenant.id,
    viewerId: user?.id ?? null,
    scope,
    category,
    cursor,
  });
}

// ---------------------------------------------------------------------------
// El reel que se abre ENCIMA del feed (2026-09-03)
// ---------------------------------------------------------------------------

/**
 * Cuántos videos trae la primera tanda del reel que abre un toque en el feed.
 *
 * Los mismos 8 que la página `/videos`, y por la misma razón: alcanzan para que
 * el scroll infinito nunca se vea venir (el prefetch se dispara a 3 del final) y
 * no tantos como para que la apertura tenga que esperar una consulta larga
 * mientras la persona ya está mirando el overlay.
 */
const OVERLAY_PAGE_SIZE = 8;

/**
 * LA PRIMERA TANDA DEL REEL, EMPEZANDO POR UN POST CONCRETO.
 *
 * Existe por el pedido del cliente del 2026-09-03 (17:23–18:20): al tocar un
 * video del feed tiene que sonar la música y poder scrollear a los otros videos
 * cortos. Hasta ese día el toque abría un visor en el lugar —sin música y sin
 * scroll— porque la alternativa era navegar a `/videos` y perder la posición del
 * feed. Ahora el reel se abre ENCIMA, así que necesita del servidor exactamente
 * lo mismo que la página: una página armada alrededor de ese post.
 *
 * ES LA MISMA FUNCIÓN QUE USA `/videos` (`fetchVideoReelsPage` con `startId`),
 * no una consulta paralela. Eso es lo que garantiza que el reel del feed y el de
 * la sección muestren el mismo contenido con las mismas reglas: sólo cortos
 * elegibles, sin publicidad, con la visibilidad del viewer y su RLS.
 *
 * SOLO LECTURA, igual que `loadMoreVideosAction`: no hace falta el tenant guard
 * de escritura — quién puede ver qué lo gobierna la RLS del cliente del usuario.
 *
 * Una lista vacía es una respuesta VÁLIDA y quien llama tiene que saber
 * manejarla: el post pudo dejar de ser elegible para el reel entre que el feed
 * se pintó y el dedo tocó (se despublicó, entró a revisión, lo bloquearon). El
 * overlay cae ahí a mostrar el video solo, sin scroll, en vez de un reel vacío.
 */
const openReelSchema = z.object({
  scope: z.string().max(30),
  startId: z.string().max(64),
});

/**
 * La tanda MÁS quién la está mirando.
 *
 * La página `/videos` recibe `tenantId` y `viewerId` del server component que la
 * monta; el overlay lo abre una TARJETA DEL FEED, que no tiene por qué conocer
 * ninguno de los dos. Viajan en la respuesta —no como props que el cliente
 * tenga que acarrear— porque el servidor ya los resolvió para armar esta misma
 * página: el reel los necesita para el me gusta y el guardado, que escriben con
 * el tenant y el perfil de quien mira.
 */
export interface ReelOverlayPage extends VideoReelsPage {
  tenantId: string;
  viewerId: string | null;
}

export async function openReelAtPostAction(input: {
  scope: string;
  startId: string;
}): Promise<ReelOverlayPage> {
  const vacio: ReelOverlayPage = {
    items: [],
    nextCursor: null,
    tenantId: "",
    viewerId: null,
  };
  const parsed = openReelSchema.safeParse(input);
  if (!parsed.success) return vacio;

  // El id se valida con la MISMA función que valida `?start=` en la URL: un post
  // que llega por acá no puede ser más laxo que uno que llega por un link.
  const startId = parseStartId(parsed.data.startId);
  if (!startId) return vacio;

  const scope = parseVideosScope(parsed.data.scope);

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  const page = await fetchVideoReelsPage({
    supabase,
    tenantId: tenant.id,
    viewerId,
    scope,
    // SIN filtro de tema: el reel que abre el feed sigue "los otros videos
    // cortos", que es lo que pidió el cliente — no los de la categoría del
    // primero. El menú de temas es una decisión de la sección `/videos`.
    category: null,
    cursor: null,
    startId,
    pageSize: OVERLAY_PAGE_SIZE,
  });

  return { ...page, tenantId: tenant.id, viewerId };
}
