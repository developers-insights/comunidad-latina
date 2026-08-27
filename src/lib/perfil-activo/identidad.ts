import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { listingPhotoUrl } from "@/components/listings/helpers";

/**
 * =============================================================================
 * PERFIL ACTIVO — con qué identidad está actuando la persona (migración 0103)
 * =============================================================================
 *
 * El pedido del cliente: «serían como tener 2 perfiles en la misma cuenta,
 * dependiendo la cuenta que quieras usar». Una sesión, dos identidades — la
 * personal y la del negocio— y en TODO momento la persona tiene que poder ver
 * con cuál está actuando.
 *
 * ── ESTO SE RESUELVE EN EL SERVIDOR, Y NO ES UN DETALLE ─────────────────────
 * La identidad activa decide con qué nombre se publica. Si viviera en el
 * cliente —una cookie, un estado de React, un valor en localStorage— cualquiera
 * podría decir "soy la panadería" y firmar una publicación con un nombre que no
 * es el suyo. Por eso vive en `public.active_identities`, cuyo WITH CHECK exige
 * membresía ACTIVA (`app.business_role`): no hay forma de dejar escrita una
 * identidad de un negocio ajeno, ni llamando a PostgREST a mano.
 *
 * ── Y ADEMÁS SE REVALIDA EN CADA LECTURA ────────────────────────────────────
 * La policy protege la ESCRITURA. Falta el caso inverso: que a alguien le
 * revoquen la membresía DESPUÉS de haber elegido esa identidad. La fila queda
 * apuntando a un negocio que ya no le corresponde, y ninguna policy la borra
 * sola. Por eso `getIdentidadActiva()` nunca confía en la fila: cruza el
 * `business_id` contra `identidades_disponibles()` —que se calcula desde
 * `business_members` en el momento— y si no está, devuelve la identidad
 * personal. Perder el modo negocio es molesto; publicar como un negocio del que
 * te echaron es un problema de confianza.
 *
 * ── NUNCA TIRA ──────────────────────────────────────────────────────────────
 * Lo consume el shell (header + Ajustes), así que un error de red no puede
 * tumbar la pantalla: ante cualquier falla se cae a la identidad personal, que
 * es el default seguro (publicás como vos, que es lo que la app hacía antes de
 * que esto existiera).
 *
 * ⚠️ ESCAPE DE TIPOS — `src/lib/types/database.types.ts` está generado hasta la
 * 0076, así que ni `active_identities` ni la RPC `identidades_disponibles`
 * existen ahí. Mismo escape acotado que ya usan reseñas (0093) y disputas
 * (0086), con la misma fecha de vencimiento: cuando se regenere el archivo de
 * tipos, `clienteSinTipar` se borra y las interfaces de abajo se reemplazan por
 * `Tables<"active_identities">`.
 */

/** Los cinco roles de `business_members` (0031), en orden de poder. */
export type RolDeNegocio =
  | "propietario"
  | "administrador"
  | "editor"
  | "atencion"
  | "analista";

/** Roles que pueden PUBLICAR en nombre del negocio. */
const ROLES_QUE_PUBLICAN: ReadonlySet<string> = new Set([
  "propietario",
  "administrador",
  "editor",
]);

export interface IdentidadNegocio {
  businessId: string;
  nombre: string;
  categoria: string | null;
  /**
   * Ficha pública del negocio en el directorio (`listings` kind='business'), o
   * null si todavía no publicó ninguna. Es la llave que necesita el feed para
   * firmar una publicación como el negocio (`posts.entity_listing_id`).
   */
  listingId: string | null;
  /**
   * La FOTO del negocio, ya resuelta a URL pública. Sale de `photos[1]` de esa
   * misma ficha (0116) — el negocio no tiene columna de avatar propia y no debe
   * tenerla: sería una columna que ningún formulario escribe (el argumento de
   * la 0103, que sigue en pie). La ficha sí tiene formulario y sí modera sus
   * imágenes, así que su primera foto es la única cara del negocio que pasó por
   * un control. `null` = todavía no subió ninguna → inicial en un círculo.
   */
  avatarUrl: string | null;
  rol: RolDeNegocio;
  esPropietario: boolean;
  /**
   * ¿Este NEGOCIO tiene su identidad verificada? (0121)
   *
   * NO es la verificación de la persona: son dos identidades distintas y ésta
   * es la del perfil con el que se actúa. Sale de la misma RPC que todo lo
   * demás porque el cambiador la pinta al lado de cada fila y preguntarla por
   * separado sería un N+1 en el header, que se dibuja en cada navegación.
   *
   * La escribe `public.verificar_identidad_de_negocio()`: alguien con el
   * documento ya validado por Stripe y rol propietario/administrador reclama la
   * verificación del negocio. Un negocio que administrás pero nunca reclamaste
   * queda en `false`, que es exactamente lo que el cliente pidió — «según cada
   * perfil».
   */
  verificada: boolean;
}

