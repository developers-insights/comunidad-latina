import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * ALERTA COMUNITARIA en el feed (call cliente 2026-07-27: «alerta comunitaria…
 * el barba está desaparecido», «hay un terremoto, hay una ayuda para
 * Venezuela… centros de acopio»).
 *
 * No hay tabla nueva: es el MISMO `broadcasts` de la 0010 (modelo PULL, global
 * sin tenant_id, alcance por `broadcast_targets`, ventana starts_at/ends_at,
 * `cta_url`) leído desde otra superficie. Lo único que separa una emergencia de
 * un aviso común es `broadcasts.severity` (0041):
 *
 *   · `urgent` → sube al feed, donde la gente entra.
 *   · `info`   → se queda SOLO en /notificaciones, como siempre.
 *
 * El acuse también se reusa: `broadcast_receipts`. Descartar acá es el mismo
 * hecho que descartar en notificaciones — no hay dos "vistos" que sincronizar.
 */

type Supabase = SupabaseClient<Database>;

export type UrgentBroadcast = {
  id: string;
  title: string;
  body: string;
  ctaUrl: string | null;
};

/** Cuántas urgentes vigentes se miran antes de elegir. Ver nota de abajo. */
const SCAN_LIMIT = 10;

/**
 * La alerta urgente vigente que ESTE usuario todavía no acusó, o null.
 *
 * FALLO EN BLANDO, siempre (mismo criterio que `fetchPostPolls`): si la lectura
 * falla —la 0041 no está aplicada en ese entorno, se cayó la red, cambió el
 * schema— se devuelve null y el feed se renderiza completo. Una alerta que no
 * carga es una alerta que no se ve; una alerta que revienta se lleva puesto el
 * feed entero, que es infinitamente peor.
 *
 * Por qué se miran varias y no `limit(1)`: la más reciente puede ser justo la
 * que el usuario ya descartó, y abajo puede quedar otra emergencia vigente sin
 * acusar. Con `limit(1)` esa segunda no aparecería nunca. Se traen unas pocas
 * ordenadas por recencia y se elige la primera sin acuse propio — así "la más
 * reciente" significa "la más reciente que todavía tiene algo que decirle a
 * esta persona".
 */
export async function fetchUrgentBroadcast(
  supabase: Supabase,
  viewerId: string | null,
): Promise<UrgentBroadcast | null> {
  // Sin sesión no hay nada que leer: las policies de broadcasts son `to
  // authenticated`, y sin viewer tampoco se puede saber qué ya acusó.
  if (!viewerId) return null;

  try {
    // Schema abierto: `severity` es de la 0041 y todavía no está en
    // database.types.ts (se regenera aparte) — mismo patrón que `saves` y las
    // encuestas. El cast es al cliente, acotado a esta query.
    const open = supabase as unknown as SupabaseClient;
    const nowIso = new Date().toISOString();

    // VIGENCIA EXPLÍCITA, aunque la policy ya la aplique: `broadcasts_select`
    // le deja ver TODO al global_admin (`is_global_admin() or (ventana and
    // targeteado)`). Sin este filtro, el admin —la persona que más va a mirar
    // esta pantalla mientras prueba— vería en su feed alertas vencidas o
    // programadas para el mes que viene.
    const { data, error } = await open
      .from("broadcasts")
      .select("id, title, body, cta_url, starts_at")
      .eq("severity", "urgent")
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("starts_at", { ascending: false })
      .limit(SCAN_LIMIT);

    if (error) {
      console.warn("[feed] alerta comunitaria: query falló", { code: error.code });
      return null;
    }

    const rows = (data ?? []) as Array<{
      id: string;
      title: string;
      body: string;
      cta_url: string | null;
    }>;
    if (rows.length === 0) return null;

    // Acuses PROPIOS. El `.eq("profile_id", viewerId)` no es redundante con la
    // RLS: la policy de select de receipts es `profile_id = auth.uid() OR
    // is_global_admin()`, así que sin este filtro un global_admin se traería
    // los acuses de TODA la comunidad y la alerta le quedaría escondida por
    // gente que no es él.
    const { data: receipts, error: receiptsError } = await open
      .from("broadcast_receipts")
      .select("broadcast_id")
      .eq("profile_id", viewerId)
      .in(
        "broadcast_id",
        rows.map((row) => row.id),
      );

    if (receiptsError) {
      // No se puede saber qué ya descartó. Volver a mostrarle una alerta que
      // ya cerró es molesto; taparle una emergencia que nunca vio es peor.
      console.warn("[feed] alerta comunitaria: acuses fallaron", {
        code: receiptsError.code,
      });
    }

    const seen = new Set(
      ((receipts ?? []) as Array<{ broadcast_id: string }>).map((r) => r.broadcast_id),
    );
    const pending = rows.find((row) => !seen.has(row.id));
    if (!pending) return null;

    return {
      id: pending.id,
      title: pending.title,
      body: pending.body,
      ctaUrl: pending.cta_url,
    };
  } catch (cause) {
    // Red caída, cliente sin cookies, lo que sea: el feed sigue.
    console.warn("[feed] alerta comunitaria: lectura descartada", cause);
    return null;
  }
}
