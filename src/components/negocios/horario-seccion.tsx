import "server-only";

import { Clock } from "@phosphor-icons/react/dist/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BezelCard } from "@/components/ui";
import {
  HORARIO_COPY as C,
  esDiaSemana,
  estadoDeApertura,
  momentoEnZona,
  type DiaSemana,
  type Tramo,
} from "@/lib/horarios";
import { supabaseSinTipar } from "@/lib/resenas";
import { timeZoneLabel } from "@/lib/time/timezone";
import { cn } from "@/lib/utils";
import { HorarioEstado } from "./horario-estado";
import { HorarioSemana } from "./horario-semana";

export interface HorarioSeccionProps {
  /** Cliente Supabase del request. La RLS de la 0093 decide qué se ve. */
  client: SupabaseClient | unknown;
  listingId: string;
  className?: string;
}

interface FilaTramo {
  weekday: number;
  opens_at: string;
  closes_at: string;
}

/**
 * La sección de HORARIOS de una ficha, de punta a punta.
 *
 * ── SI NO HAY HORARIO, NO SE INVENTA UNO ────────────────────────────────────
 * Es la misma decisión que ya estaba escrita en la ficha antes de que estas
 * tablas existieran, y no cambia: la sección se muestra con un vacío honesto en
 * vez de omitirse —que la esconde— o de rellenarse con un "Lunes a viernes de 9
 * a 18" que nadie declaró. Lo único que cambia es que ahora el vacío puede
 * dejar de estar vacío.
 *
 * ── LA ZONA ES DEL NEGOCIO ──────────────────────────────────────────────────
 * Todo lo que se muestra acá está en la zona de `listing_hours.time_zone`, y se
 * dice al pie. Un horario en el reloj de quien mira es un horario equivocado.
 */
export async function HorarioSeccion({ client, listingId, className }: HorarioSeccionProps) {
  const supabase = supabaseSinTipar(client);

  const [configResult, tramosResult] = await Promise.all([
    supabase.from("listing_hours").select("time_zone").eq("listing_id", listingId).maybeSingle(),
    supabase
      .from("listing_hours_slots")
      .select("weekday, opens_at, closes_at")
      .eq("listing_id", listingId)
      .order("weekday", { ascending: true })
      .order("opens_at", { ascending: true }),
  ]);

  if (configResult.error) {
    console.warn("[horarios] no se pudo leer la zona del negocio", {
      listingId,
      code: configResult.error.code,
    });
  }
  if (tramosResult.error) {
    console.warn("[horarios] no se pudieron leer los tramos", {
      listingId,
      code: tramosResult.error.code,
    });
  }

  const timeZone = (configResult.data?.time_zone as string | undefined) ?? null;
  const tramos: Tramo[] = ((tramosResult.data ?? []) as FilaTramo[])
    .filter((fila) => esDiaSemana(fila.weekday))
    .map((fila) => ({
      weekday: fila.weekday as DiaSemana,
      opensAt: fila.opens_at,
      closesAt: fila.closes_at,
    }));

  if (!timeZone || tramos.length === 0) {
    return (
      <BezelCard coreClassName={cn("flex items-start gap-3 p-4", className)}>
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted">
          <Clock size={20} />
        </span>
        <p className="text-sm leading-relaxed text-foreground-secondary">{C.vacio}</p>
      </BezelCard>
    );
  }

  const ahora = new Date();
  const estadoInicial = estadoDeApertura(tramos, timeZone, ahora);
  const hoy = momentoEnZona(ahora, timeZone)?.weekday ?? null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <HorarioEstado tramos={tramos} timeZone={timeZone} estadoInicial={estadoInicial} />
      <HorarioSemana tramos={tramos} zonaLabel={timeZoneLabel(timeZone)} hoy={hoy} />
    </div>
  );
}
