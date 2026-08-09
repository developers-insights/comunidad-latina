"use client";

import { useState, useTransition } from "react";
import { Clock } from "@phosphor-icons/react/dist/ssr";
import { updateTimeZoneAction } from "@/app/(app)/perfil/actions";
import {
  TIME_ZONES,
  TIME_ZONE_GROUPS,
  isKnownTimeZone,
  timeZoneLabel,
} from "@/lib/time/timezone";
import { useBrowserTimeZone, useHydrated } from "@/components/time/viewer-time-zone";
import { Select, useToast } from "@/components/ui";

/**
 * Fila "Zona horaria" de Ajustes.
 *
 * ── EL PROBLEMA QUE RESUELVE, CONTADO COMO LO VIVE LA PERSONA ────────────────
 * Alguien en Los Ángeles publica a las 22:00 y la app le fecha la publicación
 * AL DÍA SIGUIENTE. No es un detalle de programación: es la app diciéndole que
 * hizo algo un día que todavía no pasó. Venía de que TODO el repo formateaba en
 * `America/New_York` — razonable para el núcleo de la comunidad, falso para la
 * mitad del público, que está repartido entre NY, NJ, Miami, Houston, Chicago
 * y LA.
 *
 * ── SE MUESTRA LA HORA, NO EL NOMBRE DE LA ZONA ──────────────────────────────
 * Debajo del selector va la hora que la app va a mostrar con la opción elegida.
 * Es la única forma de que alguien que no sabe qué es "America/Denver"
 * verifique que acertó: mira el reloj de su teléfono y compara.
 *
 * ── LA SUGERENCIA ────────────────────────────────────────────────────────────
 * Si la persona nunca eligió, se le ofrece la zona que dice su navegador (y sólo
 * si está en el catálogo: sugerir la zona equivocada es peor que no sugerir
 * nada). La sugerencia NO se guarda sola — guardar un dato de ubicación sin que
 * nadie lo pida es exactamente lo que esta app no hace.
 */

const COPY = {
  title: "Zona horaria",
  description: "Con qué reloj se muestran las fechas y las horas de la app.",
  auto: "La que detecte tu teléfono",
  now: (time: string) => `Ahora, con esta zona, son las ${time}.`,
  suggestion: (label: string) => `Parece que estás en ${label}.`,
  useSuggestion: "Usar esa",
  saved: "Listo, las fechas se muestran con tu zona.",
  error: "No pudimos guardar tu zona horaria. Probá de nuevo en un momento.",
} as const;

export function TimeZoneRow({ initial }: { initial: string | null }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [zone, setZone] = useState(initial ?? "");

  /**
   * La zona del navegador y la hora sólo se saben DESPUÉS de hidratar: el
   * servidor no puede conocer ninguna de las dos. Renderizarlas en el primer
   * paso daría un mismatch de hidratación y una hora que parpadea.
   *
   * Los dos hooks son `useSyncExternalStore`, no efectos con `setState`: React
   * usa el snapshot del servidor para el HTML y la hidratación, y el del
   * cliente de ahí en más. Sin render extra disparado a mano y sin el
   * antipatrón que marca `react-hooks/set-state-in-effect`. Ver la nota larga
   * de `components/time/viewer-time-zone.tsx`.
   */
  const hydrated = useHydrated();
  const browserZone = useBrowserTimeZone();

  // Se sugiere SÓLO si está en el catálogo: alguien en `America/Indiana/
  // Vincennes` no encuentra su opción en la lista, y sugerirle la zona
  // equivocada es peor que no sugerirle nada.
  const suggested =
    !initial && browserZone && isKnownTimeZone(browserZone) ? browserZone : null;

  // La hora se deriva EN EL RENDER de la zona vigente. `new Date()` acá es
  // seguro porque `hydrated` es false durante el HTML y la hidratación: en el
  // servidor esta rama no corre.
  const effectiveZone = zone || browserZone;
  const now =
    hydrated && effectiveZone
      ? new Date().toLocaleTimeString("es-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: effectiveZone,
        })
      : null;

  function save(next: string) {
    const previous = zone;
    setZone(next);
    startTransition(async () => {
      const result = await updateTimeZoneAction({ timeZone: next });
      if (result.ok) {
        toast({ title: COPY.saved, variant: "success" });
        return;
      }
      // Se revierte: dejar el selector mostrando algo que no se guardó es
      // mentirle a la persona sobre el estado de su cuenta.
      setZone(previous);
      toast({ title: COPY.error, variant: "danger" });
    });
  }

  return (
    <div className="flex min-h-14 flex-col gap-2 px-3 py-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
        >
          <Clock size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <label htmlFor="ajustes-zona" className="block text-sm font-semibold text-foreground">
            {COPY.title}
          </label>
          <span className="block text-xs text-foreground-secondary">
            {COPY.description}
          </span>
        </span>
      </div>

      <Select
        id="ajustes-zona"
        value={zone}
        disabled={pending}
        onChange={(event) => save(event.target.value)}
        className="ml-12 w-[calc(100%-3rem)]"
      >
        <option value="">{COPY.auto}</option>
        {TIME_ZONE_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {TIME_ZONES.filter((z) => z.group === group).map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      <div className="ml-12 flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* `aria-live`: al cambiar la zona, quien escucha la pantalla también
            tiene que enterarse de qué hora quedó. */}
        <p aria-live="polite" className="text-xs text-foreground-muted">
          {now ? COPY.now(now) : ""}
        </p>
        {suggested && zone === "" && (
          <>
            <span className="text-xs text-foreground-muted">
              {COPY.suggestion(timeZoneLabel(suggested) ?? suggested)}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => save(suggested)}
              className="min-h-11 rounded-sm text-xs font-semibold text-brand-ink underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring disabled:opacity-50"
            >
              {COPY.useSuggestion}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
