import "server-only";

import { createClient } from "@/lib/supabase/server";
import { supabaseSinTiparComunidad, type RegistrationKind } from "@/lib/comunidad";

/**
 * =============================================================================
 * LO QUE LEE EL PROPIO REGISTRADO (0131)
 * =============================================================================
 *
 * Una sola lectura, y es la que contesta «¿ya me anoté?».
 *
 * Con el cliente del USUARIO: la policy de SELECT de `community_registrations`
 * deja ver lo propio y nada más (salvo que quien mire sea del equipo, que tiene
 * su propia pantalla en /admin). Así que esta función no filtra por autor para
 * proteger —eso ya está hecho— sino para no traer de más.
 *
 * ── POR QUÉ NO HAY UNA PANTALLA "MIS REGISTROS" ─────────────────────────────
 * Porque no habría nada que hacer en ella. Un registro no se edita (el trigger
 * congela el contenido: si te equivocaste, lo retirás y lo mandás de nuevo) y
 * no tiene conversación: lo que sigue es que el equipo llame. Lo único que la
 * persona necesita saber —«ya está, no lo mandes otra vez»— se lo dice el
 * propio formulario cuando lo vuelve a abrir, que es donde va a ir a buscarlo.
 */

export interface MiRegistro {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
}

/**
 * Los registros de esta persona en esta comunidad.
 *
 * Devuelve vacío ante cualquier problema —incluido el más común, que es no
 * tener sesión—. Un vacío acá sólo hace que el formulario se dibuje: el cupo
 * real lo hacen cumplir el índice único y el trigger de la 0131, así que el
 * peor caso de una lectura fallida es un mensaje de error en vez de una
 * pantalla que ya lo sabía.
 */
export async function fetchMisRegistros(input: {
  tenantId: string;
  viewerId: string;
}): Promise<MiRegistro[]> {
  const supabase = supabaseSinTiparComunidad(await createClient());

  const { data, error } = await supabase
    .from("community_registrations")
    .select("id, kind, status, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("created_by", input.viewerId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    // 42501 = permission denied: es el camino esperado de quien no tiene
    // sesión, no un incidente. Mismo criterio que el tablón de pedidos.
    if (error.code !== "42501") {
      console.warn("[comunidad] query de mis registros falló", { code: error.code });
    }
    return [];
  }

  return ((data ?? []) as { id: string; kind: string; status: string; created_at: string }[]).map(
    (row) => ({ id: row.id, kind: row.kind, status: row.status, createdAt: row.created_at }),
  );
}

/**
 * El registro ABIERTO de esta persona para UN formulario, si existe.
 *
 * Es lo que necesita cada pantalla de alta: con esto decide si dibuja el
 * formulario o el cartel de «ya tenemos tus datos» con el botón para retirarlos.
 */
export async function fetchRegistroAbierto(input: {
  tenantId: string;
  viewerId: string;
  kind: RegistrationKind;
}): Promise<{ id: string; createdAt: string; contacto: string | null } | null> {
  const supabase = supabaseSinTiparComunidad(await createClient());

  const { data, error } = await supabase
    .from("community_registrations")
    .select("id, created_at, contact_phone, contact_email")
    .eq("tenant_id", input.tenantId)
    .eq("created_by", input.viewerId)
    .eq("kind", input.kind)
    .in("status", ["new", "contacted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code !== "42501") {
      console.warn("[comunidad] query del registro abierto falló", { code: error.code });
    }
    return null;
  }
  if (!data) return null;

  const row = data as {
    id: string;
    created_at: string;
    contact_phone: string | null;
    contact_email: string | null;
  };
  // El contacto con el que quedó anotada se le muestra de vuelta: es la única
  // forma que tiene de darse cuenta de que puso un número viejo, y el registro
  // no se edita (se retira y se manda de nuevo).
  return {
    id: row.id,
    createdAt: row.created_at,
    contacto: row.contact_phone ?? row.contact_email,
  };
}
