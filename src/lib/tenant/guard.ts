import "server-only";

import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";
import { getTenant, type Tenant } from "./resolve";
import {
  classifyTenantMatch,
  TENANT_GUARD_COPY,
  tenantMismatchMessage,
} from "./match";

/**
 * Guard de divergencia tenant-del-request ↔ tenant-del-usuario.
 *
 * Espejo de `src/app/admin/guard.ts`, que ya trata el `tenant_id` del JWT como
 * "el tenant REAL (no el del Host header)" — acá se aplica esa misma verdad
 * fuera de `/admin`.
 *
 * REGLA DE USO: `requireTenantMatch()` va PRIMERO en toda server action de
 * escritura, ANTES de cualquier efecto colateral (consumir rate limit, subir a
 * storage con el admin client, abrir una Checkout Session en Stripe). Si el
 * guard corriera después, esos efectos quedarían huérfanos cuando la RLS
 * rechace la escritura — exactamente el bug que tenía el composer del feed,
 * que subía la foto al prefijo de storage del OTRO tenant y recién entonces
 * fallaba el insert.
 *
 * NO bloquea lecturas: el contenido `published` es cross-tenant a propósito
 * (SEO, policy `listings_select`). La divergencia solo cierra la escritura y
 * se avisa con `<TenantMismatchBanner>` en el shell de `(app)/`.
 */

export interface HomeTenant {
  id: string;
  slug: string;
  name: string;
}

interface GuardBase {
  tenant: Tenant;
  supabase: SupabaseClient<Database>;
}

export type TenantGuardResult =
  | (GuardBase & { ok: true; user: User })
  | (GuardBase & { ok: false; reason: "unauthenticated"; message: string; user: null })
  | (GuardBase & { ok: false; reason: "tenant-unavailable"; message: string; user: User })
  | (GuardBase & {
      ok: false;
      reason: "tenant-mismatch";
      message: string;
      user: User;
      /** Comunidad real del usuario, si se pudo resolver. */
      homeTenant: HomeTenant | null;
    });

/** `app_metadata.tenant_id` del JWT — server-controlled, nunca del cliente. */
function readJwtTenantId(user: User): string | null {
  const claim = user.app_metadata?.tenant_id;
  return typeof claim === "string" && claim.length > 0 ? claim : null;
}

/**
 * Resuelve la comunidad real del usuario para poder nombrarla en el aviso.
 * `tenants_select` (0002) permite leer cualquier tenant `active`, así que
 * alcanza con el cliente del usuario. Best-effort: si no se puede, el copy
 * degrada a "otra comunidad" en vez de inventar un nombre.
 */
async function findHomeTenant(
  supabase: SupabaseClient<Database>,
  jwtTenantId: string | null,
): Promise<HomeTenant | null> {
  if (!jwtTenantId) return null;
  try {
    const { data } = await supabase
      .from("tenants")
      .select("id, slug, name")
      .eq("id", jwtTenantId)
      .maybeSingle();
    return data ? { id: data.id, slug: data.slug, name: data.name } : null;
  } catch {
    return null;
  }
}

/**
 * Para server actions de ESCRITURA. Devuelve el cliente y el usuario ya
 * resueltos, así la action no repite `createClient()` + `getUser()`.
 *
 * El caller decide qué hacer con cada `reason`; `message` trae copy cálido
 * listo para mostrar (los módulos con copy propio de "entrá a tu cuenta"
 * pueden ignorar el de `unauthenticated` y usar el suyo).
 */
export async function requireTenantMatch(): Promise<TenantGuardResult> {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: TENANT_GUARD_COPY.unauthenticated,
      tenant,
      supabase,
      user: null,
    };
  }

  const jwtTenantId = readJwtTenantId(user);
  const status = classifyTenantMatch({
    requestTenantId: tenant.id,
    requestTenantIsFallback: tenant.isFallback,
    jwtTenantId,
    isAuthenticated: true,
  });

  if (status === "match") {
    return { ok: true, tenant, supabase, user };
  }

  if (status === "tenant-unavailable") {
    return {
      ok: false,
      reason: "tenant-unavailable",
      message: TENANT_GUARD_COPY.unavailable,
      tenant,
      supabase,
      user,
    };
  }

  const homeTenant = await findHomeTenant(supabase, jwtTenantId);

  // Detección, no "escritura bloqueada": el banner del shell también pasa por
  // acá en cada render, sin que haya un intento de escritura.
  // Sin PII (§5.4): solo slugs de tenant y si el token traía claim.
  console.warn("[tenant] divergencia JWT/header detectada", {
    requestTenant: tenant.slug,
    homeTenant: homeTenant?.slug ?? null,
    hasTenantClaim: jwtTenantId !== null,
  });

  return {
    ok: false,
    reason: "tenant-mismatch",
    message: tenantMismatchMessage(tenant.name, homeTenant?.name ?? null),
    tenant,
    supabase,
    user,
    homeTenant,
  };
}

/**
 * Para el shell de `(app)/`: `null` cuando no hay nada que avisar.
 *
 * Cacheado por request — el layout y cualquier RSC del mismo render comparten
 * el `getUser()`. Se muestra a TODOS los roles: un `global_admin` saltando de
 * tenant con `?t=` tampoco puede insertar (la policy `listings_insert` no tiene
 * escape para staff, solo `listings_update`), así que el aviso también es
 * verdadero para él.
 */
export const getTenantMismatch = cache(
  async (): Promise<{ current: Tenant; home: HomeTenant | null } | null> => {
    const guard = await requireTenantMatch();
    if (guard.ok || guard.reason !== "tenant-mismatch") return null;
    return { current: guard.tenant, home: guard.homeTenant };
  },
);
