import type { createClient } from "@/lib/supabase/server";

/**
 * Lecturas de engagement de un LISTING (migración 0038).
 *
 * Server-only por uso: recibe el cliente ya creado, con las cookies del
 * visitante y RLS aplicada. NO se exporta desde `./index` a propósito — ese
 * barrel lo importan client components.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * ¿El visitante ya guardó este aviso? (`saves` — RLS: sólo filas propias.)
 *
 * Devuelve `false` sin sesión y ante CUALQUIER error: el estado inicial de un
 * botón de guardar no justifica romperle la pantalla a nadie (y si la 0038 no
 * corrió todavía en un entorno, el detalle sigue de pie).
 */
export async function fetchListingSaved(
  supabase: ServerClient,
  tenantId: string,
  listingId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from("saves")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("subject_kind", "listing")
      .eq("subject_id", listingId)
      .eq("profile_id", userId)
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}
