"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { decodeCursor } from "@/components/listings";
import {
  categoryFilterValue,
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
