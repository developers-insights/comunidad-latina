"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { listingViewHref } from "@/lib/monetization/href";
import { supabaseSinTiparListings } from "@/lib/listings";
import { ELIMINAR_COPY as C, TABLAS_CON_PAGOS } from "./eliminar-copy";

const schema = z.object({ listingId: z.uuid(), confirmed: z.literal(true) });

export type EliminarAvisoResult = { ok: true } | { ok: false; error: string; needsAuth?: boolean };

export async function eliminarAvisoAction(rawInput: {
  listingId: string;
  confirmed: true;
}): Promise<EliminarAvisoResult> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: C.generico };
  const { listingId } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`eliminar-aviso:${user.id}`, 30, DAY_MS).ok) {
    return { ok: false, error: C.demasiado };
  }

  const sinTipar = supabaseSinTiparListings(supabase);
  const { data: fila, error: readError } = await sinTipar
    .from("listings")
    .select("id, kind, status")
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (readError || !fila) return { ok: false, error: C.noEsTuyo };
  const { kind } = fila as { kind: string };
  if (kind === "business") return { ok: false, error: C.negocio };

  // boosts, campaigns y listing_premiums caen en CASCADE con el aviso: borrarlo
  // se llevaría puesto el registro de lo que alguien pagó.
  const pagos = await Promise.all(
    TABLAS_CON_PAGOS.map((tabla) =>
      sinTipar.from(tabla).select("id").eq("listing_id", listingId).limit(1),
    ),
  );
  if (pagos.some((r) => r.error)) return { ok: false, error: C.generico };
  if (pagos.some((r) => (r.data ?? []).length > 0)) return { ok: false, error: C.tuvoPagos };

  const { data: borradas, error: deleteError } = await sinTipar
    .from("listings")
    .delete()
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .select("id");

  if (deleteError || (borradas ?? []).length === 0) {
    console.warn("[publicaciones] no se pudo eliminar el aviso", {
      listingId,
      code: deleteError?.code ?? "sin-filas",
    });
    return { ok: false, error: C.generico };
  }

  revalidatePath("/publicaciones");
  revalidatePath("/feed");
  revalidatePath(listingViewHref(kind, listingId));
  return { ok: true };
}
