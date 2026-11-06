"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/resolve";
import type { PerfilPublico, PuntajePublico } from "./publicos";

/**
 * Autores para quien no tiene sesión. Sin JWT la base no sabe de qué comunidad es el
 * pedido y el `Host` no llega a Postgres (0091), así que la comunidad la pone acá el
 * servidor y `anon` no ejecuta estas RPC (0187). Mismo patrón que
 * `buscar_personas_visitante`.
 *
 * `"use server"` no es para llamarla como action: el navegador va por
 * `/api/autores-visitante`. Es lo que deja a `publicos.ts`, que corre de los dos lados,
 * importar esto sin llevar `server-only` al cliente. Con `import "server-only"` el build
 * falla, incluso con import dinámico.
 */
interface ErrorDeLectura {
  code: string;
  message: string;
}

async function comunidadDelDominio() {
  const tenant = await getTenant();
  return tenant.isFallback ? null : tenant.id;
}

function sinAdmin(error: unknown): ErrorDeLectura {
  const message = error instanceof Error ? error.message : "desconocido";
  console.warn("[perfiles] visitante sin admin client", { message });
  return { code: "sin_admin", message };
}

export async function perfilesDeVisitante(
  ids: string[],
): Promise<{ data: PerfilPublico[]; error: ErrorDeLectura | null }> {
  const comunidad = await comunidadDelDominio();
  if (!comunidad) return { data: [], error: null };

  try {
    const { data, error } = await createAdminClient().rpc("perfiles_visitante", {
      p_tenant: comunidad,
      p_ids: ids,
    });
    return {
      data: data ?? [],
      error: error ? { code: error.code, message: error.message } : null,
    };
  } catch (error) {
    return { data: [], error: sinAdmin(error) };
  }
}

export async function puntajesDeVisitante(
  ids: string[],
): Promise<{ data: PuntajePublico[]; error: ErrorDeLectura | null }> {
  const comunidad = await comunidadDelDominio();
  if (!comunidad) return { data: [], error: null };

  try {
    const { data, error } = await createAdminClient().rpc("puntajes_visitante", {
      p_tenant: comunidad,
      p_ids: ids,
    });
    return {
      data: data ?? [],
      error: error ? { code: error.code, message: error.message } : null,
    };
  } catch (error) {
    return { data: [], error: sinAdmin(error) };
  }
}
