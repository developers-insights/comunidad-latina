"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { TAG_POLICIES, type TagPolicy } from "./tag-policy";

/**
 * Server action de "Quién puede etiquetarte" (Ajustes › Privacidad).
 *
 * Mismas reglas que `feed/tag-actions.ts`, que es la otra mitad de esta
 * misma migración (0089):
 * - Zod PRIMERO, `requireTenantMatch()` DESPUÉS y antes de cualquier efecto
 *   colateral.
 * - Escritura con el cliente del USUARIO, nunca admin: la RLS de
 *   `profiles_private` (0003) es la frontera real — insert/update exigen
 *   `profile_id = auth.uid()` y `tenant_id = current_tenant_id()`, así que un
 *   upsert del propio dueño la pasa sin necesitar ninguna policy nueva.
 * - `profiles_private` todavía no tiene `tag_policy` en `database.types.ts`
 *   (la 0089 no está aplicada): cliente de esquema abierto, igual que en
 *   `tag-policy.ts` y en `feed/tag-actions.ts`.
 *
 * `upsert` y no `update`: muchas cuentas no tienen fila en `profiles_private`
 * (la crea el onboarding "Recién Llegado", y no todas pasaron por ahí) —
 * `update` sobre una fila inexistente no falla, simplemente no hace nada, y la
 * persona se iría con un "Guardado" que fue mentira.
 */

type OpenClient = SupabaseClient;

const tagPolicySchema = z.enum(TAG_POLICIES);

export type SaveTagPolicyResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unauthenticated" | "error" }
  | { ok: false; code: "tenant-mismatch"; message: string };

export async function saveTagPolicyAction(policy: TagPolicy): Promise<SaveTagPolicyResult> {
  const parsed = tagPolicySchema.safeParse(policy);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  const open = supabase as OpenClient;
  const { error } = await open.from("profiles_private").upsert(
    {
      profile_id: user.id,
      tenant_id: tenant.id,
      tag_policy: parsed.data,
    },
    { onConflict: "profile_id" },
  );

  if (error) {
    console.warn("[privacidad] guardado de tag_policy falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  revalidatePath("/ajustes/privacidad");
  return { ok: true };
}
