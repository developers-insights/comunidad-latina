"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { decodeCursor } from "@/components/listings";
import { categoryFilterValue, parseVideoCategoryParam } from "../helpers";
import { fetchLongVideosPage, type LongVideosPage } from "./queries";

/**
 * Server action de "Ver más" en `/videos/largos`. SOLO LECTURA: no hay efectos
 * colaterales, así que no lleva el tenant guard de escritura — quién ve qué lo
 * gobierna la RLS del cliente del usuario, igual que en la página.
 *
 * Espeja a `loadMoreVideosAction` de Videos Cortos (mismo esquema, mismo cursor
 * opaco, misma revalidación del tema contra el catálogo cerrado): la tanda 2
 * tiene que filtrar por lo mismo que la 1, y el valor llega del cliente.
 */
const loadMoreSchema = z.object({
  category: z.string().max(30).optional(),
  cursor: z.string().min(1).max(200),
  /** El video que se está mirando no se repite en "Más videos largos". */
  excludeId: z.string().max(64).optional(),
});

export async function loadMoreLongVideosAction(input: {
  category?: string;
  cursor: string;
  excludeId?: string;
}): Promise<LongVideosPage> {
  const parsed = loadMoreSchema.safeParse(input);
  if (!parsed.success) return { items: [], nextCursor: null };

  const category = categoryFilterValue(parseVideoCategoryParam(parsed.data.category));
  const cursor = decodeCursor(parsed.data.cursor);
  if (!cursor) return { items: [], nextCursor: null };

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return fetchLongVideosPage({
    supabase,
    tenantId: tenant.id,
    viewerId: user?.id ?? null,
    category,
    cursor,
    excludeId: parsed.data.excludeId ?? null,
  });
}
