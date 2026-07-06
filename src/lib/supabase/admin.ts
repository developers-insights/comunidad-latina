import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * ⚠️ Cliente service-role — BYPASSA RLS por completo.
 *
 * Uso RESTRINGIDO (ARQUITECTURA.md §6):
 *   - Webhook de Stripe
 *   - Cron jobs (api/cron/*)
 *   - Moderación server-side
 *   - Signup: setear app_metadata (tenant_id, role)
 *
 * JAMÁS usarlo en un request path de usuario para leer datos: para eso está
 * el cliente de server.ts (anon + cookies), que respeta RLS.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Cliente admin de Supabase no configurado. Faltan NEXT_PUBLIC_SUPABASE_URL y/o " +
        "SUPABASE_SERVICE_ROLE_KEY en .env.local (BLOQUE A de .env.example).",
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
