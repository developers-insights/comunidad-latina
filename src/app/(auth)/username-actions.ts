"use server";

import { headers } from "next/headers";
import { limit, clientIpFromHeaders } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/resolve";
import { normalizeUsername, usernameProblem } from "@/lib/profile/username";

/** Mismo texto que `registerAction` (actions.ts) para cada problema — un handle
 * que la app rechaza acá tiene que decir exactamente lo mismo que si llegara
 * al submit, o la persona ve dos mensajes distintos para el mismo error. */
const COPY = {
  vacio: "Elegí tu nombre de usuario.",
  corto: "Necesita al menos 3 caracteres.",
  largo: "El máximo son 30 caracteres.",
  formato: "Solo letras sin acento, números, punto y guion bajo.",
  bordes: "No puede empezar ni terminar con punto o guion bajo.",
  taken: "Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro.",
} as const;

export type UsernameAvailability =
  | { status: "invalid"; message: string }
  | { status: "available" }
  | { status: "taken"; message: string }
  | { status: "unknown" };

/** 60/min por IP — generoso a propósito: esto corre en cada tecla, no en cada envío. */
const CHECK_WINDOW_MS = 60_000;
const CHECK_MAX_PER_WINDOW = 60;

/**
 * ¿Está libre este handle EN ESTE TENANT, ahora mismo?
 *
 * Es una foto, no una promesa: la unicidad real la arbitra el índice
 * `profiles_username_tenant_uniq` en `registerAction`, que sigue validando todo
 * de nuevo al crear la cuenta (ver username.ts: "la unicidad no se valida acá"
 * aplica también a este chequeo en vivo). Esto sólo evita que la persona llegue
 * al final del formulario para enterarse de algo que se podía saber al tipear.
 *
 * Nunca puede bloquear el alta: cualquier falla (límite de intentos, admin
 * client sin configurar, error de la consulta) devuelve `unknown` — el submit
 * real sigue siendo la única fuente de verdad.
 */
export async function checkUsernameAvailabilityAction(
  raw: string,
): Promise<UsernameAvailability> {
  const problem = usernameProblem(raw);
  if (problem) return { status: "invalid", message: COPY[problem] };

  const username = normalizeUsername(raw);
  if (username === null) return { status: "invalid", message: COPY.vacio };

  const headerStore = await headers();
  const ip = clientIpFromHeaders(headerStore);
  if (!limit(`username-check:${ip}`, CHECK_MAX_PER_WINDOW, CHECK_WINDOW_MS).ok) {
    return { status: "unknown" };
  }

  const tenant = await getTenant();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: "unknown" };
  }

  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("username", username)
    .limit(1);

  if (error) {
    console.error("[auth] chequeo de username falló", { code: error.code });
    return { status: "unknown" };
  }

  return data && data.length > 0
    ? { status: "taken", message: COPY.taken }
    : { status: "available" };
}
