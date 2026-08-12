import { BezelCard } from "@/components/ui";
import {
  HORARIO_COPY as C,
  esVeinticuatroHoras,
  horaLegible,
  minutosDeHora,
  semanaOrdenada,
  type DiaSemana,
  type Tramo,
} from "@/lib/horarios";
import { cn } from "@/lib/utils";

export interface HorarioSemanaProps {
  tramos: readonly Tramo[];
  /** Zona del negocio, ya en texto legible ("Nueva York · Nueva Jersey"). */
  zonaLabel: string | null;
  /** Día de HOY en la zona del negocio, para resaltarlo. `null` si no se pudo. */
  hoy: DiaSemana | null;
  className?: string;
}

/** "9:00 am a 1:00 pm", o la etiqueta de 24 h cuando el tramo es el día entero. */
function textoTramo(tramo: Tramo): string {
  if (esVeinticuatroHoras(tramo)) return C.veinticuatroHoras;
  const desde = minutosDeHora(tramo.opensAt);
  const hasta = minutosDeHora(tramo.closesAt);
  if (desde === null || hasta === null) return "";
  return `${horaLegible(desde)} a ${horaLegible(hasta)}`;
}

/**
 * La semana completa.
 *
 * ── SE MUESTRAN LOS SIETE DÍAS, TAMBIÉN LOS CERRADOS ────────────────────────
 * Omitir los días sin atención ahorra tres renglones y le cuesta a la persona
 * una duda: ¿el domingo no está porque cierran o porque el negocio se olvidó de
 * cargarlo? Con los siete a la vista, "Cerrado" es una respuesta.
 *
 * ── NO ES UNA `<table>` ─────────────────────────────────────────────────────
 * Es una lista de definiciones (`<dl>`): día → horario es exactamente eso, y una
 * tabla de dos columnas obliga al lector de pantalla a anunciar encabezados que
 * no aportan nada. En 375 px una tabla además pelea por el ancho; la lista fluye.
 */
export function HorarioSemana({ tramos, zonaLabel, hoy, className }: HorarioSemanaProps) {
  const semana = semanaOrdenada(tramos);

  return (
    <BezelCard coreClassName={cn("p-4", className)}>
      <dl className="flex flex-col gap-1">
        {semana.map((dia) => {
          const esHoy = hoy === dia.weekday;
          return (
            <div
              key={dia.weekday}
              className={cn(
                "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-sm px-2 py-1.5",
                esHoy && "bg-surface-subtle",
              )}
            >
              <dt
                className={cn(
                  "text-sm",
                  esHoy ? "font-semibold text-foreground" : "text-foreground-secondary",
                )}
              >
                {dia.nombre}
                {/* "Hoy" va como texto y no sólo como fondo gris: el resalte de
                    color no puede ser el único portador del dato. */}
                {esHoy && <span className="ml-1.5 text-xs text-foreground-muted">· Hoy</span>}
              </dt>
              <dd
                className={cn(
                  "numeric text-sm",
                  dia.tramos.length === 0
                    ? "text-foreground-muted"
                    : esHoy
                      ? "font-semibold text-foreground"
                      : "text-foreground",
                )}
              >
                {dia.tramos.length === 0 ? (
                  C.cerradoDia
                ) : (
                  <span className="flex flex-col items-end">
                    {dia.tramos.map((tramo) => (
                      <span key={`${tramo.opensAt}-${tramo.closesAt}`}>{textoTramo(tramo)}</span>
                    ))}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-3 border-t border-border-subtle pt-3 text-xs leading-relaxed text-foreground-muted">
        {C.fuente}
        {zonaLabel ? ` ${C.zonaNota(zonaLabel)}` : ""}
      </p>
    </BezelCard>
  );
}
