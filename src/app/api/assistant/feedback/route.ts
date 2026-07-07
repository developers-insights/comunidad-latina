import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setQueryFeedback } from "@/lib/rag";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

/**
 * POST /api/assistant/feedback — 👍/👎 sobre una respuesta del asistente.
 * Marca `helpful` en assistant_queries vía setQueryFeedback (@/lib/rag),
 * usando el queryId que la API principal devolvió en el evento "start".
 *
 * Uso del cliente admin, acotado a propósito (ARQUITECTURA §6):
 * assistant_queries es solo-service por RLS (la escribe logQuery), así que el
 * update también va por admin — pero ANTES se verifica la propiedad de la
 * fila: mismo tenant y, si hay sesión, mismo profile_id (anónimos solo tocan
 * filas anónimas). Es un booleano de analytics sin datos sensibles — no es
 * una acción administrativa (sin audit_log), y el caller solo puede marcar
 * SU propia consulta.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  queryId: z.uuid(),
  helpful: z.boolean(),
});

type OwnershipRow = { id: string; tenant_id: string; profile_id: string | null };

export async function POST(request: Request) {
  let payload: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    payload = parsed.data;
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const admin = createAdminClient();
    // assistant_queries (migración 0017) aún no está en database.types.ts →
    // cast a schema abierto SOLO para el check de propiedad.
    const open = admin as unknown as SupabaseClient;
    const { data, error } = await open
      .from("assistant_queries")
      .select("id, tenant_id, profile_id")
      .eq("id", payload.queryId)
      .maybeSingle();

    const row = (data ?? null) as OwnershipRow | null;
    const owned =
      !error &&
      row !== null &&
      row.tenant_id === tenant.id &&
      (user ? row.profile_id === user.id : row.profile_id === null);

    if (owned) {
      await setQueryFeedback(admin, payload.queryId, payload.helpful);
    }
  } catch (error) {
    console.warn(
      "[asistente] feedback no se pudo guardar:",
      error instanceof Error ? error.message : "error desconocido",
    );
  }

  // Fire-and-forget: la UI agradece igual, nunca ve un error por esto.
  return NextResponse.json({ ok: true });
}
