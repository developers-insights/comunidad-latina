import "server-only";

import { unstable_cache } from "next/cache";
import { createServerClient } from "@supabase/ssr";
import { resolvePrices, type ResolvedPrice } from "@/lib/pricing";
import { FALLBACK_PRICES } from "@/lib/pricing/defaults";
import { getTenantPrices } from "@/lib/pricing/read";
import type { Tenant } from "@/lib/tenant/resolve";
import type { Database } from "@/lib/types/database.types";

// Sin cookies a propósito: unstable_cache no admite cookies()/headers() adentro, y
// así la página se ve igual con o sin sesión. Con anon, la lectura directa de
// tenant_prices vuelve vacía por RLS y getTenantPrices cae sola a
// tenant_public_prices(tenant_id) (0078), que sí atiende a anon.
function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createServerClient<Database>(url, anonKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

const readPricesCached = unstable_cache(
  async (tenantId: string): Promise<ResolvedPrice[]> => {
    const supabase = anonClient();
    if (!supabase) return resolvePrices([], FALLBACK_PRICES);
    return getTenantPrices(supabase, tenantId);
  },
  ["precios-publicos"],
  { revalidate: 300, tags: ["tenant-prices"] },
);

export async function getPublicPrices(tenant: Pick<Tenant, "id" | "isFallback">) {
  // Un tenant de respaldo trae un id placeholder que no existe en la base.
  if (tenant.isFallback) return resolvePrices([], FALLBACK_PRICES);
  return readPricesCached(tenant.id);
}
