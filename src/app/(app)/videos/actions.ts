"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { decodeCursor } from "@/components/listings";
import { parseVideosScope } from "./helpers";
import { fetchVideoReelsPage, type VideoReelsPage } from "./queries";

/**
 * Server action del scroll infinito de /videos. SOLO LECTURA: no hay efectos
 * colaterales, así que no requiere el tenant guard de escritura — la RLS del
 * cliente del usuario gobierna qué filas devuelve, igual que en la página.
 */

const loadMoreSchema = z.object({
  scope: z.string().max(30),
  cursor: z.string().min(1).max(200),
});

export async function loadMoreVideosAction(input: {
  scope: string;
  cursor: string;
}): Promise<VideoReelsPage> {
  const parsed = loadMoreSchema.safeParse(input);
  if (!parsed.success) return { items: [], nextCursor: null };

  const scope = parseVideosScope(parsed.data.scope);
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
    cursor,
  });
}
