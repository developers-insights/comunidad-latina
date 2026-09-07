"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, MagnifyingGlass, Users } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar, BottomSheet, Button, Input } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import type { CodigoDeLlamada } from "@/lib/calls/errores";
import { COPY } from "./copy";

export interface CandidatoUI {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface HojaAgregarProps {
  open: boolean;
  onClose: () => void;
  candidatos: CandidatoUI[];
  /** Ids que ya tienen fila en `call_participants`. */
  yaEnLlamada: string[];
  /** Cuántas caben todavía. Sale del conteo de filas, no de quién está conectado. */
  cupo: number;
  onInvitar: (ids: string[]) => Promise<{ ok: true; sumados: number } | { ok: false; code: CodigoDeLlamada }>;
}

/**
 * Sumar gente a una llamada en curso.
 *
 * ── EL TOPE SE MUESTRA ANTES DE CHOCARLO ────────────────────────────────────
 * "Máximo 10 participantes" está siempre a la vista y el cupo restante se
 * cuenta en vivo; al llegar al límite, las filas que sobran quedan
 * deshabilitadas en vez de dejar elegir y fallar al confirmar. Aun así el
 * `CALL_FULL` de la base se traduce igual: entre que se abre esta hoja y se
 * toca Añadir, otro puede haber sumado a alguien, y ese "no" tiene que salir
 * como una frase y no como un error de Postgres.
 */
export function HojaAgregar({
  open,
  onClose,
  candidatos,
  yaEnLlamada,
  cupo,
  onInvitar,
}: HojaAgregarProps) {
  const { toast } = useToast();
  const [busqueda, setBusqueda] = useState("");
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [enviando, iniciarEnvio] = useTransition();

  const dentro = useMemo(() => new Set(yaEnLlamada), [yaEnLlamada]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return candidatos;
    return candidatos.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [candidatos, busqueda]);

  const restantes = Math.max(0, cupo - elegidos.length);
  const sinCupo = cupo <= 0;

  function alternar(id: string) {
    setElegidos((previos) => {
      if (previos.includes(id)) return previos.filter((x) => x !== id);
      if (previos.length >= cupo) return previos;
      return [...previos, id];
    });
  }

  function confirmar() {
    if (elegidos.length === 0 || enviando) return;
    iniciarEnvio(async () => {
      const resultado = await onInvitar(elegidos);
      if (resultado.ok) {
        toast({
          title: COPY.agregar.okTitle(resultado.sumados),
          description: COPY.agregar.okBody,
          variant: "success",
        });
        setElegidos([]);
        onClose();
        return;
      }
      const { title, body } = mensajeDeFallo(resultado.code);
      toast({ title, description: body, variant: "danger" });
    });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={COPY.agregar.sheetTitle}
      size="tall"
      bodyClassName="flex flex-col overflow-hidden p-0"
    >
      <div className="shrink-0 px-6 pb-3 pt-1">
        <p className="text-sm text-foreground-secondary">{COPY.agregar.intro}</p>

        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 py-1 font-medium text-foreground-secondary">
            <Users size={13} aria-hidden="true" />
            {COPY.agregar.tope}
          </span>
          <span
            className={cn(
              "font-medium",
              sinCupo ? "text-danger-ink" : "text-foreground-muted",
            )}
          >
            {sinCupo ? COPY.agregar.sinCupo : COPY.agregar.cupo(restantes)}
          </span>
        </div>

        <div className="relative mt-3">
          <MagnifyingGlass
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
          />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={COPY.agregar.buscar}
            aria-label={COPY.agregar.buscar}
            className="pl-9"
          />
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {visibles.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-foreground-muted">
            {busqueda.trim() ? COPY.agregar.vacio : COPY.agregar.vacioSinBusqueda}
          </li>
        )}

        {visibles.map((persona) => {
          const yaEsta = dentro.has(persona.id);
          const elegido = elegidos.includes(persona.id);
          const bloqueado = yaEsta || (!elegido && restantes === 0);

          return (
            <li key={persona.id}>
              <label
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2",
                  "transition-[background-color] duration-(--duration-fast)",
                  "focus-within:ring-[3px] focus-within:ring-focus-ring",
                  bloqueado
                    ? "cursor-not-allowed opacity-55"
                    : "cursor-pointer hover:bg-surface-subtle",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={elegido}
                  disabled={bloqueado}
                  onChange={() => alternar(persona.id)}
                />
                <Avatar src={persona.avatarUrl} name={persona.displayName} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {persona.displayName}
                  </span>
                  {yaEsta && (
                    <span className="block text-xs text-foreground-muted">
                      {COPY.agregar.yaEsta}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    // `cl-print-hide`: la tilde es tinta clara sobre relleno de
                    // marca, y el relleno no se imprime — en papel quedaría en
                    // 1.00:1. Una hoja de "elegir a quién llamar" no tiene nada
                    // que hacer impresa igual.
                    "cl-print-hide flex size-6 shrink-0 items-center justify-center rounded-full border",
                    "transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                    elegido
                      ? "scale-100 border-brand bg-brand text-brand-foreground"
                      : "border-border bg-surface",
                  )}
                >
                  {elegido && <Check size={14} weight="bold" />}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 border-t border-border-subtle px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <Button
          className="w-full"
          disabled={elegidos.length === 0}
          loading={enviando}
          onClick={confirmar}
        >
          {COPY.agregar.boton(elegidos.length)}
        </Button>
      </div>
    </BottomSheet>
  );
}

/** Un "no" de la base es una frase, nunca un código. */
export function mensajeDeFallo(code: CodigoDeLlamada): { title: string; body: string } {
  switch (code) {
    case "call-full":
      return { title: COPY.fallos.llenaTitle, body: COPY.fallos.llenaBody };
    case "account-suspended":
      return { title: COPY.fallos.suspendidaTitle, body: COPY.fallos.suspendidaBody };
    case "forbidden":
      return { title: COPY.fallos.prohibidaTitle, body: COPY.fallos.prohibidaBody };
    case "gone":
      return { title: COPY.fallos.terminadaTitle, body: COPY.fallos.terminadaBody };
    case "rate-limited":
      return { title: COPY.fallos.rapidoTitle, body: COPY.fallos.rapidoBody };
    default:
      return { title: COPY.fallos.genericoTitle, body: COPY.fallos.genericoBody };
  }
}