export type IdentidadActiva =
  | { tipo: "personal" }
  | { tipo: "negocio"; negocio: IdentidadNegocio };

export const IDENTIDAD_PERSONAL: IdentidadActiva = { tipo: "personal" };

/** ¿Esta identidad puede firmar publicaciones en nombre del negocio? */
export function puedePublicar(identidad: IdentidadActiva): boolean {
  return identidad.tipo === "personal" || ROLES_QUE_PUBLICAN.has(identidad.negocio.rol);
}

/** Fila que devuelve `public.identidades_disponibles()` (0103), literal. */
interface FilaIdentidad {
  business_id: string;
  nombre: string;
  categoria: string | null;
  listing_id: string | null;
  /** Path de storage crudo (o URL absoluta si vino de un seed). Ver 0116. */
  foto: string | null;
  rol: string;
  es_propietario: boolean;
  /** `business_verifications.stripe_status = 'verified'` (0121). */
  verificada: boolean;
}

/** Ver el aviso de ESCAPE DE TIPOS del encabezado. */
function clienteSinTipar(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

function esRol(valor: string): valor is RolDeNegocio {
  return (
    valor === "propietario" ||
    valor === "administrador" ||
    valor === "editor" ||
    valor === "atencion" ||
    valor === "analista"
  );
}

function aIdentidad(fila: FilaIdentidad): IdentidadNegocio | null {
  if (!esRol(fila.rol)) return null;
  return {
    businessId: fila.business_id,
    nombre: fila.nombre,
    categoria: fila.categoria,
    listingId: fila.listing_id,
    avatarUrl: fila.foto ? listingPhotoUrl(fila.foto) : null,
    rol: fila.rol,
    esPropietario: fila.es_propietario,
    // `=== true` y no `Boolean(...)`: la columna es nueva (0121) y una base sin
    // la migración devuelve `undefined`. Ante la duda, SIN verificar — el error
    // caro es afirmar que un perfil está verificado cuando no lo sabemos.
    verificada: fila.verificada === true,
  };
}

/**
 * Negocios con los que quien pregunta puede actuar AHORA (membresía activa).
 *
 * Sale por RPC y no por una consulta a `business_accounts` porque esa tabla solo
 * la lee su DUEÑO: un administrador invitado (0031) vería su membresía pero no
 * el negocio. La RPC es `security definer` y devuelve solo columnas de
 * identidad — los identificadores de Stripe no salen de ahí. Ver la 0103.
 */
export const listarIdentidadesDeNegocio = cache(
  async (): Promise<IdentidadNegocio[]> => {
    try {
      // Sin sesión no hay identidad que elegir: la RPC devolvería vacío igual,
      // pero el header lo pregunta en CADA request y esto ahorra el viaje a la
      // base en todas las pantallas públicas.
      const user = await getCurrentUser();
      if (!user) return [];

      const supabase = await createClient();
      const { data, error } = await clienteSinTipar(supabase).rpc(
        "identidades_disponibles",
      );
      if (error || !Array.isArray(data)) return [];
      return (data as FilaIdentidad[])
        .map(aIdentidad)
        .filter((identidad): identidad is IdentidadNegocio => identidad !== null);
    } catch {
      return [];
    }
  },
);

/**
 * Con qué identidad está actuando la persona. Default seguro: la personal.
 *
 * `cache()` por request: lo consultan el header, el cambiador y Ajustes, y sin
 * esto serían tres veces las mismas dos consultas por navegación (mismo criterio
 * que `getShellContext`).
 */
export const getIdentidadActiva = cache(async (): Promise<IdentidadActiva> => {
  try {
    const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
    if (!user) return IDENTIDAD_PERSONAL;

    const [{ data: fila }, disponibles] = await Promise.all([
      clienteSinTipar(supabase)
        .from("active_identities")
        .select("business_id")
        .eq("profile_id", user.id)
        .maybeSingle(),
      listarIdentidadesDeNegocio(),
    ]);

    const businessId = (fila as { business_id?: string } | null)?.business_id;
    if (!businessId) return IDENTIDAD_PERSONAL;

    // LA REVALIDACIÓN. La fila dice "actuá como este negocio"; la lista dice con
    // cuáles se puede actuar HOY. Manda la lista.
    const negocio = disponibles.find((item) => item.businessId === businessId);
    return negocio ? { tipo: "negocio", negocio } : IDENTIDAD_PERSONAL;
  } catch {
    return IDENTIDAD_PERSONAL;
  }
});
