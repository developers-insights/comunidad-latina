"use client";

import { useActionState, useId, useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, Field, Input, Select } from "@/components/ui";
import {
  HORARIO_COPY as C,
  MAX_TRAMOS_POR_DIA,
  NOMBRE_DIA,
  ORDEN_SEMANA,
  type DiaSemana,
  type Tramo,
} from "@/lib/horarios";
import { TIME_ZONES, TIME_ZONE_GROUPS } from "@/lib/time/timezone";
import { guardarHorarioAction } from "@/app/(app)/negocios/[id]/horario/actions";
import { HORARIO_STATE_INICIAL } from "@/app/(app)/negocios/[id]/horario/estado";
import { cn } from "@/lib/utils";

export interface HorarioEditorProps {
  listingId: string;
  timeZoneInicial: string | null;
  tramosIniciales: readonly Tramo[];
  className?: string;
}

type ModoDia = "cerrado" | "abierto" | "veinticuatro";

interface EstadoDia {
  modo: ModoDia;
  tramos: { opensAt: string; closesAt: string }[];
}

const TRAMO_POR_DEFECTO = { opensAt: "09:00", closesAt: "18:00" };

/**
 * Editor del horario de atención.
 *
 * ── TRES MODOS POR DÍA, Y NO UN CAMPO LIBRE ─────────────────────────────────
 * Cerrado · Abierto · Las 24 horas. El modo existe porque las tres situaciones
 * se cargan distinto y confundirlas es el error clásico: "abierto 24 h" escrito
 * como 00:00 a 00:00 es exactamente el caso que la base prohíbe por ambiguo.
 * Acá el modo lo traduce el editor y la persona nunca tiene que saberlo.
 *
 * ── LOS TRAMOS SE MANDAN COMO JSON ──────────────────────────────────────────
 * La cantidad de tramos por día es dinámica, así que agregar y quitar ya
 * necesita JavaScript. Serializar la semana en un campo oculto es honesto con
 * eso, y del otro lado hay un zod que la valida entera antes de tocar la base:
 * el JSON es transporte, no confianza.
 *
 * ── QUIÉN VE ESTA PANTALLA ──────────────────────────────────────────────────
 * Lo decide el servidor (`puedo_administrar_aviso`), y lo vuelve a decidir la
 * RPC al guardar. Este componente no es una barrera de seguridad y no pretende
 * serlo.
 */
