import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { listingViewHref } from "@/lib/monetization/href";
import { firstPhotoUrl } from "@/components/listings";
import {
  DEFAULT_EXPIRY_CONFIG,
  PUBLICACION_COLUMNS,
  estadoDeVencimiento,
  parseExpiryConfig,
  puedeRenovar,
  supabaseSinTiparListings,
  type EstadoVencimiento,
  type ExpiryConfig,
  type MotivoNoRenovable,
  type PublicacionRow,
} from "@/lib/listings";

/**
 * LECTURAS de "Mis publicaciones" (0098).
 *
 * Todo con el cliente del USUARIO: la RLS de `listings` ya limita las filas a
 * las propias (rama `created_by` de `listings_select`), así que acá no hay una
 * segunda verificación de propiedad — habría dos fuentes de verdad para lo
 * mismo. El `.eq('created_by')` que igual va en la consulta es para no traer los
 * avisos published de OTRA gente (que esa misma policy sí deja ver), no para
 * autorizar.
 *
 * Ante cualquier error se devuelve vacío con un `console.warn` que incluye el
 * código: el criterio del repo es que una consulta rota no tira la pantalla,
 * pero nunca en silencio (el incidente de la 0085 fue exactamente eso).
 */

export type PublicacionPropia = {
  id: string;
  kind: string;
  title: string;
  status: string;
  /** Adónde lleva tocar la tarjeta. */
  href: string;
  /** Miniatura, o null si el aviso no tiene fotos. */
  photo: string | null;
  renewalCount: number;
  estado: EstadoVencimiento;
  /** Si se puede renovar AHORA (la base lo vuelve a decidir igual). */
  renovable: boolean;
  /** Por qué no, cuando no. */
  motivo: MotivoNoRenovable | null;
};

export type MisPublicaciones = {
  publicaciones: PublicacionPropia[];
  config: ExpiryConfig;
  /** `false` = no hay sesión: la pantalla muestra el estado "entrá primero". */
  autenticado: boolean;
};

const VACIO: MisPublicaciones = {
  publicaciones: [],
  config: DEFAULT_EXPIRY_CONFIG,
  autenticado: false,
};

/**
 * Perdido y encontrado no tiene fila en `listingDetailHref` (vive dentro de
 * Comunidad), y su fallback de módulo es `/feed`, que sería un link roto de
 * hecho. Se resuelve acá y no en `lib/monetization/href` a propósito: ese módulo
 * lo comparten los flujos de pago y una pantalla nueva no tiene por qué
 * cambiarle el mapa a nadie.
 */
function hrefDePublicacion(kind: string, id: string): string {
  if (kind === "lost_found") return `/comunidad/perdidos/${id}`;
  return listingViewHref(kind, id);
}

/**
 * Orden de la lista: primero lo que pide una decisión.
 *
 * Vencidas arriba de todo (son las que dejaron de mostrarse y la persona
 * probablemente no lo sabe), después las que están por vencer, y al final el
 * resto por fecha. Ordenar por `created_at` a secas escondería justo lo único
 * que hay que hacer en esta pantalla.
 */
const PESO: Record<EstadoVencimiento["estado"], number> = {
  vencida: 0,
  por_vencer: 1,
  vigente: 2,
  no_vence: 3,
};

export async function fetchMisPublicaciones(): Promise<MisPublicaciones> {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !tenant) return VACIO;

  const sinTipar = supabaseSinTiparListings(supabase);

  const [avisos, configuracion] = await Promise.all([
    sinTipar
      .from("listings")
      .select(PUBLICACION_COLUMNS)
      .eq("tenant_id", tenant.id)
      .eq("created_by", user.id)
      .order("created_at", { ascending: false })
      .limit(200),
    sinTipar
      .from("listing_expiry_config")
      .select("dias_de_vigencia, dias_de_aviso, renovaciones_maximas, kinds_que_vencen")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
  ]);

  if (avisos.error) {
    console.warn("[publicaciones] no se pudieron leer los avisos propios", {
      code: avisos.error.code,
    });
    return { ...VACIO, autenticado: true };
  }

  // La ausencia de fila (o un error de lectura) significa los defaults: es el
  // contrato de `app.listing_expiry_config()`, no un fallback improvisado.
  const config = parseExpiryConfig(configuracion.data ?? null);
  const ahora = new Date();

  const publicaciones = ((avisos.data ?? []) as PublicacionRow[])
    .map((row): PublicacionPropia => {
      const vencible = {
        status: row.status,
        kind: row.kind,
        expiresAt: row.expires_at,
        warnAt: row.expiry_warn_at,
        renewalCount: row.renewal_count ?? 0,
      };
      const renovacion = puedeRenovar(vencible, config, ahora);

      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        status: row.status,
        href: hrefDePublicacion(row.kind, row.id),
        photo: firstPhotoUrl(row.photos),
        renewalCount: vencible.renewalCount,
        estado: estadoDeVencimiento(vencible, config, ahora),
        renovable: renovacion.ok,
        motivo: renovacion.ok ? null : renovacion.motivo,
      };
    })
    .sort((a, b) => PESO[a.estado.estado] - PESO[b.estado.estado]);

  return { publicaciones, config, autenticado: true };
}