export function HorarioEditor({
  listingId,
  timeZoneInicial,
  tramosIniciales,
  className,
}: HorarioEditorProps) {
  const zonaId = useId();
  const [state, formAction, pending] = useActionState(
    guardarHorarioAction,
    HORARIO_STATE_INICIAL,
  );
  const [zona, setZona] = useState(timeZoneInicial ?? "");
  const [dias, setDias] = useState<Record<DiaSemana, EstadoDia>>(() =>
    armarEstadoInicial(tramosIniciales),
  );

  const tramos = aTramos(dias);

  function actualizarDia(weekday: DiaSemana, cambio: Partial<EstadoDia>) {
    setDias((previo) => ({ ...previo, [weekday]: { ...previo[weekday], ...cambio } }));
  }

  return (
    <BezelCard coreClassName={cn("flex flex-col gap-5 p-4", className)}>
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">{C.editarTitulo}</h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{C.editarIntro}</p>
      </div>

      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="listingId" value={listingId} />
        <input type="hidden" name="tramos" value={JSON.stringify(tramos)} />

        <Field htmlFor={zonaId} label={C.zonaLabel} help={C.zonaHelp}>
          <Select
            id={zonaId}
            name="timeZone"
            value={zona}
            onChange={(event) => setZona(event.target.value)}
            required
          >
            <option value="">Elegí una zona</option>
            {TIME_ZONE_GROUPS.map((grupo) => (
              <optgroup key={grupo} label={grupo}>
                {TIME_ZONES.filter((opcion) => opcion.group === grupo).map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <ul className="flex flex-col gap-3">
          {ORDEN_SEMANA.map((weekday) => {
            const dia = dias[weekday];
            return (
              <li key={weekday}>
                <fieldset className="rounded-md border border-border-subtle p-3">
                  <legend className="px-1 text-sm font-semibold text-foreground">
                    {NOMBRE_DIA[weekday]}
                  </legend>

                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["cerrado", C.diaCerrado],
                        ["abierto", C.diaAbierto],
                        ["veinticuatro", C.diaVeinticuatro],
                      ] as [ModoDia, string][]
                    ).map(([modo, etiqueta]) => {
                      const id = `${zonaId}-${weekday}-${modo}`;
                      const activo = dia.modo === modo;
                      return (
                        <span key={modo} className="relative inline-flex">
                          <input
                            type="radio"
                            id={id}
                            name={`modo-${weekday}`}
                            value={modo}
                            checked={activo}
                            onChange={() =>
                              actualizarDia(weekday, {
                                modo,
                                tramos:
                                  modo === "abierto" && dia.tramos.length === 0
                                    ? [{ ...TRAMO_POR_DEFECTO }]
                                    : dia.tramos,
                              })
                            }
                            className="peer sr-only"
                          />
                          <label
                            htmlFor={id}
                            className={cn(
                              "inline-flex h-11 cursor-pointer items-center rounded-full px-4 text-sm font-medium",
                              "transition-colors duration-(--duration-fast)",
                              "peer-focus-visible:outline-none peer-focus-visible:ring-[3px] peer-focus-visible:ring-focus-ring",
                              // `cl-print-hide` a mano: la píldora activa es
                              // `bg-brand text-brand-foreground`, y el @media
                              // print sólo esconde `button` — esto es un <label>,
                              // así que sin el hook queda blanco sobre blanco.
                              // Un selector de formulario tampoco significa nada
                              // en papel. Ver src/test/print-contract.test.ts.
                              "cl-print-hide",
                              activo
                                ? "bg-brand text-brand-foreground"
                                : "bg-surface-subtle text-foreground-secondary hover:bg-surface-hover",
                            )}
                          >
                            {etiqueta}
                          </label>
                        </span>
                      );
                    })}
                  </div>

                  {dia.modo === "abierto" && (
                    <div className="mt-3 flex flex-col gap-2">
                      {dia.tramos.map((tramo, indice) => (
                        <div key={indice} className="flex flex-wrap items-end gap-2">
                          <label className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-xs text-foreground-secondary">{C.desde}</span>
                            <Input
                              type="time"
                              value={tramo.opensAt}
                              onChange={(event) =>
                                actualizarDia(weekday, {
                                  tramos: dia.tramos.map((t, i) =>
                                    i === indice ? { ...t, opensAt: event.target.value } : t,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-xs text-foreground-secondary">{C.hasta}</span>
                            <Input
                              type="time"
                              value={tramo.closesAt}
                              onChange={(event) =>
                                actualizarDia(weekday, {
                                  tramos: dia.tramos.map((t, i) =>
                                    i === indice ? { ...t, closesAt: event.target.value } : t,
                                  ),
                                })
                              }
                            />
                          </label>
                          {dia.tramos.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`${C.quitarTramo} — ${NOMBRE_DIA[weekday]}`}
                              onClick={() =>
                                actualizarDia(weekday, {
                                  tramos: dia.tramos.filter((_, i) => i !== indice),
                                })
                              }
                            >
                              <Trash size={16} aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      ))}

                      {dia.tramos.length < MAX_TRAMOS_POR_DIA && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          onClick={() =>
                            actualizarDia(weekday, {
                              tramos: [...dia.tramos, { ...TRAMO_POR_DEFECTO }],
                            })
                          }
                        >
                          <Plus size={16} aria-hidden="true" />
                          {C.agregarTramo}
                        </Button>
                      )}
                    </div>
                  )}
                </fieldset>
              </li>
            );
          })}
        </ul>

        {state.status !== "idle" && (
          <p
            role={state.status === "success" ? "status" : "alert"}
            className={cn(
              "text-sm font-medium",
              state.status === "success" ? "text-success-ink" : "text-danger",
            )}
          >
            {state.message}
          </p>
        )}

        <Button type="submit" variant="primary" loading={pending}>
          {pending ? C.guardando : C.guardar}
        </Button>
      </form>
    </BezelCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Traducción entre lo que guarda la base y lo que muestra el editor           */
/* -------------------------------------------------------------------------- */

function armarEstadoInicial(tramos: readonly Tramo[]): Record<DiaSemana, EstadoDia> {
  const base = {} as Record<DiaSemana, EstadoDia>;

  for (const weekday of ORDEN_SEMANA) {
    const delDia = tramos.filter((tramo) => tramo.weekday === weekday);

    if (delDia.length === 0) {
      base[weekday] = { modo: "cerrado", tramos: [{ ...TRAMO_POR_DEFECTO }] };
      continue;
    }

    const esTodoElDia =
      delDia.length === 1 && delDia[0].opensAt.startsWith("00:00") && delDia[0].closesAt.startsWith("24:00");

    base[weekday] = {
      modo: esTodoElDia ? "veinticuatro" : "abierto",
      tramos: esTodoElDia
        ? [{ ...TRAMO_POR_DEFECTO }]
        : delDia.map((tramo) => ({
            opensAt: tramo.opensAt.slice(0, 5),
            closesAt: tramo.closesAt.slice(0, 5),
          })),
    };
  }

  return base;
}

function aTramos(dias: Record<DiaSemana, EstadoDia>): Tramo[] {
  const salida: Tramo[] = [];

  for (const weekday of ORDEN_SEMANA) {
    const dia = dias[weekday];
    if (dia.modo === "cerrado") continue;
    if (dia.modo === "veinticuatro") {
      salida.push({ weekday, opensAt: "00:00", closesAt: "24:00" });
      continue;
    }
    for (const tramo of dia.tramos) {
      salida.push({ weekday, opensAt: tramo.opensAt, closesAt: tramo.closesAt });
    }
  }

  return salida;
}
